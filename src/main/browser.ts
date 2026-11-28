import {
  app,
  BrowserWindow,
  nativeTheme,
  screen,
  type BaseWindow,
  type BrowserWindowConstructorOptions,
  type ContextMenuParams,
  type Event,
  type Input,
  type Point,
  type Rectangle,
  type Result,
  type View,
  type WebContents
} from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Action } from '../shared/actions'
import { withPin } from '../shared/extension-pins'
import { IPC, TOAST_MS } from '../shared/ipc'
import type { CommandId } from '../shared/keymap'
import { findCanvas, findItem, profileOfItem } from '../shared/tree'
import type {
  AppState,
  ExtensionInfo,
  ID,
  OverlayMode,
  Rect,
  Space,
  TabItem,
  WindowView
} from '../shared/types'
import { layoutPanes, PANE_BAR, paneIds, splitOf } from '../shared/split'
import { isFloating, stepAfter, type TourEvent, type TourStep } from '../shared/tour'
import { routeFor } from '../shared/link-routes'
import { hostOf } from '../shared/url'
import { AdBlock } from './net/adblock'
import { Canvases } from './features/canvas'
import { DownloadList } from './core/download-list'
import { Extensions } from './net/extensions'
import { ImportScan } from './importers'
import { LittleWindow } from './features/little'
import { LiveFolders } from './features/live-folders'
import { logInfo, logProblem, setLogContext } from './core/log'
import { Media } from './features/media'
import { Mirror, stillOf } from './features/mirror'
import { Peek, sameSite } from './features/peek'
import { buildContextMenu } from './features/menus'
import { Profiles, type ProfileRuntime } from './core/profiles'
import { commandBarPlace, overlayRect, peekRects, promptAnchor, trafficLightsAt, type WindowFrame } from './features/overlay-layout'
import { PageSwipe, type SwipeTarget } from './features/page-swipe'
import { PromptView } from './core/prompt-view'
import { SharePicker } from './core/share-picker'
import { setSwipeStage } from './core/swipe-nav'
import { incognitoState, newId, Store } from './core/store'
import { HistorySync } from './sync'
import { adoptedTabView, LiveTab, type OpenDisposition, type TabHost } from './core/tab'
import { becomeDefaultBrowser } from './core/default-browser'
import { registerIpc } from './ipc'
import { dispatch, handleInput, runCommand } from './features/commands'
import { Spaces } from './features/spaces'
import { Splits } from './features/splits'
import { Tabs } from './features/tabs'
import { plainWindowForTests, WhatsNew } from './features/whats-new'
import { Updater } from './update/updater'
import { MainWindow, PAD, type ViewSlot } from './core/window'
import { applyView, captureView, cascade, newView, stateForView, viewFromState } from './features/window-state'


const HOUSEKEEPING_EVERY = 5 * 60_000
// Slack past the revealed sidebar's edge: room to grab it to resize, and no enter/leave flicker at the screen's edge.
const SIDEBAR_REVEAL_GRACE_PX = 32
const SIDEBAR_REVEAL_HIDE_DELAY_MS = 300

class WindowSession {
  peek: Peek | undefined
  sidebarReveal = false
  tabDrag: ID | undefined
  sidebarRevealHide: ReturnType<typeof setTimeout> | undefined
  fullscreenTab: LiveTab | undefined
  switcher: { order: ID[]; index: number } | undefined
  layout: AppState['layout'] = { content: { x: 0, y: 0, width: 0, height: 0 }, views: [] }

  constructor(
    readonly main: MainWindow,
    readonly view: WindowView
  ) {}

  get open(): boolean {
    return !this.main.win.isDestroyed()
  }
}

export class Browser implements TabHost {
  readonly store: Store
  readonly profiles: Profiles
  readonly extensions: Extensions
  readonly adblock: AdBlock
  readonly updater: Updater
  /** History sync; only the main controller has it, so incognito windows never sync. */
  readonly historySync: HistorySync | undefined
  readonly main: Browser | undefined
  wins: WindowSession[] = []
  /** The window commands act on; after the last window closes on macOS it stays, closed. */
  cur!: WindowSession
  private reportedLost: WindowSession | undefined
  readonly live = new Map<ID, LiveTab>()
  readonly canvases = new Canvases(this)
  readonly tabs = new Tabs(this)
  readonly splits = new Splits(this)
  readonly spaces = new Spaces(this)
  readonly whatsNew = new WhatsNew(this)
  readonly liveFolders = new LiveFolders(this)
  readonly media = new Media(this)
  private readonly swipe = new PageSwipe((page) => this.swipeTarget(page))
  /** The space editor's unsaved colors; no `spaceId` is a new space, shown on its window's current one. */
  colorPreview: { window: WindowSession; spaceId?: ID; color: string; color2?: string } | undefined
  private mirror = new Mirror((wc, still) => this.sendStill(wc, still))
  recordingShortcut = false
  readonly downloads = new DownloadList({
    toast: (text) => this.toast(text),
    startedByPage: (page) => [...this.live.values()].some((tab) => tab.wc === page && !tab.userActivated),
    changed: () => this.emitSoon(),
    progressed: () => this.emitSlowly()
  })
  extensionList: Record<ID, ExtensionInfo[]> = {}
  private emitTimer: NodeJS.Timeout | undefined
  private slowEmitTimer: NodeJS.Timeout | undefined
  readonly littles = new Set<LittleWindow>()

  /** Read this, not `littles`: Electron marks a closing window destroyed before 'closed' takes it off the list. */
  openLittles(): LittleWindow[] {
    return [...this.littles].filter((little) => !little.win.isDestroyed())
  }
  tour: TourStep | undefined
  readonly imports = new ImportScan(() => this.emitSoon())
  private legacyWindowFile: string | undefined
  private static readonly all = new Set<Browser>()

  /** Pass `main` for an incognito window: state and history in memory, no extensions, all gone when it closes. */
  constructor(main?: Browser) {
    this.main = main
    this.extensions = new Extensions(this)
    this.profiles = new Profiles((runtime) => this.onProfileCreated(runtime), !!main, () => this.syncPrompts())
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
    this.legacyWindowFile = join(userData, 'window.json')
    // engine.bin was built from Ghostery's stale copies of the lists.
    void rm(join(userData, 'adblock', 'engine.bin'), { force: true })
    this.adblock = new AdBlock(join(userData, 'adblock', 'lists.bin'), () => this.emitSlowly())
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
    this.adblock.sync(this.state.settings)
    void this.adblock.load()
    nativeTheme.themeSource = this.store.state.settings.theme
  }

