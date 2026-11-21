import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { FLOAT_WIDTH, floatingBounds, videoRatio } from '../../src/main/floating-layout.ts'

const screen = { x: 0, y: 25, width: 1728, height: 1092 }
const browser = { x: 100, y: 100, width: 1200, height: 800 }
const WIDE = 16 / 9
const INSET = 12

describe('where the floating player opens the first time', () => {
  test("at the browser window's bottom-left corner, over the sidebar", () => {
    const height = Math.round(FLOAT_WIDTH / WIDE)
    assert.deepEqual(floatingBounds({ win: browser, area: screen, ratio: WIDE, sidebarRight: false }), {
      x: browser.x + INSET,
      y: browser.y + browser.height - INSET - height,
      width: FLOAT_WIDTH,
      height
    })
  })

  test('at the bottom-right corner when the sidebar is on the right', () => {
    const b = floatingBounds({ win: browser, area: screen, ratio: WIDE, sidebarRight: true })
    assert.equal(b.x + b.width, browser.x + browser.width - INSET)
  })

  test("its height follows the video's shape", () => {
    assert.equal(floatingBounds({ win: browser, area: screen, ratio: 4 / 3, sidebarRight: false }).height, 240)
  })

  test('it stays on the screen when the browser window hangs off it', () => {
    const offscreen = { x: -500, y: 900, width: 1200, height: 800 }
    const b = floatingBounds({ win: offscreen, area: screen, ratio: WIDE, sidebarRight: false })
    assert.equal(b.x, screen.x)
    assert.equal(b.y + b.height, screen.y + screen.height)
  })
})

describe('the next video', () => {
  test('opens where the user left the player, at the width they gave it', () => {
    const last = { x: 1200, y: 60, width: 480, height: 270 }
    assert.deepEqual(floatingBounds({ win: browser, area: screen, ratio: WIDE, sidebarRight: false, last }), last)
  })

  test("takes the new video's shape at that width", () => {
    const last = { x: 1200, y: 60, width: 480, height: 270 }
    assert.equal(floatingBounds({ win: browser, area: screen, ratio: 4 / 3, sidebarRight: false, last }).height, 360)
  })
})

describe("a video's shape", () => {
  test('is its width over its height', () => {
    assert.equal(videoRatio(1920, 1080), WIDE)
  })

  test('is 16:9 before the video knows its size', () => {
    assert.equal(videoRatio(0, 0), WIDE)
  })

  test('is kept within 1:2 and 3:1, so the player stays usable', () => {
    assert.equal(videoRatio(100, 1000), 0.5)
    assert.equal(videoRatio(5000, 100), 3)
  })
})
