// Chrome extensions per profile: chrome.* APIs via electron-chrome-extensions and installs
// straight from the Chrome Web Store via electron-chrome-web-store.
import { session, type BaseWindow, type ContextMenuParams, type MenuItem } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore, updateExtensions } from 'electron-chrome-web-store'
import { join } from 'node:path'
import type { ID } from '../shared/types'
import type { Browser } from './browser'
import type { ProfileRuntime } from './profiles'
import type { LiveTab } from './tab'

export class Extensions {
  private byProfile = new Map<ID, ElectronChromeExtensions>()
  /** Set while YARC tells the library which tab it selected, so the library's echo is ignored. */
  private selecting = false

  constructor(private browser: Browser) {}

  /** The UI session shows extension icons with <browser-action-list>, which needs crx:// there. */
  static prepareUiSession(): void {
    ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
  }

  async setup(rt: ProfileRuntime): Promise<void> {
    const b = this.browser
    const ext = new ElectronChromeExtensions({
      session: rt.session,
      createTab: async (details) => {
        const item = b.newTab(details.url || 'about:blank', { activate: details.active !== false })
        const tab = b.liveFor(item)
        return [tab.wc, b.window.win]
      },
      // Called when an extension selects a tab, and also as an echo of our own selectTab. Acting on
      // the echo recursed until the stack overflowed whenever the library had the tab in a window
      // that has closed, and the tab could no longer be selected.
      selectTab: (wc) => {
        if (this.selecting) return
        const id = b.itemIdFor(wc)
        if (id) b.activate(id)
      },
      removeTab: (wc) => {
        const id = b.itemIdFor(wc)
        if (id) b.close(id)
      },
      createWindow: async (details) => {
        const url = Array.isArray(details.url) ? details.url[0] : details.url
        return b.openLittle(url).win
      },
      removeWindow: (win) => {
        // Also called after a window has already closed.
        if (!win.isDestroyed() && !b.isMainWindow(win)) win.close()
      }
    })
    this.byProfile.set(rt.id, ext)
    // After the library's preload (registered above), so `chrome` already has its APIs to copy.
    const filePath = join(__dirname, '../preload/extension-browser.js')
    rt.session.registerPreloadScript({ id: 'yarc-browser-namespace', type: 'frame', filePath })
    rt.session.registerPreloadScript({ id: 'yarc-browser-namespace-sw', type: 'service-worker', filePath })

    const refresh = () => {
      b.extensionList[rt.id] = rt.session.extensions
        .getAllExtensions()
        .map((e) => ({ id: e.id, name: e.name }))
      b.emitSoon()
    }
    rt.session.extensions.on('extension-loaded', refresh)
    rt.session.extensions.on('extension-unloaded', refresh)
    try {
      await installChromeWebStore({
        session: rt.session,
        extensionsPath: join(b.profiles.dir(rt.id), 'Extensions'),
        // The library's own updater only tracks one session; we update each profile ourselves.
        autoUpdate: false
      })
    } catch (err) {
      console.error('[extensions] web store setup failed', err)
    }
    refresh()
    const update = () => updateExtensions(rt.session).catch((err: unknown) => console.warn('[extensions] update failed', err))
    setTimeout(update, 60_000)
    setInterval(update, 5 * 3600_000)
  }

  addTab(tab: LiveTab, win: BaseWindow): void {
    this.byProfile.get(tab.profileId)?.addTab(tab.wc, win)
  }

  selectTab(tab: LiveTab): void {
    const ext = this.byProfile.get(tab.profileId)
    if (!ext) return
    this.selecting = true
    try {
      ext.selectTab(tab.wc)
    } finally {
      this.selecting = false
    }
  }

  /**
   * Tells the library a tab now lives in another window (a Little Window page moved into the main
   * window), so extensions see the right window. Call it before YARC knows the tab as an item:
   * the library's removeTab callback closes the item.
   */
  moveTab(tab: LiveTab, win: BaseWindow): void {
    const ext = this.byProfile.get(tab.profileId)
    if (!ext) return
    ext.removeTab(tab.wc)
    ext.addTab(tab.wc, win)
  }

  contextMenuItems(tab: LiveTab, params: ContextMenuParams): MenuItem[] {
    return this.byProfile.get(tab.profileId)?.getContextMenuItems(tab.wc, params) ?? []
  }
}
