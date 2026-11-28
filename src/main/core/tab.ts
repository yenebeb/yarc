import {
  BrowserWindow,
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type ContextMenuParams,
  type Event,
  type Input,
  type Result,
  type Session,
  type WebContents
} from 'electron'
import type { ID, LiveInfo } from '../../shared/types'
import { originOf } from '../../shared/url'
import { openExternalLink } from './external-links'
import { userAgentFor } from './useragent'

export type OpenDisposition = 'foreground-tab' | 'background-tab' | 'new-window' | 'other'

export interface TabHost {
  onTabChanged(tab: LiveTab, change: { url?: string; title?: string; favicon?: string; navigated?: boolean }): void
  onTabInput(tab: LiveTab, event: Event, input: Input): void
  onTabDestroyed(tab: LiveTab): void
  onTabFocus(tab: LiveTab): void
  onTabFullscreen(tab: LiveTab, on: boolean): void
  onFoundInPage(tab: LiveTab, result: Result): void
  /** A page opened a tab: adopt the page Electron made from `options`, or, without them, open `url` in a new tab. */
  adoptOpenedPage(opener: LiveTab, options: BrowserWindowConstructorOptions | undefined, disposition: OpenDisposition, url: string): WebContents
  showContextMenu(tab: LiveTab, params: ContextMenuParams): void
  /** A link the user clicked is about to replace the page; return true to open it elsewhere instead. */
  interceptLink?(tab: LiveTab, url: string): boolean
  /** A link the user shift-clicked; return true if it opened in Peek instead of a new window. */
  peekLink?(tab: LiveTab, url: string): boolean
  onPopupBlocked?(tab: LiveTab, url: string): void
}

const USER_ACTIVATION_MS = 5000
const LINK_CLICK_MS = 1000
/** One unrequested window is always allowed: clicks in a cross-site frame ("Sign in with Google") don't reach the tab's input events. */
const UNREQUESTED_POPUP_MS = 30_000
const ERR_ABORTED = -3
const PAINT_DELAY_MS = 200

const WEB_SCHEMES = /^(https?|file|about|data|blob|chrome-extension|view-source|devtools|chrome):/i

/** For a page a site opened itself: Chromium already made its webContents, with the opener's preferences. */
export function adoptedTabView(options: BrowserWindowConstructorOptions): WebContentsView {
  const view = new WebContentsView({ webContents: (options as { webContents?: WebContents }).webContents, webPreferences: options.webPreferences })
  view.setBackgroundColor('#ffffff')
  return view
}

export function createTabView(session: Session): WebContentsView {
  const view = new WebContentsView({
    webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true, scrollBounce: true }
  })
  view.setBackgroundColor('#ffffff')
  view.setBorderRadius(8)
  return view
}

/** Sites mark drag regions for their own desktop apps (Linear covers its whole page); Electron would apply them to our window, swallowing clicks. */
const IGNORE_APP_REGIONS = '*, *::before, *::after { -webkit-app-region: no-drag !important; app-region: no-drag !important; }'

export class LiveTab {
  readonly view: WebContentsView
  /** Kept separately: a view drops its webContents reference once the page is destroyed. */
  readonly wc: WebContents
  fullscreen = false
  crashed = false
  playing = false
  private lastClick = 0
  private lastActivation = 0
  private lastUnrequestedPopup = 0

  get userActivated(): boolean {
    return Date.now() - this.lastActivation < USER_ACTIVATION_MS
  }

  constructor(
    public host: TabHost,
    public itemId: ID,
    readonly profileId: ID,
    readonly session: Session,
    url?: string,
    adopt?: WebContentsView
  ) {
    this.view = adopt ?? createTabView(session)
    this.wc = this.view.webContents
    this.view.setBorderRadius(8)
    this.wire()
    if (url) void this.load(url)
  }

  get destroyed(): boolean {
    return this.wc.isDestroyed()
  }

  async load(url: string): Promise<void> {
    try {
      await this.wc.loadURL(url)
    } catch (err) {
      const code = (err as { errno?: number }).errno
      // The origin only: a URL can hold tokens, and an incognito tab's shouldn't reach any log.
      if (code !== ERR_ABORTED) console.warn('[tab] load failed', originOf(url), (err as Error).message)
    }
  }

  info(): LiveInfo {
    const wc = this.wc
    return {
      wcId: wc.id,
      url: wc.getURL(),
      title: wc.getTitle(),
      favicon: this.favicon,
      loading: wc.isLoading(),
      audible: wc.isCurrentlyAudible(),
      muted: wc.isAudioMuted(),
      playing: this.playing,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      zoom: wc.getZoomLevel(),
      blocked: 0,
      shielded: false,
      barColor: this.barColor
    }
  }