  get incognito(): boolean {
    return !!this.main
  }

  get window(): MainWindow {
    return this.cur?.main
  }

  openIncognito(url?: string): Browser {
    const main = this.main ?? this
    main.tourEvent('newIncognitoWindow')
    const incognito = new Browser(main)
    incognito.start()
    if (url) incognito.tabs.newTab(url)
    else incognito.window.win.once('show', () => incognito.runCommand('newTab'))
    return incognito
  }

  get state() {
    return this.store.state
  }

  get space(): Space {
    return this.store.activeSpace
  }

  /** Call before start(), so pages load with last run's session cookies. Waits a second at most. */
  async restoreSessions(): Promise<void> {
    const restored = this.profiles.restoreSessionCookies(this.state.profiles.map((profile) => profile.id))
    await Promise.race([restored, sleep(1000)])
  }

  start(): void {
    Browser.all.add(this)
    if (Browser.all.size === 1) {
      registerIpc(Browser.all)
      setSwipeStage({
        show: (page, step, offset, progress) => [...Browser.all].some((browser) => browser.swipe.show(page, step, offset, progress)),
        hide: (page) => Browser.all.forEach((browser) => browser.swipe.hide(page))
      })
      setLogContext(() => [...Browser.all].map((browser) => browser.describeWindows()).join('; '))
    }
    this.store.beforeWrite = () => this.captureCurrent()
    const saved = this.state.windows
    if (!saved.length) saved.push({ ...viewFromState(this.state, newId()), ...this.legacyBounds() })
    const lastFocused = saved[saved.length - 1]
    saved.forEach((view) => this.openWindow(view, view !== lastFocused))
    if (this.incognito) return
    setInterval(() => {
      this.tabs.autoArchive()
      this.tabs.unloadHiddenTabs()
      this.closeIdleLittles()
    }, HOUSEKEEPING_EVERY)
    this.tabs.autoArchive()
    this.liveFolders.start()
    this.updater.sync()
    this.whatsNew.showStartupScreen()
    this.historySync?.start()
  }

  openCommandBarIfBlank(): void {
    const activeId = this.space.activeItemId
    if ((activeId && this.hasItem(activeId)) || this.store.firstRun || plainWindowForTests()) return
    const window = this.cur
    const openCommandBar = () => window.main.overlayMode.kind === 'whats-new' || this.inWin(window, () => this.runCommand('newTab'))
    if (window.main.win.isVisible()) openCommandBar()
    else window.main.win.once('show', openCommandBar)
  }

  tourEvent(event: TourEvent): void {
    const step = this.tour
    if (!step) return
    const next = stepAfter(step, event)
    if (next === step) return
    this.tour = next
    const kind = this.window.overlayMode.kind
    const cardCanShow = kind === 'tour' || kind === 'none'
    if (cardCanShow) this.setOverlay({ kind: 'tour', step: next }, false)
  }

  pageInFront(): boolean {
    const mode = this.window.overlayMode
    return mode.kind === 'none' || mode.kind === 'notice' || (mode.kind === 'tour' && isFloating(mode.step))
  }

  panelInFront(): boolean {
    return !this.pageInFront() && this.window.overlayMode.kind !== 'sidebar'
  }

  private unopenedOrNewView(): WindowView {
    const unopened = this.state.windows.find((view) => !this.wins.some((window) => window.view === view))
    if (unopened) return unopened
    const view = viewFromState(this.state, newId())
    this.state.windows.push(view)
    return view
  }

  openWindow(view = this.unopenedOrNewView(), background = false): WindowSession {
    const window = new WindowSession(new MainWindow(view.bounds, background), view)
    this.wins.push(window)
    logInfo(`${this.incognito ? 'incognito ' : ''}window ${short(view.id)} opened`)
    this.use(window)
    const win = window.main.win
    if (view.maximized) win.maximize()
    this.syncTrafficLights()
    const onInput = (event: Event, input: Input): void => {
      this.use(window)
      this.handleInput(event, input)
    }
    for (const wc of [win.webContents, window.main.overlay.webContents]) wc.on('before-input-event', onInput)
    window.main.prompt = new PromptView(
      win,
      (id, answer) => {
        this.use(window)
        this.answerPrompt(id, answer)
      },
      onInput
    )
    win.on('focus', () => {
      this.use(window)
      this.saveAsLastFocused(window)
      // Takes back the pages it shares with other windows.
      this.layout()
    })
    // The reveal hides when the pointer leaves it, but a pointer over another app sends this window no moves.
    win.on('blur', () =>
      this.inWin(window, () => {
        if (window.sidebarReveal && !window.tabDrag && window.main.overlayMode.kind === 'sidebar') this.setOverlay({ kind: 'none' }, false)
      })
    )
    win.on('resize', () =>
      this.inWin(window, () => {
        this.layout()
        this.saveBounds(window)
      })
    )
    win.on('move', () => this.saveBounds(window))
    const stepHistory = (step: 'back' | 'forward') => this.inWin(window, () => void this.dispatch({ type: step }))
    win.on('swipe', (_event, direction) => {
      if (direction === 'left') stepHistory('back')
      if (direction === 'right') stepHistory('forward')
    })
    win.on('app-command', (_event, command) => {
      if (command === 'browser-backward') stepHistory('back')
      if (command === 'browser-forward') stepHistory('forward')
    })
    for (const eventName of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
      win.on(eventName as 'maximize', () =>
        this.inWin(window, () => {
          this.layout()
          this.emit()
          this.saveBounds(window)
        })
      )
    }
    // Detach the pages before the window goes, so they stay alive for the other windows.
    win.on('close', () => {
      window.main.show([])
      window.main.setTop(undefined)
    })
    win.on('closed', () => this.onWindowClosed(window))
    win.webContents.once('did-finish-load', () => this.emit())
    // A page taking the keyboard doesn't blur the sidebar's focused element (a rename field), so tell it.
    for (const wc of [win.webContents, window.main.overlay.webContents]) wc.on('blur', () => !wc.isDestroyed() && wc.send(IPC.blur))
    window.main.overlay.webContents.on('blur', () => {
      if (!window.open) return
      const mode = window.main.overlayMode
      if (mode.kind !== 'command' && mode.kind !== 'switcher') return
      // Windows blurs the overlay whenever a page finishes loading: hand the keyboard back; only leaving the window closes these panels.
      setTimeout(() => {
        if (!window.open || window.main.overlayMode !== mode) return
        if (win.isFocused()) window.main.overlay.webContents.focus()
        else this.inWin(window, () => this.setOverlay({ kind: 'none' }, false))
      }, 50)
    })
    win.webContents.on('before-mouse-event', (_event, mouse) => {
      const kind = window.main.overlayMode.kind
      if (mouse.type === 'mouseDown' && (kind === 'command' || kind === 'switcher')) this.inWin(window, () => this.setOverlay({ kind: 'none' }, false))
    })
    const active = this.space.activeItemId
    if (active && this.hasItem(active)) this.activate(active)
    else this.layout()
    return window
  }

