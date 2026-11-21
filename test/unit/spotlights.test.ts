import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recentSpotlights, unseenSpotlights, type Spotlight } from '../../src/shared/spotlights.ts'

// Newest first, like the catalogue.
const catalogue: Spotlight[] = [
  { id: 'floating-player', title: 'Float playing videos', text: '…' },
  { id: 'easels', title: 'Easels', text: '…' },
  { id: 'shared-tabs', title: 'Share a tab between windows', text: '…' },
  { id: 'split-view', title: 'Split view', text: '…' }
]

test("a profile that has seen none (from before spotlights) sees them all, newest first", () => {
  assert.deepEqual(unseenSpotlights(catalogue, undefined), ['floating-player', 'easels', 'shared-tabs', 'split-view'])
})

test('a spotlight is shown once: seen ones never come back', () => {
  assert.deepEqual(unseenSpotlights(catalogue, ['easels', 'shared-tabs', 'split-view']), ['floating-player'])
  assert.deepEqual(unseenSpotlights(catalogue, catalogue.map((s) => s.id)), [])
})

test('ids of spotlights no longer in the catalogue are harmless', () => {
  assert.deepEqual(unseenSpotlights(catalogue, ['removed-long-ago', 'easels', 'shared-tabs', 'split-view']), ['floating-player'])
})

test("What's New opened by hand shows the newest few", () => {
  assert.deepEqual(recentSpotlights(catalogue), ['floating-player', 'easels', 'shared-tabs'])
  assert.deepEqual(recentSpotlights(catalogue, 1), ['floating-player'])
  assert.deepEqual(recentSpotlights([]), [])
})
