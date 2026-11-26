// What history sync writes to the sync folder, and what that reveals to anyone who can decrypt it.
// Every record type the sync can write is declared here next to its exposure, so adding a kind
// of record without saying what it exposes doesn't type-check, and Settings' warning for an empty
// password always lists exactly what is written.

/** One entry in a device's history log. `seq` numbers a device's records 1, 2, 3, … */
export type SyncRecord =
  | { kind: 'visit'; seq: number; url: string; title: string; time: number }
  | { kind: 'title'; seq: number; url: string; title: string; time: number }
  /** Every visit to `url` at or before `time` is gone. */
  | { kind: 'delete'; seq: number; url: string; time: number }
  /** Every visit at or before `time` is gone. */
  | { kind: 'clear'; seq: number; time: number }

export type SyncRecordKind = SyncRecord['kind']

/** Files in the folder besides history records. */
type SyncFileKind = 'profiles'

/** Plain-language lines, shown as a bullet list. Lines repeated across kinds are shown once. */
const EXPOSURE: Record<SyncRecordKind | SyncFileKind, string[]> = {
  visit: [
    'Every URL visited, including search terms and anything else in the address',
    'Page titles',
    'When each page was visited',
    'Which device visited it (as a random device ID, not the device’s name)'
  ],
  title: ['Page titles'],
  delete: ['URLs deleted from history, and when they were deleted'],
  clear: ['When history was cleared'],
  profiles: ['The names of synced profiles']
}

/** What someone who can open the sync folder can read when the sync password is empty. */
export function syncExposure(): string[] {
  return [...new Set(Object.values(EXPOSURE).flat())]
}

export type CloudDrive = 'google-drive' | 'onedrive' | 'dropbox'

export const CLOUD_DRIVE_NAME: Record<CloudDrive, string> = { 'google-drive': 'Google Drive', onedrive: 'OneDrive', dropbox: 'Dropbox' }

/** Where the encrypted sync files live. */
export type SyncLocation =
  /** A folder another app syncs: iCloud Drive, Syncthing, a network drive… */
  | { kind: 'folder'; path: string }
  /** Directly between computers on the same network (src/main/sync/nearby.ts). */
  | { kind: 'nearby' }
  /** A cloud drive reached through its web API after signing in; `account` is the email shown. */
  | { kind: 'cloud'; drive: CloudDrive; account?: string }
  /** A WebDAV server: Nextcloud, ownCloud, a NAS… The password is kept with the sync key, not here. */
  | { kind: 'server'; url: string; username: string }

/** Runtime state of history sync, sent to the UI with every snapshot. */
export type HistorySyncStatus =
  /** `drives`: the cloud drives this build can sign in to. `icloud`: iCloud Drive is on this computer. */
  | { state: 'off'; drives: CloudDrive[]; icloud: boolean; error?: string }
  /**
   * A location was picked; waiting for the password. `existing` = another device already syncs
   * there. `searched` = nearby sync looked and found no computer with that password.
   */
  | { state: 'setup'; location: SyncLocation; existing: boolean; searched?: boolean; error?: string }
  /** `cancellable`: waiting for the user to sign in in their browser. */
  | { state: 'working'; location: SyncLocation; message: string; cancellable?: boolean }
  /** `peers`: with nearby sync, how many computers are connected right now. */
  | { state: 'on'; location: SyncLocation; peers?: number; emptyPassword: boolean; lastSync?: number; error?: string }
  /** Sync is on but can't run until the password is typed again, or the cloud drive or server is signed in to again. */
  | { state: 'locked'; location: SyncLocation; reason: 'password-changed' | 'no-saved-key' | 'missing-folder' | 'signed-out'; error?: string }

/** A folder inside iCloud Drive, as macOS and iCloud for Windows name it (src/main/sync/locations.ts). */
export const isICloudDrive = (path: string): boolean => /[\\/](com~apple~CloudDocs|iCloudDrive)([\\/]|$)/.test(path)

/** How messages name the location: "Couldn’t reach Google Drive". */
export function locationName(location: SyncLocation): string {
  if (location.kind === 'cloud') return CLOUD_DRIVE_NAME[location.drive]
  if (location.kind === 'server') return 'your server'
  if (location.kind === 'nearby') return 'your other computers'
  return isICloudDrive(location.path) ? 'iCloud Drive' : 'the sync folder'
}