  openNewWindow(): void {
    if (this.main) return this.main.openNewWindow()
    this.useFocused()
    const from = this.cur?.open ? this.cur.main.win.getNormalBounds() : undefined
    const bounds = from ? cascade(from, screen.getDisplayMatching(from).workArea) : undefined
    const view = newView(newId(), this.state.activeSpaceId, bounds)
    this.state.windows.push(view)
    const window = this.openWindow(view)
    this.store.save()
    // Showing moves the focus, which would close a command bar opened before.
    window.main.win.once('show', () => this.inWin(window, () => this.runCommand('newTab')))
  }

  private onWindowClosed(window: WindowSession): void {
    this.wins = this.wins.filter((other) => other !== window)
    logInfo(`${this.incognito ? 'incognito ' : ''}window ${short(window.view.id)} closed, ${this.wins.length} left`)
    clearTimeout(window.sidebarRevealHide)
    if (this.colorPreview?.window === window) this.colorPreview = undefined
    window.peek?.destroy()
    window.peek = undefined
    if (this.wins.length) {
      if (!this.quitting) this.state.windows = this.state.windows.filter((view) => view !== window.view)
      if (this.cur === window) this.use(this.wins[this.wins.length - 1])
      for (const other of this.wins) if (this.waitsForPage(other)) this.inWin(other, () => this.layout())
      this.syncMirrors()
      this.store.save()
      return this.emitSoon()
    }
    this.media.reset()
    for (const tab of this.live.values()) tab.destroy()
    this.live.clear()
    if (this.incognito) this.dispose()
  }

  /** Makes `window` current: the state's per-window fields become its own (window-state.ts). */
  private use(window: WindowSession): void {
    if (window === this.cur) return
    if (!window.open && this.wins.length) logProblem(`window ${short(window.view.id)} made current after it closed`)
    if (this.cur) captureView(this.state, this.cur.view)
    this.cur = window
    applyView(this.state, window.view)
  }

  inWin(window: WindowSession, run: () => void): void {
    const previous = this.cur
    this.use(window)
    try {
      run()
    } finally {
      if (previous !== window && previous.open) this.use(previous)
    }
  }

  useFocused(): void {
    const focused = BrowserWindow.getFocusedWindow()
    const window = this.wins.find((candidate) => candidate.main.win === focused)
    if (window) this.use(window)
  }

  captureCurrent(): void {
    if (!this.cur) return
    const curViewLost = this.wins.length > 0 && (!this.cur.open || !this.state.windows.includes(this.cur.view))
    if (curViewLost && this.reportedLost !== this.cur) logProblem(`saving while the current window ${short(this.cur.view.id)} is closed or not saved`)
    this.reportedLost = curViewLost ? this.cur : undefined
    captureView(this.state, this.cur.view)
  }

  private describeWindows(): string {
    const cur = this.cur
    const flags = cur ? `${cur.open ? '' : ' (closed)'}${this.state.windows.includes(cur.view) ? '' : ' (not saved)'}` : ''
    const ids = (list: { id: ID }[]) => list.map((view) => short(view.id)).join(', ')
    return `${this.incognito ? 'incognito' : 'main'}: current ${cur ? short(cur.view.id) + flags : 'none'}, open [${ids(this.wins.map((window) => window.view))}], saved [${ids(this.state.windows)}]`
  }

  private saveAsLastFocused(window: WindowSession): void {
    const list = this.state.windows
    const index = list.indexOf(window.view)
    if (index < 0 || index === list.length - 1) return
    list.splice(index, 1)
    list.push(window.view)
    this.store.save()
  }

  private winOf(tab: LiveTab): WindowSession {
    return this.wins.find((window) => window.peek?.tab === tab || (window.open && window.main.isShown(tab.view))) ?? this.cur
  }

  sidebarOrigin(win: BaseWindow): Point | undefined {
    const window = this.wins.find((open) => open.main.win === win)
    if (!window) return undefined
    const sidebarVisible = window === this.cur ? this.state.settings.sidebarVisible : window.view.sidebarVisible
    return sidebarVisible ? { x: 0, y: 0 } : window.main.sidebarOrigin()
  }

  isMainWindow(win: BaseWindow): boolean {
    return this.wins.some((window) => window.main.win === win)
  }

  private dispose(): void {
    Browser.all.delete(this)
    for (const little of this.openLittles()) little.discard()
    for (const runtime of this.profiles.all()) void runtime.session.clearData()
    this.profiles.closeAll()
  }

  private saveBounds(window: WindowSession): void {
    const win = window.main.win
    if (win.isDestroyed() || win.isFullScreen()) return
    window.view.bounds = win.getNormalBounds()
    window.view.maximized = win.isMaximized()
    this.store.save()
  }

  private legacyBounds(): Pick<WindowView, 'bounds' | 'maximized'> {
    try {
      if (!this.legacyWindowFile || !existsSync(this.legacyWindowFile)) return {}
      const { maximized, ...bounds } = JSON.parse(readFileSync(this.legacyWindowFile, 'utf8')) as Rect & { maximized?: boolean }
      return { bounds, maximized }
    } catch {
      return {}
    }
  }

