import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { ImportedVisit } from '../core/history'
import type { PinnedFolder, PinnedNode } from '../../shared/types'

export interface ChromiumBrowser {
  name: string
  userDataDir: string
}

export interface ChromiumProfile {
  /** 'Default', 'Profile 1', … */
  dir: string
  name: string
  path: string
}

const ARC_PACKAGE = 'TheBrowserCompany.Arc_ttt1ap7aakyb4'
const WEBKIT_EPOCH_OFFSET_MS = 11_644_473_600_000

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function localAppData(): string {
  return process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
}

export function findArcRoot(): string | undefined {
  if (process.platform === 'darwin') {
    const p = join(homedir(), 'Library', 'Application Support', 'Arc')
    return isDir(p) ? p : undefined
  }
  if (process.platform === 'win32') {
    const pkgs = join(localAppData(), 'Packages')
    let names: string[] = []
    try {
      names = readdirSync(pkgs).filter((d) => d.startsWith('TheBrowserCompany.Arc_'))
    } catch {}
    names.sort((a, b) => Number(b === ARC_PACKAGE) - Number(a === ARC_PACKAGE))
    for (const d of names) {
      const p = join(pkgs, d, 'LocalCache', 'Local', 'Arc')
      if (existsSync(join(p, 'StorableSidebar.json')) || isDir(join(p, 'User Data'))) return p
    }
    const fallback = join(localAppData(), 'Arc')
    return existsSync(join(fallback, 'StorableSidebar.json')) ? fallback : undefined
  }
  return undefined
}

