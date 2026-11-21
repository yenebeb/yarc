import { BrowserWindow, WebContentsView, nativeTheme, screen, type BrowserWindowConstructorOptions, type Rectangle, type View, type WebContents } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import { isFloating } from '../shared/tour'
import type { OverlayMode } from '../shared/types'
import type { PromptView } from './prompt-view'
import { guardUi, uiOrigin, uiPageUrl } from './ui-origin'

export const PAD = 8

const mac = process.platform === 'darwin'
const TRAFFIC_LIGHTS = { x: 13, y: 16 }
export const CAPTION_H = mac ? 0 : 32
/** The UI's --text (styles.css). */
export const captionSymbols = (dark: boolean): string => (dark ? '#f1eff6' : '#1d1b22')

export interface ViewSlot {
  view: View
  rect: Rectangle
}

export type RendererPage = 'index' | 'overlay' | 'little' | 'prompt' | 'float' | 'canvas'

export function loadRenderer(wc: WebContents, page: RendererPage, query?: Record<string, string>): void {
  guardUi(wc)
  void wc.loadURL(uiPageUrl(page, query))
}

export const preloadPath = (): string => join(__dirname, '../preload/ui.js')

export function uiWebPreferences() {
  return {
    preload: preloadPath(),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    spellcheck: false,
    additionalArguments: [`--yarc-ui-origin=${uiOrigin()}`]
  }
}

function onSomeDisplay(r: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    const w = Math.min(r.x + (r.width ?? 0), a.x + a.width) - Math.max(r.x, a.x)
    const h = Math.min(r.y + (r.height ?? 0), a.y + a.height) - Math.max(r.y, a.y)
    return w >= 100 && h >= 50
  })
}

export class MainWindow {
  readonly win: BrowserWindow
  readonly overlay: WebContentsView
  overlayMode: OverlayMode = { kind: 'none' }
  private shown: View[] = []
  private overlayAttached = false
  private top: WebContentsView | undefined
  prompt: PromptView | undefined
  /** Unset follows the system. */
  private appearance: 'light' | 'dark' | undefined
  private captionDark: boolean | undefined

  /** `background`: windows restored behind the front one. */
  constructor(bounds: Partial<Rectangle> | undefined, background = false) {
    const area = screen.getPrimaryDisplay().workArea
    if (bounds?.x !== undefined && bounds.y !== undefined && !onSomeDisplay(bounds as Rectangle)) bounds = { width: bounds.width, height: bounds.height }
    const options: BrowserWindowConstructorOptions = {
      width: bounds?.width ?? Math.min(1440, area.width - 80),
      height: bounds?.height ?? Math.min(920, area.height - 80),
      x: bounds?.x,
      y: bounds?.y,
      minWidth: 520,
      minHeight: 360,
      show: false,
      titleBarStyle: mac ? 'hiddenInset' : 'hidden',
      trafficLightPosition: TRAFFIC_LIGHTS,
      webPreferences: uiWebPreferences()
    }
    if (mac) {
      options.vibrancy = 'under-window'
      options.visualEffectState = 'active'
      options.backgroundColor = '#00000000'
    } else {
      options.backgroundColor = nativeTheme.shouldUseDarkColors ? '#1f1e24' : '#e9e7f3'
      this.captionDark = nativeTheme.shouldUseDarkColors
      options.titleBarOverlay = { color: '#00000000', symbolColor: captionSymbols(this.captionDark), height: CAPTION_H }
    }
    this.win = new BrowserWindow(options)
    if (!mac) {
      const sync = () => this.syncCaption()
      nativeTheme.on('updated', sync)
      this.win.once('closed', () => nativeTheme.off('updated', sync))
    }
    this.win.setMenuBarVisibility(false)
    loadRenderer(this.win.webContents, 'index')
    this.win.once('ready-to-show', () => (background ? this.win.showInactive() : this.win.show()))

    this.overlay = new WebContentsView({ webPreferences: uiWebPreferences() })
    this.overlay.setBackgroundColor('#00000000')
    loadRenderer(this.overlay.webContents, 'overlay')
    this.win.once('closed', () => {
      if (!this.overlay.webContents.isDestroyed()) this.overlay.webContents.close()
    })
  }