  favicon?: string
  private latestFaviconRequest = 0
  barColor?: string
  /** Set once the tab has been in a split, so later loads read the bar color again. */
  private sampledFor?: string

  sampleBarColor(again = false): void {
    const wc = this.wc
    if (wc.isDestroyed()) return
    const url = wc.getURL()
    if (!again && this.sampledFor === url) return
    this.sampledFor = url
    setTimeout(() => {
      const { width } = this.view.getBounds()
      if (wc.isDestroyed() || width <= 0) return
      void wc
        .capturePage({ x: 0, y: 0, width, height: 2 })
        .then((image) => {
          if (image.isEmpty() || wc.isDestroyed()) return
          const color = commonColor(image.toBitmap())
          if (!color || color === this.barColor) return
          this.barColor = color
          this.host.onTabChanged(this, {})
        })
        .catch(() => {})
    }, PAINT_DELAY_MS)
  }

  private setPlaying(on: boolean): void {
    if (this.playing === on) return
    this.playing = on
    this.host.onTabChanged(this, {})
  }

  destroy(): void {
    if (!this.wc.isDestroyed()) this.wc.close()
  }

  private wire(): void {
    const wc = this.wc
    wc.on('dom-ready', () => void wc.insertCSS(IGNORE_APP_REGIONS, { cssOrigin: 'user' }).catch(() => {}))
    wc.on('page-title-updated', (_e, title) => this.host.onTabChanged(this, { title }))
    wc.on('page-favicon-updated', (_e, icons) => {
      const asked = ++this.latestFaviconRequest
      void faviconData(this.session, icons[0]).then((data) => {
        if (asked !== this.latestFaviconRequest || wc.isDestroyed()) return
        // Not for incognito: the sidebar would fetch the URL through the default, persistent session.
        const favicon = data ?? (this.session.isPersistent() && /^https:/i.test(icons[0] ?? '') ? icons[0] : undefined)
        this.favicon = favicon
        this.host.onTabChanged(this, { favicon })
      })
    })
    wc.on('did-start-loading', () => this.host.onTabChanged(this, {}))
    wc.on('did-stop-loading', () => {
      this.host.onTabChanged(this, {})
      if (this.sampledFor !== undefined) this.sampleBarColor(true)
    })
    wc.on('did-navigate', (_e, url) => this.host.onTabChanged(this, { url, navigated: true }))
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) this.host.onTabChanged(this, { url })
    })
    wc.on('audio-state-changed', () => this.host.onTabChanged(this, {}))
    wc.on('media-started-playing', () => this.setPlaying(true))
    wc.on('media-paused', () => this.setPlaying(false))
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.setPlaying(false)
    })
    wc.on('before-input-event', (e, input) => this.host.onTabInput(this, e, input))
    wc.on('focus', () => this.host.onTabFocus(this))
    wc.on('context-menu', (_e, params) => this.host.showContextMenu(this, params))
    wc.on('found-in-page', (_e, result) => this.host.onFoundInPage(this, result))
    wc.on('enter-html-full-screen', () => {
      this.fullscreen = true
      this.host.onTabFullscreen(this, true)
    })
    wc.on('leave-html-full-screen', () => {
      this.fullscreen = false
      this.host.onTabFullscreen(this, false)
    })
    wc.once('destroyed', () => this.host.onTabDestroyed(this))
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return
      console.warn('[tab] renderer gone', details.reason)
      this.crashed = true
      this.host.onTabChanged(this, {})
    })
    wc.on('input-event', (_e, input) => {
      if (input.type === 'mouseUp') this.lastClick = Date.now()
      if (input.type === 'mouseDown' || input.type === 'mouseUp' || input.type === 'keyDown' || input.type === 'rawKeyDown' || input.type === 'touchEnd') this.lastActivation = Date.now()
    })
    wc.on('will-navigate', (e, url) => {
      if (!WEB_SCHEMES.test(url)) {
        e.preventDefault()
        void openExternalLink(wc, url, this.userActivated)
        return
      }
      const clicked = Date.now() - this.lastClick < LINK_CLICK_MS
      if (clicked && this.host.interceptLink?.(this, url)) e.preventDefault()
    })
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      if (!WEB_SCHEMES.test(url)) {
        void openExternalLink(wc, url, this.userActivated)
        return { action: 'deny' }
      }
      // Input events from a real mouse carry no modifiers; a featureless new window right after a click is a shift-click.
      const shiftClicked = disposition === 'new-window' && !features && Date.now() - this.lastClick < LINK_CLICK_MS
      if (shiftClicked && this.host.peekLink?.(this, url)) return { action: 'deny' }
      if (!this.userActivated) {
        if (Date.now() - this.lastUnrequestedPopup < UNREQUESTED_POPUP_MS) {
          this.host.onPopupBlocked?.(this, url)
          return { action: 'deny' }
        }
        this.lastUnrequestedPopup = Date.now()
      }
      // Sized windows (OAuth/SSO) stay popups so window.opener works.
      if (disposition === 'new-window' && features) {
        return { action: 'allow', overrideBrowserWindowOptions: popupOptions(this.session) }
      }
      // A window.open page keeps the session's UA in navigator.userAgent whatever setUserAgent says, so Teams opens with loadURL.
      const ua = this.session.getUserAgent()
      if (userAgentFor(url, ua) !== ua) {
        this.host.adoptOpenedPage(this, undefined, disposition as OpenDisposition, url)
        return { action: 'deny' }
      }
      return {
        action: 'allow',
        createWindow: (options) => this.host.adoptOpenedPage(this, options, disposition as OpenDisposition, url)
      }
    })
    wc.on('did-create-window', (win) => wirePopup(win, this.session))
  }
}

