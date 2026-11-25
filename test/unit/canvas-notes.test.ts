import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { isBoardItem, type TextItem } from '../../src/shared/canvas.ts'
import { enterInList, hasLongLine, linkParts, listLineStart, noteLine, rewrapped, toggledCheckbox, wrappedRows } from '../../src/shared/canvas-notes.ts'

const markOf = (typed: string) => noteLine(typed).mark
const atTheEndOf = (text: string) => text.length

describe('how a line of a text is drawn', () => {
  test('a line that starts with "- " or "* " is a bullet, without the mark in what it says', () => {
    assert.deepEqual(noteLine('- milk'), { mark: 'bullet', level: 0, prefix: '- ', text: 'milk' })
    assert.equal(markOf('* milk'), 'bullet')
  })

  test('"[ ] " is an open checkbox and "[x] " a ticked one', () => {
    assert.equal(markOf('[ ] call the shop'), 'unchecked')
    assert.equal(markOf('[x] call the shop'), 'checked')
  })

  test('"# " is a heading', () => {
    assert.equal(markOf('# Chairs to buy'), 'heading')
  })

  test('any other line is plain text, also with a dash or a bracket further on', () => {
    assert.equal(markOf('milk - the oat kind [ ]'), undefined)
    assert.equal(markOf('-no space after the dash'), undefined)
  })

  test('each tab before a list line puts it one level deeper', () => {
    assert.equal(noteLine('- milk').level, 0)
    assert.equal(noteLine('\t- oat milk').level, 1)
    assert.equal(noteLine('\t\t- barista').level, 2)
  })
})

describe('a click on a checkbox', () => {
  const list = '[ ] chairs\n[ ] table\n[x] lamp'

  test('ticks only the line that was clicked', () => {
    assert.equal(toggledCheckbox(list, 1), '[ ] chairs\n[x] table\n[x] lamp')
  })

  test('unticks a line that was ticked', () => {
    assert.equal(toggledCheckbox(list, 2), '[ ] chairs\n[ ] table\n[ ] lamp')
  })
})

describe('Enter while typing a list', () => {
  test('after a bullet, the next line starts with a bullet too', () => {
    assert.deepEqual(enterInList('- milk', atTheEndOf('- milk')), { continueWith: '- ' })
  })

  test('after a ticked checkbox, the next one is open', () => {
    assert.deepEqual(enterInList('[x] milk', atTheEndOf('[x] milk')), { continueWith: '[ ] ' })
  })

  test('the next line is as deep as the one before', () => {
    assert.deepEqual(enterInList('- milk\n\t- oat', atTheEndOf('- milk\n\t- oat')), { continueWith: '\t- ' })
  })

  test('on a list line with nothing in it yet, its mark goes: the list has ended', () => {
    assert.deepEqual(enterInList('- milk\n- ', atTheEndOf('- milk\n- ')), { endByRemoving: '- '.length })
  })

  test('in a plain line, Enter is left to the browser', () => {
    assert.equal(enterInList('milk', atTheEndOf('milk')), undefined)
  })
})

describe('Tab while typing', () => {
  test('in a list line the indent goes at the start of that line, wherever the caret is', () => {
    const startOfSecondLine = '- milk\n'.length
    assert.equal(listLineStart('- milk\n- oat', atTheEndOf('- milk\n- oat')), startOfSecondLine)
  })

  test('in a plain line there is no list to indent, so Tab types a tab', () => {
    assert.equal(listLineStart('milk', atTheEndOf('milk')), undefined)
  })
})

describe('links in a text', () => {
  test('a URL in a sentence is a link; the full stop after it is not part of it', () => {
    assert.deepEqual(linkParts('See https://example.com/chairs.'), [{ text: 'See ' }, { text: 'https://example.com/chairs', url: 'https://example.com/chairs' }, { text: '.' }])
  })

  test('a line without a URL is one piece of text', () => {
    assert.deepEqual(linkParts('Buy chairs'), [{ text: 'Buy chairs' }])
  })
})

describe('a pasted text', () => {
  test('with a line longer than about 60 characters gets wrapped', () => {
    assert.equal(hasLongLine('A paragraph copied from a page comes as one line, however long it is.'), true)
  })

  test('with only short lines stays as it is', () => {
    assert.equal(hasLongLine('milk\neggs\nbread'), false)
  })
})

describe('the rows a wrapped line takes in an exported PNG', () => {
  const LETTER = 10
  const widthOf = (text: string) => text.length * LETTER
  const TEN_LETTERS = 10 * LETTER

  test('words fill a row until the next one doesn’t fit', () => {
    assert.deepEqual(wrappedRows('buy chairs for the hall', TEN_LETTERS, widthOf), ['buy chairs', 'for the', 'hall'])
  })

  test('a word longer than a row is cut where the row ends', () => {
    assert.deepEqual(wrappedRows('https://example.com', TEN_LETTERS, widthOf), ['https://ex', 'ample.com'])
  })

  test('an empty line is still a row', () => {
    assert.deepEqual(wrappedRows('', TEN_LETTERS, widthOf), [''])
  })

  test('a text without a wrap width stays on one row', () => {
    assert.deepEqual(wrappedRows('buy chairs for the hall', Infinity, widthOf), ['buy chairs for the hall'])
  })
})

describe('dragging a text’s side handle', () => {
  const label: TextItem = { id: 'label', kind: 'text', x: 100, y: 50, width: 300, height: 20, text: 'A label as wide as what it says', size: 'body', color: 'ink' }
  const rightEdge = label.x + label.width

  test('the right handle sets where lines wrap; the left side stays', () => {
    const narrower = rewrapped(label, 'e', -100)
    assert.equal(narrower.wrapWidth, 200)
    assert.equal(narrower.x, label.x)
  })

  test('the left handle moves the left side; the right side stays', () => {
    const narrower = rewrapped(label, 'w', 100)
    assert.equal(narrower.wrapWidth, 200)
    assert.equal(narrower.x + narrower.wrapWidth!, rightEdge)
  })

  test('a text never gets narrower than 80 px, and doesn’t slide along once it’s there', () => {
    const narrowest = rewrapped(label, 'w', 500)
    assert.equal(narrowest.wrapWidth, 80)
    assert.equal(narrowest.x + 80, rightEdge)
  })
})

describe('what the board takes as a note', () => {
  const text = { id: 'note', kind: 'text', x: 0, y: 0, width: 280, height: 60, text: '- milk', size: 'body', color: 'ink' }

  test('a text with a wrap width, on a card or not', () => {
    assert.equal(isBoardItem({ ...text, wrapWidth: 280, card: true }), true)
    assert.equal(isBoardItem({ ...text, wrapWidth: 420 }), true)
  })

  test('refuses a wrap width the board can’t lay out', () => {
    assert.equal(isBoardItem({ ...text, wrapWidth: 'wide' }), false)
    assert.equal(isBoardItem({ ...text, wrapWidth: 0 }), false)
  })
})
