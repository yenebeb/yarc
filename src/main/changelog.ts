// What's New and the welcome screen: which one a launch shows, and which changes go in What's New.
// No Electron imports, so it unit-tests. The changelog itself is built in by electron.vite.config.ts.
import type { ReleaseNotes } from '../shared/types'
import { compareVersions } from './release.ts'

/** Version → the changes for users merged in it (scripts/changelog.mjs). A version may have none. */
export type Changelog = Record<string, string[]>

/** How many versions "What's New" from the menu or the command bar lists. */
export const RECENT_VERSIONS = 10

const newestFirst = (a: ReleaseNotes, b: ReleaseNotes) => compareVersions(b.version, a.version)

function notes(changelog: Changelog, keep: (version: string) => boolean): ReleaseNotes[] {
  return Object.entries(changelog)
    .filter(([version, changes]) => changes.length > 0 && keep(version))
    .map(([version, changes]) => ({ version, changes }))
    .sort(newestFirst)
}

/**
 * The changes from after `since` up to and including `current`, newest version first. A user can
 * skip releases in one update, so every version in between counts, also ones this changelog doesn't
 * know. Without `since` (state written before YARC remembered it), only `current`'s changes.
 */
export function changesSince(changelog: Changelog, since: string | undefined, current: string): ReleaseNotes[] {
  return notes(changelog, (v) => compareVersions(v, current) <= 0 && (since ? compareVersions(v, since) > 0 : compareVersions(v, current) === 0))
}

/** The last few versions with changes, for opening What's New by hand. */
export function recentChanges(changelog: Changelog, current: string, count = RECENT_VERSIONS): ReleaseNotes[] {
  return notes(changelog, (v) => compareVersions(v, current) <= 0).slice(0, count)
}

export type StartupScreen = { kind: 'none' } | { kind: 'welcome' } | { kind: 'whats-new'; releases: ReleaseNotes[] }

/**
 * What a launch shows: the welcome screen on a first run (no state.json yet), What's New on the
 * first launch of a newer version, else nothing. `lastSeen` is the version the user last ran.
 */
export function startupScreen(firstRun: boolean, lastSeen: string | undefined, current: string, changelog: Changelog): StartupScreen {
  if (firstRun) return { kind: 'welcome' }
  if (lastSeen && compareVersions(current, lastSeen) <= 0) return { kind: 'none' }
  const releases = changesSince(changelog, lastSeen, current)
  return releases.length ? { kind: 'whats-new', releases } : { kind: 'none' }
}
