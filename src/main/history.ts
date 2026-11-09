// Browsing history, one SQLite database per profile (node:sqlite, no native modules).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SyncRecord } from '../shared/sync'

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

/** Records waiting to go into this device's sync log (without sequence numbers yet). */
export interface Outbox {
  records: DistributiveOmit<SyncRecord, 'seq'>[]
  visitIds: number[]
  lastEventId: number
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * How far ahead of this computer's clock another device's timestamps may push the history clock.
 * A device whose clock is further ahead still syncs, but can't drag this one's timestamps along.
 */
export const MAX_CLOCK_SKEW = 24 * 3600_000

/** The tombstone key for "cleared before": real keys are http(s) URLs. */
const CLEAR = ''

export class History {
  private db: DatabaseSync
  /** Pages can still report navigations while the app quits; writes after close are dropped. */
  private closed = false
  /**
   * While linked to a sync folder, title changes, deletions and clears are queued for the log,
   * and deletions leave tombstones. Visits are always marked unsynced, so linking later sends them.
   */
  private linked = false
  /** Called after every local change, so sync can send it soon. */
  onChange: (() => void) | undefined

  /** Without a folder (incognito), the history lives in memory and is gone when it closes. */
  constructor(dir: string | undefined) {
    if (dir) mkdirSync(dir, { recursive: true })
    this.db = new DatabaseSync(dir ? join(dir, 'history.sqlite') : ':memory:')
    this.db.exec(`
      PRAGMA journal_mode = WAL;
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
    if (!columns.some((c) => c.name === 'synced')) this.db.exec('ALTER TABLE visits ADD COLUMN synced INTEGER NOT NULL DEFAULT 0')
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS visits_unsynced ON visits(id) WHERE synced = 0;
      CREATE INDEX IF NOT EXISTS visits_url ON visits(url);
      CREATE TABLE IF NOT EXISTS sync_events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, time INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_tombstones (url TEXT PRIMARY KEY, time INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_cursors (device TEXT PRIMARY KEY, seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_files (name TEXT PRIMARY KEY, last INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `)
  }

  /**
   * The time to stamp a local change with: this computer's clock, but never earlier than
   * anything already merged from another device (within MAX_CLOCK_SKEW). So whatever happens here
   * after seeing another device's deletion is stamped after it, even if this clock runs behind.
   */
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
    this.db.prepare('INSERT INTO visits (url, time) VALUES (?, ?)').run(url, time)
    this.onChange?.()
  }

  setTitle(url: string, title: string): void {
    if (!title || this.closed) return
    const changed = this.db.prepare('UPDATE urls SET title = ? WHERE url = ? AND title != ?').run(title, url, title).changes > 0
    if (!changed || !this.linked) return
    this.db.prepare(`DELETE FROM sync_events WHERE kind = 'title' AND url = ?`).run(url)
    this.queue('title', url, title, this.now())
  }

  search(query: string, limit = 8): HistoryEntry[] {
    const like = `%${query.replace(/[%_]/g, (m) => `\\${m}`)}%`
    const weekAgo = Date.now() - 7 * 864e5
    return this.db
      .prepare(
        `SELECT url, title, visit_count AS visitCount, last_visit AS lastVisit FROM urls
         WHERE url LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
         ORDER BY (visit_count + CASE WHEN last_visit > ? THEN 10 ELSE 0 END) DESC, last_visit DESC
         LIMIT ?`
      )
      .all(like, like, weekAgo, limit) as unknown as HistoryEntry[]
  }

