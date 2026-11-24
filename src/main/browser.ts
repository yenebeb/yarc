import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  screen,
  shell,
  WebContentsView,
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
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Action, DropTarget } from '../shared/actions'
import { IPC, type LittleAnchor, type LittleOp } from '../shared/ipc'
import { commandForInput, type CommandId } from '../shared/keymap'
import { cleanLiveSource, liveFolderName } from '../shared/live-folders'
import { containsNode, findCanvas, findFolder, findInPinned, findItem, profileOfItem, spaceCanvases, spaceItems, stripKind, walkPinned } from '../shared/tree'
import type {
  AppState,
  ExtensionInfo,
  ID,
  LiveSource,
  OverlayMode,
  PinnedNode,
  PinnedTab,
  Rect,
  Space,
  Split,
  SplitAt,
  TabItem,
  WindowView
} from '../shared/types'
import { appendPaneIn, flipSplit, gatherSplit, layoutPanes, movePane, PANE_BAR, paneIds, placePaneIn, removeFromSplits, resizeGroup, splitOf, type Side } from '../shared/split'
import { isFloating, nextStep, stepAfter, type TourEvent, type TourStep } from '../shared/tour'
import { routeFor } from '../shared/link-routes'
import { validSettingsPatch } from '../shared/settings'
import { hostOf, resolveInput } from '../shared/url'
import { AdBlock } from './adblock'
import { bookmarksHtml } from './bookmarks-export'
import { Canvases } from './canvas'
import { recentSpotlights, SPOTLIGHTS, unseenSpotlights } from '../shared/spotlights'
import { recentChanges, startupScreen, type Changelog } from './changelog'
import { openInChrome } from './chrome'
import { DownloadList } from './download-list'
import { Extensions } from './extensions'
import { importChoices, ImportScan, runImport } from './importers'
import { FLOATING_DEMO_URL } from './floating-demo'
import { FloatingPlayer, type FloatAnchor, type FloatingHost } from './floating-player'
import { LittleWindow } from './little'
import { LiveFolders } from './live-folders'
import { logInfo, logProblem, setLogContext } from './log'
import { pauseMedia, probeMedia, toggleMedia } from './media-page'
import * as mediaState from './media-state'
import type { LeftWith, MediaState } from './media-state'
import { Mirror, stillOf } from './mirror'
import { runPageAction } from './page-actions'
import { Peek, sameSite } from './peek'
import { buildAppMenu, buildCanvasMenu, buildContextMenu, buildFolderMenu, buildItemMenu, buildSpaceMenu, buildSplitMenu } from './menus'
import { Profiles, type ProfileRuntime } from './profiles'
import { PROMPT_WIDTH, PromptView, type PromptAnchor } from './prompt-view'
import { search, suggest } from './search'
import { SharePicker } from './share-picker'
import { incognitoState, MAX_ARCHIVE, newId, SPACE_COLORS, Store } from './store'
import { LiveTab, type OpenDisposition, type TabHost } from './tab'
import { handleUi, onUi } from './ui-origin'
import { Updater } from './updater'
import { MainWindow, PAD, TRAFFIC_LIGHTS, TRAFFIC_LIGHTS_WIDTH, type ViewSlot } from './window'
import { applyView, captureView, cascade, inAnyView, newView, stateForView, viewFromState } from './window-state'

const isMac = process.platform === 'darwin'

// Defined by electron.vite.config.ts from build/changelog.json; empty outside release builds.
declare const __CHANGELOG__: Changelog
const CHANGELOG: Changelog = __CHANGELOG__
const UNLOAD_HIDDEN_AFTER = 3600_000
const HOUSEKEEPING_EVERY = 5 * 60_000
// Slack past the revealed sidebar's edge: room to grab it to resize, and no enter/leave flicker at the screen's edge.
const SIDEBAR_REVEAL_GRACE_PX = 32
const SIDEBAR_REVEAL_HIDE_DELAY_MS = 300
// Chromium still reports a tab audible for a moment after its media paused; only sound that lasts gets a card.
const AUDIBLE_SETTLE_MS = 500
// Sidebar geometry, kept in step with styles.css.
const SIDEBAR_PAD = 8
const FLOATING_SIDEBAR_INSET = 4
const TOP_BAR_HEIGHT = 32
const URL_FIELD_GAP = 6
const URL_FIELD_HEIGHT = 36

const COMMAND_ACTIONS: Partial<Record<CommandId, Action>> = {
  newTab: { type: 'overlay', mode: { kind: 'command', target: 'tab' } },
  splitAdd: { type: 'overlay', mode: { kind: 'command', target: 'split' } },
  find: { type: 'overlay', mode: { kind: 'find' } },
  history: { type: 'overlay', mode: { kind: 'library', tab: 'history' } },
  downloads: { type: 'overlay', mode: { kind: 'library', tab: 'downloads' } },
  library: { type: 'overlay', mode: { kind: 'library', tab: 'archive' } },
  settings: { type: 'overlay', mode: { kind: 'settings' } },
  trafficControl: { type: 'overlay', mode: { kind: 'settings', section: 'traffic' } },
  newSpace: { type: 'overlay', mode: { kind: 'space-editor' } },
  tour: { type: 'overlay', mode: { kind: 'tour', step: 'welcome' } },
  toggleSidebar: { type: 'toggleSidebar' },
  copyUrl: { type: 'copyUrl' },
  copyUrlMarkdown: { type: 'copyUrl', markdown: true },
  littleArc: { type: 'littleArc' },
  reopenClosed: { type: 'reopenClosed' },
  clearToday: { type: 'clearToday' },
  nextSpace: { type: 'switchSpaceRelative', delta: 1 },
  prevSpace: { type: 'switchSpaceRelative', delta: -1 },
  splitClose: { type: 'unsplit' },
  devtools: { type: 'devtools' },
  reload: { type: 'reload' },
  hardReload: { type: 'reload', hard: true },
  stop: { type: 'stop' },
  back: { type: 'back' },
  forward: { type: 'forward' },
  zoomIn: { type: 'zoom', delta: 1 },
  zoomOut: { type: 'zoom', delta: -1 },
  zoomReset: { type: 'zoom', delta: 0 },
  newFolder: { type: 'newFolder' },
  newLiveFolder: { type: 'overlay', mode: { kind: 'live-folder' } },
  openInChrome: { type: 'openInChrome' },
  importArc: { type: 'import', source: 'arc' },
  importZen: { type: 'import', source: 'zen' },
  importChrome: { type: 'import', source: 'chrome' },
  exportBookmarks: { type: 'exportBookmarks' },
  extensions: { type: 'extensionsStore' }
}

interface ClosedTab {
  url: string
  title: string
  spaceId: ID
}

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

export class Browser implements TabHost, FloatingHost {
  readonly store: Store
  readonly profiles: Profiles
  readonly extensions: Extensions
  readonly adblock: AdBlock
  readonly updater: Updater
  readonly main: Browser | undefined
  private wins: WindowSession[] = []
  /** The window commands act on; after the last window closes on macOS it stays, closed. */
  private cur!: WindowSession
  private reportedLost: WindowSession | undefined
  readonly live = new Map<ID, LiveTab>()
  readonly canvases = new Canvases(this)
  private readonly liveFolders = new LiveFolders(this)
  private media: MediaState = mediaState.emptyMedia()
  /** The space editor's unsaved colors; no `spaceId` is a new space, shown on its window's current one. */
  private colorPreview: { w: WindowSession; spaceId?: ID; color: string; color2?: string } | undefined
  private readonly floating = new FloatingPlayer(this)
  private onScreen = new Set<ID>()
  private videoTabs = new Set<ID>()
  private hiddenSince = new Map<ID, number>()
  private mirror = new Mirror((wc, still) => this.sendStill(wc, still))
  private mru: ID[] = []
  private recordingShortcut = false
  private closedTabs: ClosedTab[] = []
  readonly downloads = new DownloadList({
    toast: (text) => this.toast(text),
    startedByPage: (page) => [...this.live.values()].some((t) => t.wc === page && !t.userActivated),
    changed: () => this.emitSoon(),
    progressed: () => this.emitSlowly()
  })
  extensionList: Record<ID, ExtensionInfo[]> = {}
  private emitTimer: NodeJS.Timeout | undefined
  private slowEmitTimer: NodeJS.Timeout | undefined
  readonly littles = new Set<LittleWindow>()

  /** Read this, not `littles`: Electron marks a closing window destroyed before 'closed' takes it off the list. */
  openLittles(): LittleWindow[] {
    return [...this.littles].filter((l) => !l.win.isDestroyed())
  }
  private tour: TourStep | undefined
  private readonly imports = new ImportScan(() => this.emitSoon())
  private legacyWindowFile: string | undefined
  private static readonly all = new Set<Browser>()

