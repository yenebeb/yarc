// Sync folders on this computer: the one inside a folder the user picks, iCloud Drive, and where
// the folder dialog opens.
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HEADER_FILE } from './engine'

/** The folder created inside a non-empty folder the user picks, so YARC's files stay together. */
const SUBFOLDER = 'YARC Sync'

/** iCloud Drive's folder when this computer has it (macOS, or iCloud for Windows). */
export function icloudFolder(): string | undefined {
  const home = homedir()
  const folder = process.platform === 'darwin' ? join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs') : join(home, 'iCloudDrive')
  return existsSync(folder) ? folder : undefined
}

/**
 * The folder to sync in, from the one the user picked: it (when it's already a sync folder or
 * empty), its "YARC Sync" folder when it has one, else a new "YARC Sync" folder inside it.
 */
export function syncRoot(picked: string): string {
  if (existsSync(join(picked, HEADER_FILE)) || existsSync(join(picked, `.${HEADER_FILE}.icloud`))) return picked
  const subfolder = join(picked, SUBFOLDER)
  if (existsSync(subfolder)) return subfolder
  const visible = readdirSync(picked).filter((name) => !name.startsWith('.') && name !== 'desktop.ini' && name !== 'Icon\r')
  return visible.length === 0 ? picked : subfolder
}

/** Where the folder dialog opens: the first synced folder found. */
export function cloudFolderGuess(): string | undefined {
  const home = homedir()
  const candidates = [process.env.OneDrive, icloudFolder(), join(home, 'Library', 'CloudStorage'), join(home, 'Dropbox'), join(home, 'OneDrive')]
  return candidates.find((candidate): candidate is string => !!candidate && existsSync(candidate))
}