  readonly sharePicker = new SharePicker((mode, page) => {
    const tab = page && [...this.live.values()].find((live) => live.wc === page)
    if (tab) this.use(this.winOf(tab))
    this.setOverlay(mode)
  })

  private onProfileCreated(runtime: ProfileRuntime): void {
    this.downloads.watch(runtime.session, runtime.id)
    this.sharePicker.answerFor(runtime.session)
    this.adblock.attach(runtime.session)
    if (!this.incognito) void this.extensions.setup(runtime)
  }

  snapshot(window: WindowSession = this.cur, mode = window.main.overlayMode): AppState {
    return this.withPanelData(this.snapshotWith(window, this.liveInfo()), mode)
  }

  private withPanelData(snap: AppState, mode: OverlayMode): AppState {
    if (mode.kind === 'library') return { ...snap, archive: this.state.archive }
    if (mode.kind === 'settings') return { ...snap, sitePermissions: Object.fromEntries(this.state.profiles.map((profile) => [profile.id, this.profiles.decisions(profile.id).list()])) }
    if (mode.kind === 'tour' && mode.step === 'import') return { ...snap, importChoices: this.imports.rows() }
    return snap
  }

  private liveInfo(): AppState['live'] {
    const live: AppState['live'] = {}
    for (const [id, tab] of this.live) {
      if (tab.destroyed) continue
      const info = tab.info()
      info.blocked = this.adblock.count(tab.wc)
      info.shielded = this.adblock.enabled && !this.adblock.isAllowed(info.url)
      live[id] = info
    }
    return live
  }

  private snapshotWith(window: WindowSession, live: AppState['live']): AppState {
    const win = window.main.win
    const open = !win.isDestroyed()
    const mode = window.main.overlayMode
    return {
      ...this.withColorPreview(window, window === this.cur ? this.state : stateForView(this.state, window.view)),
      live,
      downloads: this.downloads.items,
      extensions: this.extensionList,
      incognito: this.incognito,
      platform: process.platform,
      maximized: open && win.isMaximized(),
      fullscreen: open && win.isFullScreen(),
      sidebarReveal: window.sidebarReveal,
      tabDrag: window.tabDrag,
      newTabOpen: mode.kind === 'command' && (mode.target ?? 'tab') === 'tab',
      peek: window.peek && !window.peek.tab.destroyed ? window.peek.tab.info() : undefined,
      layout: window.layout,
      update: this.updater.status,
      whatsNew: this.whatsNew.whatsNewPill(),
      archive: [],
      sitePermissions: {},
      media: this.media.snapshot(),
      historySync: (this.main ?? this).historySync?.status ?? { state: 'off', drives: [], icloud: false }
    }
  }

  private withColorPreview<T extends { activeSpaceId: ID; spaces: Space[] }>(window: WindowSession, state: T): T {
    const preview = this.colorPreview
    const id = preview && (preview.spaceId ?? (preview.window === window ? state.activeSpaceId : undefined))
    if (!id) return state
    return { ...state, spaces: state.spaces.map((space) => (space.id === id ? { ...space, color: preview.color, color2: preview.color2 } : space)) }
  }

  emit(): void {
    clearTimeout(this.emitTimer)
    clearTimeout(this.slowEmitTimer)
    this.emitTimer = this.slowEmitTimer = undefined
    const live = this.liveInfo()
    for (const window of this.wins) {
      if (!window.open) continue
      const snap = this.snapshotWith(window, live)
      window.main.ui.send(IPC.state, snap)
      const mode = window.main.overlayMode
      if (mode.kind !== 'none') window.main.sendToOverlay(IPC.state, this.withPanelData(snap, mode))
    }
  }

  emitSoon(): void {
    this.emitTimer ??= setTimeout(() => this.emit(), 30)
  }

  private emitSlowly(): void {
    this.slowEmitTimer ??= setTimeout(() => this.emit(), 1000)
  }

  emitAll(): void {
    for (const browser of Browser.all) browser.emitSoon()

  }

  toast(text: string): void {
    const win = this.window?.win
    if (!win || win.isDestroyed()) return
    // The sidebar draws toasts under the page, which covers them while the sidebar is hidden.
    if (!this.state.settings.sidebarVisible) {
      const mode = this.window.overlayMode
      if (mode.kind === 'none' || mode.kind === 'notice') return this.showNotice(text, TOAST_MS)
      const overlay = overlayRect(mode, this.frame(), !!this.cur.tabDrag)
      if (overlay && overlay.height >= this.frame().content.height) return this.window.sendToOverlay(IPC.toast, text)
    }
    win.webContents.send(IPC.toast, text)
  }

  private showNotice(text: string, closeAfterMs: number): void {
    const notice: OverlayMode = { kind: 'notice', text }
    this.setOverlay(notice, false)
    const window = this.cur
    setTimeout(() => {
      if (window.open && this.wins.includes(window)) this.inWin(window, () => this.window.overlayMode === notice && this.setOverlay({ kind: 'none' }, false))
    }, closeAfterMs)
  }

  changed(): void {
    this.store.save()
    this.emitSoon()
  }

  setExtensionPin(profileId: ID, extensionId: string, pinned: boolean): void {
    const profile = this.store.profile(profileId)
    if (!profile) return
    profile.pinnedExtensions = withPin(profile.pinnedExtensions ?? [], extensionId, pinned)
    this.changed()
  }

  relayout(): void {
    this.layout()
    this.changed()
  }

  activeTab(): LiveTab | undefined {
    if (this.cur.peek && !this.cur.peek.tab.destroyed) return this.cur.peek.tab
    const id = this.space.activeItemId
    const tab = id ? this.live.get(id) : undefined
    return tab && !tab.destroyed ? tab : undefined
  }

  liveFor(item: TabItem): LiveTab {
    const existing = this.live.get(item.id)
    if (existing && !existing.destroyed && !existing.crashed) return existing
    existing?.destroy()
    const profileId = profileOfItem(this.state, item.id) ?? this.space.profileId
    const runtime = this.profiles.get(profileId)
    const tab = new LiveTab(this, item.id, profileId, runtime.session, item.url)
    tab.favicon = item.favicon
    this.live.set(item.id, tab)
    this.extensions.addTab(tab, this.window.win)
    return tab
  }

