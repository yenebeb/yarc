import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { isBoardItem, type BoardItem, type Box } from '../../src/shared/canvas.ts'
import { SPOTLIGHTS } from '../../src/shared/spotlights.ts'

const BOARDS_FOLDER = join(import.meta.dirname, '../../src/main/features/boards')
const LIST_OF_BOARDS = readFileSync(join(import.meta.dirname, '../../src/main/features/whats-new-boards.ts'), 'utf8')
const RELEASES_PAGE_STILL = 'releases-still'
const SPOTLIGHT_PICTURE = /^spotlight-(.+)$/
/** The page area of a window that isn't large, in screen pixels, less the margin a board opens with (`reveal` in canvas-board.ts). */
const ROOM_ON_ONE_SCREEN = { width: 1200 - 160, height: 800 - 200 }
const SMALLEST_READABLE_ZOOM = 0.7

interface SavedBoard {
  feature: string
  saved: unknown[]
  drawable: BoardItem[]
}

const boards: SavedBoard[] = readdirSync(BOARDS_FOLDER).map((fileName) => {
  const board = JSON.parse(readFileSync(join(BOARDS_FOLDER, fileName), 'utf8'))
  return { feature: fileName.replace(/\.json$/, ''), saved: board.items, drawable: board.items.filter(isBoardItem) }
})

const bigFeatures = SPOTLIGHTS.map((spotlight) => spotlight.id)
const isPictureOfBigFeature = (picture: string) => bigFeatures.some((feature) => picture === feature || picture.startsWith(`${feature}-`))
const takesRoom = (item: BoardItem) => item.kind === 'text' || item.kind === 'capture' || item.kind === 'image'
const overlap = (first: Box, second: Box) =>
  first.x < second.x + second.width && second.x < first.x + first.width && first.y < second.y + second.height && second.y < first.y + first.height

describe('A What’s New board: the canvas a big feature opens after an update', () => {
  test('belongs to one big feature, and is named after it', () => {
    for (const board of boards) assert.ok(bigFeatures.includes(board.feature), `${board.feature}.json has no spotlight`)
  })

  test('is in the list the app opens boards from', () => {
    for (const board of boards) assert.ok(LIST_OF_BOARDS.includes(`'${board.feature}': board(`), `${board.feature} is missing from whats-new-boards.ts`)
  })

  test('has no item the board can’t draw, because the app would leave it out without saying so', () => {
    for (const board of boards) {
      const unreadable = board.saved.filter((item) => !isBoardItem(item))
      assert.deepEqual(unreadable, [], board.feature)
    }
  })

  test('has one title, and no two items share an id', () => {
    for (const board of boards) {
      const titles = board.drawable.filter((item) => item.kind === 'text' && item.title)
      const ids = board.drawable.map((item) => item.id)
      assert.equal(titles.length, 1, `${board.feature}: titles`)
      assert.deepEqual(ids, [...new Set(ids)], `${board.feature}: ids`)
    }
  })

  test('has the card of the releases page to play, so every board shows what else shipped', () => {
    for (const board of boards) {
      const releasesCards = board.drawable.filter((item) => item.kind === 'capture' && item.fileId === RELEASES_PAGE_STILL)
      assert.equal(releasesCards.length, 1, board.feature)
    }
  })

  test('shows only pictures the app has: the still of the releases page, or one of a big feature’s own pictures', () => {
    for (const board of boards) {
      for (const item of board.drawable) {
        if (item.kind === 'capture') assert.equal(item.fileId, RELEASES_PAGE_STILL, `${board.feature}: ${item.id}`)
        if (item.kind === 'image') assert.ok(isPictureOfBigFeature(SPOTLIGHT_PICTURE.exec(item.fileId)?.[1] ?? ''), `${board.feature}: ${item.id}`)
      }
    }
  })

  test('keeps its texts, cards and pictures off each other (shapes and arrows may sit behind them)', () => {
    for (const board of boards) {
      const solid = board.drawable.filter(takesRoom)
      const covered = solid.flatMap((item, index) => solid.slice(index + 1).flatMap((other) => (overlap(item, other) ? [`${item.id} and ${other.id}`] : [])))
      assert.deepEqual(covered, [], board.feature)
    }
  })

  test('fits one screen without shrinking until it’s hard to read, because it opens scaled to the window', () => {
    for (const board of boards) {
      const left = Math.min(...board.drawable.map((item) => item.x))
      const top = Math.min(...board.drawable.map((item) => item.y))
      const width = Math.max(...board.drawable.map((item) => item.x + item.width)) - left
      const height = Math.max(...board.drawable.map((item) => item.y + item.height)) - top
      assert.ok(width * SMALLEST_READABLE_ZOOM <= ROOM_ON_ONE_SCREEN.width, `${board.feature} is too wide`)
      assert.ok(height * SMALLEST_READABLE_ZOOM <= ROOM_ON_ONE_SCREEN.height, `${board.feature} is too tall`)
    }
  })
})
