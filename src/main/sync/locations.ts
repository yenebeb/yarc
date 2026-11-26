import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HEADER_FILE } from './engine'

const SUBFOLDER = 'YARC Sync'

export function icloudFolder(): string | undefined {
  const home = homedir()
  const folder = process.platform === 'darwin' ? join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs') : join(home, 'iCloudDrive')
  return existsSync(folder) ? folder : undefined
}

export function syncRoot(picked: string): string {
  if (existsSync(join(picked, HEADER_FILE)) || existsSync(join(picked, `.${HEADER_FILE}.icloud`))) return picked
  const subfolder = join(picked, SUBFOLDER)
  if (existsSync(subfolder)) return subfolder
  const visible = readdirSync(picked).filter((name) => !name.startsWith('.') && name !== 'desktop.ini' && name !== 'Icon\r')
  return visible.length === 0 ? picked : subfolder
}

export function cloudFolderGuess(): string | undefined {
  const home = homedir()
  const candidates = [process.env.OneDrive, icloudFolder(), join(home, 'Library', 'CloudStorage'), join(home, 'Dropbox'), join(home, 'OneDrive')]
  return candidates.find((candidate): candidate is string => !!candidate && existsSync(candidate))
}
