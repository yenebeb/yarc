import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { NativeImage, WebContents } from 'electron'
import { Mirror } from '../../src/main/features/mirror.ts'

/** A page's frame, labelled so the test can tell which one was sent. */
const frame = (label: string) =>
  ({ isEmpty: () => false, getSize: () => ({ width: 800, height: 600 }), toJPEG: () => Buffer.from(label) }) as unknown as NativeImage

/** A page that paints when told to, and can be closed. */
function fakePage() {
  let paint: ((image: NativeImage) => void) | undefined
  let onDestroyed: (() => void) | undefined
  let destroyed = false
  let starts = 0
  const wc = {
    isDestroyed: () => destroyed,
    beginFrameSubscription: (_onlyDirty: boolean, cb: (image: NativeImage) => void) => {
      starts++
      paint = cb
    },
    endFrameSubscription: () => (paint = undefined),
    once: (_event: string, cb: () => void) => (onDestroyed = cb),
    off: () => (onDestroyed = undefined)
  } as unknown as WebContents
  return {
    wc,
    paint: (label: string) => paint?.(frame(label)),
    get subscribed() {
      return !!paint
    },
    get starts() {
      return starts
    },
    close() {
      destroyed = true
      onDestroyed?.()
    }
  }
}

/** A mirror that records the label of every still it sends. */
function recordingMirror() {
  const sent: string[] = []
  const mirror = new Mirror((_wc, still) => sent.push(Buffer.from(still.split(',')[1], 'base64').toString()))
  return { mirror, sent }
}

describe('mirroring a page another window shows live', () => {
  test('a page painting many frames sends one still per 200 ms: the newest frame', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const page = fakePage()
    const { mirror, sent } = recordingMirror()
    mirror.watch(new Set([page.wc]))

    page.paint('frame 1')
    page.paint('frame 2')
    page.paint('frame 3')
    assert.deepEqual(sent, [])

    t.mock.timers.tick(200)
    assert.deepEqual(sent, ['frame 3'])

    page.paint('frame 4')
    t.mock.timers.tick(200)
    assert.deepEqual(sent, ['frame 3', 'frame 4'])
  })

  test('a page that stops painting sends nothing more', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const page = fakePage()
    const { mirror, sent } = recordingMirror()
    mirror.watch(new Set([page.wc]))

    page.paint('frame 1')
    t.mock.timers.tick(1000)
    assert.deepEqual(sent, ['frame 1'])
  })

  test('a page no window shows a still of any more stops being mirrored, and a frame due is dropped', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const page = fakePage()
    const { mirror, sent } = recordingMirror()
    mirror.watch(new Set([page.wc]))
    page.paint('frame 1')

    mirror.watch(new Set())
    t.mock.timers.tick(200)
    assert.equal(page.subscribed, false)
    assert.deepEqual(sent, [])
  })

  test('a page closed while mirrored is forgotten, and never mirrored again', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const page = fakePage()
    const { mirror, sent } = recordingMirror()
    mirror.watch(new Set([page.wc]))
    page.paint('last frame')

    page.close()
    t.mock.timers.tick(200)
    mirror.watch(new Set([page.wc]))
    assert.deepEqual(sent, [])
    assert.equal(page.starts, 1)
  })

  test('the same page watched again keeps its one subscription', () => {
    const page = fakePage()
    const { mirror } = recordingMirror()
    mirror.watch(new Set([page.wc]))
    mirror.watch(new Set([page.wc]))
    assert.equal(page.starts, 1)
  })
})
