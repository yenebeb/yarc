import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { arrangeInGrid, MAX_PLACED, placedSize, placeNext, snapMove } from '../../src/shared/canvas.ts'
import { CanvasFiles, emptyOldTrash } from '../../src/main/canvas-store.ts'

const GAP = 24
const DAY = 86_400_000

const photo = (id: string, x: number, y: number, width = 200, height = 150) => ({ id, x, y, width, height })

function aCanvas(id = 'good-chairs') {
  const profileCanvases = mkdtempSync(join(tmpdir(), 'yarc-canvases-'))
  return { profileCanvases, files: new CanvasFiles(profileCanvases, id) }
}

const pngBytes = (label: string) => Buffer.from(`png of ${label}`)
const imageOn = (fileId: string) => ({ kind: 'image' as const, id: `image-showing-${fileId}`, fileId, x: 0, y: 0, width: 300, height: 200 })
const noItems = { items: [] }
const captureOf = (fileId: string) => ({ fileId, mimeType: 'image/png', width: 300, height: 200, data: { source: { url: 'https://example.com/chairs', title: 'Chairs' } } })

describe('the size a capture gets on the canvas', () => {
  test('a small capture keeps its own size', () => {
    assert.deepEqual(placedSize(300, 200), { width: 300, height: 200 })
  })

  test('a wide capture is scaled down to the largest placed width, keeping its shape', () => {
    const wide = { width: 2 * MAX_PLACED, height: MAX_PLACED }
    assert.deepEqual(placedSize(wide.width, wide.height), { width: MAX_PLACED, height: MAX_PLACED / 2 })
  })

  test('a tall capture is scaled down by its height', () => {
    const tall = { width: MAX_PLACED, height: 4 * MAX_PLACED }
    assert.deepEqual(placedSize(tall.width, tall.height), { width: MAX_PLACED / 4, height: MAX_PLACED })
  })
})

describe('where the next capture goes', () => {
  test('the first capture is centered on what the canvas shows', () => {
    const middleOfTheView = { x: 1000, y: 500 }
    const size = { width: 200, height: 100 }
    assert.deepEqual(placeNext(undefined, size, middleOfTheView), { x: 1000 - 200 / 2, y: 500 - 100 / 2 })
  })

  test('a capture right after another goes to its right, top-aligned, so a series lines up', () => {
    const before = photo('green-chair', 10, 40, 200, 150)
    assert.deepEqual(placeNext(before, { width: 90, height: 300 }, { x: 0, y: 0 }), { x: 10 + 200 + GAP, y: 40 })
  })
})

describe('Arrange in Grid', () => {
  test('four photos become two rows of two, from the selection’s top-left corner', () => {
    const scattered = [photo('green-chair', 500, 30), photo('rocking-chair', 40, 400), photo('deck-chair', 900, 700), photo('armchair', 100, 20)]
    const moves = arrangeInGrid(scattered)
    const left = 40
    const top = 20
    assert.deepEqual(moves.get('armchair'), { x: left, y: top })
    assert.deepEqual(moves.get('green-chair'), { x: left + 200 + GAP, y: top })
    assert.deepEqual(moves.get('rocking-chair'), { x: left, y: top + 150 + GAP })
    assert.deepEqual(moves.get('deck-chair'), { x: left + 200 + GAP, y: top + 150 + GAP })
  })

  test('keeps reading order: photos at about the same height stay in a row, left to right', () => {
    const slightlyLower = photo('right', 400, 25)
    const moves = arrangeInGrid([slightlyLower, photo('left', 0, 0), photo('below', 0, 600), photo('far-below', 0, 900)])
    assert.equal(moves.get('left')!.y, moves.get('right')!.y)
    assert.ok(moves.get('left')!.x < moves.get('right')!.x)
  })

  test('a row is as tall as its tallest photo', () => {
    const tallPhoto = photo('tall', 0, 0, 100, 400)
    const moves = arrangeInGrid([tallPhoto, photo('short', 200, 0, 100, 50), photo('next-row', 0, 500, 100, 50)])
    assert.equal(moves.get('next-row')!.y, 400 + GAP)
  })
})

describe('snapping while moving', () => {
  const NEAR = 6
  const chair = photo('chair', 100, 100, 200, 150)

  test('a moved photo whose left edge comes within reach of another’s jumps onto it, with a guide along both', () => {
    const almostLinedUp = { x: 104, y: 400, width: 120, height: 80 }
    const snap = snapMove(almostLinedUp, [chair], NEAR)
    assert.equal(snap.dx, chair.x - almostLinedUp.x)
    assert.deepEqual(snap.guides, [{ axis: 'x', at: chair.x, from: chair.y, to: almostLinedUp.y + almostLinedUp.height }])
  })

  test('centers line up too: a smaller photo below snaps to the middle of the one above', () => {
    const below = { x: 146, y: 400, width: 100, height: 80 }
    const chairsMiddle = chair.x + chair.width / 2
    const snap = snapMove(below, [chair], NEAR)
    assert.equal(below.x + snap.dx + below.width / 2, chairsMiddle)
  })

  test('the nearest line wins when several are within reach', () => {
    const between = { x: 297, y: 400, width: 100, height: 80 }
    const chairsRight = chair.x + chair.width
    const snap = snapMove(between, [chair], NEAR)
    assert.equal(between.x + snap.dx, chairsRight)
  })

  test('nothing within reach: no shift and no guides', () => {
    const farAway = { x: 1000, y: 1000, width: 50, height: 50 }
    assert.deepEqual(snapMove(farAway, [chair], NEAR), { dx: 0, dy: 0, guides: [] })
  })
})

