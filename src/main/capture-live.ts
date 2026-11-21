import type { MouseInputEvent, WebContents, WebContentsView } from 'electron'
import type { Box, LiveCard } from '../shared/canvas'
import type { ID } from '../shared/types'
import type { Browser } from './browser'
import { createTabView } from './tab'

/** Out of the page's own scripts' reach. */
const SCROLL_WORLD = 1848
/** Many pages fill in after load; the still stays up meanwhile. */
const SETTLE_MS = 400
/** The card picture's corner radius on the board (canvas.css). */
const CARD_RADIUS = 7

const finite = (...n: unknown[]) => n.every(Number.isFinite)

export const isLiveCard = (c: LiveCard): boolean =>
  typeof c?.id === 'string' &&
  /^https?:/i.test(String(c.url)) &&
  finite(c.zoom, c.pixelRatio, c.box?.x, c.box?.y, c.box?.width, c.box?.height, c.clip?.x, c.clip?.y, c.clip?.width, c.clip?.height) &&
  finite(c.capture?.viewport?.width, c.capture?.viewport?.height, c.capture?.rect?.x, c.capture?.rect?.y, c.capture?.scroll?.x, c.capture?.scroll?.y) &&
  c.capture.rect.width > 0 &&
  c.capture.viewport.width > 0 &&
  c.pixelRatio > 0

function intersect(a: Box, b: Box): Box {
  const x = Math.round(Math.max(a.x, b.x))
  const y = Math.round(Math.max(a.y, b.y))
  return { x, y, width: Math.max(0, Math.round(Math.min(a.x + a.width, b.x + b.width)) - x), height: Math.max(0, Math.round(Math.min(a.y + a.height, b.y + b.height)) - y) }
}

/**
 * A playing capture (docs/canvas.md 4.1): the page laid out and scrolled as when it was captured, cropped to the captured rect and
 * scaled to the card. A view doesn't clip its children on macOS, so the view is only the card's visible part. The crop is DevTools'
 * viewport override, which the page can't see (its scripts would undo a CSS shift) but input doesn't follow either, so mouse events
 * are sent again where they're drawn.
 */
export class LiveCapture {
  readonly view: WebContentsView
  private card: LiveCard
  private shown: Box = { x: 0, y: 0, width: 0, height: 0 }
  private painted = false
  private loaded = false
  /** Emulating before the page has a renderer crashes Electron. */
  private rendering = false
  private emulated = ''
  private resending = false

  constructor(browser: Browser, profileId: ID, card: LiveCard) {
    this.card = card
    this.view = createTabView(browser.profiles.get(profileId).session)
    this.view.setVisible(false)
    const wc = this.wc
    wc.setAudioMuted(true)
    wc.on('before-input-event', (e, input) => browser.handleInput(e, input))
    wc.on('before-mouse-event', (e, mouse) => {
      if (this.resending) return
      e.preventDefault()
      this.resend(mouse)
    })
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) browser.openPeek(profileId, url)
      return { action: 'deny' }
    })
    // Redirects while loading are the page's own; later, a link leaves for Peek and the card stays on its page.
    wc.on('will-navigate', (e) => {
      if (!this.loaded) return
      e.preventDefault()
      if (/^https?:/i.test(e.url)) browser.openPeek(profileId, e.url)
    })
    // A new renderer process (a cross-site redirect) starts without the emulation.
    wc.on('dom-ready', () => {
      this.rendering = true
      this.emulated = ''
      this.emulate()
    })
    wc.once('did-finish-load', () => void this.settle())
    this.update(card)
    wc.loadURL(card.url).catch(() => {})
  }

  get wc(): WebContents {
    return this.view.webContents
  }

  get url(): string {
    return this.card.url
  }

  update(card: LiveCard): void {
    this.card = card
    this.shown = intersect(card.box, card.clip)
    this.view.setBounds(this.shown)
    this.view.setBorderRadius(Math.round(CARD_RADIUS * card.zoom))
    this.emulate()
    this.view.setVisible(this.painted && !card.hidden && this.shown.width > 0 && this.shown.height > 0)
  }

  close(): void {
    if (!this.wc.isDestroyed()) this.wc.close()
  }

  private get scale(): number {
    return this.card.box.width / this.card.capture.rect.width
  }

  /** The page's top-left corner, in the page's CSS pixels, at the view's top-left corner. */
  private get corner(): { x: number; y: number } {
    const { rect } = this.card.capture
    return { x: rect.x + (this.shown.x - this.card.box.x) / this.scale, y: rect.y + (this.shown.y - this.card.box.y) / this.scale }
  }

  /** The override's viewport is in device pixels of the document. */
  private emulate(): void {
    if (!this.rendering || this.wc.isDestroyed() || !this.shown.width || !this.shown.height) return
    const { viewport, scroll } = this.card.capture
    const { scale, corner } = this
    const metrics = {
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
      deviceScaleFactor: 0,
      mobile: false,
      viewport: { x: (scroll.x + corner.x) * this.card.pixelRatio, y: (scroll.y + corner.y) * this.card.pixelRatio, width: this.shown.width / scale, height: this.shown.height / scale, scale }
    }
    const key = JSON.stringify(metrics)
    if (key === this.emulated) return
    this.emulated = key
    try {
      if (!this.wc.debugger.isAttached()) this.wc.debugger.attach('1.3')
    } catch {
      return
    }
    this.wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', metrics).catch(() => {})
    void this.wc.setVisualZoomLevelLimits(1, 1)
  }

  /** The page reads a point as its own viewport's CSS pixels, without the crop or the scale. */
  private resend(mouse: MouseInputEvent): void {
    const { scale, corner } = this
    this.resending = true
    try {
      this.wc.sendInputEvent({ ...mouse, x: Math.round(corner.x + mouse.x / scale), y: Math.round(corner.y + mouse.y / scale) })
    } finally {
      this.resending = false
    }
  }

  /** Held at the captured scroll: the crop is in the document, and the page only draws what's near its viewport. */
  private async settle(): Promise<void> {
    const to = `scrollTo(${Number(this.card.capture.scroll.x)}, ${Number(this.card.capture.scroll.y)})`
    await this.wc.executeJavaScriptInIsolatedWorld(SCROLL_WORLD, [{ code: `${to}; addEventListener('scroll', () => ${to}, { passive: true })` }]).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    this.loaded = this.painted = true
    if (!this.wc.isDestroyed()) this.update(this.card)
  }
}
