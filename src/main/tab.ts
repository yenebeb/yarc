// A live web page attached to a sidebar item (favorite, pinned or Today tab).
import {
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

export type OpenDisposition = 'foreground-tab' | 'background-tab' | 'new-window' | 'other'

export interface TabHost {
  onTabChanged(tab: LiveTab, change: { url?: string; title?: string; favicon?: string; navigated?: boolean }): void
  onTabInput(tab: LiveTab, event: Event, input: Input): void
  onTabDestroyed(tab: LiveTab): void
  onTabFocus(tab: LiveTab): void
  onTabFullscreen(tab: LiveTab, on: boolean): void
  onFoundInPage(tab: LiveTab, result: Result): void
  adoptOpenedPage(opener: LiveTab, options: BrowserWindowConstructorOptions, disposition: OpenDisposition, url: string): WebContents
  showContextMenu(tab: LiveTab, params: ContextMenuParams): void
  /** A link the user clicked is about to replace the page; return true to open it elsewhere instead. */
  interceptLink?(tab: LiveTab, url: string): boolean
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
  /** When the user last clicked in the page; navigations right after it are link clicks, not redirects. */
  private lastClick = 0

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
      if (code !== -3) console.warn('[tab] load failed', url, (err as Error).message)
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
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      zoom: wc.getZoomLevel(),
      blocked: 0,
      shielded: false,
      barColor: this.barColor
    }
  }

  favicon?: string
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
      this.favicon = icons[0]
      this.host.onTabChanged(this, { favicon: icons[0] })
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
    })
    wc.on('will-navigate', (e, url) => {
      if (!WEB_SCHEMES.test(url)) {
        e.preventDefault()
        void openExternalLink(wc, url)
        return
      }
      const clicked = Date.now() - this.lastClick < 1000
      if (clicked && this.host.interceptLink?.(this, url)) e.preventDefault()
    })
    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      if (!WEB_SCHEMES.test(url)) {
        void openExternalLink(wc, url)
        return { action: 'deny' }
      }
      // Real popups (OAuth/SSO windows opened with size features) stay popups so window.opener works.
      if (disposition === 'new-window' && features) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            width: 520,
            height: 680,
            webPreferences: { session: this.session, sandbox: true, contextIsolation: true }
          }
        }
      }
      return {
        action: 'allow',
        createWindow: (options) => this.host.adoptOpenedPage(this, options, disposition as OpenDisposition, url)
      }
    })
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
