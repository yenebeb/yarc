// Not enableBlockingInSession(): it registers global IPC handlers per session (a second profile throws).
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { ipcMain, utilityProcess, type HeadersReceivedResponse, type InsertCSSOptions, type IpcMainEvent, type IpcMainInvokeEvent, type OnBeforeRequestListenerDetails, type OnHeadersReceivedListenerDetails, type Session, type WebContents } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Settings } from '../shared/types'
import { hostOf } from '../shared/url'
import { netRulesFor } from './declarative-net-request'

const PRELOAD = createRequire(__filename).resolve('@ghostery/adblocker-electron-preload')
const SCRIPTLETS_PRELOAD = join(__dirname, '../preload/adblock-scriptlets.js')
const FILTERS_MAX_AGE = 24 * 3600_000
const FILTERS_CHECK_INTERVAL = 3600_000

export class AdBlock {
  private engine: ElectronBlocker | undefined
  private sessions = new WeakSet<Session>()
  private blocked = new Map<number, number>()
  private pendingReloads = new Map<WebContents, NodeJS.Timeout>()
  enabled = true
  allowlist = new Set<string>()

  constructor(
    private cacheFile: string,
    private onChange: () => void
  ) {
    ipcMain.on('yarc:adblock-scriptlets', (e: IpcMainEvent, url: string) => {
      e.returnValue = this.engine && this.activeFor(e.sender, url) ? firstInjection(this.engine, e, url) : []
    })
    // Without `msg` it's the page's first injection, which adblock-scriptlets already did synchronously.
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (e: IpcMainInvokeEvent, url: string, msg?: unknown) => {
      if (msg === undefined || !this.engine || !this.activeFor(e.sender, url)) return
      return this.engine.onInjectCosmeticFilters(e as never, url, msg as never)
    })
    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (e: IpcMainInvokeEvent) =>
      this.engine ? this.engine.onIsMutationObserverEnabled(e) : false
    )
  }

  /** Pages load unfiltered until it's ready. Checked hourly: YouTube's fixes go stale within days in an app left open. */
  async load(): Promise<void> {
    const age = await stat(this.cacheFile).then((info) => Date.now() - info.mtimeMs, () => Infinity)
    const built = age >= FILTERS_MAX_AGE && (await buildEngine(this.cacheFile))
    if (age >= FILTERS_MAX_AGE && !built) console.warn('[adblock] could not download filter lists')
    if (built || !this.engine) {
      const cached = await readFile(this.cacheFile).catch(() => undefined)
      if (cached) this.use(ElectronBlocker.deserialize(new Uint8Array(cached)))
    }
    setTimeout(() => void this.load(), FILTERS_CHECK_INTERVAL).unref()
  }

  private use(engine: ElectronBlocker): void {
    this.engine = engine
    // Redirects swap an ad script for a harmless stub; they count as blocked too.
    const count = (request: { tabId?: number | string }) => {
      const id = request.tabId
      if (typeof id !== 'number') return
      this.blocked.set(id, (this.blocked.get(id) ?? 0) + 1)
      this.onChange()
    }
    engine.on('request-blocked', count)
    engine.on('request-redirected', count)
  }

  attach(session: Session): void {
    if (this.sessions.has(session)) return
    this.sessions.add(session)
    session.registerPreloadScript({ type: 'frame', filePath: PRELOAD })
    session.registerPreloadScript({ type: 'frame', filePath: SCRIPTLETS_PRELOAD })
    // Electron keeps one listener per event: extensions' declarativeNetRequest rules go through this one too.
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const byExtension = netRulesFor(session)?.beforeRequest(details)
      if (byExtension) return callback(byExtension)
      if (!this.engine || !this.activeForRequest(details)) return callback({})
      this.engine.onBeforeRequest(details, callback)
    })
    session.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
      const rules = netRulesFor(session)
      const done = rules ? (response: HeadersReceivedResponse) => callback(rules.headersReceived(details, response)) : callback
      if (!this.engine || !this.activeForRequest(details)) return done({})
      this.engine.onHeadersReceived(details, done)
    })
  }

  count(wc: WebContents): number {
    return this.blocked.get(wc.id) ?? 0
  }

  resetCount(wc: WebContents): void {
    if (this.blocked.delete(wc.id)) this.onChange()
  }

  sync(settings: Pick<Settings, 'adblock' | 'adblockAllowlist'>): void {
    this.enabled = settings.adblock
    this.allowlist = new Set(settings.adblockAllowlist)
  }

  /** Undefined for a page without a host. */
  toggleSite(settings: Pick<Settings, 'adblock' | 'adblockAllowlist'>, page: WebContents): { allowed: boolean; host: string } | undefined {
    const host = hostOf(page.getURL())
    if (!host) return undefined
    const list = settings.adblockAllowlist
    const allowed = !list.includes(host)
    settings.adblockAllowlist = allowed ? [...list, host] : list.filter((h) => h !== host)
    this.sync(settings)
    this.reloadSoon(page)
    return { allowed, host }
  }

  /** Overlapping reloads (double-clicking the shield) while requests are rewritten can crash Electron. */
  private reloadSoon(page: WebContents): void {
    clearTimeout(this.pendingReloads.get(page))
    this.pendingReloads.set(
      page,
      setTimeout(() => {
        this.pendingReloads.delete(page)
        if (page.isDestroyed()) return
        if (page.isLoading()) page.stop()
        page.reload()
      }, 250)
    )
  }

  isAllowed(url: string): boolean {
    const host = hostOf(url)
    return !!host && this.allowlist.has(host)
  }

  private activeFor(wc: WebContents | null | undefined, fallbackUrl?: string): boolean {
    if (!this.enabled) return false
    const page = wc && !wc.isDestroyed() ? wc.getURL() : ''
    return !this.isAllowed(page || fallbackUrl || '')
  }

  private activeForRequest(details: OnBeforeRequestListenerDetails | OnHeadersReceivedListenerDetails): boolean {
    if (!this.enabled) return false
    if (details.resourceType === 'mainFrame') return !this.isAllowed(details.url)
    return this.activeFor(details.webContents, details.referrer)
  }
}

/** Ghostery's first injection: styles go to the page, scriptlets come back for the preload to run before the page's own scripts. */
function firstInjection(engine: ElectronBlocker, e: IpcMainEvent, url: string): string[] {
  const scriptlets: string[] = []
  const sender = { insertCSS: (css: string, options: InsertCSSOptions) => e.sender.insertCSS(css, options), executeJavaScript: (code: string) => scriptlets.push(inOwnBlock(code)) }
  // Async only in name: it calls the sender before returning (it never awaits).
  void engine.onInjectCosmeticFilters({ frameId: e.frameId, processId: e.processId, sender } as never, url)
  return scriptlets
}

// As Ghostery's content script does: at top level each scriptlet's helpers (proxyApplyFn, JSONPath) would overwrite the previous one's, and two Function.prototype.toString proxies then call each other forever.
export function inOwnBlock(scriptlet: string): string {
  return `{\n${scriptlet}\n}`
}

function buildEngine(file: string): Promise<boolean> {
  const child = utilityProcess.fork(join(__dirname, 'adblock-build.js'), [file], { serviceName: 'YARC ad block lists' })
  return new Promise((resolve) => child.once('exit', (code) => resolve(code === 0)))
}