  recent(limit = 200, offset = 0, query = ''): (HistoryEntry & { time: number })[] {
    const like = `%${query}%`
    return this.db
      .prepare(
        `SELECT v.url, u.title, u.visit_count AS visitCount, u.last_visit AS lastVisit, v.time FROM visits v
         JOIN urls u ON u.url = v.url
         WHERE ? = '' OR v.url LIKE ? OR u.title LIKE ?
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
    this.transaction(() => {
      for (const v of visits) {
        if (!/^https?:/.test(v.url)) continue
        upsert.run(v.url, v.title, v.time)
        insert.run(v.url, v.time)
      }
    })
    this.onChange?.()
    return visits.length
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

  // ---------------------------------------------------------------- sync

  /**
   * Starts queueing changes for the sync folder `folderId`. Linking to a different folder than
   * last time forgets the old folder's cursors and tombstones, and sends every visit again.
   */
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

  /** Sync was turned off: stop queueing and forget everything kept only for syncing (cursors, tombstones with deleted URLs). */
  unlink(): void {
    this.linked = false
    this.transaction(() => this.forgetSync())
  }

  private forgetSync(): void {
    this.db.exec('DELETE FROM sync_events; DELETE FROM sync_tombstones; DELETE FROM sync_cursors; DELETE FROM sync_files;')
    this.db.exec("DELETE FROM sync_meta WHERE key != 'folder'")
  }

  /** Local changes not in the sync folder yet, oldest first, at most `limit` records. */
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
    const records: Outbox['records'] = visits.map((v) => ({ kind: 'visit', url: v.url, title: v.title ?? '', time: v.time }))
    for (const e of events) {
      if (e.kind === 'title') records.push({ kind: 'title', url: e.url, title: e.title, time: e.time })
      else if (e.kind === 'delete') records.push({ kind: 'delete', url: e.url, time: e.time })
      else records.push({ kind: 'clear', time: e.time })
    }
    return { records, visitIds: visits.map((v) => v.id), lastEventId: events.at(-1)?.id ?? 0 }
  }

  /** The outbox's records are in a chunk in the folder now. */
  markSent(outbox: Outbox): void {
    const mark = this.db.prepare('UPDATE visits SET synced = 1 WHERE id = ?')
    this.transaction(() => {
      for (const id of outbox.visitIds) mark.run(id)
      this.db.prepare('DELETE FROM sync_events WHERE id <= ?').run(outbox.lastEventId)
    })
  }

  /** The last record applied from `device`'s log; 0 when none. */
  cursor(device: string): number {
    const row = this.db.prepare('SELECT seq FROM sync_cursors WHERE device = ?').get(device) as { seq: number } | undefined
    return row?.seq ?? 0
  }

  /** Chunk files already read (`<device>/<file>` → its last sequence number), so they aren't decrypted again. */
  readFiles(): Map<string, number> {
    const rows = this.db.prepare('SELECT name, last FROM sync_files').all() as { name: string; last: number }[]
    return new Map(rows.map((r) => [r.name, r.last]))
  }

  rememberFile(name: string, last: number): void {
    this.db.prepare('INSERT OR REPLACE INTO sync_files (name, last) VALUES (?, ?)').run(name, last)
  }

  forgetFiles(names: string[]): void {
    const del = this.db.prepare('DELETE FROM sync_files WHERE name = ?')
    for (const n of names) del.run(n)
  }

  /**
   * Merges another device's records, in order, and moves its cursor to `last`, all or nothing.
   * - A visit is skipped when its (device, seq) is at or below the cursor (a replay), when a
   *   visit with the same URL and time exists (the same visit sent again after re-linking), or
   *   when a deletion or clear at or after its time is known (the tombstone wins).
   * - A deletion or clear removes matching visits at or before its time and is kept as a
   *   tombstone, so visits that arrive later from a device that was offline are removed too.
   */
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
    const tombstoneTime = this.db.prepare('SELECT MAX(time) AS t FROM sync_tombstones WHERE url IN (?, ?)')
    let latest = 0
    this.transaction(() => {
      for (const r of records) {
        if (r.seq <= cursor) continue
        cursor = r.seq
        latest = Math.max(latest, r.time)
        switch (r.kind) {
          case 'visit': {
            if (!/^https?:/.test(r.url)) break
            const dead = (tombstoneTime.get(r.url, CLEAR) as { t: number | null }).t
            if (dead !== null && dead >= r.time) break
            if (sameVisit.get(r.time, r.url)) break
            upsertUrl.run(r.url, r.title, r.time)
            insertVisit.run(r.url, r.time)
            break
          }
          case 'title':
            if (r.title) this.db.prepare('UPDATE urls SET title = ? WHERE url = ?').run(r.title, r.url)
            break
          case 'delete':
            this.tombstone(r.url, r.time)
            this.db.prepare('DELETE FROM visits WHERE url = ? AND time <= ?').run(r.url, r.time)
            this.refreshUrl(r.url)
            break
          case 'clear':
            this.tombstone(CLEAR, r.time)
            this.db.prepare('DELETE FROM visits WHERE time <= ?').run(r.time)
            this.refreshAllUrls()
            break
        }
      }
      this.db.prepare('INSERT OR REPLACE INTO sync_cursors (device, seq) VALUES (?, ?)').run(device, last)
      // Another device's clock may run ahead: follow it, so local changes made after seeing its
      // records sort after them. A clock far ahead (wrong date) doesn't drag this one along.
      if (latest <= Date.now() + MAX_CLOCK_SKEW && latest > Number(this.meta('clock') ?? 0)) this.setMeta('clock', String(latest))
    })
  }

  /** Every deletion and the latest clear known here, for dropping dead records when a log is compacted. */
  tombstones(): { url: Map<string, number>; clear: number } {
    const rows = this.db.prepare('SELECT url, time FROM sync_tombstones').all() as { url: string; time: number }[]
    const url = new Map(rows.filter((r) => r.url !== CLEAR).map((r) => [r.url, r.time]))
    return { url, clear: rows.find((r) => r.url === CLEAR)?.time ?? 0 }
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

  /** Recounts a URL's visits after some were removed; drops it when none are left. */
  private refreshUrl(url: string): void {
    const row = this.db.prepare('SELECT COUNT(*) AS n, MAX(time) AS last FROM visits WHERE url = ?').get(url) as { n: number; last: number | null }
    if (row.n === 0) this.db.prepare('DELETE FROM urls WHERE url = ?').run(url)
    else this.db.prepare('UPDATE urls SET visit_count = ?, last_visit = ? WHERE url = ?').run(row.n, row.last, url)
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
