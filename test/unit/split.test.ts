import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  appendPane,
  dividers,
  dragBorder,
  flipSplit,
  gather,
  layoutPanes,
  movePane,
  newSplitRoot,
  paneIds,
  placePane,
  previewRect,
  removePane,
  sideAt,
  splitMenuModel,
  upgradeSplit
} from '../../src/shared/split.ts'
import type { SplitGroup, SplitNode } from '../../src/shared/types.ts'

/** A split written the way it looks: row(A, column(B, C)) is A on the left, B above C on the right. */
function shape(node: SplitNode | undefined): string {
  if (!node) return 'none'
  if ('itemId' in node) return node.itemId
  return `${node.dir}(${node.children.map(shape).join(', ')})`
}

const sizes = (node: SplitGroup | undefined) => node?.sizes.map((s) => Math.round(s * 100))

// --------------------------------------------------------------- dropping a tab next to a page

test('dropping a tab on the right of a page shows them side by side, page first', () => {
  assert.equal(shape(placePane(undefined, 'A', 'B', 'right')), 'row(A, B)')
})

test('dropping a tab on the left, top or bottom of a page puts it on that side', () => {
  assert.equal(shape(placePane(undefined, 'A', 'B', 'left')), 'row(B, A)')
  assert.equal(shape(placePane(undefined, 'A', 'B', 'top')), 'column(B, A)')
  assert.equal(shape(placePane(undefined, 'A', 'B', 'bottom')), 'column(A, B)')
})

test('a new split gives both pages half the space', () => {
  assert.deepEqual(sizes(placePane(undefined, 'A', 'B', 'right')), [50, 50])
})

test('dropping beside a pane in the same direction adds a sibling that takes half of that pane', () => {
  const sideBySide = newSplitRoot('A', 'B', 'right')
  const three = placePane(sideBySide, 'B', 'C', 'right')
  assert.equal(shape(three), 'row(A, B, C)')
  assert.deepEqual(sizes(three), [50, 25, 25])
})

test('dropping above or below a side-by-side pane stacks the two in that pane', () => {
  const sideBySide = newSplitRoot('A', 'B', 'right')
  assert.equal(shape(placePane(sideBySide, 'B', 'C', 'bottom')), 'row(A, column(B, C))')
  assert.equal(shape(placePane(sideBySide, 'A', 'C', 'top')), 'row(column(C, A), B)')
})

test('panes can be split both ways into a grid of four', () => {
  let grid = newSplitRoot('A', 'B', 'right')
  grid = placePane(grid, 'A', 'C', 'bottom')!
  grid = placePane(grid, 'B', 'D', 'bottom')!
  assert.equal(shape(grid), 'row(column(A, C), column(B, D))')
})

test('a split holds at most four tabs', () => {
  const four = placePane(placePane(newSplitRoot('A', 'B', 'right'), 'B', 'C', 'right'), 'C', 'D', 'right')
  assert.equal(paneIds(four!).length, 4)
  assert.equal(placePane(four, 'A', 'E', 'bottom'), undefined)
})

test('dropping a page on itself changes nothing', () => {
  assert.equal(placePane(newSplitRoot('A', 'B', 'right'), 'A', 'A', 'left'), undefined)
})

test('dropping a pane of the split elsewhere in it moves it there', () => {
  const three = placePane(newSplitRoot('A', 'B', 'right'), 'B', 'C', 'right')
  assert.equal(shape(placePane(three, 'A', 'C', 'bottom')), 'row(column(A, C), B)')
})

test('moving a pane in a full split is allowed, since it frees its own place first', () => {
  const four = placePane(placePane(newSplitRoot('A', 'B', 'right'), 'B', 'C', 'right'), 'C', 'D', 'right')
  assert.equal(shape(placePane(four, 'A', 'D', 'bottom')), 'row(column(A, D), B, C)')
})

test('moving one of two panes to another side of the other flips the split', () => {
  assert.equal(shape(placePane(newSplitRoot('A', 'B', 'right'), 'A', 'B', 'top')), 'column(B, A)')
})

// --------------------------------------------------------------- Add Split View

test('Add Split View puts the tab in a new column at the right, with equal columns', () => {
  const three = appendPane(newSplitRoot('A', 'B', 'right'), 'C')
  assert.equal(shape(three), 'row(A, B, C)')
  assert.deepEqual(sizes(three), [33, 33, 33])
})

test('Add Split View next to stacked pages puts the stack on the left', () => {
  assert.equal(shape(appendPane(newSplitRoot('A', 'B', 'bottom'), 'C')), 'row(column(A, B), C)')
})