  itemIdFor(wc: WebContents): ID | undefined {
    for (const [id, tab] of this.live) if (tab.wc === wc) return id
    return undefined
  }

  hasItem(id: ID): boolean {
    return !!findItem(this.state, id) || !!findCanvas(this.state, id)
  }

  detachEverywhere(view: View): void {
    for (const window of this.wins) if (window.open) window.main.detach(view)
  }

  dropLive(id: ID): void {
    const tab = this.live.get(id)
    if (!tab) return
    this.media.gone(id)
    this.live.delete(id)
    for (const window of this.wins) {
      if (window.open) window.main.detach(tab.view)
      if (window.fullscreenTab === tab) window.fullscreenTab = undefined
    }
    tab.destroy()
  }

  activate(id: ID, focus = true): void {
    const canvas = findCanvas(this.state, id)
    if (canvas) return this.activateCanvas(id, focus)
    const found = findItem(this.state, id)
    if (!found) return
    this.closePeek()
    let space = this.space
    if (found.loc.kind === 'favorite') {
      const profileId = found.loc.profileId
      if (space.profileId !== profileId) space = this.state.spaces.find((other) => other.profileId === profileId) ?? space
    } else {
      space = this.store.space(found.loc.spaceId) ?? space
    }
    this.state.activeSpaceId = space.id
    space.activeItemId = id
    found.item.lastActive = Date.now()
    this.tabs.used(id)
    const tab = this.liveFor(found.item)
    this.extensions.selectTab(tab)
    this.layout()
    if (focus && this.pageInFront()) tab.wc.focus()
    this.changed()
  }

  private focusWhatIsShown(): void {
    const tab = this.activeTab()
    if (tab) return tab.wc.focus()
    const canvasId = this.space.activeItemId
    if (canvasId && findCanvas(this.state, canvasId)) return this.canvases.page(canvasId).wc.focus()
    this.window.win.webContents.focus()
  }

  private activateCanvas(id: ID, focus = true): void {
    const hit = findCanvas(this.state, id)
    if (!hit) return
    this.closePeek()
    this.state.activeSpaceId = hit.space.id
    hit.space.activeItemId = id
    hit.canvas.lastActive = Date.now()
    const page = this.canvases.page(id)
    this.layout()
    if (focus && this.pageInFront()) page.wc.focus()
    this.changed()
  }

  private syncTrafficLights(): void {
    this.window.setTrafficLights(this.state.settings.sidebarVisible || this.window.overlayMode.kind === 'sidebar', trafficLightsAt(this.frame()))
  }

  private frame(): WindowFrame {
    const settings = this.state.settings
    return {
      size: this.window.size(),
      content: this.cur.layout.content,
      settings,
      sidebarRevealed: !settings.sidebarVisible && this.window.overlayMode.kind === 'sidebar',
      captionHeight: this.window.captionHeight()
    }
  }

  layout(): void {
    const mainWindow = this.window
    if (!mainWindow || mainWindow.win.isDestroyed()) return
    const settings = this.state.settings
    const fullscreen = this.cur.fullscreenTab
    const content = mainWindow.contentRect(settings.sidebarVisible, settings.sidebarWidth, settings.sidebarRight, !!fullscreen)
    this.syncTrafficLights()
    mainWindow.setAppearance(this.space.appearance)
    const views: AppState['layout']['views'] = []
    let splitId: ID | undefined
    if (fullscreen && !fullscreen.destroyed) {
      fullscreen.view.setBorderRadius(0)
      this.show([{ view: fullscreen.view, rect: content }])
      views.push({ id: fullscreen.itemId, rect: content })
    } else {
      const space = this.space
      const active = space.activeItemId && findItem(this.state, space.activeItemId) ? space.activeItemId : undefined
      const canvas = !active && space.activeItemId ? findCanvas(this.state, space.activeItemId) : undefined
      if (canvas) {
        this.show([{ view: this.canvases.page(canvas.canvas.id).stage, rect: content }])
        views.push({ id: canvas.canvas.id, rect: content })
      } else if (!active) {
        this.show([])
      } else {
        const split = splitOf(space.splits, active)
        splitId = split?.id
        const panes = split ? layoutPanes(split.root, content) : [{ id: active, rect: content }]
        const slots = []
        for (const pane of panes) {
          const item = findItem(this.state, pane.id)?.item
          if (!item) continue
          const tab = this.liveFor(item)
          tab.view.setBorderRadius(8)
          if (split) {
            const { x, y, width, height } = pane.rect
            const bar = { x, y, width, height: PANE_BAR }
            const rect = { x, y: y + PANE_BAR, width, height: Math.max(0, height - PANE_BAR) }
            slots.push({ view: tab.view, rect })
            views.push({ id: pane.id, rect, bar })
            tab.sampleBarColor()
          } else {
            slots.push({ view: tab.view, rect: pane.rect })
            views.push(pane)
          }
        }
        this.show(slots)
      }
    }
    this.cur.layout = { content, views, splitId }
    if (this.cur.peek) mainWindow.setTop(this.cur.peek.tab.view, peekRects(content).card)
    const mode = mainWindow.overlayMode.kind === 'peek' ? this.peekMode() : this.placed(mainWindow.overlayMode)
    if (mode.kind !== 'none') mainWindow.setOverlay(mode, overlayRect(mode, this.frame(), !!this.cur.tabDrag))
    this.syncPrompts()
    this.syncMirrors()
    this.media.sync(this.tabsInSight())
    this.emitSoon()
    for (const other of this.wins) if (other !== this.cur && this.waitsForPage(other)) this.inWin(other, () => this.layout())
  }

  private waitsForPage(window: WindowSession): boolean {
    if (!window.open) return false
    return window.layout.views.some((pane) => {
      const view = pane.elsewhere ? this.live.get(pane.id)?.view : undefined
      return !!view && !this.wins.some((other) => other.open && other.main.isShown(view))
    })
  }

  handleInput(event: Event, input: Input): void {
    handleInput(this, event, input)
  }

  runCommand(cmd: CommandId | string): void {
    runCommand(this, cmd)
  }

  dispatch(action: Action): Promise<void> {
    return dispatch(this, action)
  }

