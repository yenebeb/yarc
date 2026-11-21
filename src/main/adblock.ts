// Not enableBlockingInSession(): it registers global IPC handlers per session (a second profile throws).
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { ipcMain, type InsertCSSOptions, type IpcMainInvokeEvent,type OnBeforeRequestListenerDetails, type OnHeadersReceivedListenerDetails, type Session, type WebContents } from 'electron'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { Settings } from '../shared/types'

const PRELOAD = createRequire(__filename).resolve('@ghostery/adblocker-electron-preload')
const FILTERS_MAX_AGE = 24 * 3600_000

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
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (e: IpcMainInvokeEvent, url: string, msg?: unknown) => {
      if (!this.engine || !this.activeFor(e.sender, url)) return
      return this.engine.onInjectCosmeticFilters(inAskingFrame(e) as never, url, msg as never)
    })
    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (e: IpcMainInvokeEvent) =>
      this.engine ? this.engine.onIsMutationObserverEnabled(e) : false
    )
  }

  /** Pages load unfiltered until it's ready. */
  async load(): Promise<void> {
    let cached: Buffer | undefined
    let fresh = false
    try {
      const info = await stat(this.cacheFile)
      cached = await readFile(this.cacheFile)
      fresh = Date.now() - info.mtimeMs < FILTERS_MAX_AGE
    } catch {}
    if (cached && fresh) return this.use(ElectronBlocker.deserialize(new Uint8Array(cached)))
    try {
      const engine = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)
      this.use(engine)
      await mkdir(dirname(this.cacheFile), { recursive: true })
      await writeFile(this.cacheFile, engine.serialize())
    } catch (err) {
      console.warn('[adblock] could not download filter lists', err)
      if (cached) this.use(ElectronBlocker.deserialize(new Uint8Array(cached)))
    }
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
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      if (!this.engine || !this.activeForRequest(details)) return callback({})
      this.engine.onBeforeRequest(details, callback)
    })
    session.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
      if (!this.engine || !this.activeForRequest(details)) return callback({})
      this.engine.onHeadersReceived(details, callback)
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

// Ghostery's webContents.executeJavaScript waits until the page has loaded (a listener per scriptlet), too late for most, and leaves a throwing one unhandled.
function inAskingFrame(e: IpcMainInvokeEvent) {
  return {
    frameId: e.frameId,
    processId: e.processId,
    sender: {
      insertCSS: (css: string, options: InsertCSSOptions) => e.sender.insertCSS(css, options),
      executeJavaScript: (code: string) => e.senderFrame?.executeJavaScript(code).catch(() => {})
    }
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
