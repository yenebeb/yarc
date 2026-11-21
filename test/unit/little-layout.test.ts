import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { littleBarColor, littleBounds, littleExpired } from '../../src/main/little-layout.ts'

const laptop = { x: 0, y: 25, width: 1728, height: 1092 }

test('a new Little Window suits the screen and is centered on it', () => {
  assert.deepEqual(littleBounds(laptop), { x: 346, y: 116, width: 1037, height: 819 })
  assert.deepEqual(littleBounds({ x: 1728, y: -900, width: 1920, height: 1055 }), { x: 2112, y: -812, width: 1152, height: 791 })
  assert.deepEqual(littleBounds({ x: 0, y: 0, width: 1280, height: 720 }), { x: 190, y: 13, width: 900, height: 680 })
})

test('a Little Window keeps the size the user gave it, within the screen', () => {
  assert.deepEqual(littleBounds(laptop, { width: 1300, height: 900 }), { x: 214, y: 89, width: 1300, height: 900 })
  assert.deepEqual(littleBounds(laptop, { width: 3000, height: 2000 }), { x: 20, y: 38, width: 1688, height: 1052 })
})

test("Little Window's toolbar is the space color mixed into near-black", () => {
  assert.equal(littleBarColor('#0d0b18'), '#0d0b18')
  assert.equal(littleBarColor('#ffffff'), '#2a2834')
  assert.equal(littleBarColor('not a color'), littleBarColor('#7c6cf2'))
})

describe('a Little Window left in the background closes after the time picked in Settings', () => {
  const minute = 60_000
  const hour = 60 * minute
  const leftAt = 0
  const inBackground = { inFront: false, audible: false, lastActive: leftAt }

  test('it closes once it has been in the background for that long', () => {
    assert.equal(littleExpired(inBackground, leftAt + 59 * minute, 1), false)
    assert.equal(littleExpired(inBackground, leftAt + hour, 1), true)
  })

  test('the time counts from when it was last in front', () => {
    const usedLater = { ...inBackground, lastActive: leftAt + 30 * minute }
    assert.equal(littleExpired(usedLater, leftAt + hour, 1), false)
    assert.equal(littleExpired(usedLater, leftAt + hour + 30 * minute, 1), true)
  })

  test('it stays open while it is in front or playing sound', () => {
    assert.equal(littleExpired({ ...inBackground, inFront: true }, leftAt + 6 * hour, 1), false)
    assert.equal(littleExpired({ ...inBackground, audible: true }, leftAt + 6 * hour, 1), false)
  })

  test('"Never" keeps it open', () => {
    assert.equal(littleExpired(inBackground, leftAt + 30 * 24 * hour, 0), false)
  })
})