  private tabsInSight(): Set<ID> {
    const ids = new Set<ID>()
    for (const window of this.wins) if (window.open) for (const pane of window.layout.views) if (!pane.elsewhere) ids.add(pane.id)
    return ids
  }

  /** A page can be in one window only: one another window shows moves here, and that window shows a still of it. */
  private show(slots: ViewSlot[]): void {
    // A view has one parent: the floating video goes back into its page first.
    this.media.takeBackFloating(slots.map((slot) => slot.view))
    for (const other of this.wins) {
      if (other === this.cur || !other.open) continue
      for (const { view } of slots) if (other.main.isShown(view)) this.lend(other, view)
    }
    this.window.show(slots)
    this.canvases.showing((view) => this.wins.some((window) => window.open && window.main.isShown(view)))
  }

  private lend(window: WindowSession, view: View): void {
    window.main.detach(view)
    const pane = window.layout.views.find((shown) => this.live.get(shown.id)?.view === view)
    if (!pane) return
    pane.elsewhere = true
    const tab = this.live.get(pane.id)!
    // The mirror only sends a frame when the page paints again; a still page needs one now.
    void tab.wc
      .capturePage()
      .then((image) => {
        if (window.open && !image.isEmpty()) window.main.ui.send(IPC.still, { id: pane.id, image: stillOf(image) })
      })
      .catch(() => {})
    this.emitSoon()
  }

  private syncMirrors(): void {
    const pages = new Set<WebContents>()
    for (const window of this.wins) {
      if (!window.open) continue
      for (const pane of window.layout.views) {
        const tab = pane.elsewhere ? this.live.get(pane.id) : undefined
        if (tab && !tab.destroyed) pages.add(tab.wc)
      }
    }
    this.mirror.watch(pages)
  }

  private sendStill(wc: WebContents, image: string): void {
    const id = this.itemIdFor(wc)
    if (!id) return
    for (const window of this.wins) {
      if (window.open && window.layout.views.some((pane) => pane.id === id && pane.elsewhere)) window.main.ui.send(IPC.still, { id, image })
    }
  }

  setOverlay(mode: OverlayMode, refocus = true): void {
    const current = this.window.overlayMode
    if (mode.kind === 'tour') this.tour = mode.step
    else if (this.tour && mode.kind === 'none') {
      const closingCenteredCard = current.kind === 'tour' && !isFloating(current.step)
      if (closingCenteredCard) this.tour = undefined
      else mode = { kind: 'tour', step: this.tour }
    }
    if (current.kind === 'share-picker' && mode.kind !== 'share-picker') this.sharePicker.answer(current.id)
    if (mode.kind !== 'settings') this.recordingShortcut = false
    if (mode.kind !== 'peek') this.dropPeek()
    if (current.kind === 'find' && mode.kind !== 'find') this.activeTab()?.wc.stopFindInPage('keepSelection')
    if (mode.kind !== 'sidebar') this.cur.sidebarReveal = false
    if (mode.kind !== 'sidebar' && mode.kind !== 'split-drop') this.cur.tabDrag = undefined
    this.watchSidebarReveal(mode.kind === 'sidebar' && !this.cur.tabDrag)
    if (mode.kind !== 'switcher') this.cur.switcher = undefined
    if (mode.kind !== 'space-editor' && this.colorPreview?.window === this.cur) this.colorPreview = undefined
    mode = this.placed(mode)
    if (mode.kind !== 'none' && mode.kind !== current.kind) this.window.sendToOverlay(IPC.state, this.snapshot(this.cur, mode))
    this.window.setOverlay(mode, overlayRect(mode, this.frame(), !!this.cur.tabDrag))
    this.syncTrafficLights()
    if (mode.kind === 'none' && refocus) this.focusWhatIsShown()
    if (mode.kind === 'command') this.tourEvent('newTab')
    this.syncPrompts()
    this.emitSoon()
  }

  syncPrompts(): void {
    const queue = this.profiles.permissionQueue
    const canPrompt = this.pagesThatCanPrompt()
    for (const wcId of queue.waitingPages()) {
      if (canPrompt.has(wcId)) continue
      const request = queue.next([wcId])
      if (request) queue.answer(request.id, 'dismiss')
    }
    for (const little of this.openLittles()) little.syncPrompt(queue)
    for (const window of this.wins) if (window.open) this.inWin(window, () => this.syncPrompt())
  }

  private pagesThatCanPrompt(): Set<number> {
    const pages = new Set<number>([...this.live.values()].filter((tab) => !tab.destroyed).map((tab) => tab.wc.id))
    for (const window of this.wins) if (window.peek && !window.peek.tab.destroyed) pages.add(window.peek.tab.wc.id)
    for (const little of this.openLittles()) if (little.pageId !== undefined) pages.add(little.pageId)
    return pages
  }

  private syncPrompt(): void {
    const queue = this.profiles.permissionQueue
    const mainWindow = this.window
    if (!mainWindow.prompt || mainWindow.win.isDestroyed()) return
    const kind = mainWindow.overlayMode.kind
    if (kind !== 'none' && kind !== 'sidebar' && kind !== 'find' && kind !== 'peek') return mainWindow.prompt.show(undefined)
    mainWindow.prompt.show(queue.next(this.pagesOnScreen()), promptAnchor(this.frame(), !!this.cur.fullscreenTab))
  }

  private pagesOnScreen(): number[] {
    const ids: number[] = []
    if (this.cur.peek && !this.cur.peek.tab.destroyed) ids.push(this.cur.peek.tab.wc.id)
    const active = this.space.activeItemId
    const activeFirst = [...this.cur.layout.views.map((pane) => pane.id)].sort((first, second) => Number(second === active) - Number(first === active))
    for (const id of activeFirst) {
      const tab = this.live.get(id)
      if (tab && !tab.destroyed && this.window.isShown(tab.view)) ids.push(tab.wc.id)
    }
    return ids
  }

  private answerPrompt(id: string, answer: 'allow' | 'deny' | 'dismiss'): void {
    this.profiles.permissionQueue.answer(id, answer)
    if (!this.window.prompt?.visible && this.window.overlayMode.kind === 'none') this.activeTab()?.wc.focus()
  }