test('Add Split View does nothing for a tab already in the split and refuses a fifth tab', () => {
  const two = newSplitRoot('A', 'B', 'right')
  assert.equal(appendPane(two, 'B'), two)
  const four = appendPane(appendPane(two, 'C')!, 'D')!
  assert.equal(appendPane(four, 'E'), undefined)
})

// --------------------------------------------------------------- closing a pane

test('closing a pane gives its space to its neighbours', () => {
  const three = placePane(newSplitRoot('A', 'B', 'right'), 'B', 'C', 'right')
  const two = removePane(three!, 'B')
  assert.equal(shape(two), 'row(A, C)')
  assert.deepEqual(sizes(two), [67, 33])
})

test('closing one of two stacked panes leaves the other in their place', () => {
  const mixed = placePane(newSplitRoot('A', 'B', 'right'), 'B', 'C', 'bottom')!
  assert.equal(shape(removePane(mixed, 'C')), 'row(A, B)')
})

test('closing a pane so the rest run one way merges them into one row', () => {
  // A | (B over (C | D)): without B, C and D sit beside A.
  let tree = newSplitRoot('A', 'B', 'right')
  tree = placePane(tree, 'B', 'C', 'bottom')!
  tree = placePane(tree, 'C', 'D', 'right')!
  assert.equal(shape(tree), 'row(A, column(B, row(C, D)))')
  assert.equal(shape(removePane(tree, 'B')), 'row(A, C, D)')
})

test('a split with one tab left is no split', () => {
  assert.equal(removePane(newSplitRoot('A', 'B', 'right'), 'A'), undefined)
})

// --------------------------------------------------------------- where panes go on screen

const content = { x: 100, y: 10, width: 1006, height: 806 }

test('side-by-side panes fill the content with a 6 px gap', () => {
  const rects = layoutPanes(newSplitRoot('A', 'B', 'right'), content)
  assert.deepEqual(rects, [
    { id: 'A', rect: { x: 100, y: 10, width: 500, height: 806 } },
    { id: 'B', rect: { x: 606, y: 10, width: 500, height: 806 } }
  ])
})

test('stacked panes sit above each other', () => {
  const rects = layoutPanes(newSplitRoot('A', 'B', 'bottom'), content)
  assert.deepEqual(rects, [
    { id: 'A', rect: { x: 100, y: 10, width: 1006, height: 400 } },
    { id: 'B', rect: { x: 100, y: 416, width: 1006, height: 400 } }
  ])
})

test('every border between panes gets a handle, nested ones inside their own group', () => {
  const mixed = placePane(newSplitRoot('A', 'B', 'right'), 'B', 'C', 'bottom')!
  const handles = dividers(mixed, content)
  assert.deepEqual(
    handles.map((d) => ({ path: d.path, index: d.index, dir: d.dir, rect: d.rect })),
    [
      { path: [], index: 0, dir: 'row', rect: { x: 600, y: 10, width: 6, height: 806 } },
      { path: [1], index: 0, dir: 'column', rect: { x: 606, y: 410, width: 500, height: 6 } }
    ]
  )
})

test('dragging a border moves space between its two neighbours, keeping each at least 15%', () => {
  assert.deepEqual(dragBorder([0.5, 0.5], 0, 100, 1000), [0.6, 0.4])
  assert.deepEqual(dragBorder([0.5, 0.5], 0, -900, 1000), [0.15, 0.85])
})

// --------------------------------------------------------------- drop zones over a page

const pane = { x: 0, y: 0, width: 800, height: 600 }

test('the cursor picks the nearest edge of the pane', () => {
  assert.equal(sideAt(pane, 100, 300), 'left')
  assert.equal(sideAt(pane, 700, 300), 'right')
  assert.equal(sideAt(pane, 400, 50), 'top')
  assert.equal(sideAt(pane, 400, 550), 'bottom')
})

test('the preview is the half of the pane the new tab would take', () => {
  assert.deepEqual(previewRect(pane, 'left'), { x: 0, y: 0, width: 397, height: 600 })
  assert.deepEqual(previewRect(pane, 'right'), { x: 403, y: 0, width: 397, height: 600 })
  assert.deepEqual(previewRect(pane, 'top'), { x: 0, y: 0, width: 800, height: 297 })
  assert.deepEqual(previewRect(pane, 'bottom'), { x: 0, y: 303, width: 800, height: 297 })
})

// --------------------------------------------------------------- older state files

test('a split saved by an older version becomes a row', () => {
  const old = { id: 's', itemIds: ['A', 'B'], sizes: [0.7, 0.3] }
  const split = upgradeSplit(old)!
  assert.equal(shape(split.root), 'row(A, B)')
  assert.deepEqual(sizes(split.root), [70, 30])
  assert.equal(upgradeSplit({ id: 's', itemIds: ['A'] }), undefined)
})

// --------------------------------------------------------------- the split menu on a pane's bar