describe('a canvas’s files', () => {
  test('a canvas that was never saved has no scene', () => {
    assert.equal(aCanvas().files.readScene(), undefined)
  })

  test('the scene comes back as it was saved', () => {
    const { files } = aCanvas()
    const title = { kind: 'text' as const, id: 'title', text: 'Good Chairs', size: 'title' as const, color: 'ink' as const, title: true, x: 0, y: 0, width: 220, height: 45 }
    const scene = { items: [title], view: { x: 10, y: 20, zoom: 1.5 }, snapping: false }
    files.writeScene(scene)
    assert.deepEqual(files.readScene(), scene)
  })

  test('an image is stored once under its content’s hash, however often it is added', () => {
    const { files } = aCanvas()
    const first = files.addImage(pngBytes('green chair'), 'image/png')
    const again = files.addImage(pngBytes('green chair'), 'image/png')
    assert.equal(first, again)
    assert.match(first, /^[0-9a-f]{64}$/)
    assert.deepEqual(readdirSync(join(files.dir, 'images')), [`${first}.png`])
  })

  test('the page gets images as data URLs of their own type', () => {
    const { files } = aCanvas()
    const fileId = files.addImage(pngBytes('green chair'), 'image/jpeg')
    assert.deepEqual(files.readImages()[fileId], { mimeType: 'image/jpeg', dataURL: `data:image/jpeg;base64,${pngBytes('green chair').toString('base64')}` })
  })

  test('saving deletes images no item shows any more', () => {
    const { files } = aCanvas()
    const kept = files.addImage(pngBytes('kept'), 'image/png')
    const removed = files.addImage(pngBytes('removed from the board'), 'image/png')
    files.writeScene({ items: [imageOn(kept)] })
    assert.deepEqual(Object.keys(files.readImages()), [kept])
    assert.equal(files.hasImage(removed), false)
  })

  test('refuses an image type the canvas can’t show, and a file id that could be a path', () => {
    const { files } = aCanvas()
    assert.throws(() => files.writeImage('chair', pngBytes('svg'), 'image/svg+xml'))
    assert.throws(() => files.writeImage('../escape', pngBytes('png'), 'image/png'))
  })

  test('refuses a canvas id that could be a path', () => {
    assert.throws(() => new CanvasFiles(tmpdir(), '../other-profile'))
  })
})

describe('captures waiting for the canvas page (the inbox)', () => {
  test('the page gets each waiting capture once, with its image', () => {
    const { files } = aCanvas()
    const fileId = files.addImage(pngBytes('capture'), 'image/png')
    files.pushInbox(captureOf(fileId))
    const [item] = files.takeInbox()
    assert.equal(item.fileId, fileId)
    assert.equal(item.dataURL, `data:image/png;base64,${pngBytes('capture').toString('base64')}`)
    assert.deepEqual(files.takeInbox(), [])
  })

  test('a save before the page placed a capture keeps its image', () => {
    const { files } = aCanvas()
    const waiting = files.addImage(pngBytes('just captured'), 'image/png')
    files.pushInbox(captureOf(waiting))
    files.writeScene(noItems)
    assert.equal(files.hasImage(waiting), true)
  })
})

describe('deleting a canvas', () => {
  test('moves it to the profile’s trash, from where it can come back', () => {
    const { files } = aCanvas()
    files.writeScene(noItems)
    files.trash()
    assert.equal(existsSync(files.dir), false)
    files.restore()
    assert.deepEqual(files.readScene(), noItems)
  })

  test('the trash is emptied of canvases deleted more than 30 days ago, counted from the deletion, not the last edit', () => {
    const { profileCanvases, files: old } = aCanvas('deleted-long-ago')
    const recent = new CanvasFiles(profileCanvases, 'deleted-today')
    for (const canvas of [old, recent]) {
      canvas.writeScene(noItems)
      canvas.trash()
    }
    const longAgo = new Date(Date.now() - 31 * DAY)
    utimesSync(join(profileCanvases, '.trash', 'deleted-long-ago'), longAgo, longAgo)
    emptyOldTrash(profileCanvases)
    assert.deepEqual(readdirSync(join(profileCanvases, '.trash')), ['deleted-today'])
  })
})
