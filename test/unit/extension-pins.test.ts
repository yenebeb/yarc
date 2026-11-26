import assert from 'node:assert/strict'
import { test } from 'node:test'
import { everyInstalledPinned, pinnedOf, withPin } from '../../src/shared/extension-pins.ts'

test('pinned extensions come in pin order, only those installed', () => {
  const installed = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' }
  ]
  assert.deepEqual(
    pinnedOf({ id: 'p', name: 'P', favorites: [], pinnedExtensions: ['c', 'gone', 'a'] }, installed).map((extension) => extension.id),
    ['c', 'a']
  )
  assert.deepEqual(pinnedOf({ id: 'p', name: 'P', favorites: [] }, installed), [])
})

test('pinning appends once and unpinning removes', () => {
  assert.deepEqual(withPin(['a'], 'b', true), ['a', 'b'])
  assert.deepEqual(withPin(['a', 'b'], 'a', true), ['a', 'b'])
  assert.deepEqual(withPin(['a', 'b'], 'a', false), ['b'])
})

test('the first start with pins pins every installed extension, keeping any pinned while they loaded', () => {
  const installed = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' }
  ]
  assert.deepEqual(everyInstalledPinned(undefined, installed), ['a', 'b'])
  assert.deepEqual(everyInstalledPinned(['b'], installed), ['b', 'a'])
  assert.deepEqual(everyInstalledPinned([], []), [])
})
