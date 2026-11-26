import { MenuItem, session, type BaseWindow, type ContextMenuParams, type Menu, type Point, type Rectangle, type Session, type WebContents } from 'electron'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore, uninstallExtension, updateExtensions } from 'electron-chrome-web-store'
import { join } from 'node:path'
import { everyInstalledPinned } from '../shared/extension-pins'
import type { ID } from '../shared/types'
import type { Browser } from './browser'
import { NetRules } from './declarative-net-request'
import { ExtensionGrants, type Grant } from './extension-grants'
import { listenBeforeSendHeaders, type ProfileRuntime } from './profiles'
import type { LiveTab } from './tab'

const UPDATE_EVERY = 5 * 3600_000

/** electron-chrome-extensions 4.10 keeps runtime grants in a private map; reaching it is the only way to restore them. */
type LibraryInternals = { api?: { permissions?: { permissionMap?: Map<string, Grant> } } }
/** The library's PopupView, which it doesn't export. */
type Popup = { parent?: BaseWindow; on(event: 'will-move', listener: (position: Point) => void): void }
type ActionMenu = { menu: Menu; extensionId: string; anchorRect: Rectangle; sender?: WebContents }

interface ProfileExtensions {
  library: ElectronChromeExtensions
  session: Session
  folder: string
  grants: ExtensionGrants
  rules: NetRules
}

export class Extensions {
  private byProfile = new Map<ID, ProfileExtensions>()
  private selecting = false

  constructor(private browser: Browser) {}

  /** <browser-action-list> in the UI needs crx:// there. */
  static prepareUiSession(): void {
    ElectronChromeExtensions.handleCRXProtocol(session.defaultSession)
  }

  async setup(rt: ProfileRuntime): Promise<void> {
    const b = this.browser
    const firstStartWithPins = !b.store.profile(rt.id)?.pinnedExtensions
    const folder = join(b.profiles.dir(rt.id), 'Extensions')
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
    ext.on('browser-action-popup-created', (popup: Popup) => {
      const origin = popup.parent && b.sidebarOrigin(popup.parent)
      // The library places the popup from the anchor plus the window's origin; the position it emits is the one it then applies.
      if (origin) popup.on('will-move', (position: Point) => Object.assign(position, { x: position.x + origin.x, y: position.y + origin.y }))
    })
    ext.on('browser-action-context-menu', ({ menu, extensionId, anchorRect, sender }: ActionMenu) => {
      const clickedWindow = (sender && b.windowOf(sender)) ?? b.window
      const pinned = b.store.profile(rt.id)?.pinnedExtensions?.includes(extensionId) ?? false
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({ label: pinned ? 'Unpin' : 'Pin', click: () => b.setExtensionPin(rt.id, extensionId, !pinned) }))
      const origin = b.sidebarOrigin(clickedWindow.win) ?? { x: 0, y: 0 }
      menu.popup({ window: clickedWindow.win, x: Math.floor(anchorRect.x + origin.x), y: Math.floor(anchorRect.y + anchorRect.height + origin.y) })
    })
    this.byProfile.set(rt.id, { library: ext, session: rt.session, folder, grants, rules })
    // After the library's preload (registered above), so `chrome` already has its APIs to copy.
    const filePath = join(__dirname, '../preload/extension-browser.js')
    rt.session.registerPreloadScript({ id: 'yarc-browser-namespace', type: 'frame', filePath })
    rt.session.registerPreloadScript({ id: 'yarc-browser-namespace-sw', type: 'service-worker', filePath })

    const refresh = (unloadedId?: string) => {
      b.extensionList[rt.id] = rt.session.extensions
        .getAllExtensions()
        .filter((extension) => extension.id !== unloadedId)
        .map((extension) => ({ id: extension.id, name: extension.name }))
      b.emitSoon()
    }
    rt.session.extensions.on('extension-loaded', () => refresh())
    // Electron still lists an extension while it emits extension-unloaded for it.
    rt.session.extensions.on('extension-unloaded', (_event, unloaded) => refresh(unloaded.id))
    try {
      await installChromeWebStore({
        session: rt.session,
        extensionsPath: folder,
        // The library's own updater only tracks one session; we update each profile ourselves.
        autoUpdate: false
      })
    } catch (err) {
      console.error('[extensions] web store setup failed', err)
    }
    refresh()
    const profile = b.store.profile(rt.id)
    if (profile && firstStartWithPins) {
      profile.pinnedExtensions = everyInstalledPinned(profile.pinnedExtensions, b.extensionList[rt.id])
      b.changed()
    }
    const update = () => updateExtensions(rt.session).catch((err: unknown) => console.warn('[extensions] update failed', err))
    setTimeout(update, 60_000)
    setInterval(update, UPDATE_EVERY)
  }

  async remove(profileId: ID, extensionId: string): Promise<void> {
    const profile = this.byProfile.get(profileId)
    if (!profile) return
    await uninstallExtension(extensionId, { session: profile.session, extensionsPath: profile.folder })
    this.browser.setExtensionPin(profileId, extensionId, false)
    profile.grants.forget(extensionId)
    await profile.rules.forget(extensionId)
    await profile.session.clearStorageData({ origin: `chrome-extension://${extensionId}` })
  }

  addTab(tab: LiveTab, win: BaseWindow): void {
    this.byProfile.get(tab.profileId)?.library.addTab(tab.wc, win)
  }

  selectTab(tab: LiveTab): void {
    const ext = this.byProfile.get(tab.profileId)?.library
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
    const ext = this.byProfile.get(tab.profileId)?.library
    if (!ext) return
    ext.removeTab(tab.wc)
    ext.addTab(tab.wc, win)
  }

  contextMenuItems(tab: LiveTab, params: ContextMenuParams): MenuItem[] {
    return this.byProfile.get(tab.profileId)?.library.getContextMenuItems(tab.wc, params) ?? []
  }
}