  sendToOverlay(channel: string, data: unknown): void {
    if (!this.overlay.webContents.isDestroyed()) this.overlay.webContents.send(channel, data)
  }

  get ui(): WebContents {
    return this.win.webContents
  }

  size(): { width: number; height: number } {
    const [width, height] = this.win.getContentSize()
    return { width, height }
  }

  captionHeight(): number {
    return mac || this.win.isFullScreen() ? 0 : CAPTION_H
  }

  /** Electron shows them again at macOS's default spot, out of line with the sidebar's top bar. */
  setTrafficLights(visible: boolean): void {
    if (!mac) return
    this.win.setWindowButtonVisibility(visible)
    if (visible) this.win.setWindowButtonPosition(TRAFFIC_LIGHTS)
  }

  setAppearance(appearance: 'light' | 'dark' | undefined): void {
    this.appearance = appearance
    this.syncCaption()
  }

  private syncCaption(): void {
    if (mac || this.win.isDestroyed()) return
    const dark = this.appearance ? this.appearance === 'dark' : nativeTheme.shouldUseDarkColors
    if (dark === this.captionDark) return
    this.captionDark = dark
    this.win.setTitleBarOverlay({ symbolColor: captionSymbols(dark) })
  }

  contentRect(sidebarVisible: boolean, sidebarWidth: number, right: boolean, fullscreenPage: boolean): Rectangle {
    const { width, height } = this.size()
    if (fullscreenPage) return { x: 0, y: 0, width, height }
    const side = sidebarVisible ? sidebarWidth : PAD
    const w = Math.max(100, width - side - PAD)
    const top = Math.max(PAD, this.captionHeight())
    return { x: right ? PAD : side, y: top, width: w, height: Math.max(100, height - top - PAD) }
  }

  show(slots: ViewSlot[]): void {
    const next = slots.map((s) => s.view)
    for (const v of this.shown) if (!next.includes(v)) this.win.contentView.removeChildView(v)
    for (const s of slots) {
      if (!this.shown.includes(s.view)) this.win.contentView.addChildView(s.view)
      s.view.setBounds(s.rect)
    }
    this.shown = next
    if (this.overlayAttached) this.raiseOverlay()
    else this.prompt?.raise()
  }

  setTop(view: WebContentsView | undefined, rect?: Rectangle): void {
    if (this.top && this.top !== view) this.win.contentView.removeChildView(this.top)
    this.top = view
    if (!view) return
    if (rect) view.setBounds(rect)
    this.win.contentView.addChildView(view)
    this.prompt?.raise()
  }

  detach(view: View): void {
    if (this.shown.includes(view)) {
      this.win.contentView.removeChildView(view)
      this.shown = this.shown.filter((v) => v !== view)
    }
  }

  isShown(view: View): boolean {
    return this.shown.includes(view)
  }

  setOverlay(mode: OverlayMode, rect: Rectangle | undefined): void {
    this.overlayMode = mode
    this.sendToOverlay(IPC.overlay, mode)
    if (mode.kind === 'none' || !rect) {
      if (this.overlayAttached) {
        this.win.contentView.removeChildView(this.overlay)
        this.overlayAttached = false
      }
      return
    }
    this.overlay.setBounds(rect)
    this.overlayAttached = true
    this.raiseOverlay()
    const keepFocus = mode.kind === 'sidebar' || mode.kind === 'notice' || mode.kind === 'peek' || mode.kind === 'split-drop' || (mode.kind === 'tour' && isFloating(mode.step))
    if (!keepFocus) this.overlay.webContents.focus()
  }

  private raiseOverlay(): void {
    // Re-adding an existing child moves it to the top.
    this.win.contentView.addChildView(this.overlay)
    if (this.top) this.win.contentView.addChildView(this.top)
    this.prompt?.raise()
  }
}