  /** Pass `main` for an incognito window: state and history in memory, no extensions, all gone when it closes. */
  constructor(main?: Browser) {
    this.main = main
    this.extensions = new Extensions(this)
    this.profiles = new Profiles((rt) => this.onProfileCreated(rt), !!main, () => this.syncPrompts())
    if (main) {
      this.store = new Store(undefined, incognitoState(main.state.settings))
      this.adblock = main.adblock
      this.updater = main.updater
      return
    }
    const userData = app.getPath('userData')
    this.store = new Store(join(userData, 'state.json'))
    this.legacyWindowFile = join(userData, 'window.json')
    // engine.bin was built from Ghostery's stale copies of the lists.
    void rm(join(userData, 'adblock', 'engine.bin'), { force: true })
    this.adblock = new AdBlock(join(userData, 'adblock', 'lists.bin'), () => this.emitSlowly())
    this.updater = new Updater(this)
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
    const b = new Browser(main)
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

  /** Call before start(), so pages load with last run's session cookies. Waits a second at most. */
  async restoreSessions(): Promise<void> {
    const restored = this.profiles.restoreSessionCookies(this.state.profiles.map((p) => p.id))
    await Promise.race([restored, sleep(1000)])
  }

  start(): void {
    Browser.all.add(this)
    if (Browser.all.size === 1) {
      this.registerIpc()
      setLogContext(() => [...Browser.all].map((b) => b.describeWindows()).join('; '))
    }
    this.store.beforeWrite = () => this.captureCurrent()
    const saved = this.state.windows
    if (!saved.length) saved.push({ ...viewFromState(this.state, newId()), ...this.legacyBounds() })
    const lastFocused = saved[saved.length - 1]
    saved.forEach((view) => this.openWindow(view, view !== lastFocused))
    if (this.incognito) return
    setInterval(() => {
      this.autoArchive()
      this.unloadHiddenTabs()
      this.closeIdleLittles()
    }, HOUSEKEEPING_EVERY)
    this.autoArchive()
    this.liveFolders.start()
    this.updater.sync()
    this.showStartupScreen()
  }

  private showStartupScreen(): void {
    const current = app.getVersion()
    const unseen = unseenSpotlights(SPOTLIGHTS, this.state.seenSpotlights)
    const intro = startupScreen(this.store.firstRun, this.state.lastSeenVersion, current, CHANGELOG, unseen)
    if (this.state.lastSeenVersion !== current || unseen.length) {
      this.state.lastSeenVersion = current
      this.state.seenSpotlights = [...new Set([...(this.state.seenSpotlights ?? []), ...unseen])]
      this.changed()
    }
    const plainWindowForTests = process.env.YARC_TEST && !process.env.YARC_STARTUP_SCREENS
    if (intro.kind === 'none' || plainWindowForTests) return
    const mode: OverlayMode = intro.kind === 'welcome' ? { kind: 'tour', step: 'welcome' } : intro
    const win = this.window.win
    if (win.isVisible()) this.setOverlay(mode)
    else win.once('show', () => this.setOverlay(mode))
  }

  private tourEvent(event: TourEvent): void {
    const step = this.tour
    if (!step) return
    const next = stepAfter(step, event)
    if (next === step) return
    this.tour = next
    const kind = this.window.overlayMode.kind
    const cardCanShow = kind === 'tour' || kind === 'none'
    if (cardCanShow) this.setOverlay({ kind: 'tour', step: next }, false)
  }

  private pageInFront(): boolean {
    const mode = this.window.overlayMode
    return mode.kind === 'none' || mode.kind === 'notice' || (mode.kind === 'tour' && isFloating(mode.step))
  }

  private panelInFront(): boolean {
    return !this.pageInFront() && this.window.overlayMode.kind !== 'sidebar'
  }

  private unopenedOrNewView(): WindowView {
    const unopened = this.state.windows.find((v) => !this.wins.some((w) => w.view === v))
    if (unopened) return unopened
    const view = viewFromState(this.state, newId())
    this.state.windows.push(view)
    return view
  }

  openWindow(view = this.unopenedOrNewView(), background = false): WindowSession {
    const w = new WindowSession(new MainWindow(view.bounds, background), view)
    this.wins.push(w)
    logInfo(`${this.incognito ? 'incognito ' : ''}window ${short(view.id)} opened`)
    this.use(w)
    const win = w.main.win
    if (view.maximized) win.maximize()
    this.syncTrafficLights()
    const onInput = (e: Event, input: Input): void => {
      this.use(w)
      this.handleInput(e, input)
    }
    for (const wc of [win.webContents, w.main.overlay.webContents]) wc.on('before-input-event', onInput)
    w.main.prompt = new PromptView(
      win,
      (id, answer) => {
        this.use(w)
        this.answerPrompt(id, answer)
      },
      onInput
    )
    win.on('focus', () => {
      this.use(w)
      this.saveAsLastFocused(w)
      // Takes back the pages it shares with other windows.
      this.layout()
    })
    // The reveal hides when the pointer leaves it, but a pointer over another app sends this window no moves.
    win.on('blur', () =>
      this.inWin(w, () => {
        if (w.sidebarReveal && !w.tabDrag && w.main.overlayMode.kind === 'sidebar') this.setOverlay({ kind: 'none' }, false)
      })
    )
    win.on('resize', () =>
      this.inWin(w, () => {
        this.layout()
        this.saveBounds(w)
      })
    )
    win.on('move', () => this.saveBounds(w))
    const stepHistory = (step: 'back' | 'forward') => this.inWin(w, () => void this.dispatch({ type: step }))
    win.on('swipe', (_e, direction) => {
      if (direction === 'left') stepHistory('back')
      if (direction === 'right') stepHistory('forward')
    })
    win.on('app-command', (_e, command) => {
      if (command === 'browser-backward') stepHistory('back')
      if (command === 'browser-forward') stepHistory('forward')
    })
    for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
      win.on(ev as 'maximize', () =>
        this.inWin(w, () => {
          this.layout()
          this.emit()
          this.saveBounds(w)
        })
      )
    }
    // Detach the pages before the window goes, so they stay alive for the other windows.
    win.on('close', () => {
      w.main.show([])
      w.main.setTop(undefined)
    })
    win.on('closed', () => this.onWindowClosed(w))
    win.webContents.once('did-finish-load', () => this.emit())
    // A page taking the keyboard doesn't blur the sidebar's focused element (a rename field), so tell it.
    for (const wc of [win.webContents, w.main.overlay.webContents]) wc.on('blur', () => !wc.isDestroyed() && wc.send(IPC.blur))
    w.main.overlay.webContents.on('blur', () => {
      if (!w.open) return
      const k = w.main.overlayMode.kind
      if (k !== 'command' && k !== 'switcher') return
      // Windows blurs the overlay whenever a page finishes loading: hand the keyboard back; only leaving the window closes these panels.
      setTimeout(() => {
        if (!w.open || w.main.overlayMode.kind !== k) return
        if (win.isFocused()) w.main.overlay.webContents.focus()
        else this.inWin(w, () => this.setOverlay({ kind: 'none' }, false))
      }, 50)
    })
    const active = this.space.activeItemId
    if (active && this.hasItem(active)) this.activate(active)
    else this.layout()
    return w
  }

  openNewWindow(): void {
    if (this.main) return this.main.openNewWindow()
    this.useFocused()
    const from = this.cur?.open ? this.cur.main.win.getNormalBounds() : undefined
    const bounds = from ? cascade(from, screen.getDisplayMatching(from).workArea) : undefined
    const view = newView(newId(), this.state.activeSpaceId, bounds)
    this.state.windows.push(view)
    const w = this.openWindow(view)
    this.store.save()
    // Showing moves the focus, which would close a command bar opened before.
    w.main.win.once('show', () => this.inWin(w, () => this.runCommand('newTab')))
  }

  private onWindowClosed(w: WindowSession): void {
    this.wins = this.wins.filter((x) => x !== w)
    logInfo(`${this.incognito ? 'incognito ' : ''}window ${short(w.view.id)} closed, ${this.wins.length} left`)
    clearTimeout(w.sidebarRevealHide)
    if (this.colorPreview?.w === w) this.colorPreview = undefined
    w.peek?.destroy()
    w.peek = undefined
    if (this.wins.length) {
      if (!this.quitting) this.state.windows = this.state.windows.filter((v) => v !== w.view)
      if (this.cur === w) this.use(this.wins[this.wins.length - 1])
      for (const other of this.wins) if (this.waitsForPage(other)) this.inWin(other, () => this.layout())
      this.syncMirrors()
      this.store.save()
      return this.emitSoon()
    }
    this.floating.release()
    this.media = mediaState.emptyMedia()
    this.onScreen.clear()
    for (const t of this.live.values()) t.destroy()
    this.live.clear()
    if (this.incognito) this.dispose()
  }

  /** Makes `w` current: the state's per-window fields become its own (window-state.ts). */
  private use(w: WindowSession): void {
    if (w === this.cur) return
    if (!w.open && this.wins.length) logProblem(`window ${short(w.view.id)} made current after it closed`)
    if (this.cur) captureView(this.state, this.cur.view)
    this.cur = w
    applyView(this.state, w.view)
  }

  private inWin(w: WindowSession, fn: () => void): void {
    const prev = this.cur
    this.use(w)
    try {
      fn()
    } finally {
      if (prev !== w && prev.open) this.use(prev)
    }
  }

  useFocused(): void {
    const focused = BrowserWindow.getFocusedWindow()
    const w = this.wins.find((x) => x.main.win === focused)
    if (w) this.use(w)
  }

  private captureCurrent(): void {
    if (!this.cur) return
    const curViewLost = this.wins.length > 0 && (!this.cur.open || !this.state.windows.includes(this.cur.view))
    if (curViewLost && this.reportedLost !== this.cur) logProblem(`saving while the current window ${short(this.cur.view.id)} is closed or not saved`)
    this.reportedLost = curViewLost ? this.cur : undefined
    captureView(this.state, this.cur.view)
  }

