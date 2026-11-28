import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SyncRecord } from '../../shared/sync'

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

export interface Outbox {
  records: DistributiveOmit<SyncRecord, 'seq'>[]
  visitIds: number[]
  lastEventId: number
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** A device whose clock is further ahead than this still syncs, but can't drag this computer's timestamps along. */
export const MAX_CLOCK_SKEW = 24 * 3600_000

/** The tombstone key for "cleared before": real keys are http(s) URLs. */
const CLEAR = ''

export class History {
  private db: DatabaseSync
  /** Pages can still report navigations while the app quits. */
  private closed = false
  private linked = false
  onChange: (() => void) | undefined

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
    const columns = this.db.prepare('PRAGMA table_info(visits)').all() as { name: string }[]
    // synced: 0 = made here and not in the sync folder yet, 1 = in the folder (sent, or received from another device).
    if (!columns.some((column) => column.name === 'synced')) this.db.exec('ALTER TABLE visits ADD COLUMN synced INTEGER NOT NULL DEFAULT 0')
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS visits_unsynced ON visits(id) WHERE synced = 0;
      CREATE INDEX IF NOT EXISTS visits_url ON visits(url);
      CREATE TABLE IF NOT EXISTS sync_events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, time INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_tombstones (url TEXT PRIMARY KEY, time INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_cursors (device TEXT PRIMARY KEY, seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_files (name TEXT PRIMARY KEY, last INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
    this.removeDuplicateVisits()
    this.prune(now)
  }

  /** Once: before visits were unique, importing a browser again added all its history a second time. */
  private removeDuplicateVisits(): void {
    if ((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version >= 1) return
    this.transaction(() =>
      this.db.exec(`
        UPDATE urls SET visit_count = MAX(1, visit_count - d.extra)
          FROM (SELECT url, COUNT(*) - COUNT(DISTINCT time) AS extra FROM visits GROUP BY url) d
          WHERE d.url = urls.url AND d.extra > 0;
        DELETE FROM visits WHERE id NOT IN (SELECT MIN(id) FROM visits GROUP BY url, time);
        CREATE UNIQUE INDEX visits_url_time ON visits(url, time);
        PRAGMA user_version = 1;
      `)
    )
  }

  private prune(now: number): void {
    const before = now - KEEP_FOR
    this.db.prepare('DELETE FROM visits WHERE time < ?').run(before)
    this.db.prepare('DELETE FROM urls WHERE last_visit < ? AND url NOT IN (SELECT url FROM visits)').run(before)
  }

  /** Never earlier than anything merged from another device, so a change made here after seeing its deletion sorts after it even if this clock runs behind. */
  now(): number {
    return Math.max(Date.now(), Number(this.meta('clock') ?? 0) + 1)
  }

  visit(url: string, title: string, time = this.now()): void {
    if (this.closed || !/^https?:/.test(url)) return
    this.db
      .prepare(
        `INSERT INTO urls (url, title, visit_count, last_visit) VALUES (?, ?, 1, ?)
         ON CONFLICT(url) DO UPDATE SET visit_count = visit_count + 1, last_visit = excluded.last_visit,
           title = CASE WHEN excluded.title != '' THEN excluded.title ELSE urls.title END`
      )
      .run(url, title, time)
    this.db.prepare('INSERT OR IGNORE INTO visits (url, time) VALUES (?, ?)').run(url, time)
    this.onChange?.()
  }

  setTitle(url: string, title: string): void {
    if (!title || this.closed) return
    const changed = this.db.prepare('UPDATE urls SET title = ? WHERE url = ? AND title != ?').run(title, url, title).changes > 0
    if (!changed || !this.linked) return
    this.db.prepare(`DELETE FROM sync_events WHERE kind = 'title' AND url = ?`).run(url)
    this.queue('title', url, title, this.now())
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

  /** Returns how many were new: a visit already here (same page, same moment) is skipped. */
  import(visits: ImportedVisit[]): number {
    const insert = this.db.prepare('INSERT OR IGNORE INTO visits (url, time) VALUES (?, ?)')
    const upsert = this.db.prepare(
      `INSERT INTO urls (url, title, visit_count, last_visit) VALUES (?, ?, 1, ?)
       ON CONFLICT(url) DO UPDATE SET visit_count = visit_count + 1,
         last_visit = MAX(last_visit, excluded.last_visit),
         title = CASE WHEN urls.title = '' THEN excluded.title ELSE urls.title END`
    )
    let added = 0
    this.transaction(() => {
      for (const v of visits) {
        if (!/^https?:/.test(v.url) || !insert.run(v.url, v.time).changes) continue
        upsert.run(v.url, v.title, v.time)
        added++
      }
    })
    if (added) this.onChange?.()
    return added
  }

  deleteUrl(url: string): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM visits WHERE url = ?').run(url)
      this.db.prepare('DELETE FROM urls WHERE url = ?').run(url)
      if (!this.linked) return
      const time = this.now()
      this.tombstone(url, time)
      this.db.prepare(`DELETE FROM sync_events WHERE kind = 'title' AND url = ?`).run(url)
      this.queue('delete', url, '', time)
    })
    this.onChange?.()
  }

  clear(): void {
    this.transaction(() => {
      this.db.exec('DELETE FROM visits; DELETE FROM urls;')
      if (!this.linked) return
      const time = this.now()
      this.tombstone(CLEAR, time)
      this.db.exec(`DELETE FROM sync_events WHERE kind != 'clear'`)
      this.queue('clear', '', '', time)
    })
    this.onChange?.()
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  get isClosed(): boolean {
    return this.closed
  }

  link(folderId: string): void {
    this.transaction(() => {
      if (this.meta('folder') !== folderId) {
        this.forgetSync()
        this.db.exec('UPDATE visits SET synced = 0')
        this.setMeta('folder', folderId)
      }
    })
    this.linked = true
  }

  unlink(): void {
    this.linked = false
    this.transaction(() => this.forgetSync())
  }

  private forgetSync(): void {
    this.db.exec('DELETE FROM sync_events; DELETE FROM sync_tombstones; DELETE FROM sync_cursors; DELETE FROM sync_files;')
    this.db.exec("DELETE FROM sync_meta WHERE key != 'folder'")
  }

  outbox(limit: number): Outbox {
    const visits = this.db
      .prepare(
        `SELECT v.id, v.url, v.time, u.title FROM visits v LEFT JOIN urls u ON u.url = v.url
         WHERE v.synced = 0 ORDER BY v.id LIMIT ?`
      )
      .all(limit) as { id: number; url: string; time: number; title: string | null }[]
    const events = this.db.prepare('SELECT id, kind, url, title, time FROM sync_events ORDER BY id LIMIT ?').all(Math.max(0, limit - visits.length)) as {
      id: number
      kind: 'title' | 'delete' | 'clear'
      url: string
      title: string
      time: number
    }[]
    const records: Outbox['records'] = visits.map((visit) => ({ kind: 'visit', url: visit.url, title: visit.title ?? '', time: visit.time }))
    for (const event of events) {
      if (event.kind === 'title') records.push({ kind: 'title', url: event.url, title: event.title, time: event.time })
      else if (event.kind === 'delete') records.push({ kind: 'delete', url: event.url, time: event.time })
      else records.push({ kind: 'clear', time: event.time })
    }
    return { records, visitIds: visits.map((visit) => visit.id), lastEventId: events.at(-1)?.id ?? 0 }
  }

  markSent(outbox: Outbox): void {
    const mark = this.db.prepare('UPDATE visits SET synced = 1 WHERE id = ?')
    this.transaction(() => {
      for (const id of outbox.visitIds) mark.run(id)
      this.db.prepare('DELETE FROM sync_events WHERE id <= ?').run(outbox.lastEventId)
    })
  }

  cursor(device: string): number {
    const row = this.db.prepare('SELECT seq FROM sync_cursors WHERE device = ?').get(device) as { seq: number } | undefined
    return row?.seq ?? 0
  }

  readFiles(): Map<string, number> {
    const rows = this.db.prepare('SELECT name, last FROM sync_files').all() as { name: string; last: number }[]
    return new Map(rows.map((row) => [row.name, row.last]))
  }

  rememberFile(name: string, last: number): void {
    this.db.prepare('INSERT OR REPLACE INTO sync_files (name, last) VALUES (?, ?)').run(name, last)
  }

  forgetFiles(names: string[]): void {
    const del = this.db.prepare('DELETE FROM sync_files WHERE name = ?')
    for (const name of names) del.run(name)
  }

  applyRemote(device: string, records: SyncRecord[], last: number): void {
    if (this.closed) return
    let cursor = this.cursor(device)
    if (last <= cursor) return
    const upsertUrl = this.db.prepare(
      `INSERT INTO urls (url, title, visit_count, last_visit) VALUES (?, ?, 1, ?)
       ON CONFLICT(url) DO UPDATE SET visit_count = visit_count + 1,
         title = CASE WHEN excluded.title != '' AND excluded.last_visit >= urls.last_visit THEN excluded.title ELSE urls.title END,
         last_visit = MAX(urls.last_visit, excluded.last_visit)`
    )
    const sameVisit = this.db.prepare('SELECT 1 FROM visits WHERE time = ? AND url = ?')
    const insertVisit = this.db.prepare('INSERT INTO visits (url, time, synced) VALUES (?, ?, 1)')
    const tombstoneTime = this.db.prepare('SELECT MAX(time) AS time FROM sync_tombstones WHERE url IN (?, ?)')
    let latest = 0
    // A device whose date is years ahead would otherwise remove every later visit, on every device.
    const horizon = Date.now() + MAX_CLOCK_SKEW
    const removedUntil = (time: number) => Math.min(time, horizon)
    this.transaction(() => {
      for (const record of records) {
        if (record.seq <= cursor) continue
        cursor = record.seq
        latest = Math.max(latest, record.time)
        switch (record.kind) {
          case 'visit': {
            if (!/^https?:/.test(record.url)) break
            const dead = (tombstoneTime.get(record.url, CLEAR) as { time: number | null }).time
            if (dead !== null && dead >= record.time) break
            if (sameVisit.get(record.time, record.url)) break
            upsertUrl.run(record.url, record.title, record.time)
            insertVisit.run(record.url, record.time)
            break
          }
          case 'title':
            if (record.title) this.db.prepare('UPDATE urls SET title = ? WHERE url = ? AND last_visit <= ?').run(record.title, record.url, record.time)
            break
          case 'delete':
            this.tombstone(record.url, removedUntil(record.time))
            this.db.prepare('DELETE FROM visits WHERE url = ? AND time <= ?').run(record.url, removedUntil(record.time))
            this.refreshUrl(record.url)
            break
          case 'clear':
            this.tombstone(CLEAR, removedUntil(record.time))
            this.db.prepare('DELETE FROM visits WHERE time <= ?').run(removedUntil(record.time))
            this.refreshAllUrls()
            break
        }
      }
      this.db.prepare('INSERT OR REPLACE INTO sync_cursors (device, seq) VALUES (?, ?)').run(device, last)
      // Another device's clock may run ahead: follow it, so local changes made after seeing its records sort after them.
      if (latest <= Date.now() + MAX_CLOCK_SKEW && latest > Number(this.meta('clock') ?? 0)) this.setMeta('clock', String(latest))
    })
  }

  tombstones(): { url: Map<string, number>; clear: number } {
    const rows = this.db.prepare('SELECT url, time FROM sync_tombstones').all() as { url: string; time: number }[]
    const url = new Map(rows.filter((row) => row.url !== CLEAR).map((row) => [row.url, row.time]))
    return { url, clear: rows.find((row) => row.url === CLEAR)?.time ?? 0 }
  }

  meta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value
  }

  setMeta(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)').run(key, value)
  }

