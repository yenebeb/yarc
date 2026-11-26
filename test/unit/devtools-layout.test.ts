import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEVTOOLS_WIDTH, devtoolsWidthWithin, dockedDevtoolsLayout } from '../../src/shared/devtools-layout.ts'

test('docked DevTools take the right of the page area, under their bar, with a split gap before them', () => {
  const layout = dockedDevtoolsLayout({ x: 268, y: 8, width: 1200, height: 800 }, 480)
  assert.deepEqual(layout.page, { x: 268, y: 8, width: 714, height: 800 })
  assert.deepEqual(layout.bar, { x: 988, y: 8, width: 480, height: 32 })
  assert.deepEqual(layout.devtools, { x: 988, y: 40, width: 480, height: 768 })
})

test('DevTools keep the page at least 320px wide, and are never narrower than their minimum', () => {
  assert.equal(devtoolsWidthWithin(1000, 900), 674)
  assert.equal(devtoolsWidthWithin(1000, 100), DEVTOOLS_WIDTH.min)
  assert.equal(devtoolsWidthWithin(4000, 3000), DEVTOOLS_WIDTH.max)
  assert.equal(devtoolsWidthWithin(500, 480), DEVTOOLS_WIDTH.min)
})
