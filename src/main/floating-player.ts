import { BaseWindow, WebContentsView, screen, type BaseWindowConstructorOptions, type Rectangle } from 'electron'
import { IPC, type FloatOp, type FloatState } from '../shared/ipc'
import type { ID } from '../shared/types'
import { FLOAT_MIN_WIDTH, floatingBounds, videoRatio } from './floating-layout'
import { FLOAT_CSS, liftVideo, lowerVideo, skipMedia, toggleMedia, type VideoSize } from './media-page'
import type { LiveTab } from './tab'
import { handleUi } from './ui-origin'
import { loadRenderer, uiWebPreferences } from './window'

const mac = process.platform === 'darwin'

export interface FloatingHost {
  backToTab(id: ID): void
  minimizeFloating(): void
  closeFloating(): void
}

export interface FloatAnchor {
  win: Rectangle
  sidebarRight: boolean
}

const players = new Map<number, FloatingPlayer>()

export class FloatingPlayer {
  private win: BaseWindow | undefined
  private controls: WebContentsView | undefined
  private tab: LiveTab | undefined
  private cssKey: string | undefined
  private ready = false
  private lastBounds: Rectangle | undefined
  private drag: { dx: number; dy: number; width: number; height: number } | undefined
  private latestOpen = 0
  private keepLifted: ReturnType<typeof setInterval> | undefined

  constructor(private host: FloatingHost) {
    FloatingPlayer.registerIpc()
  }

  get tabId(): ID | undefined {
    return this.tab?.itemId
  }

  get view(): WebContentsView | undefined {
    return this.tab?.view
  }

  get window(): BaseWindow | undefined {
    return this.win && !this.win.isDestroyed() ? this.win : undefined
  }

  /** `wanted` is asked again once the page answered, in case the user went back to the tab meanwhile. */
  async open(tab: LiveTab, anchor: FloatAnchor, wanted: () => boolean): Promise<boolean> {
    const attempt = ++this.latestOpen
    const wc = tab.wc
    let key: string | undefined
    try {
      key = await wc.insertCSS(FLOAT_CSS, { cssOrigin: 'user' })
    } catch {
      return false
    }
    const size = await liftVideo(wc)
    if (!size || attempt !== this.latestOpen || !wanted() || wc.isDestroyed()) {
      void lowerVideo(wc)
      if (!wc.isDestroyed()) void wc.removeInsertedCSS(key).catch(() => {})
      return false
    }
    this.release()
    this.tab = tab
    this.cssKey = key
    this.show(anchor, size)
    this.keepLifted = setInterval(() => {
      if (this.tab === tab && !tab.destroyed) void liftVideo(tab.wc)
    }, 1000)
    return true
  }

  release(): LiveTab | undefined {
    const tab = this.tab
    this.tab = undefined
    this.drag = undefined
    clearInterval(this.keepLifted)
    this.keepLifted = undefined
    const win = this.window
    if (win) {
      this.remember()
      if (tab) win.contentView.removeChildView(tab.view)
      win.destroy()
    }
    this.win = undefined
    this.controls = undefined
    this.ready = false
    if (tab && !tab.destroyed) {
      void lowerVideo(tab.wc)
      if (this.cssKey) void tab.wc.removeInsertedCSS(this.cssKey).catch(() => {})
    }
    this.cssKey = undefined
    return tab
  }

  update(): void {
    const tab = this.tab
    if (!tab || !this.ready || !this.controls || this.controls.webContents.isDestroyed()) return
    const info = tab.info()
    const state: FloatState = { url: info.url, title: info.title, playing: tab.playing, muted: info.muted }
    this.controls.webContents.send(IPC.float, state)
  }

  private show(anchor: FloatAnchor, size: VideoSize): void {
    const ratio = videoRatio(size.width, size.height)
    const area = screen.getDisplayMatching(this.lastBounds ?? anchor.win).workArea
    const bounds = floatingBounds({ win: anchor.win, area, ratio, sidebarRight: anchor.sidebarRight, last: this.lastBounds })
    const options: BaseWindowConstructorOptions = {
      ...bounds,
      show: false,
      frame: false,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      roundedCorners: true,
      backgroundColor: '#000000',
      title: 'Floating Player'
    }
    // A panel floats over other apps, full-screen ones too, and a click on it doesn't pull YARC forward.
    if (mac) options.type = 'panel'
    const win = new BaseWindow(options)
    this.win = win
    win.setAlwaysOnTop(true, 'floating')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    win.setAspectRatio(ratio)
    win.setMinimumSize(FLOAT_MIN_WIDTH, Math.round(FLOAT_MIN_WIDTH / ratio))

    const tab = this.tab!
    tab.view.setBorderRadius(0)
    win.contentView.addChildView(tab.view)

    const controls = new WebContentsView({ webPreferences: uiWebPreferences() })
    controls.setBackgroundColor('#00000000')
    this.controls = controls
    players.set(controls.webContents.id, this)
    const id = controls.webContents.id
    controls.webContents.once('destroyed', () => players.delete(id))
    win.contentView.addChildView(controls)
    loadRenderer(controls.webContents, 'float')
    win.on('closed', () => {
      if (!controls.webContents.isDestroyed()) controls.webContents.close()
    })

    this.layout()
    win.on('resize', () => this.layout())
    win.on('resized', () => this.remember())
    win.on('moved', () => this.remember())
    win.showInactive()
  }

  private layout(): void {
    const win = this.window
    if (!win) return
    const [width, height] = win.getContentSize()
    const rect = { x: 0, y: 0, width, height }
    this.tab?.view.setBounds(rect)
    this.controls?.setBounds(rect)
  }

  private remember(): void {
    const win = this.window
    if (win) this.lastBounds = win.getBounds()
  }

  private op(op: FloatOp): void {
    const tab = this.tab
    switch (op.kind) {
      case 'sync':
        this.ready = true
        return this.update()
      case 'back':
        if (tab) this.host.backToTab(tab.itemId)
        return
      case 'minimize':
        return this.host.minimizeFloating()
      case 'close':
        return this.host.closeFloating()
      case 'toggle':
        if (tab) void toggleMedia(tab.wc)
        return
      case 'skip':
        if (tab) void skipMedia(tab.wc, op.seconds)
        return
      case 'drag':
        return this.dragTo(op.phase, op.x, op.y)
    }
  }

  /** x, y: the pointer's screen position. */
  private dragTo(phase: 'start' | 'move' | 'end', x: number, y: number): void {
    const win = this.window
    if (!win) return
    if (phase === 'start') {
      const b = win.getBounds()
      this.drag = { dx: x - b.x, dy: y - b.y, width: b.width, height: b.height }
      return
    }
    const d = this.drag
    if (!d) return
    // setBounds, not setPosition: Windows grows a moving window by a pixel at fractional scales.
    win.setBounds({ x: Math.round(x - d.dx), y: Math.round(y - d.dy), width: d.width, height: d.height })
    if (phase === 'end') {
      this.drag = undefined
      this.remember()
    }
  }

  private static ipcReady = false

  private static registerIpc(): void {
    if (FloatingPlayer.ipcReady) return
    FloatingPlayer.ipcReady = true
    handleUi(IPC.floatOp, (e, op: FloatOp) => players.get(e.sender.id)?.op(op))
  }
}
