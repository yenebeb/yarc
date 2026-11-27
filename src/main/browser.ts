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
import { withPin } from '../shared/extension-pins'
import { IPC, TOAST_MS, type LittleAnchor, type LittleOp } from '../shared/ipc'
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
  ReleaseNotes,
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
import { hasBoard } from './whats-new-boards'
import { recentSpotlights, spotlight, SPOTLIGHTS, unseenSpotlights } from '../shared/spotlights'
import { changesSince, newestVersion, parseChangelog, RECENT_VERSIONS, recentChanges } from './changelog'
import { openInChrome } from './chrome'
import { DownloadList } from './download-list'
import { Extensions } from './extensions'
import { importChoices, ImportScan, runImport } from './importers'
import { FLOATING_DEMO_URL } from './floating-demo'
import { LittleWindow } from './little'
import { LiveFolders } from './live-folders'
import { logInfo, logProblem, setLogContext } from './log'
import { Media } from './media'
import { Mirror, stillOf } from './mirror'
import { runPageAction } from './page-actions'
import { DockedDevtools } from './docked-devtools'
import { dockedDevtoolsLayout } from '../shared/devtools-layout'
import { Peek, sameSite } from './peek'
import { buildAppMenu, buildCanvasMenu, buildContextMenu, buildFolderMenu, buildItemMenu, buildSidebarMenu, buildSpaceMenu, buildSplitMenu } from './menus'
import { Profiles, type ProfileRuntime } from './profiles'
import { commandBarPlace, overlayRect, peekRects, promptAnchor, trafficLightsAt, type WindowFrame } from './overlay-layout'
import { PageSwipe, type SwipeTarget } from './page-swipe'
import { PromptView } from './prompt-view'
import { search, suggest } from './search'
import { SharePicker } from './share-picker'
import { setSwipeStage } from './swipe-nav'
import { incognitoState, MAX_ARCHIVE, newId, SPACE_COLORS, Store } from './store'
import { HistorySync } from './sync'
import { LiveTab, type OpenDisposition, type TabHost } from './tab'
import { handleUi, onUi } from './ui-origin'
import { Updater } from './updater'
import { MainWindow, PAD, type ViewSlot } from './window'
import { applyView, captureView, cascade, inAnyView, newView, stateForView, viewFromState } from './window-state'

const isMac = process.platform === 'darwin'

// Defined by electron.vite.config.ts from build/changelog.json; empty outside release builds.
declare const __CHANGELOG__: unknown
const CHANGELOG = parseChangelog(__CHANGELOG__)
const whatsNewVersion = () => (app.isPackaged ? app.getVersion() : (newestVersion(CHANGELOG) ?? app.getVersion()))
const UNLOAD_HIDDEN_AFTER = 3600_000
const HOUSEKEEPING_EVERY = 5 * 60_000
// Slack past the revealed sidebar's edge: room to grab it to resize, and no enter/leave flicker at the screen's edge.
const SIDEBAR_REVEAL_GRACE_PX = 32
const SIDEBAR_REVEAL_HIDE_DELAY_MS = 300
const plainWindowForTests = () => !!process.env.YARC_TEST && !process.env.YARC_STARTUP_SCREENS

/** Find on a canvas goes to its own page, which searches the board's texts. */
const CANVAS_FIND_OPS = { find: 'open', findNext: 'next', findPrev: 'previous' } as const