  private describeWindows(): string {
    const cur = this.cur
    const flags = cur ? `${cur.open ? '' : ' (closed)'}${this.state.windows.includes(cur.view) ? '' : ' (not saved)'}` : ''
    const ids = (list: { id: ID }[]) => list.map((v) => short(v.id)).join(', ')
    return `${this.incognito ? 'incognito' : 'main'}: current ${cur ? short(cur.view.id) + flags : 'none'}, open [${ids(this.wins.map((w) => w.view))}], saved [${ids(this.state.windows)}]`
  }

  private saveAsLastFocused(w: WindowSession): void {
    const list = this.state.windows
    const i = list.indexOf(w.view)
    if (i < 0 || i === list.length - 1) return
    list.splice(i, 1)
    list.push(w.view)
    this.store.save()
  }

  private winOf(tab: LiveTab): WindowSession {
    return this.wins.find((w) => w.peek?.tab === tab || (w.open && w.main.isShown(tab.view))) ?? this.cur
  }

  isMainWindow(win: BaseWindow): boolean {
    return this.wins.some((w) => w.main.win === win)
  }

  private dispose(): void {
    Browser.all.delete(this)
    for (const l of this.openLittles()) l.discard()
    for (const rt of this.profiles.all()) void rt.session.clearData()
    this.profiles.closeAll()
  }

