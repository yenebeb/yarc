// A device's history log in the sync folder: immutable, encrypted chunk files, each holding a
// run of records numbered by the device. Readers keep a cursor per device (the last record they
// applied), so replaying a chunk never applies a record twice.
import { gunzipSync, gzipSync } from 'node:zlib'
import type { SyncRecord } from '../../shared/sync'
import { sealWith, SyncCryptoError, unsealWith, type Keyring } from './crypto.ts'

export interface Chunk {
  /** The records cover sequence numbers first..last. Compaction leaves gaps, so there may be fewer. */
  first: number
  last: number
  records: SyncRecord[]
}

/** A chunk is bound to its log: moving it to another profile's or device's folder makes it unreadable. */
export function chunkContext(profileKey: string, deviceId: string): string {
  return `history/${profileKey}/${deviceId}`
}

export function encodeChunk(chunk: Chunk, keyring: Keyring, context: string): Buffer {
  return sealWith(keyring, gzipSync(Buffer.from(JSON.stringify({ v: 1, ...chunk }))), context)
}

export function decodeChunk(data: Buffer, keyring: Keyring, context: string): Chunk {
  const plain = unsealWith(keyring, data, context)
  let parsed: { v: number } & Chunk
  try {
    parsed = JSON.parse(gunzipSync(plain).toString('utf8'))
  } catch {
    throw new SyncCryptoError('corrupt', 'Chunk content is unreadable')
  }
  if (parsed.v !== 1) throw new SyncCryptoError('corrupt', `Chunk version ${parsed.v} needs a newer YARC`)
  return { first: parsed.first, last: parsed.last, records: parsed.records }
}

/** The records of `chunk` a reader whose cursor is at `cursor` hasn't applied yet. */
export function unappliedRecords(chunk: Chunk, cursor: number): SyncRecord[] {
  return chunk.records.filter((r) => r.seq > cursor)
}

/**
 * Picks the order in which to apply chunks: only a chunk that starts at or before cursor + 1 can
 * be applied, so a chunk that arrives before an earlier one (sync services don't keep order)
 * waits. Returns the chunks to apply, in order, and the ones that must wait for a gap to fill.
 */
export function planApply<T extends { chunk: Chunk }>(chunks: T[], cursor: number): { apply: T[]; waiting: T[] } {
  const pending = chunks.filter((c) => c.chunk.last > cursor).sort((a, b) => a.chunk.first - b.chunk.first)
  const apply: T[] = []
  let at = cursor
  for (const c of pending) {
    if (c.chunk.first > at + 1) break
    if (c.chunk.last <= at) continue
    apply.push(c)
    at = c.chunk.last
  }
  return { apply, waiting: pending.filter((c) => !apply.includes(c) && c.chunk.last > at) }
}

/**
 * Merges a device's own chunks into one, dropping what no longer matters: visits removed by a
 * deletion or a clear, deletions older than a later clear, and title changes superseded by a
 * later one. The result still covers the same sequence numbers, so readers' cursors stay valid.
 */
export function compactChunks(chunks: Chunk[], tombstones: { url: Map<string, number>; clear: number }): Chunk {
  const records = chunks.flatMap((c) => c.records).sort((a, b) => a.seq - b.seq)
  let clear = tombstones.clear
  const deleted = new Map(tombstones.url)
  for (const r of records) {
    if (r.kind === 'clear') clear = Math.max(clear, r.time)
    if (r.kind === 'delete') deleted.set(r.url, Math.max(deleted.get(r.url) ?? 0, r.time))
  }
  const removed = (url: string, time: number) => time <= clear || time <= (deleted.get(url) ?? 0)
  const lastTitle = new Map<string, number>()
  const lastDelete = new Map<string, number>()
  for (const r of records) {
    if (r.kind === 'title') lastTitle.set(r.url, r.seq)
    if (r.kind === 'delete' && r.time === deleted.get(r.url)) lastDelete.set(r.url, r.seq)
  }
  const kept = records.filter((r) => {
    switch (r.kind) {
      case 'visit':
        return !removed(r.url, r.time)
      case 'title':
        return lastTitle.get(r.url) === r.seq && !removed(r.url, r.time)
      case 'delete':
        return r.time > clear && lastDelete.get(r.url) === r.seq
      case 'clear':
        return r.time === clear
    }
  })
  return { first: Math.min(...chunks.map((c) => c.first)), last: Math.max(...chunks.map((c) => c.last)), records: kept }
}
