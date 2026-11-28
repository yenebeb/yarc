import { nativeTheme, screen, WebContentsView, type BrowserWindow, type BrowserWindowConstructorOptions, type Point, type Rectangle, type View, type WebContents } from 'electron'
import { release } from 'node:os'
import { IPC } from '../../shared/ipc'
import { isFloating } from '../../shared/tour'
import type { OverlayMode } from '../../shared/types'
import type { PromptView } from './prompt-view'
import { uiView, uiWindow } from './ui-view'

export const PAD = 8

const mac = process.platform === 'darwin'
export const TRAFFIC_LIGHTS = { x: 13, y: 16 }
/** Electron doesn't report the button group's width. From macOS 26 (Darwin 25), apps built with its SDK space the buttons 23pt apart instead of 20. */
export const TRAFFIC_LIGHTS_WIDTH = Number(release().split('.')[0]) >= 25 ? 60 : 54
export const CAPTION_H = mac ? 0 : 32
/** The UI's --text (base.css). */
export const captionSymbols = (dark: boolean): string => (dark ? '#f1eff6' : '#1d1b22')

export interface ViewSlot {
  view: View
  rect: Rectangle
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
  private pointerWatch: ((p: Point) => void) | undefined
  private pointerStops = new Map<WebContents, () => void>()

  /** `background`: windows restored behind the front one. */
  constructor(bounds: Partial<Rectangle> | undefined, background = false) {
    const area = screen.getPrimaryDisplay().workArea
    if (bounds?.x !== undefined && bounds.y !== undefined && !onSomeDisplay(bounds as Rectangle)) bounds = { width: bounds.width, height: bounds.height }
    const options: Omit<BrowserWindowConstructorOptions, 'webPreferences'> = {
      width: bounds?.width ?? Math.min(1440, area.width - 80),
      height: bounds?.height ?? Math.min(920, area.height - 80),
      x: bounds?.x,
      y: bounds?.y,
      minWidth: 520,
      minHeight: 360,
      show: false,
      titleBarStyle: mac ? 'hiddenInset' : 'hidden',
      trafficLightPosition: TRAFFIC_LIGHTS
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
    this.win = uiWindow('index', options)
    if (!mac) {
      const sync = () => this.syncCaption()
      nativeTheme.on('updated', sync)
      this.win.once('closed', () => nativeTheme.off('updated', sync))
    }
    this.win.setMenuBarVisibility(false)
    this.win.once('ready-to-show', () => (background ? this.win.showInactive() : this.win.show()))

    this.overlay = uiView('overlay')
    this.overlay.setBackgroundColor('#00000000')
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
  setTrafficLights(visible: boolean, at: Point): void {
    if (!mac) return
    this.win.setWindowButtonVisibility(visible)
    if (visible) this.win.setWindowButtonPosition(at)
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
    this.listenForPointer()
  }

  setTop(view: WebContentsView | undefined, rect?: Rectangle): void {
    if (this.top && this.top !== view) this.win.contentView.removeChildView(this.top)
    this.top = view
    if (!view) return
    if (rect) view.setBounds(rect)
    this.win.contentView.addChildView(view)
    this.prompt?.raise()
    this.listenForPointer()
  }

  /** In window coordinates, from mouse events in its own views: on Wayland, `screen` knows neither the cursor nor the window. */
  watchPointer(onMove: ((p: Point) => void) | undefined): void {
    for (const stop of this.pointerStops.values()) stop()
    this.pointerStops.clear()
    this.pointerWatch = onMove
    this.listenForPointer()
  }

  private listenForPointer(): void {
    if (!this.pointerWatch) return
    const listen = (wc: WebContents, origin: () => Point): void => {
      if (this.pointerStops.has(wc) || wc.isDestroyed()) return
      const onMouse = (_e: Electron.Event, m: Electron.MouseInputEvent): void => {
        // Says nothing about where the pointer went, and comes spuriously when views are restacked.
        if (m.type === 'mouseLeave') return
        const o = origin()
        this.pointerWatch?.({ x: o.x + m.x, y: o.y + m.y })
      }
      wc.on('before-mouse-event', onMouse)
      this.pointerStops.set(wc, () => wc.isDestroyed() || wc.off('before-mouse-event', onMouse))
    }
    const walk = (views: View[], origin: () => Point): void => {
      for (const view of views) {
        const at = (): Point => {
          const o = origin()
          const b = view.getBounds()
          return { x: o.x + b.x, y: o.y + b.y }
        }
        if (view instanceof WebContentsView) listen(view.webContents, at)
        walk(view.children, at)
      }
    }
    listen(this.ui, () => ({ x: 0, y: 0 }))
    walk(this.win.contentView.children, () => ({ x: 0, y: 0 }))
  }

  detach(view: View): void {
    if (this.shown.includes(view)) {
      this.win.contentView.removeChildView(view)
      this.shown = this.shown.filter((v) => v !== view)
    }
  }

  /** <browser-action-list> measures its anchor inside the view showing the sidebar, not the window. */
  sidebarOrigin(): Point {
    if (this.overlayMode.kind !== 'sidebar') return { x: 0, y: 0 }
    const { x, y } = this.overlay.getBounds()
    return { x, y }
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
    this.listenForPointer()
  }
}
