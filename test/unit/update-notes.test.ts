import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseChangelog, pendingReleases } from '../../src/main/changelog.ts'

test('lists every version between the running one and the download, newest first', () => {
  const changelog = {
    '0.1.33': ['Not yet downloaded'],
    '0.1.32': ['Daily relaunch card'],
    '0.1.31': ['Caption buttons'],
    '0.1.30': [],
    '0.1.29': ['Already running']
  }
  assert.deepEqual(pendingReleases(changelog, '0.1.29', '0.1.32'), [
    { version: '0.1.32', changes: ['Daily relaunch card'] },
    { version: '0.1.31', changes: ['Caption buttons'] },
    { version: '0.1.30', changes: [] }
  ])
})

test('versions are compared as numbers, not text', () => {
  assert.deepEqual(
    pendingReleases({ '0.1.10': ['Ten'], '0.1.9': ['Nine'] }, '0.1.8', '0.1.10').map((r) => r.version),
    ['0.1.10', '0.1.9']
  )
})

test('a downloaded changelog keeps only lists of changes', () => {
  assert.deepEqual(parseChangelog({ '0.1.32': ['Daily relaunch card'], '0.1.31': [], '0.1.30': 'oops', '0.1.29': [1] }), {
    '0.1.32': ['Daily relaunch card'],
    '0.1.31': []
  })
})

test('a download that is no changelog is an empty one', () => {
  assert.deepEqual(parseChangelog(null), {})
  assert.deepEqual(parseChangelog(['0.1.32']), {})
  assert.deepEqual(parseChangelog('Not Found'), {})
})
