// A profile's answers to site permission prompts, kept across restarts (Profiles/<id>/permissions.json).
// Kept free of Electron so unit tests can import it; profiles.ts loads and saves it.
//
// Like Chrome:
// - Allow (and Block, from Settings) stick until changed in Settings.
// - Not Now refuses the site for the rest of the run.
// - After three Not Nows, counted across launches, the site isn't asked again for a week and is refused meanwhile.

import { siteName, type SitePermissionRow } from '../shared/permissions.ts'

export type SiteSetting = 'allow' | 'block'

export type MediaType = 'video' | 'audio'

/** Not Nows before a site goes quiet, and for how long. */
export const NOT_NOWS_BEFORE_QUIET = 3
export const QUIET_FOR = 7 * 24 * 60 * 60 * 1000

export interface SitePermissionsFile {
  version: 1
  /** origin → permission key ('notifications', 'media:video', …) → the user's answer */
  settings: Record<string, Record<string, SiteSetting>>
  /** origin → key → Not Nows so far, and the end of the quiet week once there were enough */
  notNow: Record<string, Record<string, { count: number; quietUntil?: number }>>
}

/**
 * The keys an answer is stored under. Camera and microphone are separate, so allowing the
 * microphone doesn't give away the camera; a request for "media" without types means both.
 */
export function keysFor(permission: string, mediaTypes?: MediaType[]): string[] {
  if (permission !== 'media') return [permission]
  const types = mediaTypes?.length ? mediaTypes : (['video', 'audio'] as const)
  return types.map((t) => `media:${t}`)
}

export class SiteDecisions {
  private data: SitePermissionsFile
  /** Not Now's "not again this run": gone at the next launch, unlike the count. */
  private refusedThisRun = new Set<string>()
  private save: (data: SitePermissionsFile) => void
  private now: () => number

  /** `stored` is the parsed file (anything unreadable starts empty); `save` writes it back after each change. */
  constructor(stored?: unknown, save: (data: SitePermissionsFile) => void = () => {}, now: () => number = Date.now) {
    this.data = normalize(stored)
    this.save = save
    this.now = now
  }

  /** true = allowed, false = refused (blocked, Not Now this run, or a quiet week), undefined = ask. */
  answer(origin: string, key: string): boolean | undefined {
    const setting = this.data.settings[origin]?.[key]
    if (setting) return setting === 'allow'
    if (this.refusedThisRun.has(`${origin}|${key}`)) return false
    const quietUntil = this.data.notNow[origin]?.[key]?.quietUntil
    if (quietUntil === undefined) return undefined
    if (quietUntil > this.now()) return false
    // The quiet week is over: ask again, counting from zero.
    this.drop('notNow', origin, key)
    this.save(this.data)
    return undefined
  }

  set(origin: string, key: string, setting: SiteSetting): void {
    ;(this.data.settings[origin] ??= {})[key] = setting
    this.drop('notNow', origin, key)
    this.refusedThisRun.delete(`${origin}|${key}`)
    this.save(this.data)
  }

  notNow(origin: string, key: string): void {
    this.refusedThisRun.add(`${origin}|${key}`)
    const entry = ((this.data.notNow[origin] ??= {})[key] ??= { count: 0 })
    entry.count++
    if (entry.count >= NOT_NOWS_BEFORE_QUIET) {
      entry.count = 0
      entry.quietUntil = this.now() + QUIET_FOR
    }
    this.save(this.data)
  }

  /** Forgets everything about the site and permission: the next request asks again. */
  reset(origin: string, key: string): void {
    this.drop('settings', origin, key)
    this.drop('notNow', origin, key)
    this.refusedThisRun.delete(`${origin}|${key}`)
    this.save(this.data)
  }

  /** What Settings lists: every site with an answer or a quiet week, by site name. */
  list(): SitePermissionRow[] {
    const rows: SitePermissionRow[] = []
    for (const [origin, keys] of Object.entries(this.data.settings)) {
      for (const [key, setting] of Object.entries(keys)) rows.push({ origin, key, setting })
    }
    const now = this.now()
    for (const [origin, keys] of Object.entries(this.data.notNow)) {
      for (const [key, entry] of Object.entries(keys)) {
        if (entry.quietUntil !== undefined && entry.quietUntil > now && !this.data.settings[origin]?.[key]) {
          rows.push({ origin, key, setting: 'quiet', until: entry.quietUntil })
        }
      }
    }
    return rows.sort((a, b) => siteName(a.origin).localeCompare(siteName(b.origin)) || a.origin.localeCompare(b.origin) || a.key.localeCompare(b.key))
  }

  private drop(part: 'settings' | 'notNow', origin: string, key: string): void {
    const keys = this.data[part][origin]
    if (!keys) return
    delete keys[key]
    if (!Object.keys(keys).length) delete this.data[part][origin]
  }
}

function normalize(stored: unknown): SitePermissionsFile {
  const empty: SitePermissionsFile = { version: 1, settings: {}, notNow: {} }
  if (!stored || typeof stored !== 'object') return empty
  const raw = stored as Partial<SitePermissionsFile>
  for (const [origin, keys] of Object.entries(raw.settings ?? {})) {
    for (const [key, setting] of Object.entries(keys ?? {})) {
      if (setting === 'allow' || setting === 'block') (empty.settings[origin] ??= {})[key] = setting
    }
  }
  for (const [origin, keys] of Object.entries(raw.notNow ?? {})) {
    for (const [key, entry] of Object.entries(keys ?? {})) {
      if (!entry || typeof entry.count !== 'number') continue
      const clean: { count: number; quietUntil?: number } = { count: entry.count }
      if (typeof entry.quietUntil === 'number') clean.quietUntil = entry.quietUntil
      ;(empty.notNow[origin] ??= {})[key] = clean
    }
  }
  return empty
}
