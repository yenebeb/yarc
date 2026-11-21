// What a downloaded update brings, for the relaunch card. No Electron imports, so it unit-tests.
// Every merge to main is a release, so several updates can pile up: the card lists every version
// since the one running. The changes come from the downloaded release's changelog.json: the same
// file What's New is built from (scripts/changelog.mjs), listing every release up to that one.
import type { ReleaseNotes } from '../shared/types'
import type { Changelog } from './changelog.ts'
import { compareVersions } from './release.ts'

/** The changelog.json asset of a release, next to its installers. */
export function changelogUrl(version: string): string {
  return `https://github.com/yenebeb/yarc/releases/download/v${version}/changelog.json`
}

/** A downloaded changelog.json, keeping only entries of the shape scripts/changelog.mjs writes. */
export function parseChangelog(json: unknown): Changelog {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
  const changelog: Changelog = {}
  for (const [version, changes] of Object.entries(json)) {
    if (Array.isArray(changes) && changes.every((c) => typeof c === 'string')) changelog[version] = changes
  }
  return changelog
}

/**
 * The versions after `current` up to and including `target`, newest first, each with its changes.
 * Versions without changes for users stay in the list (so the count of updates is honest) with none.
 */
export function pendingReleases(changelog: Changelog, current: string, target: string): ReleaseNotes[] {
  return Object.entries(changelog)
    .map(([version, changes]) => ({ version, changes }))
    .filter((r) => compareVersions(r.version, current) > 0 && compareVersions(r.version, target) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version))
}
