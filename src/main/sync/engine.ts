import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SyncRecord } from '../../shared/sync'
import type { History } from '../history'
import { currentKey, parseHeader, sealWith, SyncCryptoError, unsealWith, type Keyring, type SyncHeader } from './crypto.ts'
import { chunkContext, compactChunks, decodeChunk, encodeChunk, planApply, unappliedRecords, type Chunk } from './log.ts'

export const HEADER_FILE = 'sync.json'
/** File and folder names YARC writes: random hex. Anything else (.DS_Store, conflict copies, temp files) is ignored. */
const ID = /^[0-9a-f]{16,64}$/
/** iCloud Drive (before macOS 14) replaces a file it evicted to save space with `.<name>.icloud`. */
const ICLOUD_PLACEHOLDER = /^\.([0-9a-f]{16,64})\.icloud$/

export function newSyncId(): string {
  return randomBytes(16).toString('hex')
}

export interface SyncedProfileInfo {
  key: string
  name: string
}

export interface EngineOptions {
  root: string
  deviceId: string
  keyring: Keyring
  chunkRecords?: number
  compactAfter?: number
  bigChunk?: number
}

export interface ReceiveResult {
  applied: number
  waiting: number
  unknownKey: boolean
}

interface OwnChunk {
  name: string
  size: number
  chunk: Chunk
}

export class SyncEngine {
  readonly root: string
  readonly deviceId: string
  keyring: Keyring
  private chunkRecords: number
  private compactAfter: number
  private bigChunk: number
  private publishedProfiles: string | undefined

  constructor(options: EngineOptions) {
    this.root = options.root
    this.deviceId = options.deviceId
    this.keyring = options.keyring
    this.chunkRecords = options.chunkRecords ?? 5000
    this.compactAfter = options.compactAfter ?? 16
    this.bigChunk = options.bigChunk ?? 1024 * 1024
  }

  private logDir(profileKey: string, device = this.deviceId): string {
    return join(this.root, 'history', profileKey, device)
  }

  /** Read from the folder after sync was off and on again: other devices keep a cursor per device, so numbers must never repeat. */
  async lastSeq(profileKey: string, history: History): Promise<number> {
    const known = history.meta('seq')
    if (known !== undefined) return Number(known)
    const own = await this.readOwn(profileKey)
    const last = Math.max(0, ...own.map((owned) => owned.chunk.last))
    history.setMeta('seq', String(last))
    return last
  }

  /** Synchronous, so it can run while the app quits. */
  send(profileKey: string, history: History): number {
    let sent = 0
    for (;;) {
      const outbox = history.outbox(this.chunkRecords)
      if (outbox.records.length === 0) return sent
      const first = Number(history.meta('seq') ?? 0) + 1
      const records = outbox.records.map((record, index) => ({ ...record, seq: first + index }) as SyncRecord)
      const chunk: Chunk = { first, last: first + records.length - 1, records }
      writeAtomic(join(this.logDir(profileKey), newSyncId()), encodeChunk(chunk, this.keyring, chunkContext(profileKey, this.deviceId)))
      history.setMeta('seq', String(chunk.last))
      history.markSent(outbox)
      sent += records.length
    }
  }

  async receive(profileKey: string, history: History): Promise<ReceiveResult> {
    const result: ReceiveResult = { applied: 0, waiting: 0, unknownKey: false }
    const devices = (await listNames(join(this.root, 'history', profileKey))).ready.filter((device) => device !== this.deviceId)
    const known = history.readFiles()
    for (const device of devices) {
      const dir = this.logDir(profileKey, device)
      const { ready, evicted } = await listNames(dir)
      requestDownload(evicted.map((name) => join(dir, name)))
      result.waiting += evicted.length
      const present = new Set([...ready, ...evicted].map((name) => `${device}/${name}`))
      history.forgetFiles([...known.keys()].filter((file) => file.startsWith(`${device}/`) && !present.has(file)))
      const cursor = history.cursor(device)
      const fresh: { name: string; chunk: Chunk }[] = []
      for (const name of ready) {
        const id = `${device}/${name}`
        if (known.has(id)) continue
        try {
          fresh.push({ name: id, chunk: decodeChunk(await readFile(join(dir, name)), this.keyring, chunkContext(profileKey, device)) })
        } catch (err) {
          // Still downloading, cut short, or sealed with a newer key: try again next time.
          if (err instanceof SyncCryptoError && err.code === 'unknown-key') result.unknownKey = true
          else if (!(err instanceof SyncCryptoError)) console.warn('[sync] could not read a chunk:', (err as Error).message)
          result.waiting++
        }
      }
      const plan = planApply(fresh, cursor)
      for (const { name, chunk } of plan.apply) {
        const records = unappliedRecords(chunk, history.cursor(device))
        history.applyRemote(device, records, chunk.last)
        history.rememberFile(name, chunk.last)
        result.applied += records.length
      }
      const now = history.cursor(device)
      for (const { name, chunk } of fresh) if (chunk.last <= now) history.rememberFile(name, chunk.last)
      result.waiting += plan.waiting.length
    }
    return result
  }

