// Reads and writes the sync folder for history. No Electron imports, and value imports carry .ts,
// so unit tests load it in plain Node.
//
// Folder layout; every name past the top level is a random hex ID:
//   sync.json                                   salt, key-derivation parameters, check value, sealed keyring
//   profiles/<device>                           sealed: the profiles this device syncs (sync key + name)
//   history/<profile key>/<device>/<chunk>      sealed, gzipped runs of history records
// Each device writes only its own files, and never changes a chunk once written (compaction
// writes a new chunk, then deletes the old ones), so sync services never see edit conflicts.
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SyncRecord } from '../../shared/sync'
import type { History } from '../history'
import { parseHeader, sealWith, SyncCryptoError, unsealWith, type Keyring, type SyncHeader } from './crypto.ts'
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
  /** Random, the same on every device that syncs this profile. */
  key: string
  name: string
}

export interface EngineOptions {
  root: string
  deviceId: string
  keyring: Keyring
  /** Records per chunk when sending; a big backlog (the first sync) is split. */
  chunkRecords?: number
  /** Merge a device's small chunks once it has this many. */
  compactAfter?: number
  /** Chunks at least this big (bytes) are left alone by routine compaction. */
  bigChunk?: number
}

export interface ReceiveResult {
  applied: number
  /** Chunks that couldn't be read yet: still downloading, evicted by iCloud, or behind a missing chunk. */
  waiting: number
  /** A chunk is sealed with a key this device doesn't have: the password changed on another device. */
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

  constructor(o: EngineOptions) {
    this.root = o.root
    this.deviceId = o.deviceId
    this.keyring = o.keyring
    this.chunkRecords = o.chunkRecords ?? 5000
    this.compactAfter = o.compactAfter ?? 16
    this.bigChunk = o.bigChunk ?? 1024 * 1024
  }

  private logDir(profileKey: string, device = this.deviceId): string {
    return join(this.root, 'history', profileKey, device)
  }

  // ---------------------------------------------------------------- sending

  /**
   * The last sequence number this device used in `profileKey`'s log. Read from the folder when
   * the local copy is missing (sync was turned off and on again), so numbers never repeat.
   */
  async lastSeq(profileKey: string, history: History): Promise<number> {
    const known = history.meta('seq')
    if (known !== undefined) return Number(known)
    const own = await this.readOwn(profileKey)
    const last = Math.max(0, ...own.map((c) => c.chunk.last))
    history.setMeta('seq', String(last))
    return last
  }

  /**
   * Writes everything in `history`'s outbox to new chunks in this device's log. Synchronous, so
   * it can run while the app quits. Call `lastSeq` once before the first send.
   */
  send(profileKey: string, history: History): number {
    let sent = 0
    for (;;) {
      const outbox = history.outbox(this.chunkRecords)
      if (outbox.records.length === 0) return sent
      const first = Number(history.meta('seq') ?? 0) + 1
      const records = outbox.records.map((r, i) => ({ ...r, seq: first + i }) as SyncRecord)
      const chunk: Chunk = { first, last: first + records.length - 1, records }
      writeAtomic(join(this.logDir(profileKey), newSyncId()), encodeChunk(chunk, this.keyring, chunkContext(profileKey, this.deviceId)))
      history.setMeta('seq', String(chunk.last))
      history.markSent(outbox)
      sent += records.length
    }
  }

  // ---------------------------------------------------------------- receiving

