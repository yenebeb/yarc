import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface HistoryEntry {
  url: string
  title: string
  visitCount: number
  lastVisit: number
}

export interface ImportedVisit {
  url: string
  title: string
  time: number
}

const KEEP_FOR = 365 * 864e5

/** For LIKE … ESCAPE '\\'. */
function contains(text: string): string {
  return `%${text.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
}

export class History {
  private db: DatabaseSync
  /** Pages can still report navigations while the app quits. */
  private closed = false

  /** Without a folder (incognito), it lives in memory. */
  constructor(dir: string | undefined, now = Date.now()) {
    if (dir) mkdirSync(dir, { recursive: true, mode: 0o700 })
    const file = dir ? join(dir, 'history.sqlite') : ':memory:'
    this.db = new DatabaseSync(file)
    // SQLite creates it with the default, usually world-readable, mode.
    if (dir) chmodSync(file, 0o600)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS urls (
        url TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        visit_count INTEGER NOT NULL DEFAULT 0,
        last_visit INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY, url TEXT NOT NULL, time INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS visits_time ON visits(time);
      CREATE INDEX IF NOT EXISTS urls_last ON urls(last_visit);
    `)
    this.prune(now)
  }

  private prune(now: number): void {
    const before = now - KEEP_FOR
    this.db.prepare('DELETE FROM visits WHERE time < ?').run(before)
    this.db.prepare('DELETE FROM urls WHERE last_visit < ? AND url NOT IN (SELECT url FROM visits)').run(before)
  }

  visit(url: string, title: string, time = Date.now()): void {
    if (this.closed || !/^https?:/.test(url)) return
    this.db
      .prepare(
        `INSERT INTO urls (url, title, visit_count, last_visit) VALUES (?, ?, 1, ?)
         ON CONFLICT(url) DO UPDATE SET visit_count = visit_count + 1, last_visit = excluded.last_visit,
           title = CASE WHEN excluded.title != '' THEN excluded.title ELSE urls.title END`
      )
      .run(url, title, time)
    this.db.prepare('INSERT INTO visits (url, time) VALUES (?, ?)').run(url, time)
  }

  setTitle(url: string, title: string): void {
    if (title && !this.closed) this.db.prepare('UPDATE urls SET title = ? WHERE url = ?').run(title, url)
  }

  /** Pages starting with the query come first, then the most visited; the caller ranks them. */
  search(query: string, limit = 100): HistoryEntry[] {
    const words = query.trim().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    const start = `${query.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`
    const starting = this.db
      .prepare(
        `SELECT url, title, visit_count AS visitCount, last_visit AS lastVisit FROM urls
         WHERE title LIKE ?1 ESCAPE '\\' OR url LIKE 'http://' || ?1 ESCAPE '\\' OR url LIKE 'https://' || ?1 ESCAPE '\\'
           OR url LIKE 'http://www.' || ?1 ESCAPE '\\' OR url LIKE 'https://www.' || ?1 ESCAPE '\\'
         ORDER BY visit_count DESC, last_visit DESC LIMIT 100`
      )
      .all(start) as unknown as HistoryEntry[]
    const everyWord = words.map(() => `(url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')`).join(' AND ')
    const containing = this.db
      .prepare(
        `SELECT url, title, visit_count AS visitCount, last_visit AS lastVisit FROM urls
         WHERE ${everyWord}
         ORDER BY visit_count DESC, last_visit DESC LIMIT ?`
      )
      .all(...words.flatMap((w) => [contains(w), contains(w)]), limit) as unknown as HistoryEntry[]
    const seen = new Set(starting.map((h) => h.url))
    return [...starting, ...containing.filter((h) => !seen.has(h.url))]
  }

  recent(limit = 200, offset = 0, query = ''): (HistoryEntry & { time: number })[] {
    const like = contains(query)
    return this.db
      .prepare(
        `SELECT v.url, u.title, u.visit_count AS visitCount, u.last_visit AS lastVisit, v.time FROM visits v
         JOIN urls u ON u.url = v.url
         WHERE ? = '' OR v.url LIKE ? ESCAPE '\\' OR u.title LIKE ? ESCAPE '\\'
         ORDER BY v.time DESC LIMIT ? OFFSET ?`
      )
      .all(query, like, like, limit, offset) as unknown as (HistoryEntry & { time: number })[]
  }

  import(visits: ImportedVisit[]): number {
    const upsert = this.db.prepare(
      `INSERT INTO urls (url, title, visit_count, last_visit) VALUES (?, ?, 1, ?)
       ON CONFLICT(url) DO UPDATE SET visit_count = visit_count + 1,
         last_visit = MAX(last_visit, excluded.last_visit),
         title = CASE WHEN urls.title = '' THEN excluded.title ELSE urls.title END`
    )
    const insert = this.db.prepare('INSERT INTO visits (url, time) VALUES (?, ?)')
    this.db.exec('BEGIN')
    try {
      for (const v of visits) {
        if (!/^https?:/.test(v.url)) continue
        upsert.run(v.url, v.title, v.time)
        insert.run(v.url, v.time)
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return visits.length
  }

  deleteUrl(url: string): void {
    this.db.prepare('DELETE FROM visits WHERE url = ?').run(url)
    this.db.prepare('DELETE FROM urls WHERE url = ?').run(url)
  }

  clear(): void {
    this.db.exec('DELETE FROM visits; DELETE FROM urls;')
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }
}
