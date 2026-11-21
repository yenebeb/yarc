import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { ImportedVisit } from '../history'
import { readDatabaseCopy } from './chromium'
import { parseContainers, parsePrefs, parseProfilesIni, readMozLz4 } from './zen-session'

export interface ZenProfile {
  name: string
  path: string
}

export function findZenRoots(): string[] {
  const home = homedir()
  const roots =
    process.platform === 'darwin'
      ? [join(home, 'Library', 'Application Support', 'zen')]
      : process.platform === 'win32'
        ? [join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'zen')]
        : [join(home, '.zen'), join(home, '.var', 'app', 'app.zen_browser.zen', '.zen')]
  return roots.filter((root) => existsSync(join(root, 'profiles.ini')))
}

/** Newest first; older Zen keeps spaces in the first window of Firefox's session store. */
const SESSION_FILES = ['zen-sessions.jsonlz4', join('sessionstore-backups', 'recovery.jsonlz4'), 'sessionstore.jsonlz4']

export const isZenProfile = (dir: string): boolean => SESSION_FILES.some((file) => existsSync(join(dir, file)))

export function listZenProfiles(root: string): ZenProfile[] {
  let text: string
  try {
    text = readFileSync(join(root, 'profiles.ini'), 'utf8')
  } catch {
    return []
  }
  return parseProfilesIni(text)
    // A network path (\\server\share) would make Windows sign in to that server, handing it the user's password hash.
    .filter((p) => p.relative || !/^(\\\\|\/\/)/.test(p.path))
    .map((p) => ({ name: p.name, path: p.relative ? join(root, p.path) : p.path }))
    .filter((p) => isZenProfile(p.path))
}

export function findZenProfiles(): ZenProfile[] {
  return findZenRoots().flatMap(listZenProfiles)
}

/** `path` is a profile folder, or a Zen data folder whose default profile is used. */
export function resolveZenProfile(path: string): ZenProfile {
  if (isZenProfile(path)) return { name: basename(path), path }
  const [profile] = listZenProfiles(path)
  if (!profile) throw new Error(`No Zen profile found in ${path}`)
  return profile
}

export async function readZenSession(dir: string): Promise<unknown> {
  for (const file of SESSION_FILES) {
    const path = join(dir, file)
    if (!existsSync(path)) continue
    const json = JSON.parse(readMozLz4(await readFile(path)).toString('utf8'))
    const session = file === SESSION_FILES[0] ? json : json?.windows?.[0]
    if (Array.isArray(session?.spaces) && Array.isArray(session?.tabs)) return session
  }
  throw new Error(`No Zen spaces found in ${dir}`)
}

export function readZenPrefs(dir: string): Map<string, string | number | boolean> {
  try {
    return parsePrefs(readFileSync(join(dir, 'prefs.js'), 'utf8'))
  } catch {
    return new Map()
  }
}

export function readZenContainers(dir: string): Map<number, string> {
  try {
    return parseContainers(JSON.parse(readFileSync(join(dir, 'containers.json'), 'utf8')))
  } catch {
    return new Map()
  }
}

export async function readZenHistory(dir: string, limit = 50_000): Promise<ImportedVisit[]> {
  const src = join(dir, 'places.sqlite')
  if (!existsSync(src)) return []
  return readDatabaseCopy(src, ['moz_places', 'moz_historyvisits'], (db) => {
    const rows = db
      .prepare(
        `SELECT p.url AS url, COALESCE(p.title, '') AS title, v.visit_date / 1000 AS time
         FROM moz_historyvisits v JOIN moz_places p ON p.id = v.place_id
         WHERE v.visit_date > 0 AND v.visit_type NOT IN (4, 7, 8) AND p.hidden = 0
         ORDER BY v.visit_date DESC LIMIT ?`
      )
      .all(limit) as unknown as ImportedVisit[]
    return rows.reverse()
  })
}
