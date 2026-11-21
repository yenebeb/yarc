import type { ReleaseNotes } from '../shared/types'
import { compareVersions } from './release.ts'

/** Version → the changes for users merged in it (scripts/changelog.mjs). A version may have none. */
export type Changelog = Record<string, string[]>

export const RECENT_VERSIONS = 10

function notes(changelog: Changelog, keep: (version: string) => boolean): ReleaseNotes[] {
  return Object.entries(changelog)
    .filter(([version]) => keep(version))
    .map(([version, changes]) => ({ version, changes }))
    .sort((a, b) => compareVersions(b.version, a.version))
}

const hasChanges = (release: ReleaseNotes) => release.changes.length > 0

/** Every version after `since` counts, also ones this changelog doesn't know. Without `since` (older state), only `current`'s changes. */
export function changesSince(changelog: Changelog, since: string | undefined, current: string): ReleaseNotes[] {
  return notes(changelog, (v) => compareVersions(v, current) <= 0 && (since ? compareVersions(v, since) > 0 : compareVersions(v, current) === 0)).filter(hasChanges)
}

export function recentChanges(changelog: Changelog, current: string, count = RECENT_VERSIONS): ReleaseNotes[] {
  return notes(changelog, (v) => compareVersions(v, current) <= 0)
    .filter(hasChanges)
    .slice(0, count)
}

/** Versions without changes for users stay in the list, so the count of updates is honest. */
export function pendingReleases(changelog: Changelog, current: string, target: string): ReleaseNotes[] {
  return notes(changelog, (v) => compareVersions(v, current) > 0 && compareVersions(v, target) <= 0)
}

export function parseChangelog(json: unknown): Changelog {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
  const changelog: Changelog = {}
  for (const [version, changes] of Object.entries(json)) {
    if (Array.isArray(changes) && changes.every((c) => typeof c === 'string')) changelog[version] = changes
  }
  return changelog
}

export type StartupScreen = { kind: 'none' } | { kind: 'welcome' } | { kind: 'whats-new'; releases: ReleaseNotes[]; spotlights: string[] }

/** `unseen`: spotlights (src/shared/spotlights.ts) the user hasn't seen. `lastSeen`: the version the user last ran. */
export function startupScreen(firstRun: boolean, lastSeen: string | undefined, current: string, changelog: Changelog, unseen: string[] = []): StartupScreen {
  if (firstRun) return { kind: 'welcome' }
  const newer = !lastSeen || compareVersions(current, lastSeen) > 0
  const releases = newer ? changesSince(changelog, lastSeen, current) : []
  return releases.length || unseen.length ? { kind: 'whats-new', releases, spotlights: unseen } : { kind: 'none' }
}