  private watchSidebarReveal(on: boolean): void {
    const window = this.cur
    clearTimeout(window.sidebarRevealHide)
    window.sidebarRevealHide = undefined
    if (!on) return window.main.watchPointer(undefined)
    window.main.watchPointer((pointer) => {
      const settings = this.state.settings
      const reach = settings.sidebarWidth + PAD + SIDEBAR_REVEAL_GRACE_PX
      if (settings.sidebarRight ? pointer.x >= window.main.size().width - reach : pointer.x <= reach) {
        clearTimeout(window.sidebarRevealHide)
        window.sidebarRevealHide = undefined
      } else {
        window.sidebarRevealHide ??= setTimeout(() => this.inWin(window, () => this.setOverlay({ kind: 'none' }, false)), SIDEBAR_REVEAL_HIDE_DELAY_MS)
      }
    })
  }

  private swipeTarget(page: WebContents): SwipeTarget | undefined {
    const tab = [...this.live.values()].find((live) => live.wc === page && !live.destroyed)
    const window = tab && this.wins.find((candidate) => candidate.open && candidate.main.isShown(tab.view))
    if (!tab || !window) return undefined
    return { tab, window, relayout: () => this.inWin(window, () => this.layout()) }
  }

  openPeek(profileId: ID, url: string): void {
    this.dropPeek()
    this.cur.peek = new Peek(this, this.profiles.get(profileId), url)
    this.window.setTop(this.cur.peek.tab.view, peekRects(this.cur.layout.content).card)
    this.setOverlay(this.peekMode())
    this.cur.peek.tab.wc.focus()
  }

  closePeek(): void {
    if (this.window.overlayMode.kind === 'peek') this.setOverlay({ kind: 'none' })
    else this.dropPeek()
  }

  expandPeek(split = false): void {
    const peek = this.cur.peek
    if (!peek || peek.tab.destroyed) return
    this.cur.peek = undefined
    this.window.setTop(undefined)
    this.setOverlay({ kind: 'none' }, false)
    const id = this.tabs.takeInAsTodayTab(peek.release(), this.space)
    if (split) this.splits.splitWith(id)
    else this.activate(id)
  }

  private dropPeek(): void {
    const peek = this.cur.peek
    if (!peek) return
    this.cur.peek = undefined
    if (!this.window.win.isDestroyed()) this.window.setTop(undefined)
    peek.destroy()
    this.emitSoon()
  }

  private placed(mode: OverlayMode): OverlayMode {
    if (mode.kind !== 'command') return mode
    const place = commandBarPlace(this.frame())
    const unmoved = mode.place && mode.place.x === place.x && mode.place.y === place.y && mode.place.width === place.width
    return unmoved ? mode : { ...mode, place }
  }

  private peekMode(): OverlayMode {
    return { kind: 'peek', card: peekRects(this.cur.layout.content).local }
  }

  onPeekChanged(tab: LiveTab, change: { url?: string; navigated?: boolean }): void {
    if (change.navigated && change.url) this.recordHistory(tab, (history) => history.visit(change.url!, tab.wc.getTitle()))

    this.emitSoon()
  }

  onPopupBlocked(tab: LiveTab, url: string): void {
    if (this.winOf(tab) !== this.cur) return
    this.toast(`Blocked a pop-up from ${hostOf(tab.wc.getURL()) || 'this page'}${hostOf(url) ? ` to ${hostOf(url)}` : ''}`)
  }

  interceptLink(tab: LiveTab, url: string): boolean {
    if (!this.state.settings.peekPinnedLinks || !/^https?:/i.test(url)) return false
    const found = findItem(this.state, tab.itemId)
    if (!found || found.loc.kind === 'today' || sameSite(tab.wc.getURL(), url)) return false
    this.openPeek(tab.profileId, url)
    return true
  }

  peekLink(tab: LiveTab, url: string): boolean {
    if (!/^https?:/i.test(url) || tab.host !== this) return false
    this.openPeek(tab.profileId, url)
    return true
  }

