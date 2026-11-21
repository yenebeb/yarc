import {
  BrowserWindow,
  clipboard,
  Menu,
  screen,
  type BrowserWindowConstructorOptions,
  type ContextMenuParams,
  type Event,
  type Input,
  type Rectangle
} from 'electron'
import { IPC, type LittleAnchor, type LittleOp, type LittleState } from '../shared/ipc'
import { matches } from '../shared/keymap'
import type { Browser } from './browser'
import { littleBarColor, littleBounds, littleExpired } from './little-layout'
import { buildContextMenu } from './menus'
import type { PermissionQueue } from './permission-queue'
import type { ProfileRuntime } from './profiles'
import { PromptView } from './prompt-view'
import { LiveTab, type OpenDisposition, type TabHost } from './tab'
import { loadRenderer, uiWebPreferences } from './window'

const TOOLBAR_HEIGHT = 47
const isMac = process.platform === 'darwin'
const TRAFFIC_LIGHTS_END = isMac ? 83 : 8
const URL_PILL_SITE_NAME_X = TRAFFIC_LIGHTS_END + 120
const URL_PILL_BOTTOM = TOOLBAR_HEIGHT - 6
const MAIN_WINDOW_TAB_RADIUS = 8

export class LittleWindow implements TabHost {
  readonly win: BrowserWindow
  private tab: LiveTab | undefined
  private released = false
  /** Reopened with another profile, or an incognito window's. */
  private discarded = false
  private lastActive = Date.now()
  private prompt: PromptView

  constructor(
    private browser: Browser,
    readonly profile: ProfileRuntime,
    url = 'https://www.google.com/',
    bounds?: Rectangle
  ) {
    const cursor = screen.getCursorScreenPoint()
    const area = screen.getDisplayNearestPoint(cursor).workArea
    this.win = new BrowserWindow({
      ...(bounds ?? littleBounds(area, browser.state.littleArc.size)),
      minWidth: 360,
      minHeight: 240,
      titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
      trafficLightPosition: { x: 11, y: 17 },
      titleBarOverlay: isMac ? undefined : { color: '#00000000', symbolColor: '#f1eff6', height: TOOLBAR_HEIGHT },
      backgroundColor: littleBarColor(browser.store.activeSpace.color),
      show: false,
      webPreferences: uiWebPreferences()
    })
    this.win.setMenuBarVisibility(false)
    loadRenderer(this.win.webContents, 'little')
    this.win.webContents.on('before-input-event', (e, input) => this.onTabInput(undefined, e, input))
    this.win.once('ready-to-show', () => this.win.show())

    this.tab = new LiveTab(this, 'little', profile.id, profile.session, url)
    this.tab.view.setBorderRadius(0)
    this.browser.extensions.addTab(this.tab, this.win)
    this.win.contentView.addChildView(this.tab.view)
    this.prompt = new PromptView(
      this.win,
      (id, answer) => {
        browser.profiles.permissionQueue.answer(id, answer)
        if (!this.prompt.visible) this.tab?.wc.focus()
      },
      (e, input) => this.onTabInput(undefined, e, input)
    )
    this.layout()
    this.win.on('resize', () => this.layout())
    this.win.on('resized', () => {
      const [width, height] = this.win.getSize()
      browser.rememberLittleSize(width, height)
    })
    this.win.on('focus', () => (this.lastActive = Date.now()))
    this.win.on('blur', () => (this.lastActive = Date.now()))
    this.win.on('close', () => {
      if (this.released || this.discarded || !this.tab || this.tab.destroyed) return
      const { url, title, favicon } = this.tab.info()
      this.browser.archiveLittle(this.profile.id, { url, title, favicon })
    })
    this.win.on('closed', () => {
      if (!this.released) this.tab?.destroy()
    })
    this.tab.wc.focus()
  }

  expired(now: number, hours: number): boolean {
    const audible = !!this.tab && !this.tab.destroyed && this.tab.info().audible
    return littleExpired({ inFront: this.win.isFocused(), audible, lastActive: this.lastActive }, now, hours)
  }

  discard(): void {
    this.discarded = true
    this.win.close()
  }

  get url(): string {
    // '' once the page is gone: it can be destroyed while the window is still closing.
    return this.tab && !this.tab.destroyed ? this.tab.wc.getURL() : ''
  }

  get pageId(): number | undefined {
    return this.tab && !this.tab.destroyed && !this.released ? this.tab.wc.id : undefined
  }

  syncPrompt(queue: PermissionQueue): void {
    if (this.win.isDestroyed()) return
    const id = this.pageId
    if (id === undefined || this.win.isFullScreen()) return this.prompt.show(undefined)
    this.prompt.show(queue.next([id]), { arrow: true, x: URL_PILL_SITE_NAME_X, y: URL_PILL_BOTTOM })
  }

