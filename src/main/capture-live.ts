import { View, type WebContents, type WebContentsView } from 'electron'
import type { LiveCard } from '../shared/canvas'
import type { ID } from '../shared/types'
import type { Browser } from './browser'
import { createTabView } from './tab'

/** Out of the page's own scripts' reach. */
const SCROLL_WORLD = 1848
/** Many pages fill in after load; the still stays up meanwhile. */
const SETTLE_MS = 400
/** The card picture's corner radius on the board (canvas.css). */
const CARD_RADIUS = 7

export const isLiveCard = (c: LiveCard): boolean =>
  typeof c?.id === 'string' &&
  /^https?:/i.test(String(c.url)) &&
  [c.zoom, c.box?.x, c.box?.y, c.box?.width, c.box?.height, c.capture?.viewport?.width, c.capture?.viewport?.height, c.capture?.rect?.x, c.capture?.rect?.y, c.capture?.scroll?.x, c.capture?.scroll?.y].every(Number.isFinite) &&
  c.capture.rect.width > 0 &&
  c.capture.viewport.width > 0

/**
 * A playing capture (docs/canvas.md 4.1): the page laid out and scrolled as when it was captured, drawn scaled so the captured
 * rect fills the card's picture box, which clips it.
 */
export class LiveCapture {
  readonly box = new View()
  private readonly view: WebContentsView
  private card: LiveCard
  private scale = 0
  private painted = false
  private loaded = false
  /** Emulating before the page has a renderer crashes Electron. */
  private rendering = false

  constructor(browser: Browser, profileId: ID, card: LiveCard) {
    this.card = card
    this.view = createTabView(browser.profiles.get(profileId).session)
    this.view.setBorderRadius(0)
    this.box.addChildView(this.view)
    this.box.setVisible(false)
    const wc = this.wc
    wc.setAudioMuted(true)
    wc.on('before-input-event', (e, input) => browser.handleInput(e, input))
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
    const { viewport, rect } = card.capture
    const scale = card.box.width / rect.width
    this.box.setBounds({ x: Math.round(card.box.x), y: Math.round(card.box.y), width: Math.round(card.box.width), height: Math.round(card.box.height) })
    this.box.setBorderRadius(Math.round(CARD_RADIUS * card.zoom))
    this.view.setBounds({ x: Math.round(-rect.x * scale), y: Math.round(-rect.y * scale), width: Math.round(viewport.width * scale), height: Math.round(viewport.height * scale) })
    if (scale !== this.scale) {
      this.scale = scale
      this.emulate()
    }
    this.box.setVisible(this.painted && !card.hidden)
  }

  close(): void {
    if (!this.wc.isDestroyed()) this.wc.close()
  }

  private emulate(): void {
    if (!this.rendering || this.wc.isDestroyed()) return
    const { width, height } = this.card.capture.viewport
    const size = { width: Math.round(width), height: Math.round(height) }
    this.wc.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: size, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 0, viewSize: size, scale: this.scale })
    void this.wc.setVisualZoomLevelLimits(1, 1)
  }

  private async settle(): Promise<void> {
    const { x, y } = this.card.capture.scroll
    await this.wc.executeJavaScriptInIsolatedWorld(SCROLL_WORLD, [{ code: `scrollTo(${Number(x)}, ${Number(y)})` }]).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    this.loaded = this.painted = true
    if (!this.wc.isDestroyed()) this.update(this.card)
  }
}