  private saveBounds(w: WindowSession): void {
    const win = w.main.win
    if (win.isDestroyed() || win.isFullScreen()) return
    w.view.bounds = win.getNormalBounds()
    w.view.maximized = win.isMaximized()
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

  private readonly sharePicker = new SharePicker((mode, page) => {
    const tab = page && [...this.live.values()].find((t) => t.wc === page)
    if (tab) this.use(this.winOf(tab))
    this.setOverlay(mode)
  })

  private onProfileCreated(rt: ProfileRuntime): void {
    this.downloads.watch(rt.session, rt.id)
    rt.session.setDisplayMediaRequestHandler((req, reply) => void this.sharePicker.pick(req, reply), { useSystemPicker: true })
    this.adblock.attach(rt.session)
    if (!this.incognito) void this.extensions.setup(rt)
  }

  snapshot(w: WindowSession = this.cur, mode = w.main.overlayMode): AppState {
    return this.withPanelData(this.snapshotWith(w, this.liveInfo()), mode)
  }

  private withPanelData(snap: AppState, mode: OverlayMode): AppState {
    if (mode.kind === 'library') return { ...snap, archive: this.state.archive }
    if (mode.kind === 'settings') return { ...snap, sitePermissions: Object.fromEntries(this.state.profiles.map((p) => [p.id, this.profiles.decisions(p.id).list()])) }
    if (mode.kind === 'tour' && mode.step === 'import') return { ...snap, importChoices: this.imports.rows() }
    return snap
  }

  private liveInfo(): AppState['live'] {
    const live: AppState['live'] = {}
    for (const [id, t] of this.live) {
      if (t.destroyed) continue
      const info = t.info()
      info.blocked = this.adblock.count(t.wc)
      info.shielded = this.adblock.enabled && !this.adblock.isAllowed(info.url)
      live[id] = info
    }
    return live
  }

  private snapshotWith(w: WindowSession, live: AppState['live']): AppState {
    const win = w.main.win
    const open = !win.isDestroyed()
    const mode = w.main.overlayMode
    return {
      ...this.withColorPreview(w, w === this.cur ? this.state : stateForView(this.state, w.view)),
      live,
      downloads: this.downloads.items,
      extensions: this.extensionList,
      platform: process.platform,
      maximized: open && win.isMaximized(),
      fullscreen: open && win.isFullScreen(),
      sidebarReveal: w.sidebarReveal,
      tabDrag: w.tabDrag,
      newTabOpen: mode.kind === 'command' && (mode.target ?? 'tab') === 'tab',
      peek: w.peek && !w.peek.tab.destroyed ? w.peek.tab.info() : undefined,
      layout: w.layout,
      update: this.updater.status,
      archive: [],
      sitePermissions: {},
      media: { cards: [...this.media.cards], floating: this.media.floating, videos: this.media.cards.filter((id) => this.videoTabs.has(id)) }
    }
  }

  private withColorPreview<T extends { activeSpaceId: ID; spaces: Space[] }>(w: WindowSession, state: T): T {
    const p = this.colorPreview
    const id = p && (p.spaceId ?? (p.w === w ? state.activeSpaceId : undefined))
    if (!id) return state
    return { ...state, spaces: state.spaces.map((s) => (s.id === id ? { ...s, color: p.color, color2: p.color2 } : s)) }
  }

  emit(): void {
    clearTimeout(this.emitTimer)
    clearTimeout(this.slowEmitTimer)
    this.emitTimer = this.slowEmitTimer = undefined
    const live = this.liveInfo()
    for (const w of this.wins) {
      if (!w.open) continue
      const snap = this.snapshotWith(w, live)
      w.main.ui.send(IPC.state, snap)
      const mode = w.main.overlayMode
      if (mode.kind !== 'none') w.main.sendToOverlay(IPC.state, this.withPanelData(snap, mode))
    }
  }

  emitSoon(): void {
    this.emitTimer ??= setTimeout(() => this.emit(), 30)
  }

  private emitSlowly(): void {
    this.slowEmitTimer ??= setTimeout(() => this.emit(), 1000)
  }

  emitAll(): void {
    for (const b of Browser.all) b.emitSoon()
  }

  toast(text: string): void {
    const win = this.window?.win
    if (win && !win.isDestroyed()) win.webContents.send(IPC.toast, text)
  }

  changed(): void {
    this.store.save()
    this.emitSoon()
  }

  private relayout(): void {
    this.layout()
    this.changed()
  }

  activeTab(): LiveTab | undefined {
    if (this.cur.peek && !this.cur.peek.tab.destroyed) return this.cur.peek.tab
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

  private hasItem(id: ID): boolean {
    return !!findItem(this.state, id) || !!findCanvas(this.state, id)
  }

  detachEverywhere(view: View): void {
    for (const w of this.wins) if (w.open) w.main.detach(view)
  }

  private dropLive(id: ID): void {
    const t = this.live.get(id)
    if (!t) return
    this.mediaGone(id)
    this.live.delete(id)
    for (const w of this.wins) {
      if (w.open) w.main.detach(t.view)
      if (w.fullscreenTab === t) w.fullscreenTab = undefined
    }
    t.destroy()
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
    if (focus && this.pageInFront()) tab.wc.focus()
    this.changed()
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
    this.window.setTrafficLights(this.state.settings.sidebarVisible || this.window.overlayMode.kind === 'sidebar', this.trafficLightsAt())
  }

  /** A right sidebar's top bar keeps them at the window's top-right corner, mirroring the left layout. */
  private trafficLightsAt(): Point | undefined {
    if (!this.state.settings.sidebarRight) return undefined
    const revealed = !this.state.settings.sidebarVisible && this.window.overlayMode.kind === 'sidebar'
    return {
      x: this.window.size().width - TRAFFIC_LIGHTS.x - TRAFFIC_LIGHTS_WIDTH,
      y: TRAFFIC_LIGHTS.y + (revealed ? FLOATING_SIDEBAR_INSET : 0)
    }
  }

  layout(): void {
    const w = this.window
    if (!w || w.win.isDestroyed()) return
    const s = this.state.settings
    const fs = this.cur.fullscreenTab
    const content = w.contentRect(s.sidebarVisible, s.sidebarWidth, s.sidebarRight, !!fs)
    this.syncTrafficLights()
    w.setAppearance(this.space.appearance)
    const views: AppState['layout']['views'] = []
    let splitId: ID | undefined
    if (fs && !fs.destroyed) {
      fs.view.setBorderRadius(0)
      this.show([{ view: fs.view, rect: content }])
      views.push({ id: fs.itemId, rect: content })
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
            const r = pane.rect
            const bar = { x: r.x, y: r.y, width: r.width, height: PANE_BAR }
            const rect = { x: r.x, y: r.y + PANE_BAR, width: r.width, height: Math.max(0, r.height - PANE_BAR) }
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
    if (this.cur.peek) w.setTop(this.cur.peek.tab.view, this.peekRects().card)
    const mode = w.overlayMode.kind === 'peek' ? this.peekMode() : w.overlayMode
    if (mode.kind !== 'none') w.setOverlay(mode, this.overlayRect(mode))
    this.syncPrompts()
    this.syncMirrors()
    this.syncMedia()
    this.emitSoon()
    for (const other of this.wins) if (other !== this.cur && this.waitsForPage(other)) this.inWin(other, () => this.layout())
  }

  private waitsForPage(w: WindowSession): boolean {
    if (!w.open) return false
    return w.layout.views.some((v) => {
      const view = v.elsewhere ? this.live.get(v.id)?.view : undefined
      return !!view && !this.wins.some((x) => x.open && x.main.isShown(view))
    })
  }

  /** A page can be in one window only: one another window shows moves here, and that window shows a still of it. */
  private show(slots: ViewSlot[]): void {
    // A view has one parent: the floating video goes back into its page first.
    const floatingId = this.floating.tabId
    if (floatingId && slots.some((s) => s.view === this.floating.view)) this.setMedia(mediaState.shown(this.media, floatingId))
    for (const other of this.wins) {
      if (other === this.cur || !other.open) continue
      for (const { view } of slots) if (other.main.isShown(view)) this.lend(other, view)
    }
    this.window.show(slots)
    this.canvases.showing((view) => this.wins.some((w) => w.open && w.main.isShown(view)))
  }

  private lend(w: WindowSession, view: View): void {
    w.main.detach(view)
    const pane = w.layout.views.find((v) => this.live.get(v.id)?.view === view)
    if (!pane) return
    pane.elsewhere = true
    const tab = this.live.get(pane.id)!
    // The mirror only sends a frame when the page paints again; a still page needs one now.
    void tab.wc
      .capturePage()
      .then((image) => {
        if (w.open && !image.isEmpty()) w.main.ui.send(IPC.still, { id: pane.id, image: stillOf(image) })
      })
      .catch(() => {})
    this.emitSoon()
  }

  private syncMirrors(): void {
    const pages = new Set<WebContents>()
    for (const w of this.wins) {
      if (!w.open) continue
      for (const v of w.layout.views) {
        const t = v.elsewhere ? this.live.get(v.id) : undefined
        if (t && !t.destroyed) pages.add(t.wc)
      }
    }
    this.mirror.watch(pages)
  }

  private syncMedia(): void {
    const now = new Set<ID>()
    for (const w of this.wins) if (w.open) for (const v of w.layout.views) if (!v.elsewhere) now.add(v.id)
    const before = this.onScreen
    this.onScreen = now
    for (const id of now) if (!before.has(id)) this.setMedia(mediaState.shown(this.media, id))
    for (const id of before) if (!now.has(id)) void this.tabLeft(id)
  }

  private async tabLeft(id: ID): Promise<void> {
    const tab = this.live.get(id)
    if (!tab || tab.destroyed || (!tab.playing && !tab.wc.isCurrentlyAudible())) return
    const found = await probeMedia(tab.wc)
    if (found === null && !tab.playing) await sleep(AUDIBLE_SETTLE_MS)
    const still = () => this.outOfSight(id, tab)
    if (!still()) return
    const playing: LeftWith = found === null ? (tab.wc.isCurrentlyAudible() ? 'audio' : 'nothing') : found === 'audio' ? 'audio' : 'video'
    if (playing === 'video') this.videoTabs.add(id)
    else this.videoTabs.delete(id)
    const next = mediaState.left(this.media, id, playing, this.state.settings.floatVideos)
    if (next.floating !== id) return this.setMedia(next)
    await this.floatTab(tab, still)
  }

  private outOfSight(id: ID, tab: LiveTab): boolean {
    return !this.onScreen.has(id) && this.live.get(id) === tab && !tab.destroyed
  }

  private async floatTab(tab: LiveTab, wanted: () => boolean): Promise<void> {
    const id = tab.itemId
    const ok = await this.floating.open(tab, this.floatAnchor(), wanted)
    if (!wanted()) return
    this.setMedia(ok ? mediaState.float(this.media, id) : mediaState.left(this.media, id, 'audio', false))
  }

  private floatAnchor(): FloatAnchor {
    const win = this.cur?.open ? this.cur.main.win.getBounds() : screen.getPrimaryDisplay().workArea
    return { win, sidebarRight: this.state.settings.sidebarRight }
  }

  private setMedia(next: MediaState): void {
    const before = this.media
    if (next === before) return
    this.media = next
    if (before.floating && before.floating !== next.floating && this.floating.tabId === before.floating) this.floating.release()
    this.emitSoon()
  }

  private mediaGone(id: ID): void {
    this.onScreen.delete(id)
    this.videoTabs.delete(id)
    this.setMedia(mediaState.closed(this.media, id))
  }

  private async exportBookmarks(): Promise<void> {
    const state = (this.main ?? this).state
    const defaultPath = join(app.getPath('downloads'), `YARC bookmarks ${new Date().toISOString().slice(0, 10)}.html`)
    const { canceled, filePath } = await dialog.showSaveDialog(this.window.win, { defaultPath, filters: [{ name: 'Bookmarks', extensions: ['html'] }] })
    if (canceled || !filePath) return
    try {
      await writeFile(filePath, bookmarksHtml(state))
      this.toast(`Exported ${state.spaces.length === 1 ? '1 space' : `${state.spaces.length} spaces`} as bookmarks`)
    } catch (err) {
      this.toast(`Export failed: ${(err as Error).message}`)
    }
  }

  private async floatingPlayerDemo(): Promise<void> {
    if (!this.state.settings.floatVideos) return this.toast('Turn on floating videos in Settings first')
    const from = this.space.activeItemId
    const demo = this.newTab(FLOATING_DEMO_URL)
    demo.title = 'Floating Player Demo'
    const tab = this.live.get(demo.id)
    for (let i = 0; i < 50 && tab && !tab.playing && !tab.destroyed; i++) await sleep(100)
    if (!tab?.playing || this.space.activeItemId !== demo.id) return
    await sleep(1200)
    if (this.space.activeItemId !== demo.id) return
    if (from && findItem(this.state, from)) this.activate(from)
    else this.toast('Switch to another tab to see the video float')
  }

  backToTab(id: ID): void {
    if (!findItem(this.state, id)) return
    this.focusWindow()
    this.activate(id)
  }

  minimizeFloating(): void {
    this.setMedia(mediaState.minimize(this.media))
  }

  closeFloating(): void {
    const tab = this.media.floating ? this.live.get(this.media.floating) : undefined
    if (tab) void pauseMedia(tab.wc)
    this.setMedia(mediaState.closeFloating(this.media))
  }

  private async mediaCard(id: ID, op: 'back' | 'toggle' | 'float' | 'dismiss'): Promise<void> {
    const tab = this.live.get(id)
    if (op === 'back') return this.backToTab(id)
    if (op === 'dismiss') {
      if (tab) void pauseMedia(tab.wc)
      return this.setMedia(mediaState.dismiss(this.media, id))
    }
    if (!tab || tab.destroyed) return this.setMedia(mediaState.closed(this.media, id))
    if (op === 'toggle') return void (await toggleMedia(tab.wc))
    if (!this.onScreen.has(id)) await this.floatTab(tab, () => this.outOfSight(id, tab))
  }

  private sendStill(wc: WebContents, image: string): void {
    const id = this.itemIdFor(wc)
    if (!id) return
    for (const w of this.wins) {
      if (w.open && w.layout.views.some((v) => v.id === id && v.elsewhere)) w.main.ui.send(IPC.still, { id, image })
    }
  }

  private overlayRect(mode: OverlayMode): Rectangle | undefined {
    const { width, height } = this.window.size()
    const whole = { x: 0, y: 0, width, height }
    const s = this.state.settings
    const c = this.cur.layout.content
    const centeredX = (w: number) => Math.round(c.x + (c.width - w) / 2)
    switch (mode.kind) {
      case 'none':
        return undefined
      case 'sidebar': {
        if (this.cur.tabDrag) return whole
        const w = s.sidebarWidth + PAD
        return { x: s.sidebarRight ? width - w : 0, y: 0, width: w, height }
      }
      case 'split-drop':
      case 'peek':
      case 'capture':
        return c
      case 'notice': {
        const w = Math.min(440, c.width - 24)
        return { x: centeredX(w), y: c.y + 16, width: w, height: 44 }
      }
      case 'find': {
        const w = Math.min(380, c.width - 16)
        return { x: c.x + c.width - w - 12, y: c.y + 12, width: w, height: 60 }
      }
      case 'tour': {
        if (!isFloating(mode.step)) return whole
        const w = Math.min(460, c.width - 24)
        const h = 176
        return { x: centeredX(w), y: c.y + c.height - h - 16, width: w, height: h }
      }
      default:
        return whole
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
    if (mode.kind !== 'space-editor' && this.colorPreview?.w === this.cur) this.colorPreview = undefined
    if (mode.kind !== 'none' && mode.kind !== current.kind) this.window.sendToOverlay(IPC.state, this.snapshot(this.cur, mode))
    this.window.setOverlay(mode, this.overlayRect(mode))
    this.syncTrafficLights()
    if (mode.kind === 'none' && refocus) this.activeTab()?.wc.focus()
    if (mode.kind === 'command') this.tourEvent('newTab')
    this.syncPrompts()
    this.emitSoon()
  }

  syncPrompts(): void {
    const queue = this.profiles.permissionQueue
    const canPrompt = this.pagesThatCanPrompt()
    for (const wcId of queue.waitingPages()) {
      if (canPrompt.has(wcId)) continue
      const req = queue.next([wcId])
      if (req) queue.answer(req.id, 'dismiss')
    }
    for (const l of this.openLittles()) l.syncPrompt(queue)
    for (const w of this.wins) if (w.open) this.inWin(w, () => this.syncPrompt())
  }

  private pagesThatCanPrompt(): Set<number> {
    const pages = new Set<number>([...this.live.values()].filter((t) => !t.destroyed).map((t) => t.wc.id))
    for (const w of this.wins) if (w.peek && !w.peek.tab.destroyed) pages.add(w.peek.tab.wc.id)
    for (const l of this.openLittles()) if (l.pageId !== undefined) pages.add(l.pageId)
    return pages
  }

  private syncPrompt(): void {
    const queue = this.profiles.permissionQueue
    const w = this.window
    if (!w.prompt || w.win.isDestroyed()) return
    const kind = w.overlayMode.kind
    if (kind !== 'none' && kind !== 'sidebar' && kind !== 'find' && kind !== 'peek') return w.prompt.show(undefined)
    w.prompt.show(queue.next(this.pagesOnScreen()), this.promptAnchor())
  }

  private pagesOnScreen(): number[] {
    const ids: number[] = []
    if (this.cur.peek && !this.cur.peek.tab.destroyed) ids.push(this.cur.peek.tab.wc.id)
    const active = this.space.activeItemId
    const order = [...this.cur.layout.views.map((v) => v.id)].sort((a, b) => Number(b === active) - Number(a === active))
    for (const id of order) {
      const t = this.live.get(id)
      if (t && !t.destroyed && this.window.isShown(t.view)) ids.push(t.wc.id)
    }
    return ids
  }

  private promptAnchor(): PromptAnchor {
    const s = this.state.settings
    const content = this.cur.layout.content
    const floating = !s.sidebarVisible && this.window.overlayMode.kind === 'sidebar'
    if ((s.sidebarVisible || floating) && !this.cur.fullscreenTab) {
      const inset = floating ? FLOATING_SIDEBAR_INSET : 0
      const fieldRight = s.sidebarRight ? this.window.size().width - 10 : inset + s.sidebarWidth - 6
      const fieldBottom = this.topBarY(floating, inset) + TOP_BAR_HEIGHT + URL_FIELD_GAP + URL_FIELD_HEIGHT
      return { arrow: true, x: fieldRight - 22, y: fieldBottom + 2 }
    }
    const x = s.sidebarRight ? content.x + content.width - PROMPT_WIDTH - 12 : content.x + 12
    return { arrow: false, x, y: content.y + 12 }
  }

  private topBarY(floating: boolean, inset: number): number {
    const cap = this.window.captionHeight()
    const right = this.state.settings.sidebarRight
    // Windows' caption buttons sit top right: a left sidebar's top bar shares their strip, a right one's goes below.
    if (!cap || (floating && !right)) return inset + SIDEBAR_PAD
    if (right) return cap + (floating ? SIDEBAR_PAD : 0)
    return 0
  }

  private answerPrompt(id: string, answer: 'allow' | 'deny' | 'dismiss'): void {
    this.profiles.permissionQueue.answer(id, answer)
    if (!this.window.prompt?.visible && this.window.overlayMode.kind === 'none') this.activeTab()?.wc.focus()
  }

  private watchSidebarReveal(on: boolean): void {
    const w = this.cur
    clearTimeout(w.sidebarRevealHide)
    w.sidebarRevealHide = undefined
    if (!on) return w.main.watchPointer(undefined)
    w.main.watchPointer((p) => {
      const s = this.state.settings
      const reach = s.sidebarWidth + PAD + SIDEBAR_REVEAL_GRACE_PX
      if (s.sidebarRight ? p.x >= w.main.size().width - reach : p.x <= reach) {
        clearTimeout(w.sidebarRevealHide)
        w.sidebarRevealHide = undefined
      } else {
        w.sidebarRevealHide ??= setTimeout(() => this.inWin(w, () => this.setOverlay({ kind: 'none' }, false)), SIDEBAR_REVEAL_HIDE_DELAY_MS)
      }
    })
  }

  openPeek(profileId: ID, url: string): void {
    this.dropPeek()
    this.cur.peek = new Peek(this, this.profiles.get(profileId), url)
    this.window.setTop(this.cur.peek.tab.view, this.peekRects().card)
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
    const id = this.takeInAsTodayTab(peek.release(), this.space)
    if (split) this.splitWith(id)
    else this.activate(id)
  }

  private takeInAsTodayTab(tab: LiveTab, space: Space): ID {
    const item: TabItem = { id: newId(), url: tab.wc.getURL(), title: tab.wc.getTitle(), favicon: tab.favicon, lastActive: Date.now() }
    space.today.unshift(item)
    tab.itemId = item.id
    this.live.set(item.id, tab)
    return item.id
  }

  private dropPeek(): void {
    const peek = this.cur.peek
    if (!peek) return
    this.cur.peek = undefined
    if (!this.window.win.isDestroyed()) this.window.setTop(undefined)
    peek.destroy()
    this.emitSoon()
  }

  private peekRects(): { card: Rectangle; local: Rect } {
    const c = this.cur.layout.content
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

  newTab(url: string, opts: { activate?: boolean; spaceId?: ID } = {}): TabItem {
    const space = (opts.spaceId && this.store.space(opts.spaceId)) || this.space
    const item: TabItem = { id: newId(), url, title: url, lastActive: Date.now() }
    space.today.unshift(item)
    if (opts.activate !== false) this.activate(item.id)
    else this.changed()
    return item
  }

  open(input: string, where: 'tab' | 'current' | 'split' | 'background' | 'little' = 'tab', splitAt?: SplitAt): void {
    const url = resolveInput(input, this.state.settings.searchEngine)
    if (where === 'little') return void this.openLittle(url)
    if (where === 'current') {
      const tab = this.activeTab()
      if (tab) return void tab.load(url)
      where = 'tab'
    }
    if (where === 'split') {
      const item = this.newTab(url, { activate: false })
      return this.splitWith(item.id, splitAt)
    }
    this.newTab(url, { activate: where === 'tab' })
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
    const canvas = findCanvas(this.state, id)
    if (canvas) {
      // Closing a canvas only deselects it; Delete Canvas is in its menu.
      if (canvas.space.activeItemId === id) canvas.space.activeItemId = undefined
      this.layout()
      return this.changed()
    }
    const found = findItem(this.state, id)
    if (!found) return
    const loc = found.loc
    const space = loc.kind === 'favorite' ? this.space : this.store.space(loc.spaceId)!
    const split = splitOf(space.splits, id)
    const partner = split && paneIds(split.root).find((x) => x !== id)
    const wasActive = space.activeItemId === id
    space.splits = removeFromSplits(space.splits, id)
    this.dropLive(id)
    this.mru = this.mru.filter((m) => m !== id)
    if (loc.kind === 'today') {
      loc.list.splice(loc.index, 1)
      this.archiveClosed(found.item, space.id)
    } else if (found.item.savedUrl) found.item.url = found.item.savedUrl
    if (wasActive) {
      space.activeItemId = this.nextActiveAfter(space, id, partner)
      if (space.activeItemId) return this.activate(space.activeItemId)
    }
    this.relayout()
  }

  private archive(item: Pick<TabItem, 'url' | 'title' | 'favicon'>, spaceId: ID): void {
    if (!/^https?:/.test(item.url)) return
    this.state.archive.unshift({ id: newId(), url: item.url, title: item.title, favicon: item.favicon, spaceId, archivedAt: Date.now() })
    if (this.state.archive.length > MAX_ARCHIVE) this.state.archive.length = MAX_ARCHIVE
  }

  private archiveClosed(item: Pick<TabItem, 'url' | 'title' | 'favicon'>, spaceId: ID): void {
    this.archive(item, spaceId)
    this.closedTabs.push({ url: item.url, title: item.title, spaceId })
  }

  private shownOrPlaying(id: ID): boolean {
    return inAnyView(this.state.windows, id) || (this.live.get(id)?.info().audible ?? false)
  }

  private autoArchive(): void {
    const hours = this.state.settings.archiveAfterHours
    if (!hours) return
    const cutoff = Date.now() - hours * 3600_000
    let any = false
    this.captureCurrent()
    for (const space of this.state.spaces) {
      const keep: TabItem[] = []
      for (const t of space.today) {
        if (!this.shownOrPlaying(t.id) && t.lastActive < cutoff) {
          this.archive(t, space.id)
          this.dropLive(t.id)
          any = true
        } else keep.push(t)
      }
      space.today = keep
    }
    if (any) this.changed()
  }

  private unloadHiddenTabs(): void {
    const now = Date.now()
    this.captureCurrent()
    for (const [id, t] of [...this.live]) {
      if (t.destroyed) continue
      const inUse = inAnyView(this.state.windows, id) || t.wc.isCurrentlyAudible() || this.media.cards.includes(id) || this.floating.tabId === id
      const since = this.hiddenSince.get(id)
      if (inUse) this.hiddenSince.delete(id)
      else if (since === undefined) this.hiddenSince.set(id, now)
      else if (now - since >= UNLOAD_HIDDEN_AFTER) this.dropLive(id)
    }
    for (const id of this.hiddenSince.keys()) if (!this.live.has(id)) this.hiddenSince.delete(id)
    this.emitSoon()
  }

  clearToday(): void {
    const space = this.space
    for (const t of [...space.today]) {
      this.archiveClosed(t, space.id)
      space.splits = removeFromSplits(space.splits, t.id)
      this.dropLive(t.id)
    }
    const wasToday = space.today.some((t) => t.id === space.activeItemId)
    space.today = []
    if (wasToday) space.activeItemId = undefined
    this.relayout()
  }

  reopenClosed(): void {
    const last = this.closedTabs.pop()
    if (!last) return
    if (this.store.space(last.spaceId)) this.state.activeSpaceId = last.spaceId
    this.newTab(last.url)
  }

  togglePin(id: ID): void {
    const found = findItem(this.state, id)
    if (!found) return
    this.tourEvent('togglePin')
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
    let node: PinnedNode | TabItem | undefined
    let fromList: (PinnedNode | TabItem)[] | undefined
    const pinnedHit = findInPinned(space.pinned, id)
    if (pinnedHit) {
      node = pinnedHit.list[pinnedHit.index]
      fromList = pinnedHit.list
    } else {
      const found = findItem(this.state, id)
      if (!found) return
      node = found.item
      fromList = found.loc.list
    }
    // Folders and canvases move as they are, and only among pinned items.
    const isFolder = 'kind' in node && (node.kind === 'folder' || node.kind === 'canvas')
    let target: unknown[]
    if (to.section === 'favorites') target = profile.favorites
    else if (to.section === 'today') target = space.today
    else {
      const folder = to.folderId ? findFolder(space, to.folderId) : undefined
      if (folder && (folder.live || containsNode(node as PinnedNode, folder.id))) return
      target = folder ? folder.children : space.pinned
    }
    if (isFolder && to.section !== 'pinned') return
    const split = isFolder || to.section === 'favorites' ? undefined : splitOf(space.splits, id)
    const ids = split ? paneIds(split.root) : [id]
    const group = fromList.filter((n) => ids.includes(n.id))
    const profileBefore = new Map(group.map((n) => [n.id, profileOfItem(this.state, n.id)]))
    let index = to.index
    if (fromList === target) index -= group.filter((n) => fromList.indexOf(n) < to.index).length
    for (const n of group) fromList.splice(fromList.indexOf(n), 1)
    const moved = group.map((n) => {
      if (isFolder) return n
      const item = stripKind(n as TabItem)
      if (to.section === 'today') delete item.savedUrl
      else item.savedUrl ??= item.url
      return to.section === 'pinned' ? ({ ...item, kind: 'tab' } satisfies PinnedTab) : item
    })
    target.splice(Math.max(0, Math.min(index, target.length)), 0, ...moved)
    if (!isFolder) {
      for (const n of group) {
        if (profileOfItem(this.state, n.id) === profileBefore.get(n.id)) continue
        this.dropLive(n.id)
        if (space.activeItemId === n.id) this.activate(n.id)
      }
    }
    this.relayout()
  }

  moveToSpace(id: ID, spaceId: ID): void {
    const canvas = findCanvas(this.state, id)
    if (canvas) return this.moveCanvasToSpace(id, spaceId)
    const found = findItem(this.state, id)
    const target = this.store.space(spaceId)
    if (!found || !target || found.loc.kind === 'favorite') return
    const from = this.store.space(found.loc.spaceId)!
    if (from.id === target.id) return
    found.loc.list.splice(found.loc.index, 1)
    from.splits = removeFromSplits(from.splits, id)
    const item = stripKind(found.item)
    if (found.loc.kind === 'pinned') target.pinned.push({ ...item, kind: 'tab' })
    else target.today.unshift(item)
    if (from.profileId !== target.profileId) this.dropLive(id)
    if (from.activeItemId === id) {
      from.activeItemId = undefined
      this.activate(id)
    } else this.relayout()
  }

  splitWith(id: ID, at?: SplitAt): void {
    const space = this.space
    const active = space.activeItemId
    const found = findItem(this.state, id)
    if (!found) return
    if (found.loc.kind !== 'favorite' && found.loc.spaceId !== space.id) this.moveToSpace(id, space.id)
    if (at && findItem(this.state, at.target) && at.target !== id) return this.placeInSplit(id, at.target, at.side)
    if (!active || active === id || !findItem(this.state, active)) return this.activate(id)
    this.showSplit(space, appendPaneIn(space.splits, active, id, newId()), id)
  }

  /** Shows `id` on `side` of `target`, joining or moving within target's split; does nothing when that split is full. */
  placeInSplit(id: ID, target: ID, side: Side): void {
    const space = this.space
    const visible = new Set(spaceItems(this.state, space).map((i) => i.id))
    if (id === target || !visible.has(id) || !visible.has(target)) return
    const splits = placePaneIn(space.splits, target, id, side, newId())
    if (splits) this.showSplit(space, splits, id)
  }

  private showSplit(space: Space, splits: Split[], id: ID): void {
    space.splits = splits
    Object.assign(space, gatherSplit(space, id))
    this.activate(id)
    this.tourEvent('split')
  }

  /** Chromium drops a view's key-ups after a key-down the browser handled, until its next key-down: send one so releasing Ctrl gets through. */
  private letSwitcherSeeRelease(): void {
    const w = this.cur
    const overlay = w.main.overlay.webContents
    setImmediate(() => {
      if (w.switcher && !overlay.isDestroyed()) overlay.sendInputEvent({ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] })
    })
  }

  moveInSplit(id: ID, delta: -1 | 1): void {
    const split = splitOf(this.space.splits, id)
    const root = split && movePane(split.root, id, delta)
    if (!split || !root) return
    split.root = root
    this.relayout()
  }

  flipSplit(id: ID): void {
    const split = splitOf(this.space.splits, id)
    if (!split) return
    split.root = flipSplit(split.root)
    this.relayout()
  }

  separateFromSplit(id: ID): void {
    const space = this.space
    if (!splitOf(space.splits, id)) return
    space.splits = removeFromSplits(space.splits, id)
    this.activate(id)
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

  unsplit(id?: ID): void {
    const space = this.space
    const target = id ?? space.activeItemId
    space.splits = space.splits.filter((sp) => !target || !paneIds(sp.root).includes(target))
    this.relayout()
  }

  switchSpace(id: ID): void {
    const space = this.store.space(id)
    if (!space) return
    this.closePeek()
    this.state.activeSpaceId = id
    if (space.activeItemId && this.hasItem(space.activeItemId)) this.activate(space.activeItemId)
    else {
      space.activeItemId = undefined
      this.relayout()
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
      color2: a.color2 || undefined,
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
    for (const canvas of spaceCanvases(space)) this.canvases.delete(canvas.id)
    for (const item of spaceItems(this.state, space)) if (!this.state.profiles.some((p) => p.favorites.includes(item))) this.dropLive(item.id)
    this.state.spaces = this.state.spaces.filter((s) => s.id !== id)
    this.state.settings.linkRoutes = this.state.settings.linkRoutes.filter((r) => r.spaceId !== id)
    if (!this.state.spaces.some((s) => s.profileId === space.profileId)) {
      const profile = this.store.profile(space.profileId)
      for (const f of profile?.favorites ?? []) this.dropLive(f.id)
      this.state.profiles = this.state.profiles.filter((p) => p.id !== space.profileId)
      void this.profiles.remove(space.profileId)
    }
    if (this.state.activeSpaceId === id) this.switchSpace(this.state.spaces[0].id)
    else this.changed()
  }

  private saveLiveFolder(space: Space, id: ID | undefined, name: string, source: LiveSource): void {
    const live = cleanLiveSource(source)
    if (!live) return this.toast('That address can’t be used as a feed')
    let folder = id ? findFolder(space, id) : undefined
    if (id && !folder) return
    if (!folder) {
      folder = { kind: 'folder', id: newId(), name: '', open: true, children: [] }
      space.pinned.unshift(folder)
    }
    folder.name = name.trim() || liveFolderName(live)
    if (JSON.stringify(folder.live) !== JSON.stringify(live)) {
      folder.live = live
      folder.liveError = undefined
    }
    this.changed()
    void this.liveFolders.refresh(folder.id)
  }

  /** For tabs already taken out of the sidebar. */
  private forgetPinned(space: Space, nodes: PinnedNode[]): void {
    const wasActive = space.activeItemId
    for (const n of walkPinned(nodes)) {
      if (n.kind !== 'tab') continue
      this.dropLive(n.id)
      space.splits = removeFromSplits(space.splits, n.id)
      this.mru = this.mru.filter((m) => m !== n.id)
      if (space.activeItemId === n.id) space.activeItemId = this.nextActiveAfter(space, n.id)
    }
    if (space.activeItemId !== wasActive && space.activeItemId) return this.activate(space.activeItemId)
    this.relayout()
  }

  handleInput(e: Event, input: Input): void {
    if (this.cur.switcher && input.type === 'keyUp' && (input.key === 'Control' || input.key === 'Meta')) {
      const target = this.cur.switcher.order[this.cur.switcher.index]
      this.cur.switcher = undefined
      this.setOverlay({ kind: 'none' }, false)
      if (target) this.activate(target)
      return
    }
    if (this.recordingShortcut) return
    if (input.type === 'keyDown' && input.key === 'Escape' && this.panelInFront()) {
      e.preventDefault()
      this.setOverlay({ kind: 'none' })
      return
    }
    const cmd = commandForInput(input, isMac, this.state.settings.shortcuts)
    if (!cmd) return
    e.preventDefault()
    this.runCommand(cmd)
  }

  runCommand(cmd: CommandId | string): void {
    const action = Object.hasOwn(COMMAND_ACTIONS, cmd) && COMMAND_ACTIONS[cmd as CommandId]
    if (action) return void this.dispatch(action)
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
      case 'editUrl':
        // The command bar replaces Peek; edit the Peek page's URL as a real tab.
        if (this.cur.peek) this.expandPeek()
        return this.setOverlay({ kind: 'command', target: 'current', editCurrent: true, initial: tab?.wc.getURL() ?? '' })
      case 'newWindow':
        return this.openNewWindow()
      case 'newIncognitoWindow':
        return void this.openIncognito()
      case 'closeTab':
        if (this.cur.peek) return this.closePeek()
        if (space.activeItemId) this.close(space.activeItemId)
        return
      case 'togglePin':
        if (space.activeItemId) this.togglePin(space.activeItemId)
        return
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
        if (!this.cur.switcher) {
          const order = [...this.mru.filter((id) => ids.has(id)), ...[...ids].filter((id) => !this.mru.includes(id))]
          if (order.length < 2) return
          this.cur.switcher = { order, index: cmd === 'switcherNext' ? 1 : order.length - 1 }
        } else {
          const n = this.cur.switcher.order.length
          this.cur.switcher.index = (this.cur.switcher.index + (cmd === 'switcherNext' ? 1 : -1) + n) % n
        }
        const sw = this.cur.switcher
        this.setOverlay({ kind: 'switcher', order: sw.order, index: sw.index })
        this.cur.switcher = sw
        this.letSwitcherSeeRelease()
        return
      }
      case 'findNext':
      case 'findPrev':
        this.window.sendToOverlay(IPC.find, { step: cmd === 'findNext' ? 1 : -1 })
        return
      case 'duplicate':
        if (tab) this.newTab(tab.wc.getURL())
        return
      case 'focusPage':
        return void tab?.wc.focus()
      case 'setDefaultBrowser':
        return this.makeDefaultBrowser()
      case 'checkForUpdates':
        return void this.updater.check(true)
      case 'installUpdate':
        return void this.updater.apply()
      case 'newCanvas':
        return this.newCanvas()
      case 'capture':
        return this.startCapture()
      case 'whatsNew':
        return this.setOverlay({ kind: 'whats-new', releases: recentChanges(CHANGELOG, app.getVersion()), spotlights: recentSpotlights(SPOTLIGHTS) })
      case 'floatingPlayerDemo':
        return void this.floatingPlayerDemo()
    }
  }

  private tabFor(a: Action): LiveTab | undefined {
    const paneBarAction = a.type === 'back' || a.type === 'forward' || a.type === 'reload' || a.type === 'stop' || a.type === 'copyUrl'
    return paneBarAction && a.id ? this.live.get(a.id) : this.activeTab()
  }

  async dispatch(a: Action): Promise<void> {
    const tab = this.tabFor(a)
    const space = this.space
    switch (a.type) {
      case 'activate':
        return this.activate(a.id)
      case 'close':
        return this.close(a.id)
      case 'open':
        this.setOverlay({ kind: 'none' }, false)
        return this.open(a.url, a.where, a.splitAt)
      case 'reopenClosed':
        return this.reopenClosed()
      case 'togglePin':
        return this.togglePin(a.id)
      case 'addFavorite':
        return this.addFavorite(a.id)
      case 'resetToSaved':
        return this.resetToSaved(a.id)
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
      case 'unload':
        return this.unload(a.id)
      case 'mute': {
        const t = this.live.get(a.id)
        if (t) t.wc.setAudioMuted(!t.wc.isAudioMuted())
        return this.emitSoon()
      }
      case 'media':
        return this.mediaCard(a.id, a.op)
      case 'back':
      case 'forward':
      case 'reload':
      case 'stop':
      case 'zoom':
      case 'copyUrl':
      case 'devtools':
      case 'find': {
        if (!tab) return
        const toast = runPageAction(tab.wc, a)
        if (toast) this.toast(toast)
        return a.type === 'zoom' ? this.emitSoon() : undefined
      }
      case 'newFolder':
        space.pinned.unshift({ kind: 'folder', id: newId(), name: a.name || 'New Folder', open: true, children: [] })
        return this.changed()
      case 'toggleFolder': {
        const f = findFolder(space, a.id)
        if (f) f.open = !f.open
        if (f?.open && f.live) this.liveFolders.opened(f.id)
        return this.changed()
      }
      case 'renameFolder': {
        const f = findFolder(space, a.id)
        if (f) f.name = a.name.trim() || f.name
        return this.changed()
      }
      case 'deleteFolder':
        return this.deleteFolder(space, a.id)
      case 'saveLiveFolder':
        return this.saveLiveFolder(space, a.id, a.name, a.source)
      case 'refreshLiveFolder':
        return void this.liveFolders.refresh(a.id)
      case 'switchSpace':
        return this.switchSpace(a.id)
      case 'switchSpaceRelative': {
        const list = this.state.spaces
        const i = list.findIndex((s) => s.id === space.id)
        const next = list[i + a.delta]
        if (next) this.switchSpace(next.id)
        return
      }
      case 'createSpace':
        this.setOverlay({ kind: 'none' }, false)
        return this.createSpace(a)
      case 'updateSpace':
        return this.updateSpace(a)
      case 'deleteSpace':
        return this.deleteSpace(a.id)
      case 'renameProfile': {
        const p = this.store.profile(a.id)
        if (p) p.name = a.name
        return this.changed()
      }
      case 'splitWith':
        return this.splitWith(a.id, a.at)
      case 'splitMenu':
        return buildSplitMenu(this, a.id)?.popup({ window: this.window.win, x: Math.round(a.x), y: Math.round(a.y) })
      case 'moveInSplit':
        return this.moveInSplit(a.id, a.delta)
      case 'addSplit':
        if (!splitOf(space.splits, a.id)) return
        return this.setOverlay({ kind: 'command', target: 'split', splitAt: { target: a.id, side: a.side } })
      case 'separateFromSplit':
        return this.separateFromSplit(a.id)
      case 'flipSplit':
        return this.flipSplit(a.id)
      case 'unsplit':
        return this.unsplit(a.id)
      case 'placeInSplit':
        this.setTabDrag(undefined)
        return this.placeInSplit(a.id, a.target, a.side)
      case 'tabDrag':
        return this.setTabDrag(a.id)
      case 'resizeSplit': {
        const sp = space.splits.find((x) => x.id === a.splitId)
        const root = sp && resizeGroup(sp.root, a.path, a.sizes)
        if (!sp || !root) return
        sp.root = root
        return this.relayout()
      }
      case 'toggleSidebar':
        return this.toggleSidebar()
      case 'sidebarReveal': {
        if (this.state.settings.sidebarVisible || this.cur.sidebarReveal === a.show || this.panelInFront()) return
        this.cur.sidebarReveal = a.show
        return this.setOverlay(a.show ? { kind: 'sidebar' } : { kind: 'none' }, false)
      }
      case 'overlay':
        return this.setOverlay(a.mode)
      case 'previewSpaceColors':
        this.colorPreview = { w: this.cur, spaceId: a.spaceId, color: a.color, color2: a.color2 || undefined }
        return this.emitSoon()
      case 'endTour':
        this.tour = undefined
        return this.setOverlay({ kind: 'none' })
      case 'settings':
        return this.changeSettings(a.patch)
      case 'recordShortcut':
        this.recordingShortcut = a.on === true
        return
      case 'littleArc':
        return void this.openLittle(a.url)
      case 'peek':
        if (a.op === 'close') return this.closePeek()
        return this.expandPeek(a.op === 'split')
      case 'openInChrome':
        return this.openTabInChrome(a.id ? this.live.get(a.id) : tab, a.id)
      case 'stopFind':
        tab?.wc.stopFindInPage('keepSelection')
        return this.setOverlay({ kind: 'none' })
      case 'downloadOpen':
        return this.downloads.open(a.id, a.reveal, this.window.win)
      case 'sharePick':
        if (this.sharePicker.answer(a.id, a.sourceId, a.systemAudio === true) && this.window.overlayMode.kind === 'share-picker') this.setOverlay({ kind: 'none' })
        return
      case 'downloadsClear':
        return this.downloads.clearFinished()
      case 'archiveRestore':
        return this.restoreArchived(a.id)
      case 'archiveClear':
        this.state.archive = []
        return this.changed()
      case 'import': {
        if (!a.keepOverlay) this.setOverlay({ kind: 'none' }, false)
        const summary = await runImport(this, a.source, a.path)
        return summary ? this.toast(summary) : undefined
      }
      case 'exportBookmarks':
        this.setOverlay({ kind: 'none' }, false)
        return this.exportBookmarks()
      case 'importChoices': {
        const summary = await importChoices(this, this.imports.chosen(a.ids))
        if (summary) this.toast(summary)
        if (this.tour === 'import') this.setOverlay({ kind: 'tour', step: nextStep('import')! }, false)
        return
      }
      case 'relaunchUpdate':
        return void this.updater.apply(true)
      case 'command':
        if (!a.keepOverlay) this.setOverlay({ kind: 'none' }, false)
        return this.runCommand(a.id)
      case 'adblockToggleSite':
        return this.toggleAdblockOn(a.id ? this.live.get(a.id) : tab)
      case 'sitePermission':
        if (this.store.profile(a.profileId) && this.profiles.setSitePermission(a.profileId, a.origin, a.key, a.setting)) this.emitSoon()
        return
      case 'itemMenu':
        return buildItemMenu(this, a.id)?.popup({ window: this.window.win })
      case 'folderMenu':
        return buildFolderMenu(this, a.id)?.popup({ window: this.window.win })
      case 'canvasMenu':
        return buildCanvasMenu(this, a.id)?.popup({ window: this.window.win })
      case 'appMenu':
        return buildAppMenu(this).popup({ window: this.window.win, x: Math.round(Number(a.x)), y: Math.round(Number(a.y)) })
      case 'renameCanvas':
        this.canvases.rename(a.id, String(a.name))
        return this.changed()
      case 'capture': {
        const mode = this.window.overlayMode
        this.setOverlay({ kind: 'none' }, false)
        const page = this.activeTab()
        if (mode.kind !== 'capture' || !page || this.incognito) return
        return this.canvases.capture(page, a.rect, a.to, a.whole)
      }
      case 'spaceMenu':
        return buildSpaceMenu(this, a.id)?.popup({ window: this.window.win })
      case 'extensionsStore':
        this.setOverlay({ kind: 'none' }, false)
        this.newTab('https://chromewebstore.google.com/category/extensions')
        return
    }
  }

  private resetToSaved(id: ID): void {
    const item = findItem(this.state, id)?.item
    if (!item?.savedUrl) return
    item.url = item.savedUrl
    void this.live.get(id)?.load(item.savedUrl)
    this.activate(id)
  }

  private unload(id: ID): void {
    const item = findItem(this.state, id)?.item
    this.dropLive(id)
    if (item?.savedUrl) item.url = item.savedUrl
    if (this.space.activeItemId === id) this.space.activeItemId = this.nextActiveAfter(this.space, id)
    this.relayout()
  }

  private deleteFolder(space: Space, id: ID): void {
    const hit = findInPinned(space.pinned, id)
    const f = hit?.list[hit.index]
    if (!hit || f?.kind !== 'folder') return
    if (!f.live) {
      hit.list.splice(hit.index, 1, ...f.children)
      return this.changed()
    }
    hit.list.splice(hit.index, 1)
    this.forgetPinned(space, f.children)
  }

  private updateSpace(a: Extract<Action, { type: 'updateSpace' }>): void {
    const s = this.store.space(a.id)
    if (!s) return
    if (a.name !== undefined) s.name = a.name
    if (a.emoji !== undefined) s.emoji = a.emoji || undefined
    if (a.color) s.color = a.color
    if (a.color2 !== undefined) s.color2 = a.color2 || undefined
    if (a.profileId && a.profileId !== s.profileId && this.store.profile(a.profileId)) {
      for (const n of spaceItems(this.state, s)) this.dropLive(n.id)
      s.profileId = a.profileId
      s.splits = []
      if (s.id === this.space.id && s.activeItemId) return this.activate(s.activeItemId)
      this.layout()
    }
    this.changed()
  }

  private toggleSidebar(): void {
    const s = this.state.settings
    s.sidebarVisible = !s.sidebarVisible
    this.cur.sidebarReveal = false
    if (this.window.overlayMode.kind === 'sidebar') this.window.setOverlay({ kind: 'none' }, undefined)
    this.relayout()
    if (this.tour && this.window.overlayMode.kind === 'none') this.setOverlay({ kind: 'tour', step: this.tour }, false)
    this.tourEvent('toggleSidebar')
  }

  private changeSettings(patch: Extract<Action, { type: 'settings' }>['patch']): void {
    Object.assign(this.state.settings, validSettingsPatch(this.state.settings, patch, isMac))
    this.adblock.sync(this.state.settings)
    if (patch.theme) nativeTheme.themeSource = patch.theme
    if (patch.autoUpdate !== undefined) this.updater.sync()
    this.relayout()
  }

  private async openTabInChrome(tab: LiveTab | undefined, id?: ID): Promise<void> {
    const url = tab?.wc.getURL() || (id ? findItem(this.state, id)?.item.url : undefined)
    if (!url) return
    const ok = await openInChrome(url)
    this.toast(ok ? 'Opened in Chrome' : 'Chrome was not found on this computer')
  }

  private restoreArchived(id: ID): void {
    const entry = this.state.archive.find((x) => x.id === id)
    if (!entry) return
    this.state.archive = this.state.archive.filter((x) => x.id !== id)
    this.setOverlay({ kind: 'none' }, false)
    this.newTab(entry.url, { spaceId: this.store.space(entry.spaceId) ? entry.spaceId : undefined })
  }

  private toggleAdblockOn(tab: LiveTab | undefined): void {
    const toggled = tab && this.adblock.toggleSite(this.state.settings, tab.wc)
    if (!toggled) return
    this.toast(toggled.allowed ? `Ads allowed on ${toggled.host}` : `Blocking ads on ${toggled.host}`)
    this.changed()
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
    if (this.floating.tabId === tab.itemId) {
      // Same-page navigations (YouTube's next video) aren't `navigated` and keep the video.
      if (change.navigated) this.setMedia(mediaState.closed(this.media, tab.itemId))
      else this.floating.update()
    }
    this.emitSoon()
  }

  onTabDestroyed(tab: LiveTab): void {
    if (this.live.get(tab.itemId) !== tab) return
    this.mediaGone(tab.itemId)
    const found = findItem(this.state, tab.itemId)
    if (found?.loc.kind === 'today') this.close(tab.itemId)
    else {
      this.live.delete(tab.itemId)
      this.layout()
      this.emitSoon()
    }
  }

  private recordHistory(tab: LiveTab, write: (h: ProfileRuntime['history']) => void): void {
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
      this.mru = [tab.itemId, ...this.mru.filter((m) => m !== tab.itemId)]
      this.changed()
    }
  }

  private moveCanvasToSpace(id: ID, spaceId: ID): void {
    const hit = findCanvas(this.state, id)
    const target = this.store.space(spaceId)
    if (!hit || !target || hit.space.id === target.id) return
    this.canvases.moveFiles(id, hit.space.profileId, target.profileId)
    hit.list.splice(hit.index, 1)
    target.pinned.push(hit.canvas)
    if (hit.space.activeItemId === id) hit.space.activeItemId = undefined
    this.layout()
    this.changed()
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
    const pane = tab && !this.cur.peek ? this.cur.layout.views.find((v) => v.id === tab.itemId && !v.elsewhere) : undefined
    if (!tab || !pane) return this.toast('Open a page to capture part of it')
    const c = this.cur.layout.content
    this.setOverlay({ kind: 'capture', page: { x: pane.rect.x - c.x, y: pane.rect.y - c.y, width: pane.rect.width, height: pane.rect.height } })
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
      const notice: OverlayMode = { kind: 'notice', text: `${site ? `${site} is` : 'This page is'} in full screen · Press Esc to exit` }
      this.setOverlay(notice, false)
      const w = this.cur
      setTimeout(() => {
        if (w.open && this.wins.includes(w)) this.inWin(w, () => this.window.overlayMode === notice && this.setOverlay({ kind: 'none' }, false))
      }, 3500)
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
      const guest = (options as { webContents?: WebContents }).webContents
      const view = new WebContentsView({ webContents: guest, webPreferences: options.webPreferences })
      view.setBackgroundColor('#ffffff')
      tab = new LiveTab(this, item.id, opener.profileId, opener.session, undefined, view)
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
    const s = this.state.settings
    return known(this.state.littleArc.profileByHost[hostOf(url ?? '')]) ?? known(s.littleArcProfileId) ?? this.space.profileId
  }

  archiveLittle(page: Pick<TabItem, 'url' | 'title' | 'favicon'>, spaceId: ID): void {
    this.archiveClosed(page, spaceId)
    this.changed()
    // Little Windows close after the state was written for quitting.
    if (this.quitting) this.store.flush()
  }

  private closeIdleLittles(): void {
    const now = Date.now()
    for (const l of this.openLittles()) if (l.expired(now, this.state.settings.littleCloseAfterHours)) l.win.close()
  }

  adoptTab(tab: LiveTab, space: Space): void {
    this.extensions.moveTab(tab, this.window.win)
    tab.host = this
    this.activate(this.takeInAsTodayTab(tab, space))
    this.focusWindow()
  }

  /** Links opened from other apps. */
  openExternalUrl(url: string): void {
    if (!/^https?:|^file:/i.test(url)) return
    const route = routeFor(this.state.settings.linkRoutes, url)
    const space = route && this.store.space(route.spaceId)
    if (!space && this.state.settings.littleArcForExternalLinks) return void this.openLittle(url)
    this.ensureWindow()
    if (space && space.id !== this.state.activeSpaceId) this.switchSpace(space.id)
    this.newTab(url)
    this.focusWindow()
  }

  private winFor(wc: WebContents): WindowSession | undefined {
    return this.wins.find((w) => w.open && (w.main.ui === wc || w.main.overlay.webContents === wc))
  }

  private ownsLittle(wc: WebContents): boolean {
    return this.openLittles().some((l) => l.win.webContents === wc)
  }

  private registerIpc(): void {
    const of = (e: { sender: WebContents }): Browser => {
      for (const b of Browser.all) {
        const w = b.winFor(e.sender)
        if (w) {
          b.use(w)
          return b
        }
        if (b.ownsLittle(e.sender)) return b
      }
      throw new Error('IPC from a view no window owns')
    }
    handleUi(IPC.action, (e, action: Action) => of(e).dispatch(action))
    handleUi(IPC.getState, (e) => of(e).snapshot())
    handleUi(IPC.getOverlay, (e) => of(e).window.overlayMode)
    handleUi(IPC.search, (e, q: string) => search(of(e), String(q)))
    handleUi(IPC.suggest, (e, q: string) => suggest(of(e), String(q)))
    handleUi(IPC.history, (e, q: string, offset: number) => {
      const b = of(e)
      return b.profiles.get(b.space.profileId).history.recent(200, Math.max(0, Math.floor(Number(offset) || 0)), String(q ?? ''))
    })
    handleUi(IPC.historyDelete, (e, url: string) => {
      const b = of(e)
      return b.profiles.get(b.space.profileId).history.deleteUrl(String(url))
    })
    handleUi(IPC.focus, (e) => e.sender.focus())
    onUi(IPC.downloadDrag, (e, id: string) => of(e).downloads.drag(String(id), e.sender))
    handleUi(IPC.capturePick, (e, x: number, y: number, depth: number) => {
      const b = of(e)
      const tab = b.activeTab()
      return tab && b.window.overlayMode.kind === 'capture' ? b.canvases.pick(tab, x, y, depth) : undefined
    })
    Canvases.registerIpc((wc) => {
      for (const b of Browser.all) {
        const page = b.canvases.pageOf(wc)
        if (page) return { canvases: b.canvases, page }
      }
      return undefined
    })
    handleUi(IPC.littleOp, (e, op: LittleOp, at?: LittleAnchor) => {
      for (const l of of(e).openLittles()) if (l.win.webContents === e.sender) return l.op(op, at)
    })
  }

  makeDefaultBrowser(): void {
    // Windows doesn't let apps claim the default themselves.
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
