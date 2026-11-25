import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { BoardItem } from '../../src/shared/canvas.ts'
import { matchAfter, textsHolding } from '../../src/shared/canvas-find.ts'

const textAt = (id: string, x: number, y: number, text: string): BoardItem => ({ id, kind: 'text', x, y, width: 100, height: 20, text, size: 'body', color: 'ink' })
const board: BoardItem[] = [
  textAt('lower-note', 0, 300, 'Chairs to buy'),
  textAt('shopping', 0, 100, 'Chairs, tables\nand a LAMP'),
  textAt('right-of-shopping', 400, 100, 'more chairs'),
  textAt('unrelated', 0, 500, 'Holiday plans'),
  { id: 'box', kind: 'rect', x: 0, y: 0, width: 50, height: 50, color: 'ink', fill: false }
]

describe('which texts a find on a canvas lands on', () => {
  test('the texts that hold what was typed, in reading order: top to bottom, then left to right', () => {
    assert.deepEqual(textsHolding(board, 'chairs'), ['shopping', 'right-of-shopping', 'lower-note'])
  })

  test('capitals make no difference', () => {
    assert.deepEqual(textsHolding(board, 'lamp'), ['shopping'])
    assert.deepEqual(textsHolding(board, 'CHAIRS TO'), ['lower-note'])
  })

  test('a text with the words twice is one match, and one in a later line counts', () => {
    assert.deepEqual(textsHolding([textAt('twice', 0, 0, 'tea, more tea\nand tea')], 'tea'), ['twice'])
    assert.deepEqual(textsHolding(board, 'and a'), ['shopping'])
  })

  test('nothing matches an empty search, or one of only spaces', () => {
    assert.deepEqual(textsHolding(board, ''), [])
    assert.deepEqual(textsHolding(board, '  '), [])
  })

  test('shapes and pictures are not searched', () => {
    assert.deepEqual(textsHolding(board, 'ink'), [])
  })
})

describe('going from match to match', () => {
  test('next goes one on, and after the last goes back to the first', () => {
    assert.equal(matchAfter(3, 0, 1), 1)
    assert.equal(matchAfter(3, 2, 1), 0)
  })

  test('previous goes one back, and from the first goes to the last', () => {
    assert.equal(matchAfter(3, 2, -1), 1)
    assert.equal(matchAfter(3, 0, -1), 2)
  })

  test('with no matches it stays on the first', () => {
    assert.equal(matchAfter(0, 0, 1), 0)
  })
})
