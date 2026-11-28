import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, test } from 'node:test'
import { History } from '../../src/main/core/history.ts'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const HOUR = 36e5

const visit = (url: string, hoursAgo: number, title = '') => ({ url, title, time: NOW - hoursAgo * HOUR })
const countOf = (history: History, url: string) => history.search(url.replace(/^https?:\/\//, '')).find((h) => h.url === url)?.visitCount

describe('importing history', () => {
  test('importing the same history again adds nothing', () => {
    const history = new History(undefined, NOW)
    const visits = [visit('https://a.example/', 3), visit('https://a.example/', 2), visit('https://b.example/', 1)]
    assert.equal(history.import(visits), 3)
    assert.equal(history.import(visits), 0)
    assert.equal(history.recent().length, 3)
    assert.equal(countOf(history, 'https://a.example/'), 2)
  })

  test('a later import adds only the visits that are new', () => {
    const history = new History(undefined, NOW)
    history.import([visit('https://a.example/', 3), visit('https://a.example/', 2)])
    assert.equal(history.import([visit('https://a.example/', 2), visit('https://a.example/', 1)]), 1)
    assert.equal(countOf(history, 'https://a.example/'), 3)
  })

  test('history from an older YARC loses the duplicates earlier imports left', () => {
    const dir = mkdtempSync(join(tmpdir(), 'yarc-history-'))
    try {
      const old = new DatabaseSync(join(dir, 'history.sqlite'))
      old.exec(`
        CREATE TABLE urls (url TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', visit_count INTEGER NOT NULL DEFAULT 0, last_visit INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE visits (id INTEGER PRIMARY KEY, url TEXT NOT NULL, time INTEGER NOT NULL);
      `)
      const a = 'https://a.example/'
      const b = 'https://b.example/'
      // a: 2 real visits imported twice, plus 3 older ones already pruned from visits.
      old.prepare('INSERT INTO urls VALUES (?, ?, ?, ?)').run(a, 'A', 7, NOW - HOUR)
      old.prepare('INSERT INTO urls VALUES (?, ?, ?, ?)').run(b, 'B', 1, NOW - HOUR)
      for (const [url, hoursAgo] of [[a, 2], [a, 1], [a, 2], [a, 1], [b, 0.5]] as const) {
        old.prepare('INSERT INTO visits (url, time) VALUES (?, ?)').run(url, NOW - hoursAgo * HOUR)
      }
      old.close()

      const history = new History(dir, NOW)
      try {
        assert.deepEqual(
          history.recent().map((v) => v.url),
          [b, a, a]
        )
        assert.equal(countOf(history, a), 5)
        assert.equal(countOf(history, b), 1)
        assert.equal(history.import([visit(a, 1)]), 0)
      } finally {
        history.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
