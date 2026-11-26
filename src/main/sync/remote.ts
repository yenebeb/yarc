import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseHeader } from './crypto.ts'
import { HEADER_FILE, readHeader, removeSyncFiles, writeAtomic } from './engine.ts'
import { contentHash, FolderHashes, ownerOf, SYNC_PATH } from './paths.ts'

export interface RemoteStore {
  list(): Promise<Map<string, string>>
  read(path: string): Promise<Buffer>
  write(path: string, data: Buffer): Promise<void>
  remove(path: string): Promise<void>
}

export class SignedOutError extends Error {}

const STATE_FILE = '.mirror.json'

export interface MirrorOptions {
  root: string
  store: RemoteStore
  deviceId: string
}

export class RemoteMirror {
  readonly root: string
  private readonly store: RemoteStore
  private readonly deviceId: string
  private readonly hashes: FolderHashes
  private readonly pulled: Map<string, string>
  private readonly pushed: Map<string, string>

  constructor(options: MirrorOptions) {
    this.root = options.root
    this.store = options.store
    this.deviceId = options.deviceId
    this.hashes = new FolderHashes(options.root)
    mkdirSync(options.root, { recursive: true })
    const saved = readState(join(options.root, STATE_FILE))
    this.pulled = new Map(Object.entries(saved.pulled))
    this.pushed = new Map(Object.entries(saved.pushed))
  }

  async pull(): Promise<boolean> {
    const remote = await this.store.list()
    const local = await this.hashes.list()
    let changed = false
    for (const [path, version] of remote) {
      if (!SYNC_PATH.test(path) || !this.wanted(path, version, local)) continue
      const data = await this.store.read(path)
      if (path === HEADER_FILE && !(await this.keepsStoreHeader(data))) continue
      writeAtomic(join(this.root, path), data)
      this.hashes.forget(path)
      this.pulled.set(path, version)
      if (path === HEADER_FILE || ownerOf(path) === this.deviceId) this.pushed.set(path, contentHash(data))
      changed = true
    }
    for (const path of local.keys()) {
      const owner = ownerOf(path)
      if (!owner || owner === this.deviceId || remote.has(path)) continue
      rmSync(join(this.root, path), { force: true })
      this.hashes.forget(path)
      this.pulled.delete(path)
      changed = true
    }
    this.save()
    return changed
  }

  async push(): Promise<void> {
    const local = await this.hashes.list()
    for (const [path, hash] of local) {
      if (path !== HEADER_FILE && ownerOf(path) !== this.deviceId) continue
      if (this.pushed.get(path) === hash) continue
      await this.store.write(path, await readFile(join(this.root, path)))
      this.pushed.set(path, hash)
      this.save()
    }
    for (const path of [...this.pushed.keys()]) {
      if (local.has(path) || path === HEADER_FILE) continue
      await this.store.remove(path)
      this.pushed.delete(path)
      this.pulled.delete(path)
      this.save()
    }
  }

  async clear(): Promise<void> {
    for (const path of (await this.store.list()).keys()) if (SYNC_PATH.test(path)) await this.store.remove(path)
    removeSyncFiles(this.root)
    this.pulled.clear()
    this.pushed.clear()
    this.save()
  }

  private wanted(path: string, version: string, local: Map<string, string>): boolean {
    // This computer's own files only come back when the copy was cleared: its logs continue from them, so numbering never repeats.
    if (ownerOf(path) === this.deviceId) return !local.has(path) && !this.pushed.has(path)
    return !local.has(path) || this.pulled.get(path) !== version
  }

  private async keepsStoreHeader(data: Buffer): Promise<boolean> {
    let theirs
    try {
      theirs = parseHeader(data.toString('utf8'))
    } catch {
      return false
    }
    const ours = await readHeader(this.root).catch(() => undefined)
    return !ours || theirs.folderId !== ours.folderId || (theirs.generation ?? 0) >= (ours.generation ?? 0)
  }

  private save(): void {
    const state = { pulled: Object.fromEntries(this.pulled), pushed: Object.fromEntries(this.pushed) }
    writeFileSync(join(this.root, STATE_FILE), JSON.stringify(state))
  }
}

function readState(file: string): { pulled: Record<string, string>; pushed: Record<string, string> } {
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'))
    return { pulled: state.pulled ?? {}, pushed: state.pushed ?? {} }
  } catch {
    return { pulled: {}, pushed: {} }
  }
}

/** A request body from file contents: fetch takes bytes backed by a plain ArrayBuffer, which a Buffer's may not be. */
export function requestBody(data: Buffer): Uint8Array<ArrayBuffer> {
  return new Uint8Array(data)
}