const COMMAND_ACTIONS: Partial<Record<CommandId, Action>> = {
  newTab: { type: 'overlay', mode: { kind: 'command', target: 'tab' } },
  splitAdd: { type: 'overlay', mode: { kind: 'command', target: 'split' } },
  find: { type: 'overlay', mode: { kind: 'find' } },
  history: { type: 'overlay', mode: { kind: 'library', tab: 'history' } },
  downloads: { type: 'overlay', mode: { kind: 'library', tab: 'downloads' } },
  library: { type: 'overlay', mode: { kind: 'library', tab: 'archive' } },
  settings: { type: 'overlay', mode: { kind: 'settings' } },
  trafficControl: { type: 'overlay', mode: { kind: 'settings', section: 'traffic' } },
  historySync: { type: 'overlay', mode: { kind: 'settings', section: 'sync' } },
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

export class Browser implements TabHost {
  readonly store: Store
  readonly profiles: Profiles
  readonly extensions: Extensions
  readonly adblock: AdBlock
  readonly updater: Updater
  /** History sync; only the main controller has it, so incognito windows never sync. */
  readonly historySync: HistorySync | undefined
  readonly main: Browser | undefined
  private wins: WindowSession[] = []
  /** The window commands act on; after the last window closes on macOS it stays, closed. */
  private cur!: WindowSession
  private reportedLost: WindowSession | undefined
  readonly live = new Map<ID, LiveTab>()
  readonly canvases = new Canvases(this)
  readonly devtools = new DockedDevtools(
    (tab) => this.inWin(this.winOf(tab), () => this.relayout()),
    (tab, event, input) => this.onTabInput(tab, event, input)
  )
  /** `since`: the version whose changes the user saw last. */
  private waitingNews: { since?: string; releases: ReleaseNotes[]; spotlights: string[] } = { releases: [], spotlights: [] }
  private readonly liveFolders = new LiveFolders(this)
  private readonly media = new Media(this)
  private readonly swipe = new PageSwipe((page) => this.swipeTarget(page))
  /** The space editor's unsaved colors; no `spaceId` is a new space, shown on its window's current one. */
  private colorPreview: { window: WindowSession; spaceId?: ID; color: string; color2?: string } | undefined
  private hiddenSince = new Map<ID, number>()
  private mirror = new Mirror((wc, still) => this.sendStill(wc, still))
  private mru: ID[] = []
  private recordingShortcut = false
  private closedTabs: ClosedTab[] = []
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
  private tour: TourStep | undefined
  private readonly imports = new ImportScan(() => this.emitSoon())
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
    if (url) incognito.newTab(url)
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
      this.registerIpc()
      setLogContext(() => [...Browser.all].map((browser) => browser.describeWindows()).join('; '))
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
    this.historySync?.start()
  }

  private showStartupScreen(): void {
    this.canvases.discardTemporary()
    const current = whatsNewVersion()
    const state = this.state
    const seen = state.whatsNewSeenVersion ?? state.lastSeenVersion
    if (this.store.firstRun || !seen) this.markWhatsNewSeen()
    else {
      state.whatsNewSeenVersion = seen
      this.waitingNews = { since: seen, releases: changesSince(CHANGELOG, seen, current), spotlights: unseenSpotlights(SPOTLIGHTS, state.seenSpotlights) }
    }
    state.lastSeenVersion = app.getVersion()
    this.changed()
    if (plainWindowForTests()) return
    if (this.store.firstRun) this.whenWindowShows(() => this.setOverlay({ kind: 'tour', step: 'welcome' }))
    else if (this.waitingNews.spotlights.length) this.whenWindowShows(() => this.openWhatsNew())
  }

  private whenWindowShows(show: () => void): void {
    const win = this.window.win
    if (win.isVisible()) show()
    else win.once('show', show)
  }

  private markSpotlightsSeen(): void {
    this.state.seenSpotlights = SPOTLIGHTS.map((known) => known.id)
    this.waitingNews.spotlights = []
  }

  private markWhatsNewSeen(): void {
    this.state.whatsNewSeenVersion = whatsNewVersion()
    this.waitingNews.releases = []
    this.markSpotlightsSeen()
  }

  private newsWaits(): boolean {
    return this.waitingNews.releases.length + this.waitingNews.spotlights.length > 0
  }

  private spotlightsToShow(): string[] {
    return this.newsWaits() ? this.waitingNews.spotlights : recentSpotlights(SPOTLIGHTS)
  }

  private boardsToOffer(): string[] {
    return this.incognito ? [] : this.spotlightsToShow().filter(hasBoard)
  }

  private whatsNewPill(): AppState['whatsNew'] {
    if (!this.newsWaits()) return undefined
    return { boards: this.boardsToOffer().map((id) => ({ spotlight: id, title: spotlight(id)?.title ?? id })) }
  }

  /** On the user's click, or at launch for an unseen spotlight. What waits when there is something, else the latest changes and features. */
  private openWhatsNew(): void {
    const { releases } = this.waitingNews
    this.setOverlay({
      kind: 'whats-new',
      releases: this.newsWaits() ? releases.slice(0, RECENT_VERSIONS) : recentChanges(CHANGELOG, whatsNewVersion()),
      spotlights: this.spotlightsToShow(),
      boards: this.boardsToOffer()
    })
    this.markWhatsNewSeen()
    this.changed()
  }

  private openBoard(spotlightId: string): void {
    if (this.incognito || !hasBoard(spotlightId)) return
    this.setOverlay({ kind: 'none' })
    this.activate(this.canvases.createWhatsNew(this.space, spotlightId).id)
  }

  openCommandBarIfBlank(): void {
    const activeId = this.space.activeItemId
    if ((activeId && this.hasItem(activeId)) || this.store.firstRun || plainWindowForTests()) return
    const window = this.cur
    const openCommandBar = () => window.main.overlayMode.kind === 'whats-new' || this.inWin(window, () => this.runCommand('newTab'))
    if (window.main.win.isVisible()) openCommandBar()
    else window.main.win.once('show', openCommandBar)
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

  private inWin(window: WindowSession, run: () => void): void {
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

  private docksDevtools(tab: LiveTab): boolean {
    return this.wins.some((window) => window.open && window.main.isShown(tab.view))
  }

  inspect(tab: LiveTab, x: number, y: number): void {
    if (!this.docksDevtools(tab)) return tab.wc.inspectElement(x, y)
    if (this.space.activeItemId !== tab.itemId) this.activate(tab.itemId)
    void this.devtools.inspect(tab, x, y)
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

  private readonly sharePicker = new SharePicker((mode, page) => {
    const tab = page && [...this.live.values()].find((live) => live.wc === page)
    if (tab) this.use(this.winOf(tab))
    this.setOverlay(mode)
  })

  private onProfileCreated(runtime: ProfileRuntime): void {
    this.downloads.watch(runtime.session, runtime.id)
    runtime.session.setDisplayMediaRequestHandler((request, reply) => void this.sharePicker.pick(request, reply), { useSystemPicker: true })
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
      whatsNew: this.whatsNewPill(),
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
    if (!this.state.settings.sidebarVisible && this.window.overlayMode.kind === 'none') return this.showNotice(text, TOAST_MS)
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

  private relayout(): void {
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

  private hasItem(id: ID): boolean {
    return !!findItem(this.state, id) || !!findCanvas(this.state, id)
  }

  detachEverywhere(view: View): void {
    for (const window of this.wins) if (window.open) window.main.detach(view)
  }

  private dropLive(id: ID): void {
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
    this.mru = [id, ...this.mru.filter((recent) => recent !== id)].slice(0, 200)
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

  /** Peek is a short preview, so it covers docked DevTools rather than squeezing beside them. */
  private contentWithDevtools(): Rect {
    const { content, devtools } = this.cur.layout
    return devtools ? { ...content, width: devtools.bar.x + devtools.bar.width - content.x } : content
  }

  private frame(): WindowFrame {
    const settings = this.state.settings
    return {
      size: this.window.size(),
      content: this.cur.layout.content,
      contentWithDevtools: this.contentWithDevtools(),
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
    let devtools: AppState['layout']['devtools']
    let pageArea: Rectangle | undefined
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
        const devtoolsView = this.devtools.viewOf(this.live.get(active))
        const docked = devtoolsView && dockedDevtoolsLayout(content, settings.devtoolsWidth)
        pageArea = docked?.page
        const split = splitOf(space.splits, active)
        splitId = split?.id
        const panes = split ? layoutPanes(split.root, pageArea ?? content) : [{ id: active, rect: pageArea ?? content }]
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
        if (devtoolsView && docked) {
          slots.push({ view: devtoolsView, rect: docked.devtools })
          devtools = { bar: docked.bar, rect: docked.devtools }
        }
        this.show(slots)
      }
    }
    this.cur.layout = { content: pageArea ?? content, views, splitId, devtools }
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
    for (let attempt = 0; attempt < 50 && tab && !tab.playing && !tab.destroyed; attempt++) await sleep(100)
    if (!tab?.playing || this.space.activeItemId !== demo.id) return
    await sleep(1200)
    if (this.space.activeItemId !== demo.id) return
    if (from && findItem(this.state, from)) this.activate(from)
    else this.toast('Switch to another tab to see the video float')
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
    this.window.setTop(this.cur.peek.tab.view, peekRects(this.contentWithDevtools()).card)
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

  private placed(mode: OverlayMode): OverlayMode {
    if (mode.kind !== 'command') return mode
    const place = commandBarPlace(this.frame())
    const unmoved = mode.place && mode.place.x === place.x && mode.place.y === place.y && mode.place.width === place.width
    return unmoved ? mode : { ...mode, place }
  }

  private peekMode(): OverlayMode {
    return { kind: 'peek', card: peekRects(this.contentWithDevtools()).local }
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
    const visible = new Set(spaceItems(this.state, space).map((item) => item.id))
    visible.delete(closedId)
    const recent = this.mru.find((id) => visible.has(id) && this.live.has(id))
    if (recent) return recent
    return space.today.find((item) => item.id !== closedId)?.id
  }

  close(id: ID): void {
    const canvas = findCanvas(this.state, id)
    if (canvas) {
      // Closing a canvas only deselects it; Delete Canvas is in its menu.
      if (canvas.space.activeItemId === id) canvas.space.activeItemId = undefined
      if (canvas.canvas.temporary) this.canvases.discard(id)
      this.layout()
      return this.changed()
    }
    const found = findItem(this.state, id)
    if (!found) return
    const loc = found.loc
    const space = loc.kind === 'favorite' ? this.space : this.store.space(loc.spaceId)!
    const split = splitOf(space.splits, id)
    const partner = split && paneIds(split.root).find((paneId) => paneId !== id)
    const wasActive = space.activeItemId === id
    space.splits = removeFromSplits(space.splits, id)
    this.dropLive(id)
    this.mru = this.mru.filter((recent) => recent !== id)
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
      for (const item of space.today) {
        if (!this.shownOrPlaying(item.id) && item.lastActive < cutoff) {
          this.archive(item, space.id)
          this.dropLive(item.id)
          any = true
        } else keep.push(item)
      }
      space.today = keep
    }
    if (any) this.changed()
  }

  private unloadHiddenTabs(): void {
    const now = Date.now()
    this.captureCurrent()
    for (const [id, tab] of [...this.live]) {
      if (tab.destroyed) continue
      const inUse = inAnyView(this.state.windows, id) || tab.wc.isCurrentlyAudible() || this.media.keepsLoaded(id)
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
    for (const item of [...space.today]) {
      this.archiveClosed(item, space.id)
      space.splits = removeFromSplits(space.splits, item.id)
      this.dropLive(item.id)
    }
    const wasToday = space.today.some((item) => item.id === space.activeItemId)
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
    const group = fromList.filter((member) => ids.includes(member.id))
    const profileBefore = new Map(group.map((member) => [member.id, profileOfItem(this.state, member.id)]))
    let index = to.index
    if (fromList === target) index -= group.filter((member) => fromList.indexOf(member) < to.index).length
    for (const member of group) fromList.splice(fromList.indexOf(member), 1)
    const moved = group.map((member) => {
      if (isFolder) return member
      const item = stripKind(member as TabItem)
      if (to.section === 'today') delete item.savedUrl
      else item.savedUrl ??= item.url
      return to.section === 'pinned' ? ({ ...item, kind: 'tab' } satisfies PinnedTab) : item
    })
    target.splice(Math.max(0, Math.min(index, target.length)), 0, ...moved)
    if (!isFolder) {
      for (const member of group) {
        if (profileOfItem(this.state, member.id) === profileBefore.get(member.id)) continue
        this.dropLive(member.id)
        if (space.activeItemId === member.id) this.activate(member.id)
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
    const visible = new Set(spaceItems(this.state, space).map((item) => item.id))
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
    const window = this.cur
    const overlay = window.main.overlay.webContents
    setImmediate(() => {
      if (window.switcher && !overlay.isDestroyed()) overlay.sendInputEvent({ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] })
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
    space.splits = space.splits.filter((split) => !target || !paneIds(split.root).includes(target))
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

  createSpace(action: Extract<Action, { type: 'createSpace' }>): void {
    let profileId = action.profileId && action.profileId !== 'new' ? action.profileId : undefined
    if (!profileId) {
      profileId = newId()
      this.state.profiles.push({ id: profileId, name: action.profileName || action.name, favorites: [] })
    }
    const space: Space = {
      id: newId(),
      name: action.name || 'New Space',
      emoji: action.emoji,
      color: action.color || SPACE_COLORS[this.state.spaces.length % SPACE_COLORS.length],
      color2: action.color2 || undefined,
      appearance: action.appearance,
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
    for (const item of spaceItems(this.state, space)) if (!this.state.profiles.some((profile) => profile.favorites.includes(item))) this.dropLive(item.id)
    this.state.spaces = this.state.spaces.filter((other) => other.id !== id)
    this.state.settings.linkRoutes = this.state.settings.linkRoutes.filter((route) => route.spaceId !== id)
    if (!this.state.spaces.some((other) => other.profileId === space.profileId)) {
      const profile = this.store.profile(space.profileId)
      for (const favorite of profile?.favorites ?? []) this.dropLive(favorite.id)
      this.state.profiles = this.state.profiles.filter((other) => other.id !== space.profileId)
      void this.profiles.remove(space.profileId)
      this.historySync?.profilesChanged()
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
    for (const node of walkPinned(nodes)) {
      if (node.kind !== 'tab') continue
      this.dropLive(node.id)
      space.splits = removeFromSplits(space.splits, node.id)
      this.mru = this.mru.filter((recent) => recent !== node.id)
      if (space.activeItemId === node.id) space.activeItemId = this.nextActiveAfter(space, node.id)
    }
    if (space.activeItemId !== wasActive && space.activeItemId) return this.activate(space.activeItemId)
    this.relayout()
  }

  handleInput(event: Event, input: Input): void {
    if (this.cur.switcher && input.type === 'keyUp' && (input.key === 'Control' || input.key === 'Meta')) {
      const target = this.cur.switcher.order[this.cur.switcher.index]
      this.cur.switcher = undefined
      this.setOverlay({ kind: 'none' }, false)
      if (target) this.activate(target)
      return
    }
    if (this.recordingShortcut) return
    if (input.type === 'keyDown' && input.key === 'Escape' && this.panelInFront()) {
      event.preventDefault()
      this.setOverlay({ kind: 'none' })
      return
    }
    const cmd = commandForInput(input, isMac, this.state.settings.shortcuts)
    if (!cmd) return
    event.preventDefault()
    this.runCommand(cmd)
  }

  runCommand(cmd: CommandId | string): void {
    const tab = this.activeTab()
    const canvasId = tab ? undefined : this.space.activeItemId
    if (canvasId && cmd in CANVAS_FIND_OPS && findCanvas(this.state, canvasId)) return this.canvases.find(canvasId, CANVAS_FIND_OPS[cmd as keyof typeof CANVAS_FIND_OPS])
    const findsWithNoPageToSearch = cmd === 'find' && !tab
    if (findsWithNoPageToSearch) return
    const action = Object.hasOwn(COMMAND_ACTIONS, cmd) && COMMAND_ACTIONS[cmd as CommandId]
    if (action) return void this.dispatch(action)
    const space = this.space
    const num = /^(space|tab)(\d)$/.exec(cmd)
    if (num) {
      const index = Number(num[2]) - 1
      if (num[1] === 'space') {
        const numbered = this.state.spaces[index]
        if (numbered) this.switchSpace(numbered.id)
      } else {
        const items = spaceItems(this.state, space)
        const item = cmd === 'tab9' ? items[items.length - 1] : items[index]
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
        const index = items.findIndex((item) => item.id === space.activeItemId)
        const next = items[(index + (cmd === 'nextTab' ? 1 : -1) + items.length) % items.length]
        return this.activate(next.id)
      }
      case 'switcherNext':
      case 'switcherPrev': {
        const ids = new Set(spaceItems(this.state, space).map((item) => item.id))
        if (!this.cur.switcher) {
          const order = [...this.mru.filter((id) => ids.has(id)), ...[...ids].filter((id) => !this.mru.includes(id))]
          if (order.length < 2) return
          this.cur.switcher = { order, index: cmd === 'switcherNext' ? 1 : order.length - 1 }
        } else {
          const count = this.cur.switcher.order.length
          this.cur.switcher.index = (this.cur.switcher.index + (cmd === 'switcherNext' ? 1 : -1) + count) % count
        }
        const switcher = this.cur.switcher
        this.setOverlay({ kind: 'switcher', order: switcher.order, index: switcher.index })
        this.cur.switcher = switcher
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
        return this.openWhatsNew()
      case 'floatingPlayerDemo':
        return void this.floatingPlayerDemo()
    }
  }

  private tabFor(action: Action): LiveTab | undefined {
    const paneBarAction = action.type === 'back' || action.type === 'forward' || action.type === 'reload' || action.type === 'stop' || action.type === 'copyUrl'
    return paneBarAction && action.id ? this.live.get(action.id) : this.activeTab()
  }

  async dispatch(action: Action): Promise<void> {
    const tab = this.tabFor(action)
    const space = this.space
    switch (action.type) {
      case 'activate':
        return this.activate(action.id)
      case 'close':
        return this.close(action.id)
      case 'open':
        this.setOverlay({ kind: 'none' }, false)
        return this.open(action.url, action.where, action.splitAt)
      case 'reopenClosed':
        return this.reopenClosed()
      case 'togglePin':
        return this.togglePin(action.id)
      case 'addFavorite':
        return this.addFavorite(action.id)
      case 'resetToSaved':
        return this.resetToSaved(action.id)
      case 'duplicate': {
        const item = findItem(this.state, action.id)?.item
        if (item) this.newTab(this.live.get(action.id)?.wc.getURL() || item.url)
        return
      }
      case 'rename': {
        const item = findItem(this.state, action.id)?.item
        if (!item) return
        item.savedTitle = action.title.trim() || undefined
        return this.changed()
      }
      case 'move':
        return this.move(action.id, action.to)
      case 'moveToSpace':
        return this.moveToSpace(action.id, action.spaceId)
      case 'clearToday':
        return this.clearToday()
      case 'unload':
        return this.unload(action.id)
      case 'mute': {
        const muted = this.live.get(action.id)
        if (muted) muted.wc.setAudioMuted(!muted.wc.isAudioMuted())
        return this.emitSoon()
      }
      case 'media':
        return this.media.card(action.id, action.op)
      case 'back':
      case 'forward':
      case 'reload':
      case 'stop':
      case 'zoom':
      case 'copyUrl':
      case 'devtools':
      case 'find': {
        if (!tab) return
        if (action.type === 'devtools' && this.docksDevtools(tab)) return this.devtools.toggle(tab)
        const toast = runPageAction(tab.wc, action)
        if (toast) this.toast(toast)
        return action.type === 'zoom' ? this.emitSoon() : undefined
      }
      case 'devtoolsPopOut':
        return tab && this.devtools.popOut(tab)
      case 'newFolder':
        space.pinned.unshift({ kind: 'folder', id: newId(), name: action.name || 'New Folder', open: true, children: [] })
        return this.changed()
      case 'toggleFolder': {
        const folder = findFolder(space, action.id)
        if (folder) folder.open = !folder.open
        if (folder?.open && folder.live) this.liveFolders.opened(folder.id)
        return this.changed()
      }
      case 'renameFolder': {
        const folder = findFolder(space, action.id)
        if (folder) folder.name = action.name.trim() || folder.name
        return this.changed()
      }
      case 'deleteFolder':
        return this.deleteFolder(space, action.id)
      case 'saveLiveFolder':
        return this.saveLiveFolder(space, action.id, action.name, action.source)
      case 'refreshLiveFolder':
        return void this.liveFolders.refresh(action.id)
      case 'switchSpace':
        return this.switchSpace(action.id)
      case 'switchSpaceRelative': {
        const list = this.state.spaces
        const index = list.findIndex((other) => other.id === space.id)
        const next = list[index + action.delta]
        if (next) this.switchSpace(next.id)
        return
      }
      case 'createSpace': {
        this.setOverlay({ kind: 'none' }, false)
        const created = this.createSpace(action)
        this.historySync?.profilesChanged()
        return created
      }
      case 'updateSpace':
        return this.updateSpace(action)
      case 'deleteSpace':
        return this.deleteSpace(action.id)
      case 'renameProfile': {
        const profile = this.store.profile(action.id)
        if (profile) profile.name = action.name
        this.historySync?.profilesChanged()
        return this.changed()
      }
      case 'splitWith':
        return this.splitWith(action.id, action.at)
      case 'splitMenu':
        return buildSplitMenu(this, action.id)?.popup({ window: this.window.win, x: Math.round(action.x), y: Math.round(action.y) })
      case 'moveInSplit':
        return this.moveInSplit(action.id, action.delta)
      case 'addSplit':
        if (!splitOf(space.splits, action.id)) return
        return this.setOverlay({ kind: 'command', target: 'split', splitAt: { target: action.id, side: action.side } })
      case 'separateFromSplit':
        return this.separateFromSplit(action.id)
      case 'flipSplit':
        return this.flipSplit(action.id)
      case 'unsplit':
        return this.unsplit(action.id)
      case 'placeInSplit':
        this.setTabDrag(undefined)
        return this.placeInSplit(action.id, action.target, action.side)
      case 'tabDrag':
        return this.setTabDrag(action.id)
      case 'resizeSplit': {
        const split = space.splits.find((other) => other.id === action.splitId)
        const root = split && resizeGroup(split.root, action.path, action.sizes)
        if (!split || !root) return
        split.root = root
        return this.relayout()
      }
      case 'toggleSidebar':
        return this.toggleSidebar()
      case 'sidebarReveal': {
        if (this.state.settings.sidebarVisible || this.cur.sidebarReveal === action.show || this.panelInFront()) return
        this.cur.sidebarReveal = action.show
        return this.setOverlay(action.show ? { kind: 'sidebar' } : { kind: 'none' }, false)
      }
      case 'overlay':
        return this.setOverlay(action.mode)
      case 'previewSpaceColors':
        this.colorPreview = { window: this.cur, spaceId: action.spaceId, color: action.color, color2: action.color2 || undefined }
        return this.emitSoon()
      case 'endTour':
        this.tour = undefined
        return this.setOverlay({ kind: 'none' })
      case 'settings':
        return this.changeSettings(action.patch)
      case 'recordShortcut':
        this.recordingShortcut = action.on === true
        return
      case 'littleArc':
        return void this.openLittle(action.url)
      case 'peek':
        if (action.op === 'close') return this.closePeek()
        return this.expandPeek(action.op === 'split')
      case 'openInChrome':
        return this.openTabInChrome(action.id ? this.live.get(action.id) : tab, action.id)
      case 'stopFind':
        tab?.wc.stopFindInPage('keepSelection')
        return this.setOverlay({ kind: 'none' })
      case 'downloadOpen':
        return this.downloads.open(action.id, action.reveal, this.window.win)
      case 'sharePick':
        if (this.sharePicker.answer(action.id, action.sourceId, action.systemAudio === true) && this.window.overlayMode.kind === 'share-picker') this.setOverlay({ kind: 'none' })
        return
      case 'downloadsClear':
        return this.downloads.clearFinished()
      case 'archiveRestore':
        return this.restoreArchived(action.id)
      case 'syncPickFolder':
        return (this.main ?? this).historySync?.pickFolder()
      case 'syncICloud':
        return (this.main ?? this).historySync?.useICloud()
      case 'syncNearby':
        return (this.main ?? this).historySync?.setUpNearby()
      case 'syncCloud':
        return (this.main ?? this).historySync?.signInToDrive(action.drive)
      case 'syncServer':
        return (this.main ?? this).historySync?.setUpServer(action.url, action.username, action.password)
      case 'syncSignIn':
        return (this.main ?? this).historySync?.signInAgain()
      case 'syncConnect':
        return (this.main ?? this).historySync?.connect(action.password, action.create)
      case 'syncChangePassword':
        return (this.main ?? this).historySync?.changePassword(action.password)
      case 'syncProfile':
        return (this.main ?? this).historySync?.setProfileSync(action.id, action.on)
      case 'syncCancel':
        return (this.main ?? this).historySync?.cancelSetup()
      case 'syncOff':
        return (this.main ?? this).historySync?.turnOff()
      case 'archiveClear':
        this.state.archive = []
        return this.changed()
      case 'import': {
        if (!action.keepOverlay) this.setOverlay({ kind: 'none' }, false)
        const summary = await runImport(this, action.source, action.path)
        this.historySync?.profilesChanged()
        return summary ? this.toast(summary) : undefined
      }
      case 'exportBookmarks':
        this.setOverlay({ kind: 'none' }, false)
        return this.exportBookmarks()
      case 'importChoices': {
        const summary = await importChoices(this, this.imports.chosen(action.ids))
        if (summary) this.toast(summary)
        this.historySync?.profilesChanged()
        if (this.tour === 'import') this.setOverlay({ kind: 'tour', step: nextStep('import')! }, false)
        return
      }
      case 'relaunchUpdate':
        return void this.updater.apply(true)
      case 'command':
        if (!action.keepOverlay) this.setOverlay({ kind: 'none' }, false)
        return this.runCommand(action.id)
      case 'adblockToggleSite':
        return this.toggleAdblockOn(action.id ? this.live.get(action.id) : tab)
      case 'sitePermission':
        if (this.store.profile(action.profileId) && this.profiles.setSitePermission(action.profileId, action.origin, action.key, action.setting)) this.emitSoon()
        return
      case 'extensionPin':
        return this.setExtensionPin(action.profileId, action.extensionId, action.pinned)
      case 'extensionsPopover': {
        const origin = this.sidebarOrigin(this.window.win) ?? { x: 0, y: 0 }
        return this.setOverlay({ kind: 'extensions', profileId: action.profileId, anchor: { ...action.anchor, x: action.anchor.x + origin.x, y: action.anchor.y + origin.y } })
      }
      case 'itemMenu':
        return buildItemMenu(this, action.id)?.popup({ window: this.window.win })
      case 'folderMenu':
        return buildFolderMenu(this, action.id)?.popup({ window: this.window.win })
      case 'canvasMenu':
        return buildCanvasMenu(this, action.id)?.popup({ window: this.window.win })
      case 'appMenu':
        return buildAppMenu(this).popup({ window: this.window.win, x: Math.round(Number(action.x)), y: Math.round(Number(action.y)) })
      case 'renameCanvas':
        this.canvases.rename(action.id, String(action.name))
        return this.changed()
      case 'hideWhatsNew':
        this.markWhatsNewSeen()
        return this.changed()
      case 'openBoard':
        return this.openBoard(String(action.spotlight))
      case 'capture': {
        const mode = this.window.overlayMode
        this.setOverlay({ kind: 'none' }, false)
        const page = this.activeTab()
        if (mode.kind !== 'capture' || !page || this.incognito) return
        return this.canvases.capture(page, action.rect, action.to, action.whole)
      }
      case 'spaceMenu':
        return buildSpaceMenu(this, action.id)?.popup({ window: this.window.win })
      case 'sidebarMenu':
        return buildSidebarMenu(this).popup({ window: this.window.win })
      case 'extensionsStore':
        this.setOverlay({ kind: 'none' }, false)
        this.newTab('https://chromewebstore.google.com/category/extensions')
        return
      case 'removeExtension':
        return this.extensions.remove(action.profileId, action.id)
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
    const folder = hit?.list[hit.index]
    if (!hit || folder?.kind !== 'folder') return
    if (!folder.live) {
      hit.list.splice(hit.index, 1, ...folder.children)
      return this.changed()
    }
    hit.list.splice(hit.index, 1)
    this.forgetPinned(space, folder.children)
  }

  private updateSpace(action: Extract<Action, { type: 'updateSpace' }>): void {
    const space = this.store.space(action.id)
    if (!space) return
    if (action.name !== undefined) space.name = action.name
    if (action.emoji !== undefined) space.emoji = action.emoji || undefined
    if (action.color) space.color = action.color
    if (action.color2 !== undefined) space.color2 = action.color2 || undefined
    if (action.appearance !== undefined) space.appearance = action.appearance || undefined
    if (action.profileId && action.profileId !== space.profileId && this.store.profile(action.profileId)) {
      for (const item of spaceItems(this.state, space)) this.dropLive(item.id)
      space.profileId = action.profileId
      space.splits = []
      if (space.id === this.space.id && space.activeItemId) return this.activate(space.activeItemId)
    }
    this.relayout()
  }

  private toggleSidebar(): void {
    const settings = this.state.settings
    settings.sidebarVisible = !settings.sidebarVisible
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
    if (patch.sidebarRight !== undefined) for (const other of this.wins) if (other !== this.cur) this.inWin(other, () => this.layout())
    this.relayout()
  }

  private async openTabInChrome(tab: LiveTab | undefined, id?: ID): Promise<void> {
    const url = tab?.wc.getURL() || (id ? findItem(this.state, id)?.item.url : undefined)
    if (!url) return
    const ok = await openInChrome(url)
    this.toast(ok ? 'Opened in Chrome' : 'Chrome was not found on this computer')
  }

  private restoreArchived(id: ID): void {
    const entry = this.state.archive.find((archived) => archived.id === id)
    if (!entry) return
    this.state.archive = this.state.archive.filter((archived) => archived.id !== id)
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
    if (found?.loc.kind === 'today') this.close(tab.itemId)
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
      this.mru = [tab.itemId, ...this.mru.filter((recent) => recent !== tab.itemId)]
      this.relayout()
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
    return known(this.state.littleArc.profileByHost[hostOf(url ?? '')]) ?? known(this.state.settings.littleArcProfileId) ?? this.space.profileId
  }

  archiveLittle(page: Pick<TabItem, 'url' | 'title' | 'favicon'>, spaceId: ID): void {
    this.archiveClosed(page, spaceId)
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
    return this.wins.find((window) => window.open && (window.main.ui === wc || window.main.overlay.webContents === wc))
  }

  windowOf(wc: WebContents): MainWindow | undefined {
    return this.winFor(wc)?.main
  }

  private ownsLittle(wc: WebContents): boolean {
    return this.openLittles().some((little) => little.win.webContents === wc)
  }

  private registerIpc(): void {
    const browserOf = (event: { sender: WebContents }): Browser => {
      for (const browser of Browser.all) {
        const window = browser.winFor(event.sender)
        if (window) {
          browser.use(window)
          return browser
        }
        if (browser.ownsLittle(event.sender)) return browser
      }
      throw new Error('IPC from a view no window owns')
    }
    handleUi(IPC.action, (event, action: Action) => browserOf(event).dispatch(action))
    setSwipeStage({
      show: (page, step, offset, progress) => [...Browser.all].some((browser) => browser.swipe.show(page, step, offset, progress)),
      hide: (page) => Browser.all.forEach((browser) => browser.swipe.hide(page))
    })
    handleUi(IPC.getState, (event) => browserOf(event).snapshot())
    handleUi(IPC.getOverlay, (event) => browserOf(event).window.overlayMode)
    handleUi(IPC.search, (event, query: string) => search(browserOf(event), String(query)))
    handleUi(IPC.suggest, (event, query: string) => suggest(browserOf(event), String(query)))
    handleUi(IPC.history, (event, query: string, offset: number) => {
      const browser = browserOf(event)
      return browser.profiles.get(browser.space.profileId).history.recent(200, Math.max(0, Math.floor(Number(offset) || 0)), String(query ?? ''))
    })
    handleUi(IPC.historyDelete, (event, url: string) => {
      const browser = browserOf(event)
      return browser.profiles.get(browser.space.profileId).history.deleteUrl(String(url))
    })
    handleUi(IPC.focus, (event) => event.sender.focus())
    onUi(IPC.downloadDrag, (event, id: string) => browserOf(event).downloads.drag(String(id), event.sender))
    handleUi(IPC.capturePick, (event, x: number, y: number, depth: number) => {
      const browser = browserOf(event)
      const tab = browser.activeTab()
      return tab && browser.window.overlayMode.kind === 'capture' ? browser.canvases.pick(tab, x, y, depth) : undefined
    })
    Canvases.registerIpc((wc) => {
      for (const browser of Browser.all) {
        const page = browser.canvases.pageOf(wc)
        if (page) return { canvases: browser.canvases, page }
      }
      return undefined
    })
    handleUi(IPC.littleOp, (event, op: LittleOp, at?: LittleAnchor) => {
      for (const little of browserOf(event).openLittles()) if (little.win.webContents === event.sender) return little.op(op, at)
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
