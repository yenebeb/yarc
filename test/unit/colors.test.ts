import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hexToHsv, hsvToHex, SPACE_COLORS } from '../../src/shared/colors.ts'

test('hex and HSV convert both ways', () => {
  assert.deepEqual(hexToHsv('#ff0000'), { h: 0, s: 1, v: 1 })
  assert.deepEqual(hexToHsv('#000000'), { h: 0, s: 0, v: 0 })
  assert.equal(hsvToHex({ h: 120, s: 1, v: 1 }), '#00ff00')
  assert.equal(hsvToHex({ h: 240, s: 0.5, v: 1 }), '#8080ff')
  assert.equal(hsvToHex({ h: 360, s: 1, v: 1 }), '#ff0000')
  for (const c of [...SPACE_COLORS, '#ffffff', '#123456']) assert.equal(hsvToHex(hexToHsv(c)), c)
})
