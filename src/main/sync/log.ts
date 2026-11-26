import { gunzipSync, gzipSync } from 'node:zlib'
import type { SyncRecord } from '../../shared/sync'
import { sealWith, SyncCryptoError, unsealWith, type Keyring } from './crypto.ts'

export interface Chunk {
  first: number
  last: number
  records: SyncRecord[]
}

/** A chunk is bound to its log: moving it to another profile's or device's folder makes it unreadable. */
export function chunkContext(profileKey: string, deviceId: string): string {
  return `history/${profileKey}/${deviceId}`
}

export function encodeChunk(chunk: Chunk, keyring: Keyring, context: string): Buffer {
  return sealWith(keyring, gzipSync(Buffer.from(JSON.stringify({ version: 1, ...chunk }))), context)
}

export function decodeChunk(data: Buffer, keyring: Keyring, context: string): Chunk {
  const plain = unsealWith(keyring, data, context)
  let parsed: { version: number } & Chunk
  try {
    parsed = JSON.parse(gunzipSync(plain).toString('utf8'))
  } catch {
    throw new SyncCryptoError('corrupt', 'Chunk content is unreadable')
  }
  if (parsed.version !== 1) throw new SyncCryptoError('corrupt', `Chunk version ${parsed.version} needs a newer YARC`)
  return { first: parsed.first, last: parsed.last, records: parsed.records }
}

export function unappliedRecords(chunk: Chunk, cursor: number): SyncRecord[] {
  return chunk.records.filter((record) => record.seq > cursor)
}

/** Sync services don't keep order: a chunk that arrives before an earlier one waits. */
export function planApply<T extends { chunk: Chunk }>(chunks: T[], cursor: number): { apply: T[]; waiting: T[] } {
  const pending = chunks.filter((candidate) => candidate.chunk.last > cursor).sort((one, other) => one.chunk.first - other.chunk.first)
  const apply: T[] = []
  let at = cursor
  for (const candidate of pending) {
    if (candidate.chunk.first > at + 1) break
    if (candidate.chunk.last <= at) continue
    apply.push(candidate)
    at = candidate.chunk.last
  }
  return { apply, waiting: pending.filter((candidate) => !apply.includes(candidate) && candidate.chunk.last > at) }
}

export function compactChunks(chunks: Chunk[], tombstones: { url: Map<string, number>; clear: number }): Chunk {
  const records = chunks.flatMap((chunk) => chunk.records).sort((one, other) => one.seq - other.seq)
  let clear = tombstones.clear
  const deleted = new Map(tombstones.url)
  for (const record of records) {
    if (record.kind === 'clear') clear = Math.max(clear, record.time)
    if (record.kind === 'delete') deleted.set(record.url, Math.max(deleted.get(record.url) ?? 0, record.time))
  }
  const removed = (url: string, time: number) => time <= clear || time <= (deleted.get(url) ?? 0)
  const lastTitle = new Map<string, number>()
  const lastDelete = new Map<string, number>()
  for (const record of records) {
    if (record.kind === 'title') lastTitle.set(record.url, record.seq)
    if (record.kind === 'delete' && record.time === deleted.get(record.url)) lastDelete.set(record.url, record.seq)
  }
  const kept = records.filter((record) => {
    switch (record.kind) {
      case 'visit':
        return !removed(record.url, record.time)
      case 'title':
        return lastTitle.get(record.url) === record.seq && !removed(record.url, record.time)
      case 'delete':
        return record.time > clear && lastDelete.get(record.url) === record.seq
      case 'clear':
        return record.time === clear
    }
  })
  // Still covers the same sequence numbers, so readers' cursors stay valid.
  return { first: Math.min(...chunks.map((chunk) => chunk.first)), last: Math.max(...chunks.map((chunk) => chunk.last)), records: kept }
}