function popupOptions(session: Session): BrowserWindowConstructorOptions {
  return { autoHideMenuBar: true, width: 520, height: 680, webPreferences: { session, sandbox: true, contextIsolation: true } }
}

/** Never the page's own title: a popup has no address bar to check. */
export function popupTitle(url: string): string {
  const u = URL.parse(url)
  if (u?.protocol === 'https:') return u.host
  if (u?.protocol === 'http:') return `Not Secure – ${u.host}`
  return url.length > 80 ? `${url.slice(0, 80)}…` : url
}

function wirePopup(win: BrowserWindow, session: Session): void {
  const wc = win.webContents
  const show = () => {
    if (!win.isDestroyed()) win.setTitle(popupTitle(wc.getURL()))
  }
  wc.on('page-title-updated', (e) => {
    e.preventDefault()
    show()
  })
  wc.on('did-navigate', show)
  wc.on('did-navigate-in-page', show)
  wc.on('will-navigate', (e, url) => {
    if (WEB_SCHEMES.test(url)) return
    e.preventDefault()
    void openExternalLink(wc, url)
  })
  wc.on('dom-ready', () => void wc.insertCSS(IGNORE_APP_REGIONS, { cssOrigin: 'user' }).catch(() => {}))
  wc.setWindowOpenHandler(({ url }) => {
    if (WEB_SCHEMES.test(url)) return { action: 'allow', overrideBrowserWindowOptions: popupOptions(session) }
    void openExternalLink(wc, url)
    return { action: 'deny' }
  })
  wc.on('did-create-window', (child) => wirePopup(child, session))
  show()
}

/** Each data: URL is stored with its tab and sent to the UI with every update. */
export const FAVICON_MAX = 16_000
const IMAGE_TYPES: Record<string, string> = { ico: 'image/x-icon', png: 'image/png', svg: 'image/svg+xml', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

/** With the tab's own session (in memory for incognito), so YARC's UI never loads anything from the network itself. */
export async function faviconData(session: Session, url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined
  if (/^data:image\//i.test(url)) return url.length <= FAVICON_MAX * 1.4 ? url : undefined
  if (!/^https?:/i.test(url)) return undefined
  try {
    const res = await session.fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return undefined
    let type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    // Servers often send .ico files as text/plain or application/octet-stream.
    if (!type.startsWith('image/')) type = IMAGE_TYPES[/\.(\w+)$/.exec(new URL(url).pathname)?.[1]?.toLowerCase() ?? ''] ?? ''
    if (!type) return undefined
    const body = Buffer.from(await res.arrayBuffer())
    if (!body.length || body.length > FAVICON_MAX) return undefined
    return `data:${type};base64,${body.toString('base64')}`
  } catch {
    return undefined
  }
}

function commonColor(bgra: Buffer): string | undefined {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i + 3 < bgra.length; i += 4) {
    const b = bgra[i]
    const g = bgra[i + 1]
    const r = bgra[i + 2]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const s = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    s.n++
    s.r += r
    s.g += g
    s.b += b
    buckets.set(key, s)
  }
  let best: { n: number; r: number; g: number; b: number } | undefined
  for (const s of buckets.values()) if (!best || s.n > best.n) best = s
  if (!best) return undefined
  return `rgb(${Math.round(best.r / best.n)}, ${Math.round(best.g / best.n)}, ${Math.round(best.b / best.n)})`
}
