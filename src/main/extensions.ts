import { session, type BaseWindow, type ContextMenuParams, type MenuItem } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore, updateExtensions } from 'electron-chrome-web-store'
import { join } from 'node:path'
import type { ID } from '../shared/types'
import type { Browser } from './browser'
import { NetRules } from './declarative-net-request'
import { ExtensionGrants, type Grant } from './extension-grants'
import { listenBeforeSendHeaders, type ProfileRuntime } from './profiles'
import type { LiveTab } from './tab'

const UPDATE_EVERY = 5 * 3600_000

/** electron-chrome-extensions 4.10 keeps runtime grants in a private map; reaching it is the only way to restore them. */
type LibraryInternals = { api?: { permissions?: { permissionMap?: Map<string, Grant> } } }

export class Extensions {
  private byProfile = new Map<ID, ElectronChromeExtensions>()
  private selecting = false

  constructor(private browser: Browser) {}

  /** <browser-action-list> in the UI needs crx:// there. */
  static prepareUiSession(): void {
    ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
  }

  async setup(rt: ProfileRuntime): Promise<void> {
    const b = this.browser
    const grants = new ExtensionGrants(join(b.profiles.dir(rt.id), 'extension-permissions.json'))
    const rules = new NetRules(
      rt.session,
      join(b.profiles.dir(rt.id), 'Extension Rules'),
      (wanted) => listenBeforeSendHeaders(rt.session, wanted ? (details, headers) => rules.requestHeaders(details, headers) : undefined),
      (id) => grants.get(id)?.origins ?? []
    )
    // Before the library's preload, which freezes `chrome`.
    const dnrPreload = join(__dirname, '../preload/extension-dnr.js')
    rt.session.registerPreloadScript({ id: 'yarc-dnr', type: 'frame', filePath: dnrPreload })
    rt.session.registerPreloadScript({ id: 'yarc-dnr-sw', type: 'service-worker', filePath: dnrPreload })
    const ext = new ElectronChromeExtensions({
      session: rt.session,
      createTab: async (details) => {
        const item = b.newTab(details.url || 'about:blank', { activate: details.active !== false })
        const tab = b.liveFor(item)
        return [tab.wc, b.window.win]
      },
      // Also an echo of our own selectTab: acting on it recursed until the stack overflowed when the tab's window had closed.
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
        if (!win.isDestroyed() && !b.isMainWindow(win)) win.close()
      },
      // As the library does without this hook, every request is granted; here it's also remembered.
      requestPermissions: async (extension, request) => {
        grants.add(extension, request)
        return true
      }
    })
    // After the library's own listener, which resets an extension's grants to its manifest.
    const granted = (ext as unknown as LibraryInternals).api?.permissions?.permissionMap
    rt.session.extensions.on('extension-loaded', (_e, extension) => grants.restore(granted?.get(extension.id), extension.id))
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
    setInterval(update, UPDATE_EVERY)
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

  /** Call it before YARC knows the tab as an item: the library's removeTab callback closes the item. */
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