  /** Applies every other device's new records for `profileKey`, from where it last stopped. */
  async receive(profileKey: string, history: History): Promise<ReceiveResult> {
    const result: ReceiveResult = { applied: 0, waiting: 0, unknownKey: false }
    const devices = (await listNames(join(this.root, 'history', profileKey))).ready.filter((d) => d !== this.deviceId)
    const known = history.readFiles()
    for (const device of devices) {
      const dir = this.logDir(profileKey, device)
      const { ready, evicted } = await listNames(dir)
      requestDownload(evicted.map((n) => join(dir, n)))
      result.waiting += evicted.length
      const present = new Set([...ready, ...evicted].map((n) => `${device}/${n}`))
      history.forgetFiles([...known.keys()].filter((k) => k.startsWith(`${device}/`) && !present.has(k)))
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

  // ---------------------------------------------------------------- compaction

  /**
   * Keeps this device's log from growing without limit: once it has `compactAfter` small chunks,
   * they're merged into one, dropping records that no longer matter (see `compactChunks`).
   * Chunks of `bigChunk` bytes or more are left alone, so routine compaction rewrites little.
   */
  async compact(profileKey: string, history: History): Promise<boolean> {
    const own = (await this.readOwn(profileKey)).sort((a, b) => a.chunk.first - b.chunk.first)
    const lastBig = own.findLastIndex((c) => c.size >= this.bigChunk)
    const small = own.slice(lastBig + 1)
    if (small.length < this.compactAfter) return false
    this.replaceOwn(profileKey, [compactChunks(small.map((c) => c.chunk), history.tombstones())], small)
    return true
  }

  /** After a password change: rewrites every chunk of this device's log with the newest key. */
  async reencrypt(profileKey: string, history: History): Promise<void> {
    const own = await this.readOwn(profileKey)
    const tombstones = history.tombstones()
    for (const c of own) this.replaceOwn(profileKey, [compactChunks([c.chunk], tombstones)], [c])
  }

  private replaceOwn(profileKey: string, chunks: Chunk[], old: OwnChunk[]): void {
    const dir = this.logDir(profileKey)
    for (const chunk of chunks) writeAtomic(join(dir, newSyncId()), encodeChunk(chunk, this.keyring, chunkContext(profileKey, this.deviceId)))
    for (const c of old) rmSync(join(dir, c.name), { force: true })
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

  // ---------------------------------------------------------------- profiles

  /** Publishes the profiles this device syncs, so another device can match them by name. */
  writeProfiles(profiles: SyncedProfileInfo[]): void {
    const context = `profiles/${this.deviceId}`
    writeAtomic(join(this.root, 'profiles', this.deviceId), sealWith(this.keyring, Buffer.from(JSON.stringify(profiles)), context))
  }

  /** Every profile any device syncs (this one's included), deduplicated by key. */
  async readProfiles(): Promise<SyncedProfileInfo[]> {
    const dir = join(this.root, 'profiles')
    const byKey = new Map<string, SyncedProfileInfo>()
    for (const device of (await listNames(dir)).ready) {
      try {
        const list = JSON.parse(unsealWith(this.keyring, await readFile(join(dir, device)), `profiles/${device}`).toString('utf8')) as SyncedProfileInfo[]
        for (const p of list) if (ID.test(p.key) && !byKey.has(p.key)) byKey.set(p.key, p)
      } catch {
        // Unreadable for now (downloading, or a newer key); its profiles show up next time.
      }
    }
    return [...byKey.values()]
  }
}

// ---------------------------------------------------------------- folder helpers

/** Reads sync.json; undefined when the folder has none (a new sync). */
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

/** YARC's files in `dir`, and the ones iCloud evicted (only a placeholder is there). A missing folder is empty. */
export async function listNames(dir: string): Promise<{ ready: string[]; evicted: string[] }> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return { ready: [], evicted: [] }
  }
  const ready = names.filter((n) => ID.test(n))
  const evicted = names.flatMap((n) => ICLOUD_PLACEHOLDER.exec(n)?.[1] ?? []).filter((n) => !ready.includes(n))
  return { ready, evicted }
}

/** Asks iCloud Drive to download evicted files; the folder watcher picks them up once they're back. */
function requestDownload(paths: string[]): void {
  if (process.platform !== 'darwin') return
  for (const p of paths) execFile('/usr/bin/brctl', ['download', p], () => {})
}

/** Writes to a temporary name, then renames, so other devices never see half a file from this side. */
export function writeAtomic(path: string, data: Buffer): void {
  const dir = join(path, '..')
  mkdirSync(dir, { recursive: true })
  const tmp = join(dir, `.${newSyncId()}.tmp`)
  writeFileSync(tmp, data)
  renameSync(tmp, path)
}