  setTabDrag(id: ID | undefined): void {
    if (id === this.cur.tabDrag) return
    const kind = this.window.overlayMode.kind
    if (id) {
      if (this.panelInFront()) return
      this.cur.tabDrag = id
      this.setOverlay(kind === 'sidebar' ? { kind: 'sidebar' } : { kind: 'split-drop' }, false)
    } else {
      this.cur.tabDrag = undefined
      if (kind === 'split-drop') this.setOverlay({ kind: 'none' }, false)
      else if (kind === 'sidebar') this.setOverlay({ kind: 'sidebar' }, false)
      else this.emitSoon()
    }
  }

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
      this.recordHistory(tab, (history) => history.setTitle(tab.wc.getURL(), change.title!))
    }
    if (change.favicon && change.favicon !== item.favicon) {
      item.favicon = change.favicon
      persist = true
    }
    if (change.navigated && change.url) {
      this.recordHistory(tab, (history) => history.visit(change.url!, tab.wc.getTitle()))
      this.adblock.resetCount(tab.wc)
    }
    if (persist) this.store.save()
    this.media.pageChanged(tab.itemId, change.navigated)
    this.emitSoon()
  }

  onTabDestroyed(tab: LiveTab): void {
    if (this.live.get(tab.itemId) !== tab) return
    this.media.gone(tab.itemId)
    const found = findItem(this.state, tab.itemId)
    if (found?.loc.kind === 'today') this.tabs.close(tab.itemId)
    else {
      this.live.delete(tab.itemId)
      this.layout()
      this.emitSoon()
    }
  }

  private recordHistory(tab: LiveTab, write: (history: ProfileRuntime['history']) => void): void {
    if (this.quitting) return
    try {
      write(this.profiles.get(tab.profileId).history)
    } catch (err) {
      console.warn('[history]', (err as Error).message)
    }
  }

  onTabInput(tab: LiveTab, event: Event, input: Input): void {
    this.use(this.winOf(tab))
    this.handleInput(event, input)
  }

  onTabFocus(tab: LiveTab): void {
    this.use(this.winOf(tab))
    const space = this.space
    if (space.activeItemId === tab.itemId) return
    const split = splitOf(space.splits, tab.itemId)
    if (split && paneIds(split.root).includes(space.activeItemId ?? '')) {
      space.activeItemId = tab.itemId
      this.tabs.used(tab.itemId)
      this.changed()
    }
  }

  newCanvas(): void {
    if (this.incognito) return this.toast('Canvases aren’t available in incognito windows')
    const canvas = this.canvases.create(this.space)
    this.activate(canvas.id)
    if (this.state.settings.sidebarVisible) this.window.ui.send(IPC.edit, { kind: 'renameCanvas', id: canvas.id })
  }

  startCapture(): void {
    if (this.incognito) return this.toast('Canvases aren’t available in incognito windows')
    const tab = this.activeTab()
    const pane = tab && !this.cur.peek ? this.cur.layout.views.find((shown) => shown.id === tab.itemId && !shown.elsewhere) : undefined
    if (!tab || !pane) return this.toast('Open a page to capture part of it')
    const content = this.cur.layout.content
    this.setOverlay({ kind: 'capture', page: { x: pane.rect.x - content.x, y: pane.rect.y - content.y, width: pane.rect.width, height: pane.rect.height } })
  }

  onTabFullscreen(tab: LiveTab, on: boolean): void {
    this.use(this.winOf(tab))
    this.cur.fullscreenTab = on ? tab : undefined
    const win = this.window.win
    if (on !== win.isFullScreen()) win.setFullScreen(on)
    this.layout()
    // A page in full screen could draw a fake browser or system: say whose page it is and how to leave.
    if (on && this.pageInFront()) {
      const site = hostOf(tab.wc.getURL())
      this.showNotice(`${site ? `${site} is` : 'This page is'} in full screen · Press Esc to exit`, 3500)
    } else if (!on && this.window.overlayMode.kind === 'notice') this.setOverlay({ kind: 'none' }, false)
  }

  onFoundInPage(tab: LiveTab, result: Result): void {
    this.winOf(tab).main.sendToOverlay(IPC.find, { matches: result.matches, active: result.activeMatchOrdinal })
  }

  adoptOpenedPage(opener: LiveTab, options: BrowserWindowConstructorOptions | undefined, disposition: OpenDisposition, url: string): WebContents {
    this.use(this.winOf(opener))
    const openerItem = findItem(this.state, opener.itemId)
    const spaceId = openerItem && openerItem.loc.kind !== 'favorite' ? openerItem.loc.spaceId : this.space.id
    const space = this.store.space(spaceId)!
    const item: TabItem = { id: newId(), url, title: url, lastActive: Date.now() }
    space.today.unshift(item)
    let tab: LiveTab
    if (options) {
      tab = new LiveTab(this, item.id, opener.profileId, opener.session, undefined, adoptedTabView(options))
    } else {
      tab = new LiveTab(this, item.id, opener.profileId, opener.session, url)
    }
    this.live.set(item.id, tab)
    this.extensions.addTab(tab, this.window.win)
    if (disposition === 'background-tab') this.changed()
    else setImmediate(() => this.activate(item.id))
    return tab.wc
  }

  showContextMenu(tab: LiveTab, params: ContextMenuParams): void {
    this.use(this.winOf(tab))
    buildContextMenu(this, tab, params).popup({ window: this.window.win })
  }

  openLittle(url?: string, profileId = this.littleProfile(url), bounds?: Rectangle): LittleWindow {
    const little = new LittleWindow(this, this.profiles.get(profileId), url, bounds)
    this.tourEvent('littleArc')
    this.littles.add(little)
    little.win.on('closed', () => this.littles.delete(little))
    return little
  }

  private littleProfile(url?: string): ID {
    const known = (id: ID | undefined) => (id && this.store.profile(id) ? id : undefined)
    return known(this.state.littleArc.profileByHost[hostOf(url ?? '')]) ?? known(this.state.settings.littleArcProfileId) ?? this.space.profileId
  }

  archiveLittle(page: Pick<TabItem, 'url' | 'title' | 'favicon'>, spaceId: ID): void {
    this.tabs.archiveClosed(page, spaceId)
    this.changed()
    // Little Windows close after the state was written for quitting.
    if (this.quitting) this.store.flush()
  }

  private closeIdleLittles(): void {
    const now = Date.now()
    for (const little of this.openLittles()) if (little.expired(now, this.state.settings.littleCloseAfterHours)) little.win.close()
  }

  adoptTab(tab: LiveTab, space: Space): void {
    this.extensions.moveTab(tab, this.window.win)
    tab.host = this
    this.activate(this.tabs.takeInAsTodayTab(tab, space))
    this.focusWindow()
  }

  /** Links opened from other apps. */
  openExternalUrl(url: string): void {
    if (!/^https?:|^file:/i.test(url)) return
    const route = routeFor(this.state.settings.linkRoutes, url)
    const space = route && this.store.space(route.spaceId)
    if (!space && this.state.settings.littleArcForExternalLinks) return void this.openLittle(url)
    this.ensureWindow()
    if (space && space.id !== this.state.activeSpaceId) this.spaces.switchSpace(space.id)
    this.tabs.newTab(url)
    this.focusWindow()
  }

  private winFor(wc: WebContents): WindowSession | undefined {
    return this.wins.find((window) => window.open && (window.main.ui === wc || window.main.overlay.webContents === wc))
  }

  windowOf(wc: WebContents): MainWindow | undefined {
    return this.winFor(wc)?.main
  }

  private ownsLittle(wc: WebContents): boolean {
    return this.openLittles().some((little) => little.win.webContents === wc)
  }

  /** Whether an IPC sender is one of this controller's views; its window becomes the current one. */
  takes(sender: WebContents): boolean {
    const window = this.winFor(sender)
    if (window) this.use(window)
    return !!window || this.ownsLittle(sender)
  }

  makeDefaultBrowser(): void {
    if (!becomeDefaultBrowser() && !app.isPackaged) this.toast('Install YARC first, then pick it in Default apps')
  }

  private quitting = false

  shutdown(): void {
    this.quitting = true
    this.historySync?.shutdown()
    this.store.flush()
    this.profiles.closeAll()
  }

  ensureWindow(): void {
    if (!this.cur?.open) this.openWindow()
  }

  focusWindow(): void {
    if (!this.cur?.open) return void this.openWindow()
    const win = this.cur.main.win
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

function short(id: ID): string {
  return id.slice(0, 8)
}
