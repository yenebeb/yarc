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

/** Runtime state of history sync, sent to the UI with every snapshot. */
export type HistorySyncStatus =
  | { state: 'off' }
  /**
   * A folder was picked (or nearby sync chosen); waiting for the password. `existing` = another
   * device already syncs there. `searched` = nearby sync looked and found no computer with that password.
   */
  | { state: 'setup'; folder: string; existing: boolean; nearby?: boolean; searched?: boolean; error?: string }
  | { state: 'working'; folder: string; nearby?: boolean; message: string }
  /** `peers`: with nearby sync, how many computers are connected right now. */
  | { state: 'on'; folder: string; nearby?: boolean; peers?: number; emptyPassword: boolean; lastSync?: number; error?: string }
  /** Sync is on but can't run until the password is typed again. */
  | { state: 'locked'; folder: string; nearby?: boolean; reason: 'password-changed' | 'no-saved-key' | 'missing-folder'; error?: string }
