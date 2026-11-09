// The browser controller: owns state, live tabs, spaces and the main window.
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  nativeTheme,
  screen,
  shell,
  WebContentsView,
  type BrowserWindowConstructorOptions,
  type ContextMenuParams,
  type Event,
  type Input,
  type IpcMainInvokeEvent,
  type Rectangle,
  type Result,
  type WebContents
} from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Action, DropTarget } from '../shared/actions'
import { IPC, type LittleAnchor, type LittleOp } from '../shared/ipc'
import { commandForInput, type CommandId } from '../shared/keymap'
import { containsNode, findFolder, findInPinned, findItem, profileOfItem, spaceItems } from '../shared/tree'
import type {
  AppState,
  DownloadItemInfo,
  ExtensionInfo,
  ID,
  OverlayMode,
  PinnedNode,
  PinnedTab,
  Rect,
  Space,
  TabItem
} from '../shared/types'
import { resolveInput } from '../shared/url'
import { AdBlock, hostOf } from './adblock'
import { openInChrome } from './chrome'
import { Extensions } from './extensions'
import { runImport } from './importers'
import { LittleWindow } from './little'
import { Peek, sameSite } from './peek'
import { buildContextMenu, buildFolderMenu, buildItemMenu, buildSpaceMenu } from './menus'
import { Profiles, type ProfileRuntime } from './profiles'
import { search, suggest } from './search'
import { HistorySync } from './sync'
import { incognitoState, newId, SPACE_COLORS, Store } from './store'
import { LiveTab, type OpenDisposition, type TabHost } from './tab'
import { Updater } from './updater'
import { MainWindow, PAD } from './window'

const isMac = process.platform === 'darwin'
const MAX_ARCHIVE = 1000
/**
 * The hidden sidebar stays out while the cursor is within this many pixels past its edge, and
 * goes away once the cursor has been further for PEEK_HIDE_DELAY ms, like Arc. Room to grab the
 * edge and resize, and no flicker from mouse enter/leave events at the screen's edge.
 */
const PEEK_GRACE = 32
const PEEK_HIDE_DELAY = 300

interface ClosedTab {
  url: string
  title: string
  spaceId: ID
}

export class Browser implements TabHost {
  readonly store: Store
  readonly profiles: Profiles
  readonly extensions: Extensions
  readonly adblock: AdBlock
  readonly updater: Updater
  /** History sync; only the main controller has it, so incognito windows never sync. */
  readonly historySync: HistorySync | undefined
  /** Set on an incognito window's controller: the main one, whose ad blocker and updater it shares. */
  readonly main: Browser | undefined
  window!: MainWindow
  readonly live = new Map<ID, LiveTab>()
  private mru: ID[] = []
  private closed: ClosedTab[] = []
  downloads: DownloadItemInfo[] = []
  extensionList: Record<ID, ExtensionInfo[]> = {}
  private sidebarPeek = false
  private peekWatch: ReturnType<typeof setInterval> | undefined
  private fullscreenTab: LiveTab | undefined
  private switcher: { order: ID[]; index: number } | undefined
  private emitTimer: NodeJS.Timeout | undefined
  readonly littles = new Set<LittleWindow>()
  private peek: Peek | undefined
  private windowFile: string | undefined
  /** Every controller with a window: the main one, plus one per incognito window. IPC goes to the sender's. */
  private static readonly all = new Set<Browser>()

  /**
   * Pass `main` for an incognito window: a temporary profile, state and history in memory, no
   * extensions, all thrown away when its window closes, like Arc's incognito windows.
   */
  constructor(main?: Browser) {
    this.main = main
    this.extensions = new Extensions(this)
    this.profiles = new Profiles((rt) => this.onProfileCreated(rt), !!main)
    if (main) {
      this.store = new Store(undefined, incognitoState(main.state.settings))
      this.adblock = main.adblock
      this.updater = main.updater
      this.historySync = undefined
      return
    }
    const userData = app.getPath('userData')
    const store = new Store(join(userData, 'state.json'))
    this.store = store
    this.windowFile = join(userData, 'window.json')
    this.adblock = new AdBlock(join(userData, 'adblock', 'engine.bin'), () => this.emitSoon())
    this.updater = new Updater(this)
    this.historySync = new HistorySync({
      get profileList() {
        return store.state.profiles
      },
      history: (id) => this.profiles.history(id),
      settings: this.store.state.settings,
      saveState: () => this.store.save(),
      emitSoon: () => this.emitSoon(),
      window: () => (this.window?.win.isDestroyed() === false ? this.window.win : undefined)
    })
    this.syncAdblock()
    void this.adblock.load()
    nativeTheme.themeSource = this.store.state.settings.theme
  }

  get incognito(): boolean {
    return !!this.main
  }

  /** Opens an incognito window, with `url` or with the command bar. */
  openIncognito(url?: string): Browser {
    const b = new Browser(this.main ?? this)
    b.start()
    if (url) b.newTab(url)
    else b.window.win.once('show', () => b.runCommand('newTab'))
    return b
  }

  get state() {
    return this.store.state
  }

  get space(): Space {
    return this.store.activeSpace
  }

  // ---------------------------------------------------------------- startup

  start(): void {
    Browser.all.add(this)
    if (Browser.all.size === 1) this.registerIpc()
    this.openWindow()
    if (this.incognito) return
    setInterval(() => this.autoArchive(), 5 * 60_000)
    this.autoArchive()
    this.updater.sync()
    this.historySync?.start()
  }