  async compact(profileKey: string, history: History): Promise<boolean> {
    const own = (await this.readOwn(profileKey)).sort((one, other) => one.chunk.first - other.chunk.first)
    const lastBig = own.findLastIndex((owned) => owned.size >= this.bigChunk)
    const small = own.slice(lastBig + 1)
    if (small.length < this.compactAfter) return false
    this.replaceOwn(profileKey, [compactChunks(small.map((owned) => owned.chunk), history.tombstones())], small)
    return true
  }

  async reencrypt(profileKey: string, history: History): Promise<void> {
    const own = await this.readOwn(profileKey)
    const tombstones = history.tombstones()
    for (const owned of own) this.replaceOwn(profileKey, [compactChunks([owned.chunk], tombstones)], [owned])
  }

  private replaceOwn(profileKey: string, chunks: Chunk[], old: OwnChunk[]): void {
    const dir = this.logDir(profileKey)
    for (const chunk of chunks) writeAtomic(join(dir, newSyncId()), encodeChunk(chunk, this.keyring, chunkContext(profileKey, this.deviceId)))
    for (const owned of old) rmSync(join(dir, owned.name), { force: true })
  }

  private async readOwn(profileKey: string): Promise<OwnChunk[]> {
    const dir = this.logDir(profileKey)
    const { ready } = await listNames(dir)
    const own: OwnChunk[] = []
    for (const name of ready) {
      const data = await readFile(join(dir, name))
      own.push({ name, size: data.length, chunk: decodeChunk(data, this.keyring, chunkContext(profileKey, this.deviceId)) })
    }
    return own
  }

  writeProfiles(profiles: SyncedProfileInfo[]): void {
    const list = JSON.stringify(profiles)
    // Sealing again changes the file, which every other device then copies and reads: only when the list or the key changed.
    const published = `${currentKey(this.keyring).id} ${list}`
    if (published === this.publishedProfiles) return
    writeAtomic(join(this.root, 'profiles', this.deviceId), sealWith(this.keyring, Buffer.from(list), `profiles/${this.deviceId}`))
    this.publishedProfiles = published
  }

  async readProfiles(): Promise<SyncedProfileInfo[]> {
    const dir = join(this.root, 'profiles')
    const byKey = new Map<string, SyncedProfileInfo>()
    for (const device of (await listNames(dir)).ready) {
      try {
        const list = JSON.parse(unsealWith(this.keyring, await readFile(join(dir, device)), `profiles/${device}`).toString('utf8')) as SyncedProfileInfo[]
        for (const profile of list) if (ID.test(profile.key) && !byKey.has(profile.key)) byKey.set(profile.key, profile)
      } catch {
        // Unreadable for now (downloading, or a newer key); its profiles show up next time.
      }
    }
    return [...byKey.values()]
  }
}

export async function readHeader(root: string): Promise<SyncHeader | undefined> {
  let text: string
  try {
    text = await readFile(join(root, HEADER_FILE), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      requestDownload(await exists(join(root, `.${HEADER_FILE}.icloud`)) ? [join(root, HEADER_FILE)] : [])
      return undefined
    }
    throw err
  }
  return parseHeader(text)
}

export function removeSyncFiles(root: string): void {
  for (const name of [HEADER_FILE, `.${HEADER_FILE}.icloud`, 'profiles', 'history']) rmSync(join(root, name), { recursive: true, force: true })
}

export function writeHeader(root: string, header: SyncHeader): void {
  writeAtomic(join(root, HEADER_FILE), Buffer.from(`${JSON.stringify(header, null, 2)}\n`))
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function listNames(dir: string): Promise<{ ready: string[]; evicted: string[] }> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return { ready: [], evicted: [] }
  }
  const ready = names.filter((name) => ID.test(name))
  const evicted = names.flatMap((name) => ICLOUD_PLACEHOLDER.exec(name)?.[1] ?? []).filter((name) => !ready.includes(name))
  return { ready, evicted }
}

/** Asks iCloud Drive to download evicted files; the folder watcher picks them up once they're back. */
function requestDownload(paths: string[]): void {
  if (process.platform !== 'darwin') return
  for (const path of paths) execFile('/usr/bin/brctl', ['download', path], () => {})
}

/** Writes to a temporary name, then renames, so other devices never see half a file from this side. */
export function writeAtomic(path: string, data: Buffer): void {
  const dir = join(path, '..')
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `.${newSyncId()}.tmp`)
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

