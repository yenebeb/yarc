import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseChangelog, pendingReleases } from '../../src/main/features/changelog.ts'

test('lists every version between the running one and the download, newest first', () => {
  const changelog = {
    changes: {
      '0.1.33': ['Not yet downloaded'],
      '0.1.32': ['Daily relaunch card'],
      '0.1.31': ['Caption buttons'],
      '0.1.30': [],
      '0.1.29': ['Already running']
    },
    thanks: { '0.1.31': ['ada', 'grace'] }
  }
  assert.deepEqual(pendingReleases(changelog, '0.1.29', '0.1.32'), [
    { version: '0.1.32', changes: ['Daily relaunch card'], thanks: [] },
    { version: '0.1.31', changes: ['Caption buttons'], thanks: ['ada', 'grace'] },
    { version: '0.1.30', changes: [], thanks: [] }
  ])
})

test('versions are compared as numbers, not text', () => {
  assert.deepEqual(
    pendingReleases({ changes: { '0.1.10': ['Ten'], '0.1.9': ['Nine'] }, thanks: {} }, '0.1.8', '0.1.10').map((r) => r.version),
    ['0.1.10', '0.1.9']
  )
})

test('a downloaded changelog keeps only lists of changes', () => {
  assert.deepEqual(parseChangelog({ '0.1.32': ['Daily relaunch card'], '0.1.31': [], '0.1.30': 'oops', '0.1.29': [1] }), {
    changes: { '0.1.32': ['Daily relaunch card'], '0.1.31': [] },
    thanks: {}
  })
})

test('a downloaded changelog thanks contributors per version, next to the versions apps from before it read', () => {
  assert.deepEqual(parseChangelog({ '0.1.32': ['Daily relaunch card'], thanks: { '0.1.32': ['ada'], '0.1.31': 'oops' } }), {
    changes: { '0.1.32': ['Daily relaunch card'] },
    thanks: { '0.1.32': ['ada'] }
  })
})

test('a download that is no changelog is an empty one', () => {
  const empty = { changes: {}, thanks: {} }
  assert.deepEqual(parseChangelog(null), empty)
  assert.deepEqual(parseChangelog(['0.1.32']), empty)
  assert.deepEqual(parseChangelog('Not Found'), empty)
})