  private queue(kind: 'title' | 'delete' | 'clear', url: string, title: string, time: number): void {
    this.db.prepare('INSERT INTO sync_events (kind, url, title, time) VALUES (?, ?, ?, ?)').run(kind, url, title, time)
    this.onChange?.()
  }

  private tombstone(url: string, time: number): void {
    this.db.prepare('INSERT INTO sync_tombstones (url, time) VALUES (?, ?) ON CONFLICT(url) DO UPDATE SET time = MAX(time, excluded.time)').run(url, time)
  }

  private refreshUrl(url: string): void {
    const row = this.db.prepare('SELECT COUNT(*) AS count, MAX(time) AS last FROM visits WHERE url = ?').get(url) as { count: number; last: number | null }
    if (row.count === 0) this.db.prepare('DELETE FROM urls WHERE url = ?').run(url)
    else this.db.prepare('UPDATE urls SET visit_count = ?, last_visit = ? WHERE url = ?').run(row.count, row.last, url)
  }

  private refreshAllUrls(): void {
    this.db.exec(`
      DELETE FROM urls WHERE url NOT IN (SELECT url FROM visits);
      UPDATE urls SET visit_count = (SELECT COUNT(*) FROM visits v WHERE v.url = urls.url),
        last_visit = (SELECT MAX(time) FROM visits v WHERE v.url = urls.url);
    `)
  }

  private transaction(work: () => void): void {
    if (this.db.isTransaction) return work()
    this.db.exec('BEGIN')
    try {
      work()
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }
}
