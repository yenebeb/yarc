import { safeStorage } from 'electron'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { newSyncId } from './engine'

export interface SavedKey {
  folderId: string
  check: string
  master: string
  emptyPassword: boolean
  pairing?: string[]
  credential?: string
}

export function deviceId(dir: string): string {
  const file = join(dir, 'device.json')
  try {
    const id = JSON.parse(readFileSync(file, 'utf8')).id
    if (/^[0-9a-f]{32}$/.test(id)) return id
  } catch {}
  const id = newSyncId()
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, JSON.stringify({ id }))
  return id
}

/** Not protected on macOS: without an Apple Developer ID the keychain asks for the login password after every update (docs/electron-notes.md section 8). */
export function saveKey(dir: string, key: SavedKey): void {
  mkdirSync(dir, { recursive: true })
  const json = JSON.stringify(key)
  const protect = process.platform !== 'darwin' && safeStorage.isEncryptionAvailable()
  const data = protect ? { protected: 'safeStorage', data: safeStorage.encryptString(json).toString('base64') } : { protected: 'none', data: json }
  writeFileSync(join(dir, 'key.json'), JSON.stringify(data), { mode: 0o600 })
}

export function loadKey(dir: string): SavedKey | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'key.json'), 'utf8')) as { protected: string; data: string }
    const json = raw.protected === 'safeStorage' ? safeStorage.decryptString(Buffer.from(raw.data, 'base64')) : raw.data
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

export function forgetKey(dir: string): void {
  rmSync(join(dir, 'key.json'), { force: true })
}
