import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SyncHeader } from './crypto.ts'
import { HEADER_FILE } from './engine.ts'

const ID = '[0-9a-f]{16,64}'
export const ID_NAME = new RegExp(`^${ID}$`)
export const SYNC_PATH = new RegExp(`^(${HEADER_FILE.replace('.', '\\.')}|profiles/${ID}|history/${ID}/${ID}/${ID})$`)
const OWNED_PATH = new RegExp(`^(?:profiles/(${ID})|history/${ID}/(${ID})/${ID})$`)

export function ownerOf(path: string): string | undefined {
  const match = OWNED_PATH.exec(path)
  return match ? (match[1] ?? match[2]) : undefined
}

export function contentHash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 32)
}

export class FolderHashes {
  private readonly cache = new Map<string, { size: number; mtime: number; hash: string }>()
  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  async list(): Promise<Map<string, string>> {
    const root = this.root
    const paths = [HEADER_FILE, ...(await idsIn(join(root, 'profiles'))).map((device) => `profiles/${device}`)]
    for (const profileKey of await idsIn(join(root, 'history')))
      for (const device of await idsIn(join(root, 'history', profileKey)))
        for (const chunk of await idsIn(join(root, 'history', profileKey, device))) paths.push(`history/${profileKey}/${device}/${chunk}`)
    const files = new Map<string, string>()
    for (const path of paths) {
      try {
        const full = join(root, path)
        const info = await stat(full)
        const cached = this.cache.get(path)
        if (cached && cached.size === info.size && cached.mtime === info.mtimeMs) {
          files.set(path, cached.hash)
          continue
        }
        const hash = contentHash(await readFile(full))
        this.cache.set(path, { size: info.size, mtime: info.mtimeMs, hash })
        files.set(path, hash)
      } catch {
        // Not there (no sync.json yet), or removed meanwhile.
      }
    }
    return files
  }

  forget(path: string): void {
    this.cache.delete(path)
  }
}

export async function idsIn(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => ID_NAME.test(name))
  } catch {
    return []
  }
}

export interface HeaderInfo {
  folderId: string
  generation: number
}

export function headerInfo(header: SyncHeader): HeaderInfo {
  return { folderId: header.folderId, generation: header.generation ?? 0 }
}

export function acceptHeader(theirs: HeaderInfo, ours: SyncHeader | undefined): boolean {
  if (!ours) return true
  return theirs.folderId === ours.folderId && theirs.generation > (ours.generation ?? 0)
}