export function findChromiumBrowsers(): ChromiumBrowser[] {
  const home = homedir()
  const candidates: [string, string][] =
    process.platform === 'win32'
      ? [
          ['Chrome', join(localAppData(), 'Google', 'Chrome', 'User Data')],
          ['Edge', join(localAppData(), 'Microsoft', 'Edge', 'User Data')],
          ['Brave', join(localAppData(), 'BraveSoftware', 'Brave-Browser', 'User Data')]
        ]
      : process.platform === 'darwin'
        ? [
            ['Chrome', join(home, 'Library', 'Application Support', 'Google', 'Chrome')],
            ['Edge', join(home, 'Library', 'Application Support', 'Microsoft Edge')],
            ['Brave', join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')]
          ]
        : [
            ['Chrome', join(home, '.config', 'google-chrome')],
            ['Edge', join(home, '.config', 'microsoft-edge')],
            ['Brave', join(home, '.config', 'BraveSoftware', 'Brave-Browser')]
          ]
  return candidates.filter(([, dir]) => isDir(dir)).map(([name, userDataDir]) => ({ name, userDataDir }))
}

export function readProfileNames(userDataDir: string): Map<string, string> {
  const names = new Map<string, string>()
  try {
    const state = JSON.parse(readFileSync(join(userDataDir, 'Local State'), 'utf8'))
    const cache = state?.profile?.info_cache
    if (cache && typeof cache === 'object') {
      for (const [dir, info] of Object.entries(cache as Record<string, { name?: unknown }>)) {
        names.set(dir, typeof info?.name === 'string' ? info.name.trim() : '')
      }
    }
  } catch {}
  return names
}

export function listProfiles(userDataDir: string): ChromiumProfile[] {
  const names = readProfileNames(userDataDir)
  let dirs = [...names.keys()]
  if (!dirs.length) {
    try {
      dirs = readdirSync(userDataDir).filter((d) => d === 'Default' || /^Profile \d+$/.test(d))
    } catch {}
  }
  dirs.sort((a, b) => (a === 'Default' ? -1 : b === 'Default' ? 1 : a.localeCompare(b, undefined, { numeric: true })))
  return dirs
    .map((dir) => ({ dir, name: names.get(dir) || dir, path: join(userDataDir, dir) }))
    .filter((p) => existsSync(join(p.path, 'History')) || existsSync(join(p.path, 'Bookmarks')))
}

/** `tables` must be plain tables: a crafted file could make them views that never finish and hang YARC. */
export async function readDatabaseCopy<T>(src: string, tables: string[], read: (db: DatabaseSync) => T): Promise<T> {
  const tmp = await mkdtemp(join(tmpdir(), 'yarc-import-'))
  try {
    const copy = join(tmp, basename(src))
    try {
      await copyFile(src, copy)
      for (const suffix of ['-wal', '-journal']) {
        if (existsSync(src + suffix)) await copyFile(src + suffix, copy + suffix)
      }
    } catch (err) {
      throw new Error(`Could not read ${src}. Quit the browser and try again. (${(err as Error).message})`)
    }
    const open = (readOnly: boolean): T => {
      const db = new DatabaseSync(copy, { readOnly })
      try {
        db.exec('PRAGMA trusted_schema = OFF')
        const kind = db.prepare('SELECT type FROM sqlite_master WHERE name = ?')
        for (const table of tables) {
          if ((kind.get(table) as { type?: string } | undefined)?.type !== 'table') throw new Error(`${basename(src)} has no ${table} table`)
        }
        return read(db)
      } finally {
        db.close()
      }
    }
    try {
      return open(true)
    } catch {
      // A hot journal / WAL needs a writable connection to recover; this only touches our temp copy.
      return open(false)
    }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

export async function readHistory(profileDir: string, limit = 50_000): Promise<ImportedVisit[]> {
  const src = join(profileDir, 'History')
  if (!existsSync(src)) return []
  return readDatabaseCopy(src, ['urls', 'visits'], (db) => {
    const cols = db.prepare('PRAGMA table_info(urls)').all() as { name: string }[]
    const hidden = cols.some((c) => c.name === 'hidden') ? 'AND u.hidden = 0' : ''
    const rows = db
      .prepare(
        `SELECT u.url AS url, COALESCE(u.title, '') AS title, (v.visit_time / 1000 - ${WEBKIT_EPOCH_OFFSET_MS}) AS time
         FROM visits v JOIN urls u ON u.id = v.url
         WHERE v.visit_time > 0 AND (v.transition & 255) NOT IN (3, 4) ${hidden}
         ORDER BY v.visit_time DESC LIMIT ?`
      )
      .all(limit) as unknown as ImportedVisit[]
    return rows.reverse()
  })
}

interface BookmarkNode {
  type?: string
  name?: string
  url?: string
  children?: BookmarkNode[]
  date_added?: string
  date_last_used?: string
}

const webkitToMs = (v: unknown): number | undefined => {
  if (typeof v !== 'string' || !/^\d+$/.test(v) || v === '0') return undefined
  return Number(BigInt(v) / 1000n - BigInt(WEBKIT_EPOCH_OFFSET_MS))
}

function convertBookmarks(nodes: BookmarkNode[] | undefined, now: number, depth = 0): PinnedNode[] {
  if (!Array.isArray(nodes) || depth > 32) return []
  const out: PinnedNode[] = []
  for (const n of nodes) {
    if (n?.type === 'folder') {
      const folder: PinnedFolder = { kind: 'folder', id: randomUUID(), name: (typeof n.name === 'string' && n.name.trim()) || 'Untitled folder', open: false, children: convertBookmarks(n.children, now, depth + 1) }
      out.push(folder)
    } else if (n?.type === 'url' && typeof n.url === 'string' && /^(https?|file):/i.test(n.url)) {
      out.push({
        kind: 'tab',
        id: randomUUID(),
        url: n.url,
        title: (typeof n.name === 'string' && n.name.trim()) || n.url,
        savedUrl: n.url,
        lastActive: webkitToMs(n.date_last_used) ?? webkitToMs(n.date_added) ?? now
      })
    }
  }
  return out
}

export function readBookmarks(profileDir: string, now = Date.now()): PinnedNode[] {
  const out: PinnedNode[] = []
  for (const file of ['Bookmarks', 'AccountBookmarks']) {
    let roots: Record<string, BookmarkNode> | undefined
    try {
      roots = JSON.parse(readFileSync(join(profileDir, file), 'utf8'))?.roots
    } catch {
      continue
    }
    if (!roots || typeof roots !== 'object') continue
    out.push(...convertBookmarks(roots.bookmark_bar?.children, now))
    for (const [key, fallback] of [['other', 'Other bookmarks'], ['synced', 'Mobile bookmarks']] as const) {
      const children = convertBookmarks(roots[key]?.children, now)
      if (children.length) out.push({ kind: 'folder', id: randomUUID(), name: roots[key]?.name?.trim() || fallback, open: false, children })
    }
  }
  return out
}

export function countTabs(nodes: PinnedNode[]): number {
  return nodes.reduce((n, node) => n + (node.kind === 'folder' ? countTabs(node.children) : 1), 0)
}