const abc = () => placePane(newSplitRoot('A', 'B', 'right'), 'B', 'C', 'right')!

test('Move Right swaps a pane with its right neighbour, and it keeps its width', () => {
  const wideA = { ...newSplitRoot('A', 'B', 'right'), sizes: [0.7, 0.3] }
  const moved = movePane(wideA, 'A', 1)
  assert.equal(shape(moved), 'row(B, A)')
  assert.deepEqual(sizes(moved), [30, 70])
})

test('Move Left and Move Right stop at the edges', () => {
  assert.equal(movePane(abc(), 'A', -1), undefined)
  assert.equal(movePane(abc(), 'C', 1), undefined)
  assert.equal(shape(movePane(abc(), 'C', -1)), 'row(A, C, B)')
})

test('a stacked pane moves up and down within its stack', () => {
  const mixed = placePane(newSplitRoot('A', 'B', 'right'), 'B', 'C', 'bottom')!
  assert.equal(shape(movePane(mixed, 'C', -1)), 'row(A, column(C, B))')
})

test('the menu offers Move Left (not at the left edge) and Move Right (not at the right edge)', () => {
  const left = splitMenuModel(abc(), 'A')
  assert.deepEqual([left.moveBack, left.moveForward], [
    { label: 'Move Left', enabled: false },
    { label: 'Move Right', enabled: true }
  ])
  const right = splitMenuModel(abc(), 'C')
  assert.deepEqual([right.moveBack.enabled, right.moveForward.enabled], [true, false])
})

test('in a stacked split the menu moves and adds up and down', () => {
  const m = splitMenuModel(newSplitRoot('A', 'B', 'bottom'), 'A')
  assert.deepEqual([m.moveBack.label, m.moveForward.label, m.addAfter.label, m.addBefore.label], ['Move Up', 'Move Down', 'Add Bottom Split', 'Add Top Split'])
  assert.equal(m.convert, 'Convert to Horizontal Split View')
})

test('Add Right Split puts the new tab right of the pane, taking half of it', () => {
  const m = splitMenuModel(newSplitRoot('A', 'B', 'right'), 'A')
  const added = placePane(newSplitRoot('A', 'B', 'right'), 'A', 'N', m.addAfter.side)
  assert.equal(shape(added), 'row(A, N, B)')
  assert.deepEqual(sizes(added), [25, 25, 50])
})

test('Add Left Split puts the new tab left of the pane', () => {
  const m = splitMenuModel(newSplitRoot('A', 'B', 'right'), 'B')
  assert.equal(shape(placePane(newSplitRoot('A', 'B', 'right'), 'B', 'N', m.addBefore.side)), 'row(A, N, B)')
})

test('a split of four tabs offers no Add', () => {
  const four = placePane(abc(), 'C', 'D', 'right')!
  assert.equal(splitMenuModel(four, 'A').canAdd, false)
  assert.equal(splitMenuModel(abc(), 'A').canAdd, true)
})

test('Separate Tab from Split leaves the others as a split, or ends a split of two', () => {
  assert.equal(shape(removePane(abc(), 'B')), 'row(A, C)')
  assert.equal(removePane(newSplitRoot('A', 'B', 'right'), 'B'), undefined)
})

test('Convert to Vertical Split View stacks side-by-side panes, keeping their sizes', () => {
  const wideA = { ...newSplitRoot('A', 'B', 'right'), sizes: [0.7, 0.3] }
  const flipped = flipSplit(wideA)
  assert.equal(shape(flipped), 'column(A, B)')
  assert.deepEqual(sizes(flipped), [70, 30])
  assert.equal(splitMenuModel(wideA, 'A').convert, 'Convert to Vertical Split View')
})

test('converting a mixed split turns every group', () => {
  const mixed = placePane(newSplitRoot('A', 'B', 'right'), 'B', 'C', 'bottom')!
  assert.equal(shape(flipSplit(mixed)), 'column(A, row(B, C))')
  assert.equal(shape(flipSplit(flipSplit(mixed))), shape(mixed))
})

// --------------------------------------------------------------- the split's row in the sidebar

const tabs = (...ids: string[]) => ids.map((id) => ({ id }))
const order = (list: { id: string }[]) => list.map((x) => x.id).join('')

test("a split's tabs are brought together where the first of them is", () => {
  assert.equal(order(gather(tabs('A', 'X', 'B', 'Y'), ['B', 'A'])), 'ABXY')
  assert.equal(order(gather(tabs('X', 'A', 'Y', 'Z', 'B'), ['A', 'B'])), 'XABYZ')
})

test('a list with fewer than two of the split\'s tabs stays as it is', () => {
  const list = tabs('A', 'X', 'Y')
  assert.equal(gather(list, ['A', 'B']), list)
})