  private layout(): void {
    if (!this.tab || this.released) return
    const [w, h] = this.win.getContentSize()
    this.tab.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: w, height: h - TOOLBAR_HEIGHT })
  }

  private push(): void {
    if (!this.tab || this.tab.destroyed || this.win.isDestroyed()) return
    const { url, title, favicon, loading } = this.tab.info()
    const spaces = this.browser.state.spaces.filter((s) => s.profileId === this.profile.id)
    const state: LittleState = {
      url,
      title,
      favicon,
      loading,
      barColor: littleBarColor(this.browser.store.activeSpace.color),
      profileName: this.browser.store.profile(this.profile.id)?.name ?? '',
      spaceName: this.browser.littleTargetSpace(this.profile.id).name,
      moreSpaces: spaces.length > 1
    }
    this.win.webContents.send(IPC.little, state)
  }

  release(): LiveTab {
    const tab = this.tab!
    this.released = true
    this.win.contentView.removeChildView(tab.view)
    tab.view.setBorderRadius(MAIN_WINDOW_TAB_RADIUS)
    this.tab = undefined
    this.win.close()
    return tab
  }

  op(op: LittleOp, at?: LittleAnchor): void {
    const wc = this.tab?.wc
    switch (op) {
      case 'sync':
        return this.push()
      case 'openInMain':
        return this.browser.adoptLittle(this)
      case 'close':
        return this.win.close()
      case 'copyUrl':
        if (wc) clipboard.writeText(wc.getURL())
        return
      case 'back':
        return void (wc?.navigationHistory.canGoBack() && wc.navigationHistory.goBack())
      case 'forward':
        return void (wc?.navigationHistory.canGoForward() && wc.navigationHistory.goForward())
      case 'reload':
        return wc?.reload()
      case 'profileMenu':
        return this.profileMenu(at)
      case 'spaceMenu':
        return this.spaceMenu(at)
    }
  }

  private profileMenu(at?: LittleAnchor): void {
    const items = this.browser.state.profiles.map((p) => ({
      label: p.name,
      type: 'radio' as const,
      checked: p.id === this.profile.id,
      click: () => {
        if (p.id !== this.profile.id) this.browser.switchLittleProfile(this, p.id)
      }
    }))
    Menu.buildFromTemplate(items).popup({ window: this.win, x: at?.x, y: at?.y })
  }

  private spaceMenu(at?: LittleAnchor): void {
    const spaces = this.browser.state.spaces.filter((s) => s.profileId === this.profile.id)
    const items = spaces.map((s) => ({
      label: s.emoji ? `${s.emoji}  ${s.name}` : s.name,
      click: () => this.browser.adoptLittle(this, s.id)
    }))
    Menu.buildFromTemplate(items).popup({ window: this.win, x: at?.x, y: at?.y })
  }

  onTabChanged = () => this.push()
  adoptOpenedPage = (opener: LiveTab, options: BrowserWindowConstructorOptions | undefined, disposition: OpenDisposition, url: string) =>
    this.browser.adoptOpenedPage(opener, options, disposition, url)

  onTabInput(_tab: LiveTab | undefined, e: Event, input: Input): void {
    if (input.type !== 'keyDown') return
    const mod = isMac ? 'Cmd' : 'Ctrl'
    const run = (op: LittleOp) => {
      e.preventDefault()
      this.op(op)
    }
    if (matches(input, `${mod}+W`)) return run('close')
    if (matches(input, `${mod}+O`)) return run('openInMain')
    if (matches(input, `${mod}+Shift+O`)) return run('spaceMenu')
    if (matches(input, `${mod}+Shift+C`)) return run('copyUrl')
    if (matches(input, `${mod}+R`)) return run('reload')
    if (matches(input, isMac ? 'Cmd+BracketLeft' : 'Alt+Left')) return run('back')
    if (matches(input, isMac ? 'Cmd+BracketRight' : 'Alt+Right')) return run('forward')
  }

  onTabFocus(): void {}

  onTabDestroyed(): void {
    if (!this.released && !this.win.isDestroyed()) this.win.close()
  }

  onTabFullscreen(_tab: LiveTab, on: boolean): void {
    this.win.setFullScreen(on)
    this.browser.syncPrompts()
    if (on && this.tab) this.tab.view.setBounds({ x: 0, y: 0, ...sizeOf(this.win) })
    else this.layout()
  }

  onFoundInPage(): void {}

  showContextMenu(tab: LiveTab, params: ContextMenuParams): void {
    buildContextMenu(this.browser, tab, params).popup({ window: this.win })
  }
}

function sizeOf(win: BrowserWindow): { width: number; height: number } {
  const [width, height] = win.getContentSize()
  return { width, height }
}