  openWindow(): void {
    let saved: (Partial<Rectangle> & { maximized?: boolean }) | undefined
    try {
      if (this.windowFile && existsSync(this.windowFile)) saved = JSON.parse(readFileSync(this.windowFile, 'utf8'))
    } catch {}
    this.window = new MainWindow(saved)
    const win = this.window.win
    if (saved?.maximized) win.maximize()
    if (isMac) win.setWindowButtonVisibility(this.state.settings.sidebarVisible)
    for (const wc of [win.webContents, this.window.overlay.webContents]) {
      wc.on('before-input-event', (e, input) => this.handleInput(e, input))
    }
    const relayout = () => {
      this.layout()
      this.saveWindowBounds()
    }
    win.on('resize', relayout)
    win.on('move', () => this.saveWindowBounds())
    for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
      win.on(ev as 'maximize', () => {
        this.layout()
        this.emit()
        this.saveWindowBounds()
      })
    }
    win.on('closed', () => {
      for (const t of this.live.values()) t.destroy()
      this.live.clear()
      this.peek?.destroy()
      this.peek = undefined
      if (this.incognito) this.dispose()
    })
    win.webContents.once('did-finish-load', () => this.emit())
    this.window.overlay.webContents.on('blur', () => {
      // Closing the window blurs the overlay too, after the window is gone.
      if (win.isDestroyed()) return
      // Clicking back into the page closes transient panels, like Arc.
      const k = this.window.overlayMode.kind
      if (k === 'command' || k === 'switcher') this.setOverlay({ kind: 'none' }, false)
    })
    const active = this.space.activeItemId
    if (active && findItem(this.state, active)) this.activate(active)
    else this.layout()
  }

  /** An incognito window closed: forget its pages, cookies, storage and history. */
  private dispose(): void {
    Browser.all.delete(this)
    this.watchPeek(false)
    for (const l of this.littles) l.win.close()
    for (const rt of this.profiles.all()) void rt.session.clearData()
    this.profiles.closeAll()
  }

  private saveWindowBounds(): void {
    const win = this.window?.win
    if (!this.windowFile || !win || win.isDestroyed() || win.isFullScreen()) return
    try {
      // Normal bounds, so un-maximizing after a restart returns to the old size.
      writeFileSync(this.windowFile, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }))
    } catch {}
  }

  private onProfileCreated(rt: ProfileRuntime): void {
    rt.session.on('will-download', (_e, item) => {
      const info: DownloadItemInfo = {
        id: newId(),
        filename: item.getFilename(),
        path: '',
        url: item.getURL(),
        state: 'progressing',
        received: 0,
        total: item.getTotalBytes(),
        startedAt: Date.now()
      }
      item.setSavePath(uniquePath(app.getPath('downloads'), item.getFilename()))
      info.path = item.getSavePath()
      this.downloads.unshift(info)
      this.toast(`Downloading ${info.filename}`)
      item.on('updated', (_ev, state) => {
        info.received = item.getReceivedBytes()
        info.total = item.getTotalBytes()
        info.state = state === 'interrupted' ? 'interrupted' : 'progressing'
        this.emitSoon()
      })
      item.once('done', (_ev, state) => {
        info.state = state
        info.received = item.getReceivedBytes()
        if (state === 'completed') this.toast(`Downloaded ${info.filename}`)
        this.emitSoon()
      })
      this.emitSoon()
    })
    this.adblock.attach(rt.session)
    // Like Chrome, extensions stay out of incognito.
    if (!this.incognito) void this.extensions.setup(rt)
  }

  // ---------------------------------------------------------------- state out

  snapshot(): AppState {
    const live: AppState['live'] = {}
    for (const [id, t] of this.live) {
      if (t.destroyed) continue
      const info = t.info()
      info.blocked = this.adblock.count(t.wc)
      info.shielded = this.adblock.enabled && !this.adblock.isAllowed(info.url)
      live[id] = info
    }
    const win = this.window?.win
    return {
      ...this.state,
      live,
      downloads: this.downloads,
      extensions: this.extensionList,
      platform: process.platform,
      maximized: !!win && !win.isDestroyed() && win.isMaximized(),
      fullscreen: !!win && !win.isDestroyed() && win.isFullScreen(),
      sidebarPeek: this.sidebarPeek,
      newTabOpen: this.newTabOpen(),
      peek: this.peek && !this.peek.tab.destroyed ? this.peek.tab.info() : undefined,
      layout: this.currentLayout,
      update: this.updater.status,
      historySync: (this.main ?? this).historySync?.status ?? { state: 'off' }
    }
  }

  private currentLayout: AppState['layout'] = { content: { x: 0, y: 0, width: 0, height: 0 }, views: [] }

  emit(): void {
    clearTimeout(this.emitTimer)
    this.emitTimer = undefined
    const win = this.window?.win
    if (!win || win.isDestroyed()) return
    const snap = this.snapshot()
    win.webContents.send(IPC.state, snap)
    this.window.overlay.webContents.send(IPC.state, snap)
  }

  private newTabOpen(): boolean {
    const mode = this.window?.overlayMode
    return mode?.kind === 'command' && (mode.target ?? 'tab') === 'tab'
  }

  emitSoon(): void {
    if (!this.emitTimer) this.emitTimer = setTimeout(() => this.emit(), 30)
  }

  toast(text: string): void {
    const win = this.window?.win
    if (win && !win.isDestroyed()) win.webContents.send(IPC.toast, text)
  }

  private changed(): void {
    this.store.save()
    this.emitSoon()
  }

  // ---------------------------------------------------------------- tabs

  /** The page that commands (reload, back, find, zoom…) act on: the Peek page while one is open. */
  activeTab(): LiveTab | undefined {
    if (this.peek && !this.peek.tab.destroyed) return this.peek.tab
    const id = this.space.activeItemId
    const t = id ? this.live.get(id) : undefined
    return t && !t.destroyed ? t : undefined
  }

  liveFor(item: TabItem): LiveTab {
    const existing = this.live.get(item.id)
    if (existing && !existing.destroyed && !existing.crashed) return existing
    existing?.destroy()
    const profileId = profileOfItem(this.state, item.id) ?? this.space.profileId
    const rt = this.profiles.get(profileId)
    const tab = new LiveTab(this, item.id, profileId, rt.session, item.url)
    tab.favicon = item.favicon
    this.live.set(item.id, tab)
    this.extensions.addTab(tab, this.window.win)
    return tab
  }

  itemIdFor(wc: WebContents): ID | undefined {
    for (const [id, t] of this.live) if (t.wc === wc) return id
    return undefined
  }

  private dropLive(id: ID): void {
    const t = this.live.get(id)
    if (!t) return
    this.live.delete(id)
    if (this.window && !this.window.win.isDestroyed()) this.window.detach(t.view)
    if (this.fullscreenTab === t) this.fullscreenTab = undefined
    t.destroy()
  }

  activate(id: ID, focus = true): void {
    const found = findItem(this.state, id)
    if (!found) return
    this.closePeek()
    let space = this.space
    if (found.loc.kind === 'favorite') {
      const profileId = found.loc.profileId
      if (space.profileId !== profileId) space = this.state.spaces.find((s) => s.profileId === profileId) ?? space
    } else {
      space = this.store.space(found.loc.spaceId) ?? space
    }
    this.state.activeSpaceId = space.id
    space.activeItemId = id
    found.item.lastActive = Date.now()
    this.mru = [id, ...this.mru.filter((m) => m !== id)].slice(0, 200)
    const tab = this.liveFor(found.item)
    this.extensions.selectTab(tab)
    this.layout()
    if (focus && this.window.overlayMode.kind === 'none') tab.wc.focus()
    this.changed()
  }

  /** Puts the active item (and its split partners) in the content area. */
  layout(): void {
    const w = this.window
    if (!w || w.win.isDestroyed()) return
    const s = this.state.settings
    const fs = this.fullscreenTab
    const content = w.contentRect(s.sidebarVisible, s.sidebarWidth, s.sidebarRight, !!fs)
    const views: AppState['layout']['views'] = []
    let splitId: ID | undefined
    if (fs && !fs.destroyed) {
      fs.view.setBorderRadius(0)
      w.show([{ view: fs.view, rect: content }])
      views.push({ id: fs.itemId, rect: content })
    } else {
      const space = this.space
      const active = space.activeItemId && findItem(this.state, space.activeItemId) ? space.activeItemId : undefined
      if (!active) {
        w.show([])
      } else {
        const split = space.splits.find((sp) => sp.itemIds.includes(active))
        splitId = split?.id
        const ids = split ? split.itemIds : [active]
        const rects = split ? MainWindow.splitRect(content, split.sizes) : [content]
        const slots = []
        for (let i = 0; i < ids.length; i++) {
          const item = findItem(this.state, ids[i])?.item
          if (!item) continue
          const tab = this.liveFor(item)
          tab.view.setBorderRadius(8)
          slots.push({ view: tab.view, rect: rects[i] })
          views.push({ id: ids[i], rect: rects[i] })
        }
        w.show(slots)
      }
    }
    this.currentLayout = { content, views, splitId }
    if (this.peek) w.setTop(this.peek.tab.view, this.peekRects().card)
    const mode = w.overlayMode.kind === 'peek' ? this.peekMode() : w.overlayMode
    if (mode.kind !== 'none') w.setOverlay(mode, this.overlayRect(mode))
    this.emitSoon()
  }

  private overlayRect(mode: OverlayMode): Rectangle | undefined {
    const { width, height } = this.window.size()
    const s = this.state.settings
    switch (mode.kind) {
      case 'none':
        return undefined
      case 'sidebar': {
        const w = s.sidebarWidth + PAD
        return { x: s.sidebarRight ? width - w : 0, y: 0, width: w, height }
      }
      case 'find': {
        const c = this.currentLayout.content
        const w = Math.min(380, c.width - 16)
        return { x: c.x + c.width - w - 12, y: c.y + 12, width: w, height: 60 }
      }
      case 'peek':
        return this.currentLayout.content
      default:
        return { x: 0, y: 0, width, height }
    }
  }

  setOverlay(mode: OverlayMode, refocus = true): void {
    if (mode.kind !== 'peek') this.dropPeek()
    if (this.window.overlayMode.kind === 'find' && mode.kind !== 'find') this.activeTab()?.wc.stopFindInPage('keepSelection')
    if (mode.kind !== 'sidebar') this.sidebarPeek = false
    this.watchPeek(mode.kind === 'sidebar')
    if (mode.kind !== 'switcher') this.switcher = undefined
    this.window.setOverlay(mode, this.overlayRect(mode))
    if (isMac && !this.state.settings.sidebarVisible) this.window.win.setWindowButtonVisibility(mode.kind === 'sidebar')
    if (mode.kind === 'none' && refocus) this.activeTab()?.wc.focus()
    this.emitSoon()
  }

  /** While the hidden sidebar is out, hides it once the cursor has stayed away from it (PEEK_GRACE). */
  private watchPeek(on: boolean): void {
    clearInterval(this.peekWatch)
    this.peekWatch = undefined
    if (!on) return
    let awaySince = 0
    this.peekWatch = setInterval(() => {
      const win = this.window.win
      if (win.isDestroyed()) return this.watchPeek(false)
      const b = win.getContentBounds()
      const s = this.state.settings
      const p = screen.getCursorScreenPoint()
      const reach = s.sidebarWidth + PAD + PEEK_GRACE
      const near = s.sidebarRight ? p.x >= b.x + b.width - reach : p.x <= b.x + reach
      if (near && p.y >= b.y - PEEK_GRACE && p.y <= b.y + b.height + PEEK_GRACE) awaySince = 0
      else if (!awaySince) awaySince = Date.now()
      else if (Date.now() - awaySince >= PEEK_HIDE_DELAY) this.setOverlay({ kind: 'none' }, false)
    }, 50)
  }

  // ---------------------------------------------------------------- Peek

  /** Opens a page in Peek, over the current tab, with the opener's profile. */
  openPeek(opener: LiveTab, url: string): void {
    this.dropPeek()
    this.peek = new Peek(this, this.profiles.get(opener.profileId), url)
    this.window.setTop(this.peek.tab.view, this.peekRects().card)
    this.setOverlay(this.peekMode())
    this.peek.tab.wc.focus()
  }

  closePeek(): void {
    if (this.window.overlayMode.kind === 'peek') this.setOverlay({ kind: 'none' })
    else this.dropPeek()
  }

  /** Moves the Peek page into a Today tab, keeping its state (or into a split with the current tab). */
  expandPeek(split = false): void {
    const peek = this.peek
    if (!peek || peek.tab.destroyed) return
    this.peek = undefined
    this.window.setTop(undefined)
    this.setOverlay({ kind: 'none' }, false)
    const tab = peek.release()
    const item: TabItem = { id: newId(), url: tab.wc.getURL(), title: tab.wc.getTitle(), favicon: tab.favicon, lastActive: Date.now() }
    this.space.today.unshift(item)
    tab.itemId = item.id
    this.live.set(item.id, tab)
    if (split) this.splitWith(item.id)
    else this.activate(item.id)
  }

  private dropPeek(): void {
    const peek = this.peek
    if (!peek) return
    this.peek = undefined
    if (!this.window.win.isDestroyed()) this.window.setTop(undefined)
    peek.destroy()
    this.emitSoon()
  }

  /** Arc's Peek card: nearly the content's height, with room beside it for the buttons. */
  private peekRects(): { card: Rectangle; local: Rect } {
    const c = this.currentLayout.content
    const margin = Math.round(Math.max(56, c.width * 0.08))
    const local = { x: margin, y: 4, width: Math.max(100, c.width - 2 * margin), height: Math.max(100, c.height - 8) }
    return { card: { ...local, x: c.x + local.x, y: c.y + local.y }, local }
  }

  private peekMode(): OverlayMode {
    return { kind: 'peek', card: this.peekRects().local }
  }

  onPeekChanged(tab: LiveTab, change: { url?: string; navigated?: boolean }): void {
    if (change.navigated && change.url) this.recordHistory(tab, (h) => h.visit(change.url!, tab.wc.getTitle()))
    this.emitSoon()
  }

  /** Links from pinned tabs and favorites to other sites open in Peek, like Arc. */
  interceptLink(tab: LiveTab, url: string): boolean {
    if (!this.state.settings.peekPinnedLinks || !/^https?:/i.test(url)) return false
    const found = findItem(this.state, tab.itemId)
    if (!found || found.loc.kind === 'today' || sameSite(tab.wc.getURL(), url)) return false
    this.openPeek(tab, url)
    return true
  }

  /** Creates a new unpinned tab at the top of Today. */
  newTab(url: string, opts: { activate?: boolean; spaceId?: ID } = {}): TabItem {
    const space = (opts.spaceId && this.store.space(opts.spaceId)) || this.space
    const item: TabItem = { id: newId(), url, title: url, lastActive: Date.now() }
    space.today.unshift(item)
    if (opts.activate !== false) this.activate(item.id)
    else this.changed()
    return item
  }

  open(input: string, where: 'tab' | 'current' | 'split' | 'background' | 'little' = 'tab'): void {
    const url = resolveInput(input, this.state.settings.searchEngine)
    if (where === 'little') return void this.openLittle(url)
    if (where === 'current') {
      const tab = this.activeTab()
      if (tab) return void tab.load(url)
      where = 'tab'
    }
    if (where === 'split') {
      const item = this.newTab(url, { activate: false })
      return this.splitWith(item.id)
    }
    this.newTab(url, { activate: where === 'tab' })
  }

  private removeFromSplits(space: Space, id: ID): void {
    for (const sp of space.splits) {
      const i = sp.itemIds.indexOf(id)
      if (i < 0) continue
      sp.itemIds.splice(i, 1)
      sp.sizes.splice(i, 1)
      const sum = sp.sizes.reduce((a, b) => a + b, 0) || 1
      sp.sizes = sp.sizes.map((x) => x / sum)
    }
    space.splits = space.splits.filter((sp) => sp.itemIds.length > 1)
  }

  private nextActiveAfter(space: Space, closedId: ID, splitPartner?: ID): ID | undefined {
    if (splitPartner) return splitPartner
    const visible = new Set(spaceItems(this.state, space).map((i) => i.id))
    visible.delete(closedId)
    const recent = this.mru.find((id) => visible.has(id) && this.live.has(id))
    if (recent) return recent
    return space.today.find((t) => t.id !== closedId)?.id
  }

  close(id: ID): void {
    const found = findItem(this.state, id)
    if (!found) return
    const loc = found.loc
    const space = loc.kind === 'favorite' ? this.space : this.store.space(loc.spaceId)!
    const split = space.splits.find((sp) => sp.itemIds.includes(id))
    const partner = split?.itemIds.find((x) => x !== id)
    const wasActive = space.activeItemId === id
    this.removeFromSplits(space, id)
    this.dropLive(id)
    this.mru = this.mru.filter((m) => m !== id)
    if (loc.kind === 'today') {
      loc.list.splice(loc.index, 1)
      this.archive(found.item, space.id)
      this.closed.push({ url: found.item.url, title: found.item.title, spaceId: space.id })
    } else {
      // Pinned tabs and favorites stay in the sidebar; closing unloads them and resets to their saved URL.
      if (found.item.savedUrl) found.item.url = found.item.savedUrl
    }
    if (wasActive) {
      space.activeItemId = this.nextActiveAfter(space, id, partner)
      if (space.activeItemId) return this.activate(space.activeItemId)
    }
    this.layout()
    this.changed()
  }

  private archive(item: TabItem, spaceId: ID): void {
    if (!/^https?:/.test(item.url)) return
    this.state.archive.unshift({ id: newId(), url: item.url, title: item.title, favicon: item.favicon, spaceId, archivedAt: Date.now() })
    if (this.state.archive.length > MAX_ARCHIVE) this.state.archive.length = MAX_ARCHIVE
  }

  private autoArchive(): void {
    const hours = this.state.settings.archiveAfterHours
    if (!hours) return
    const cutoff = Date.now() - hours * 3600_000
    let any = false
    for (const space of this.state.spaces) {
      const keep: TabItem[] = []
      for (const t of space.today) {
        const busy =
          t.id === space.activeItemId ||
          space.splits.some((sp) => sp.itemIds.includes(t.id)) ||
          (this.live.get(t.id)?.info().audible ?? false)
        if (!busy && t.lastActive < cutoff) {
          this.archive(t, space.id)
          this.dropLive(t.id)
          any = true
        } else keep.push(t)
      }
      space.today = keep
    }
    if (any) this.changed()
  }

  clearToday(): void {
    const space = this.space
    for (const t of [...space.today]) {
      this.archive(t, space.id)
      this.removeFromSplits(space, t.id)
      this.dropLive(t.id)
      this.closed.push({ url: t.url, title: t.title, spaceId: space.id })
    }
    const wasToday = space.today.some((t) => t.id === space.activeItemId)
    space.today = []
    if (wasToday) space.activeItemId = undefined
    this.layout()
    this.changed()
  }

  reopenClosed(): void {
    const last = this.closed.pop()
    if (!last) return
    if (this.store.space(last.spaceId)) this.state.activeSpaceId = last.spaceId
    this.newTab(last.url)
  }

  togglePin(id: ID): void {
    const found = findItem(this.state, id)
    if (!found) return
    const item = found.item
    const space = found.loc.kind === 'favorite' ? this.space : this.store.space(found.loc.spaceId)!
    found.loc.list.splice(found.loc.index, 1)
    if (found.loc.kind === 'today') {
      const pinned: PinnedTab = { ...stripKind(item), kind: 'tab', savedUrl: item.url, savedTitle: item.savedTitle }
      space.pinned.push(pinned)
      this.toast('Pinned tab')
    } else {
      const unpinned = stripKind(item)
      delete unpinned.savedUrl
      space.today.unshift(unpinned)
    }
    this.changed()
  }

  addFavorite(id: ID): void {
    const found = findItem(this.state, id)
    if (!found || found.loc.kind === 'favorite') return
    const space = this.store.space(found.loc.spaceId)!
    const profile = this.store.profile(space.profileId)!
    found.loc.list.splice(found.loc.index, 1)
    const fav = stripKind(found.item)
    fav.savedUrl ??= fav.url
    profile.favorites.push(fav)
    this.changed()
  }

  move(id: ID, to: DropTarget): void {
    const space = this.space
    const profile = this.store.profile(space.profileId)!
    const beforeProfile = profileOfItem(this.state, id)
    let node: PinnedNode | TabItem | undefined
    let fromList: unknown[] | undefined
    let fromIndex = -1
    const pinnedHit = findInPinned(space.pinned, id)
    if (pinnedHit) {
      node = pinnedHit.list[pinnedHit.index]
      fromList = pinnedHit.list
      fromIndex = pinnedHit.index
    } else {
      const found = findItem(this.state, id)
      if (!found) return
      node = found.item
      fromList = found.loc.list
      fromIndex = found.loc.index
    }
    const isFolder = 'kind' in node && node.kind === 'folder'
    let target: unknown[]
    if (to.section === 'favorites') target = profile.favorites
    else if (to.section === 'today') target = space.today
    else {
      const folder = to.folderId ? findFolder(space, to.folderId) : undefined
      if (folder && containsNode(node as PinnedNode, folder.id)) return
      target = folder ? folder.children : space.pinned
    }
    if (isFolder && to.section !== 'pinned') return
    fromList.splice(fromIndex, 1)
    let index = to.index
    if (fromList === target && fromIndex < index) index--
    let moved: unknown = node
    if (!isFolder) {
      const item = stripKind(node as TabItem)
      if (to.section === 'today') delete item.savedUrl
      else item.savedUrl ??= item.url
      moved = to.section === 'pinned' ? ({ ...item, kind: 'tab' } satisfies PinnedTab) : item
    }
    target.splice(Math.max(0, Math.min(index, target.length)), 0, moved)
    if (!isFolder && profileOfItem(this.state, id) !== beforeProfile) {
      this.dropLive(id)
      if (space.activeItemId === id) this.activate(id)
    }
    this.layout()
    this.changed()
  }

  moveToSpace(id: ID, spaceId: ID): void {
    const found = findItem(this.state, id)
    const target = this.store.space(spaceId)
    if (!found || !target || found.loc.kind === 'favorite') return
    const from = this.store.space(found.loc.spaceId)!
    if (from.id === target.id) return
    found.loc.list.splice(found.loc.index, 1)
    this.removeFromSplits(from, id)
    const item = stripKind(found.item)
    if (found.loc.kind === 'pinned') target.pinned.push({ ...item, kind: 'tab' })
    else target.today.unshift(item)
    if (from.profileId !== target.profileId) this.dropLive(id)
    if (from.activeItemId === id) {
      from.activeItemId = undefined
      this.activate(id)
    } else {
      this.layout()
      this.changed()
    }
  }

  splitWith(id: ID): void {
    const space = this.space
    const active = space.activeItemId
    const found = findItem(this.state, id)
    if (!found) return
    if (found.loc.kind !== 'favorite' && found.loc.spaceId !== space.id) this.moveToSpace(id, space.id)
    if (!active || active === id || !findItem(this.state, active)) return this.activate(id)
    this.removeFromSplits(space, id)
    let split = space.splits.find((sp) => sp.itemIds.includes(active))
    if (split && split.itemIds.length < 4) {
      split.itemIds.push(id)
    } else if (!split) {
      split = { id: newId(), itemIds: [active, id], sizes: [] }
      space.splits.push(split)
    } else return this.activate(id)
    split.sizes = split.itemIds.map(() => 1 / split!.itemIds.length)
    this.activate(id)
  }

  unsplit(id?: ID): void {
    const space = this.space
    const target = id ?? space.activeItemId
    space.splits = space.splits.filter((sp) => !target || !sp.itemIds.includes(target))
    this.layout()
    this.changed()
  }

  switchSpace(id: ID): void {
    const space = this.store.space(id)
    if (!space) return
    this.closePeek()
    this.state.activeSpaceId = id
    if (space.activeItemId && findItem(this.state, space.activeItemId)) this.activate(space.activeItemId)
    else {
      space.activeItemId = undefined
      this.layout()
      this.changed()
    }
  }

  createSpace(a: Extract<Action, { type: 'createSpace' }>): void {
    let profileId = a.profileId && a.profileId !== 'new' ? a.profileId : undefined
    if (!profileId) {
      profileId = newId()
      this.state.profiles.push({ id: profileId, name: a.profileName || a.name, favorites: [] })
    }
    const space: Space = {
      id: newId(),
      name: a.name || 'New Space',
      emoji: a.emoji,
      color: a.color || SPACE_COLORS[this.state.spaces.length % SPACE_COLORS.length],
      profileId,
      pinned: [],
      today: [],
      splits: []
    }
    this.state.spaces.push(space)
    this.switchSpace(space.id)
  }

  deleteSpace(id: ID): void {
    if (this.state.spaces.length <= 1) return this.toast('You need at least one space')
    const space = this.store.space(id)
    if (!space) return
    for (const item of spaceItems(this.state, space)) if (!this.state.profiles.some((p) => p.favorites.includes(item))) this.dropLive(item.id)
    this.state.spaces = this.state.spaces.filter((s) => s.id !== id)
    if (!this.state.spaces.some((s) => s.profileId === space.profileId)) {
      const profile = this.store.profile(space.profileId)
      for (const f of profile?.favorites ?? []) this.dropLive(f.id)
      this.state.profiles = this.state.profiles.filter((p) => p.id !== space.profileId)
      void this.profiles.remove(space.profileId)
      this.historySync?.profilesChanged()
    }
    if (this.state.activeSpaceId === id) this.switchSpace(this.state.spaces[0].id)
    else this.changed()
  }

  // ---------------------------------------------------------------- input

  handleInput(e: Event, input: Input): void {
    if (this.switcher && input.type === 'keyUp' && (input.key === 'Control' || input.key === 'Meta')) {
      const target = this.switcher.order[this.switcher.index]
      this.switcher = undefined
      this.setOverlay({ kind: 'none' }, false)
      if (target) this.activate(target)
      return
    }
    if (input.type === 'keyDown' && input.key === 'Escape') {
      if (this.window.overlayMode.kind !== 'none' && this.window.overlayMode.kind !== 'sidebar') {
        e.preventDefault()
        this.setOverlay({ kind: 'none' })
        return
      }
    }
    const cmd = commandForInput(input, isMac)
    if (!cmd) return
    e.preventDefault()
    this.runCommand(cmd)
  }

  runCommand(cmd: CommandId | string): void {
    const tab = this.activeTab()
    const space = this.space
    const num = /^(space|tab)(\d)$/.exec(cmd)
    if (num) {
      const n = Number(num[2]) - 1
      if (num[1] === 'space') {
        const s = this.state.spaces[n]
        if (s) this.switchSpace(s.id)
      } else {
        const items = spaceItems(this.state, space)
        const item = cmd === 'tab9' ? items[items.length - 1] : items[n]
        if (item) this.activate(item.id)
      }
      return
    }
    switch (cmd as CommandId) {
      case 'newTab':
        return this.setOverlay({ kind: 'command', target: 'tab' })
      case 'editUrl':
        // The command bar replaces Peek; edit the Peek page's URL as a real tab.
        if (this.peek) this.expandPeek()
        return this.setOverlay({ kind: 'command', target: 'current', editCurrent: true, initial: tab?.wc.getURL() ?? '' })
      case 'toggleSidebar':
        return void this.dispatch({ type: 'toggleSidebar' })
      case 'copyUrl':
        return void this.dispatch({ type: 'copyUrl' })
      case 'copyUrlMarkdown':
        return void this.dispatch({ type: 'copyUrl', markdown: true })
      case 'littleArc':
        return void this.openLittle()
      case 'newIncognitoWindow':
        return void this.openIncognito()
      case 'closeTab':
        if (this.peek) return this.closePeek()
        if (space.activeItemId) this.close(space.activeItemId)
        return
      case 'reopenClosed':
        return this.reopenClosed()
      case 'togglePin':
        if (space.activeItemId) this.togglePin(space.activeItemId)
        return
      case 'clearToday':
        return this.clearToday()
      case 'nextTab':
      case 'prevTab': {
        const items = spaceItems(this.state, space)
        if (!items.length) return
        const i = items.findIndex((x) => x.id === space.activeItemId)
        const next = items[(i + (cmd === 'nextTab' ? 1 : -1) + items.length) % items.length]
        return this.activate(next.id)
      }
      case 'switcherNext':
      case 'switcherPrev': {
        const ids = new Set(spaceItems(this.state, space).map((i) => i.id))
        if (!this.switcher) {
          const order = [...this.mru.filter((id) => ids.has(id)), ...[...ids].filter((id) => !this.mru.includes(id))]
          if (order.length < 2) return
          this.switcher = { order, index: cmd === 'switcherNext' ? 1 : order.length - 1 }
        } else {
          const n = this.switcher.order.length
          this.switcher.index = (this.switcher.index + (cmd === 'switcherNext' ? 1 : -1) + n) % n
        }
        const sw = this.switcher
        this.setOverlay({ kind: 'switcher', order: sw.order, index: sw.index })
        this.switcher = sw
        return
      }
      case 'nextSpace':
      case 'prevSpace':
        return void this.dispatch({ type: 'switchSpaceRelative', delta: cmd === 'nextSpace' ? 1 : -1 })
      case 'splitAdd':
        return this.setOverlay({ kind: 'command', target: 'split' })
      case 'splitClose':
        return this.unsplit()
      case 'find':
        return this.setOverlay({ kind: 'find' })
      case 'findNext':
      case 'findPrev':
        this.window.overlay.webContents.send(IPC.find, { step: cmd === 'findNext' ? 1 : -1 })
        return
      case 'history':
        return this.setOverlay({ kind: 'library', tab: 'history' })
      case 'downloads':
        return this.setOverlay({ kind: 'library', tab: 'downloads' })
      case 'library':
        return this.setOverlay({ kind: 'library', tab: 'archive' })
      case 'devtools':
        return void this.dispatch({ type: 'devtools' })
      case 'reload':
        return void this.dispatch({ type: 'reload' })
      case 'hardReload':
        return void this.dispatch({ type: 'reload', hard: true })
      case 'stop':
        return void tab?.wc.stop()
      case 'zoomIn':
        return void this.dispatch({ type: 'zoom', delta: 1 })
      case 'zoomOut':
        return void this.dispatch({ type: 'zoom', delta: -1 })
      case 'zoomReset':
        return void this.dispatch({ type: 'zoom', delta: 0 })
      case 'back':
        return void (tab?.wc.navigationHistory.canGoBack() && tab.wc.navigationHistory.goBack())
      case 'forward':
        return void (tab?.wc.navigationHistory.canGoForward() && tab.wc.navigationHistory.goForward())
      case 'settings':
        return this.setOverlay({ kind: 'settings' })
      case 'newSpace':
        return this.setOverlay({ kind: 'space-editor' })
      case 'newFolder':
        return void this.dispatch({ type: 'newFolder' })
      case 'duplicate':
        if (tab) this.newTab(tab.wc.getURL())
        return
      case 'openInChrome':
        return void this.dispatch({ type: 'openInChrome' })
      case 'importArc':
        return void this.dispatch({ type: 'import', source: 'arc' })
      case 'importZen':
        return void this.dispatch({ type: 'import', source: 'zen' })
      case 'importChrome':
        return void this.dispatch({ type: 'import', source: 'chrome' })
      case 'extensions':
        return void this.dispatch({ type: 'extensionsStore' })
      case 'focusPage':
        return void tab?.wc.focus()
      case 'setDefaultBrowser':
        return this.makeDefaultBrowser()
      case 'checkForUpdates':
        return void this.updater.check(true)
      case 'installUpdate':
        return void this.updater.apply()
    }
  }

  // ---------------------------------------------------------------- actions

  async dispatch(a: Action): Promise<void> {
    const tab = this.activeTab()
    const space = this.space
    switch (a.type) {
      case 'activate':
        return this.activate(a.id)
      case 'close':
        return this.close(a.id)
      case 'open':
        this.setOverlay({ kind: 'none' }, false)
        return this.open(a.url, a.where)
      case 'reopenClosed':
        return this.reopenClosed()
      case 'togglePin':
        return this.togglePin(a.id)
      case 'addFavorite':
        return this.addFavorite(a.id)
      case 'resetToSaved': {
        const item = findItem(this.state, a.id)?.item
        if (!item?.savedUrl) return
        item.url = item.savedUrl
        const live = this.live.get(a.id)
        if (live) void live.load(item.savedUrl)
        return this.activate(a.id)
      }
      case 'duplicate': {
        const item = findItem(this.state, a.id)?.item
        if (item) this.newTab(this.live.get(a.id)?.wc.getURL() || item.url)
        return
      }
      case 'rename': {
        const item = findItem(this.state, a.id)?.item
        if (!item) return
        item.savedTitle = a.title.trim() || undefined
        return this.changed()
      }
      case 'move':
        return this.move(a.id, a.to)
      case 'moveToSpace':
        return this.moveToSpace(a.id, a.spaceId)
      case 'clearToday':
        return this.clearToday()
      case 'unload': {
        const item = findItem(this.state, a.id)?.item
        this.dropLive(a.id)
        if (item?.savedUrl) item.url = item.savedUrl
        if (space.activeItemId === a.id) space.activeItemId = this.nextActiveAfter(space, a.id)
        this.layout()
        return this.changed()
      }
      case 'mute': {
        const t = this.live.get(a.id)
        if (t) t.wc.setAudioMuted(!t.wc.isAudioMuted())
        return this.emitSoon()
      }
      case 'back':
        return this.runCommand('back')
      case 'forward':
        return this.runCommand('forward')
      case 'reload':
        if (!tab) return
        return a.hard ? tab.wc.reloadIgnoringCache() : tab.wc.reload()
      case 'stop':
        return void tab?.wc.stop()
      case 'zoom': {
        if (!tab) return
        const level = a.delta === 0 ? 0 : Math.max(-6, Math.min(9, tab.wc.getZoomLevel() + a.delta * 0.5))
        tab.wc.setZoomLevel(level)
        this.toast(`Zoom ${Math.round(Math.pow(1.2, level) * 100)}%`)
        return this.emitSoon()
      }
      case 'copyUrl': {
        if (!tab) return
        const url = tab.wc.getURL()
        clipboard.writeText(a.markdown ? `[${tab.wc.getTitle()}](${url})` : url)
        return this.toast(a.markdown ? 'Copied URL as Markdown' : 'Copied URL')
      }
      case 'devtools':
        if (!tab) return
        return tab.wc.isDevToolsOpened() ? tab.wc.closeDevTools() : tab.wc.openDevTools({ mode: 'detach' })
      case 'newFolder':
        space.pinned.unshift({ kind: 'folder', id: newId(), name: a.name || 'New Folder', open: true, children: [] })
        return this.changed()
      case 'toggleFolder': {
        const f = findFolder(space, a.id)
        if (f) f.open = !f.open
        return this.changed()
      }
      case 'renameFolder': {
        const f = findFolder(space, a.id)
        if (f) f.name = a.name.trim() || f.name
        return this.changed()
      }
      case 'deleteFolder': {
        const hit = findInPinned(space.pinned, a.id)
        const f = hit?.list[hit.index]
        if (!hit || f?.kind !== 'folder') return
        hit.list.splice(hit.index, 1, ...f.children)
        return this.changed()
      }
      case 'switchSpace':
        return this.switchSpace(a.id)
      case 'switchSpaceRelative': {
        const list = this.state.spaces
        const i = list.findIndex((s) => s.id === space.id)
        const next = list[i + a.delta]
        if (next) this.switchSpace(next.id)
        return
      }
      case 'switchSpaceIndex': {
        const s = this.state.spaces[a.index]
        if (s) this.switchSpace(s.id)
        return
      }
      case 'createSpace':
        this.setOverlay({ kind: 'none' }, false)
        this.createSpace(a)
        return this.historySync?.profilesChanged()
      case 'updateSpace': {
        const s = this.store.space(a.id)
        if (!s) return
        if (a.name !== undefined) s.name = a.name
        if (a.emoji !== undefined) s.emoji = a.emoji || undefined
        if (a.color) s.color = a.color
        if (a.profileId && a.profileId !== s.profileId && this.store.profile(a.profileId)) {
          for (const n of spaceItems(this.state, s)) this.dropLive(n.id)
          s.profileId = a.profileId
          s.splits = []
          if (s.id === this.space.id && s.activeItemId) return this.activate(s.activeItemId)
          this.layout()
        }
        return this.changed()
      }
      case 'deleteSpace':
        return this.deleteSpace(a.id)
      case 'renameProfile': {
        const p = this.store.profile(a.id)
        if (p) p.name = a.name
        this.historySync?.profilesChanged()
        return this.changed()
      }
      case 'splitWith':
        return this.splitWith(a.id)
      case 'unsplit':
        return this.unsplit(a.id)
      case 'resizeSplit': {
        const sp = space.splits.find((x) => x.id === a.splitId)
        if (!sp || a.sizes.length !== sp.itemIds.length) return
        const sum = a.sizes.reduce((x, y) => x + y, 0)
        sp.sizes = a.sizes.map((x) => Math.max(0.1, x / sum))
        this.layout()
        return this.changed()
      }
      case 'toggleSidebar': {
        const s = this.state.settings
        s.sidebarVisible = !s.sidebarVisible
        this.sidebarPeek = false
        if (this.window.overlayMode.kind === 'sidebar') this.window.setOverlay({ kind: 'none' }, undefined)
        if (isMac) this.window.win.setWindowButtonVisibility(s.sidebarVisible)
        this.layout()
        return this.changed()
      }
      case 'sidebarPeek': {
        if (this.state.settings.sidebarVisible || this.sidebarPeek === a.show) return
        const k = this.window.overlayMode.kind
        if (k !== 'none' && k !== 'sidebar') return
        this.sidebarPeek = a.show
        return this.setOverlay(a.show ? { kind: 'sidebar' } : { kind: 'none' }, false)
      }
      case 'overlay':
        return this.setOverlay(a.mode)
      case 'window': {
        const win = this.window.win
        if (a.op === 'minimize') win.minimize()
        else if (a.op === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
        else win.close()
        return
      }
      case 'settings': {
        Object.assign(this.state.settings, a.patch)
        this.syncAdblock()
        if (a.patch.theme) nativeTheme.themeSource = a.patch.theme
        if (isMac && a.patch.sidebarVisible !== undefined) this.window.win.setWindowButtonVisibility(a.patch.sidebarVisible)
        if (a.patch.autoUpdate !== undefined) this.updater.sync()
        this.layout()
        return this.changed()
      }
      case 'searchEngine':
        this.state.settings.searchEngine = a.engine
        return this.changed()
      case 'littleArc':
        return void this.openLittle(a.url)
      case 'peek':
        if (a.op === 'close') return this.closePeek()
        return this.expandPeek(a.op === 'split')
      case 'openInChrome': {
        const t = a.id ? this.live.get(a.id) : tab
        const url = t?.wc.getURL() || (a.id ? findItem(this.state, a.id)?.item.url : undefined)
        if (!url) return
        const ok = await openInChrome(url)
        return this.toast(ok ? 'Opened in Chrome' : 'Chrome was not found on this computer')
      }
      case 'find': {
        if (!tab) return
        if (!a.query) return void tab.wc.stopFindInPage('clearSelection')
        tab.wc.findInPage(a.query, { forward: a.forward ?? true, findNext: a.findNext ?? false })
        return
      }
      case 'stopFind':
        tab?.wc.stopFindInPage('keepSelection')
        return this.setOverlay({ kind: 'none' })
      case 'downloadOpen': {
        const d = this.downloads.find((x) => x.id === a.id)
        if (!d) return
        if (a.reveal) shell.showItemInFolder(d.path)
        else void shell.openPath(d.path)
        return
      }
      case 'downloadsClear':
        this.downloads = this.downloads.filter((d) => d.state === 'progressing')
        return this.emitSoon()
      case 'archiveRestore': {
        const entry = this.state.archive.find((x) => x.id === a.id)
        if (!entry) return
        this.state.archive = this.state.archive.filter((x) => x.id !== a.id)
        this.setOverlay({ kind: 'none' }, false)
        this.newTab(entry.url, { spaceId: this.store.space(entry.spaceId) ? entry.spaceId : undefined })
        return
      }
      case 'syncPickFolder':
        return (this.main ?? this).historySync?.pickFolder()
      case 'syncConnect':
        return (this.main ?? this).historySync?.connect(a.password)
      case 'syncChangePassword':
        return (this.main ?? this).historySync?.changePassword(a.password)
      case 'syncProfile':
        return (this.main ?? this).historySync?.setProfileSync(a.id, a.on)
      case 'syncCancel':
        return (this.main ?? this).historySync?.cancelSetup()
      case 'syncOff':
        return (this.main ?? this).historySync?.turnOff()
      case 'archiveClear':
        this.state.archive = []
        return this.changed()
      case 'import': {
        this.setOverlay({ kind: 'none' }, false)
        try {
          const summary = await runImport(this, a.source, a.path)
          if (summary) this.toast(summary)
          this.historySync?.profilesChanged()
        } catch (err) {
          console.error('[import]', err)
          this.toast(`Import failed: ${(err as Error).message}`)
        }
        return
      }
      case 'command':
        this.setOverlay({ kind: 'none' }, false)
        return this.runCommand(a.id)
      case 'adblockToggleSite': {
        const t = a.id ? this.live.get(a.id) : tab
        const host = t ? hostOf(t.wc.getURL()) : ''
        if (!host) return
        const list = this.state.settings.adblockAllowlist
        const allowed = list.includes(host)
        this.state.settings.adblockAllowlist = allowed ? list.filter((h) => h !== host) : [...list, host]
        this.syncAdblock()
        this.toast(allowed ? `Blocking ads on ${host}` : `Ads allowed on ${host}`)
        this.reloadSoon(t!)
        return this.changed()
      }
      case 'itemMenu':
        return buildItemMenu(this, a.id)?.popup({ window: this.window.win })
      case 'folderMenu':
        return buildFolderMenu(this, a.id)?.popup({ window: this.window.win })
      case 'spaceMenu':
        return buildSpaceMenu(this, a.id)?.popup({ window: this.window.win })
      case 'extensionsStore':
        this.setOverlay({ kind: 'none' }, false)
        this.newTab('https://chromewebstore.google.com/category/extensions')
        return
    }
  }

  // ---------------------------------------------------------------- TabHost

  onTabChanged(tab: LiveTab, change: { url?: string; title?: string; favicon?: string; navigated?: boolean }): void {
    const item = findItem(this.state, tab.itemId)?.item
    if (!item) return
    let persist = false
    if (change.url && change.url !== item.url) {
      item.url = change.url
      persist = true
    }
    if (change.title && change.title !== item.title) {
      item.title = change.title
      persist = true
      this.recordHistory(tab, (h) => h.setTitle(tab.wc.getURL(), change.title!))
    }
    if (change.favicon && change.favicon !== item.favicon) {
      item.favicon = change.favicon
      persist = true
    }
    if (change.navigated && change.url) {
      this.recordHistory(tab, (h) => h.visit(change.url!, tab.wc.getTitle()))
      this.adblock.resetCount(tab.wc)
    }
    if (persist) this.store.save()
    this.emitSoon()
  }

  onTabDestroyed(tab: LiveTab): void {
    if (this.live.get(tab.itemId) !== tab) return
    // Destroyed without going through close(): the page closed itself.
    const found = findItem(this.state, tab.itemId)
    if (found?.loc.kind === 'today') this.close(tab.itemId)
    else {
      this.live.delete(tab.itemId)
      this.layout()
      this.emitSoon()
    }
  }

  /** History is best-effort: a failing write must never take down the main process. */
  private recordHistory(tab: LiveTab, write: (h: ProfileRuntime['history']) => void): void {
    if (this.quitting) return
    try {
      write(this.profiles.get(tab.profileId).history)
    } catch (err) {
      console.warn('[history]', (err as Error).message)
    }
  }

  onTabInput(_tab: LiveTab, event: Event, input: Input): void {
    this.handleInput(event, input)
  }

  onTabFocus(tab: LiveTab): void {
    const space = this.space
    if (space.activeItemId === tab.itemId) return
    const split = space.splits.find((sp) => sp.itemIds.includes(tab.itemId))
    if (split && split.itemIds.includes(space.activeItemId ?? '')) {
      space.activeItemId = tab.itemId
      this.mru = [tab.itemId, ...this.mru.filter((m) => m !== tab.itemId)]
      this.changed()
    }
  }

  onTabFullscreen(tab: LiveTab, on: boolean): void {
    this.fullscreenTab = on ? tab : undefined
    const win = this.window.win
    if (on !== win.isFullScreen()) win.setFullScreen(on)
    this.layout()
  }

  onFoundInPage(_tab: LiveTab, result: Result): void {
    this.window.overlay.webContents.send(IPC.find, { matches: result.matches, active: result.activeMatchOrdinal })
  }

  adoptOpenedPage(opener: LiveTab, options: BrowserWindowConstructorOptions, disposition: OpenDisposition, url: string): WebContents {
    const openerItem = findItem(this.state, opener.itemId)
    const spaceId = openerItem && openerItem.loc.kind !== 'favorite' ? openerItem.loc.spaceId : this.space.id
    const space = this.store.space(spaceId)!
    const item: TabItem = { id: newId(), url, title: url, lastActive: Date.now() }
    space.today.unshift(item)
    const guest = (options as { webContents?: WebContents }).webContents
    const view = new WebContentsView({ webContents: guest, webPreferences: options.webPreferences })
    view.setBackgroundColor('#ffffff')
    const tab = new LiveTab(this, item.id, opener.profileId, opener.session, undefined, view)
    this.live.set(item.id, tab)
    this.extensions.addTab(tab, this.window.win)
    if (disposition === 'background-tab') this.changed()
    else setImmediate(() => this.activate(item.id))
    return view.webContents
  }

  showContextMenu(tab: LiveTab, params: ContextMenuParams): void {
    buildContextMenu(this, tab, params).popup({ window: this.window.win })
  }

  // ---------------------------------------------------------------- Little Arc

  openLittle(url?: string, profileId = this.littleProfile(url), bounds?: Rectangle): LittleWindow {
    const little = new LittleWindow(this, this.profiles.get(profileId), url, bounds)
    this.littles.add(little)
    little.win.on('closed', () => this.littles.delete(little))
    return little
  }

  /** The profile a Little Arc page opens in: the one picked for the site, the Settings choice, else the active space's. */
  private littleProfile(url?: string): ID {
    const known = (id: ID | undefined) => (id && this.store.profile(id) ? id : undefined)
    const s = this.state.settings
    return known(this.state.littleArc.profileByHost[hostOf(url ?? '')]) ?? known(s.littleArcProfileId) ?? this.space.profileId
  }

  /** Reopens a Little Arc page with another profile (the toolbar's profile chip) and remembers that for the site. */
  switchLittleProfile(little: LittleWindow, profileId: ID): void {
    const url = little.url
    const host = hostOf(url)
    if (host) this.state.littleArc.profileByHost[host] = profileId
    this.store.save()
    this.openLittle(url, profileId, little.win.getBounds())
    little.win.close()
  }

  rememberLittleSize(width: number, height: number): void {
    this.state.littleArc.size = { width, height }
    this.store.save()
  }

  /** The space "Open in" uses: the active space when it has the window's profile, else the first space that does. */
  littleTargetSpace(profileId: ID): Space {
    if (this.space.profileId === profileId) return this.space
    return this.state.spaces.find((s) => s.profileId === profileId) ?? this.space
  }

  /** Moves a Little Arc page into the main window as a Today tab, keeping its state. */
  adoptLittle(little: LittleWindow, spaceId?: ID): void {
    this.ensureWindow()
    const space = (spaceId && this.store.space(spaceId)) || this.littleTargetSpace(little.profile.id)
    const tab = little.release()
    const item: TabItem = { id: newId(), url: tab.wc.getURL(), title: tab.wc.getTitle(), favicon: tab.favicon, lastActive: Date.now() }
    space.today.unshift(item)
    tab.host = this
    tab.itemId = item.id
    this.live.set(item.id, tab)
    this.activate(item.id)
    const win = this.window.win
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  /** Links opened from other apps. */
  openExternalUrl(url: string): void {
    if (!/^https?:|^file:/i.test(url)) return
    if (this.state.settings.littleArcForExternalLinks) void this.openLittle(url)
    else {
      this.ensureWindow()
      this.newTab(url)
      const win = this.window.win
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  }

  // ---------------------------------------------------------------- IPC

  /** Whether this controller's window (sidebar or overlay) or one of its Little Arc windows is `wc`. */
  private owns(wc: WebContents): boolean {
    const w = this.window
    if (w && !w.win.isDestroyed() && (w.win.webContents === wc || w.overlay.webContents === wc)) return true
    return [...this.littles].some((l) => !l.win.isDestroyed() && l.win.webContents === wc)
  }

  /** Registered once, by the main controller; each call goes to the controller of the window that sent it. */
  private registerIpc(): void {
    const of = (e: IpcMainInvokeEvent) => [...Browser.all].find((b) => b.owns(e.sender)) ?? this
    ipcMain.handle(IPC.action, (e, action: Action) => of(e).dispatch(action))
    ipcMain.handle(IPC.getState, (e) => of(e).snapshot())
    ipcMain.handle(IPC.getOverlay, (e) => of(e).window.overlayMode)
    ipcMain.handle(IPC.search, (e, q: string) => search(of(e), q))
    ipcMain.handle(IPC.suggest, (e, q: string) => suggest(of(e), q))
    ipcMain.handle(IPC.history, (e, q: string, offset: number) => {
      const b = of(e)
      return b.profiles.get(b.space.profileId).history.recent(200, offset, q)
    })
    ipcMain.handle(IPC.historyDelete, (e, url: string) => {
      const b = of(e)
      return b.profiles.get(b.space.profileId).history.deleteUrl(url)
    })
    ipcMain.handle(IPC.littleOp, (e, op: LittleOp, at?: LittleAnchor) => {
      for (const l of of(e).littles) if (l.win.webContents === e.sender) return l.op(op, at)
    })
  }

  private pendingReloads = new Map<LiveTab, NodeJS.Timeout>()

  /**
   * Reloads once after rapid repeated requests (e.g. double-clicking the shield). Overlapping
   * reloads while the ad blocker rewrites requests can crash Electron's browser process.
   */
  private reloadSoon(tab: LiveTab): void {
    clearTimeout(this.pendingReloads.get(tab))
    this.pendingReloads.set(
      tab,
      setTimeout(() => {
        this.pendingReloads.delete(tab)
        if (tab.destroyed) return
        if (tab.wc.isLoading()) tab.wc.stop()
        tab.wc.reload()
      }, 250)
    )
  }

  private syncAdblock(): void {
    this.adblock.enabled = this.state.settings.adblock
    this.adblock.allowlist = new Set(this.state.settings.adblockAllowlist)
  }

  /** Windows doesn't let apps claim the default themselves; macOS asks the user to confirm. */
  makeDefaultBrowser(): void {
    if (process.platform === 'win32') {
      void shell.openExternal('ms-settings:defaultapps?registeredAppUser=YARC')
      if (!app.isPackaged) this.toast('Install YARC first, then pick it in Default apps')
      return
    }
    app.setAsDefaultProtocolClient('http')
    app.setAsDefaultProtocolClient('https')
  }

  private quitting = false

  shutdown(): void {
    this.quitting = true
    this.historySync?.shutdown()
    this.store.flush()
    this.profiles.closeAll()
  }

  /** On macOS the app outlives its main window; reopen it before using it. */
  ensureWindow(): void {
    const win = this.window?.win
    if (!win || win.isDestroyed()) this.openWindow()
  }

  focusWindow(): void {
    const win = this.window?.win
    if (!win || win.isDestroyed()) return this.openWindow()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  allWindows(): BrowserWindow[] {
    return [this.window.win, ...[...this.littles].map((l) => l.win)]
  }
}

function stripKind<T extends TabItem>(item: T): TabItem {
  const { kind: _kind, ...rest } = item as T & { kind?: string }
  return { ...rest }
}

function uniquePath(dir: string, filename: string): string {
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot) : ''
  let candidate = join(dir, filename)
  for (let i = 1; existsSync(candidate); i++) candidate = join(dir, `${base} (${i})${ext}`)
  return candidate
}
