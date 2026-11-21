// A live web page attached to a sidebar item (favorite, pinned or Today tab).
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
import type { ID, LiveInfo } from '../shared/types'
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
  /** The page tried to open a window without the user clicking or typing just before. */
  onPopupBlocked?(tab: LiveTab, url: string): void
}

/** How long a click or key press counts as the user's doing, like Chromium's transient user activation. */
const ACTIVATION_MS = 5000
/**
 * A page that opened a window without the user's input can't open another for this long. Clicks in
 * a cross-site frame (a "Sign in with Google" button) don't reach the tab's input events, so one
 * such window is always allowed; the blocker stops pop-up floods, not single sign-in windows.
 */
const UNREQUESTED_POPUP_MS = 30_000

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return '(unparsable URL)'
  }
}

const WEB_SCHEMES = /^(https?|file|about|data|blob|chrome-extension|view-source|devtools|chrome):/i

export function createTabView(session: Session): WebContentsView {
  const view = new WebContentsView({
    webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true, scrollBounce: true }
  })
  view.setBackgroundColor('#ffffff')
  view.setBorderRadius(8)
  return view
}

const IGNORE_APP_REGIONS = '*, *::before, *::after { -webkit-app-region: no-drag !important; app-region: no-drag !important; }'

export class LiveTab {
  readonly view: WebContentsView
  /** Kept separately: a view drops its webContents reference once the page is destroyed. */
  readonly wc: WebContents
  fullscreen = false
  crashed = false
  /** The page's media plays (from Chromium's media events; it may be silent). */
  playing = false
  /** When the user last clicked in the page; navigations right after it are link clicks, not redirects. */
  private lastClick = 0
  /** When the user last clicked or pressed a key in the page. */
  private lastActivation = 0
  /** When the page last opened a window without the user's input. */
  private lastUnrequestedPopup = 0

  /** Whether the user clicked or typed in the page just now. */
  get userActivated(): boolean {
    return Date.now() - this.lastActivation < ACTIVATION_MS
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
      // ERR_ABORTED (-3) happens on redirects and user navigation; the page handles the rest.
      const code = (err as { errno?: number }).errno
      // The origin only: a URL can hold tokens, and an incognito tab's shouldn't reach any log.
      if (code !== -3) console.warn('[tab] load failed', originOf(url), (err as Error).message)
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
  /** Counts favicon changes, so a slow fetch can't replace a newer icon. */
  private faviconRequest = 0
  /** The color along the top of the page, for its bar in a split view (Arc tints the bar like the page). */
  barColor?: string
  /** The page `barColor` was read from; set once the tab has been in a split, so later loads read it again. */
  private sampledFor?: string

  /** Reads the color along the top of the page (a strip 2 px tall), once per page unless `again`. */
  sampleBarColor(again = false): void {
    const wc = this.wc
    if (wc.isDestroyed()) return
    const url = wc.getURL()
    if (!again && this.sampledFor === url) return
    this.sampledFor = url
    // A page just put on screen paints a moment later.
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
    }, 200)
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
    // Websites can mark areas as window-drag regions (`-webkit-app-region`, meant for their own
    // desktop apps, e.g. Linear covers its whole page). Electron would apply them to our window,
    // above the overlay, swallowing clicks; browsers ignore them, so cancel them as the user.
    wc.on('dom-ready', () => void wc.insertCSS(IGNORE_APP_REGIONS, { cssOrigin: 'user' }).catch(() => {}))
    wc.on('page-title-updated', (_e, title) => this.host.onTabChanged(this, { title }))
    wc.on('page-favicon-updated', (_e, icons) => {
      const asked = ++this.faviconRequest
      void faviconData(this.session, icons[0]).then((data) => {
        if (asked !== this.faviconRequest || wc.isDestroyed()) return
        // Incognito favicons never fall back to the URL: the sidebar would fetch it through the
        // default, persistent session, outside the incognito one.
        const favicon = data ?? (this.session.isPersistent() && /^https:/i.test(icons[0] ?? '') ? icons[0] : undefined)
        this.favicon = favicon
        this.host.onTabChanged(this, { favicon })
      })
    })
    wc.on('did-start-loading', () => this.host.onTabChanged(this, {}))
    wc.on('did-stop-loading', () => {
      this.host.onTabChanged(this, {})
      // A tab shown in a split has a bar the color of its page: read it again once the page has painted.
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
    // Pages can close themselves (window.close()) — drop them like a closed tab.
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
      const clicked = Date.now() - this.lastClick < 1000
      if (clicked && this.host.interceptLink?.(this, url)) e.preventDefault()
    })
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      if (!WEB_SCHEMES.test(url)) {
        void openExternalLink(wc, url, this.userActivated)
        return { action: 'deny' }
      }
      // A pop-up blocker for floods: without a click or key press just before, one window per half minute.
      if (!this.userActivated) {
        if (Date.now() - this.lastUnrequestedPopup < UNREQUESTED_POPUP_MS) {
          this.host.onPopupBlocked?.(this, url)
          return { action: 'deny' }
        }
        this.lastUnrequestedPopup = Date.now()
      }
      // Real popups (OAuth/SSO windows opened with size features) stay popups so window.opener works.
      if (disposition === 'new-window' && features) {
        return { action: 'allow', overrideBrowserWindowOptions: popupOptions(this.session) }
      }
      // A page Electron creates for window.open keeps the session's UA in navigator.userAgent whatever
      // setUserAgent says, so sites that need another UA (Teams) open with loadURL instead.
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

/** A popup's title is the site it shows, never the page's own title: there's no address bar to check. */
export function popupTitle(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:') return u.host
    if (u.protocol === 'http:') return `Not Secure – ${u.host}`
  } catch {}
  return url.length > 80 ? `${url.slice(0, 80)}…` : url
}

/** Popup windows (sign-in pages): the site in the title, and the same guards as tabs. */
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

/** Larger icons stay URLs: each data: URL is stored with its tab and sent to the UI with every update. */
export const FAVICON_MAX = 16_000
const IMAGE_TYPES: Record<string, string> = { ico: 'image/x-icon', png: 'image/png', svg: 'image/svg+xml', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

/**
 * A page's favicon as a data: URL, fetched with the tab's own session (its cookies, cache and ad
 * blocking; in memory for incognito), so YARC's UI never loads anything from the network itself.
 */
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

/** The most common color in a BGRA bitmap (colors close together count as one), as `rgb(…)`. */
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
