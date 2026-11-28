import { BrowserWindow, clipboard, ClipboardItem, dialog, nativeImage, View, type Event, type Input, type WebContents, type WebContentsView } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FILE_ID, IMAGE_TYPES, isBoardAppearance, isBoardBackground, MAX_QUOTE_LENGTH, type CanvasImage, type CanvasLoad, type CanvasScene, type CaptureGeometry, type CaptureSource, type LiveCard, type QueuedInboxItem } from '../../shared/canvas'
import { IPC } from '../../shared/ipc'
import { bindingLabel, commandForInput, type CommandId } from '../../shared/keymap'
import { findCanvas, spaceCanvases } from '../../shared/tree'
import { spotlight, SPOTLIGHTS } from '../../shared/spotlights'
import type { CaptureTo } from '../../shared/actions'
import type { ID, PinnedCanvas, Rect, Space } from '../../shared/types'
import type { Browser } from '../browser'
import { CanvasFiles, emptyOldTrash } from './canvas-store'
import { LiveCapture } from './capture-live'
import { logError } from '../core/log'
import type { CanvasFindOp } from '../../shared/canvas-find'
import { newId } from '../core/store'
import type { LiveTab } from '../core/tab'
import { wholePage } from '../core/page-devtools'
import { elementBoxAt, selectedText, viewportOf } from '../core/page-scripts'
import { uiView } from '../core/ui-view'
import { imageOnPage } from '../net/outbound'
import { BOARDS, RELEASES_STILL } from './whats-new-boards'
import releasesStill from './whats-new-releases.png?asset'

const MAX_IMAGE_BYTES = 25 * 1024 * 1024
/** YARC shortcuts a focused canvas keeps for itself: ⌘D duplicates, ⌘± and ⌘0 zoom the board. */
const CANVAS_KEYS = new Set<CommandId>(['togglePin', 'zoomIn', 'zoomOut', 'zoomReset'])

export class CanvasPage {
  /** What the window shows: the page, with its live cards above it (a web page's own child views are drawn under it). */
  readonly stage = new View()
  readonly view: WebContentsView
  readonly live = new Map<string, LiveCapture>()
  private shown = true

  constructor(
    readonly id: ID,
    onInput: (e: Event, input: Input) => void
  ) {
    this.view = uiView('canvas', { id })
    this.view.setBorderRadius(8)
    this.view.webContents.on('before-input-event', onInput)
    this.stage.addChildView(this.view)
    this.stage.on('bounds-changed', () => {
      const { width, height } = this.stage.getBounds()
      this.view.setBounds({ x: 0, y: 0, width, height })
    })
  }

  get wc(): WebContents {
    return this.view.webContents
  }

  setShown(shown: boolean): void {
    if (shown === this.shown || this.wc.isDestroyed()) return
    this.shown = shown
    this.wc.send(IPC.canvasShown, shown)
  }

  stop(cardId: string): void {
    const live = this.live.get(cardId)
    if (!live) return
    this.live.delete(cardId)
    this.stage.removeChildView(live.view)
    live.close()
  }

  destroy(): void {
    for (const id of [...this.live.keys()]) this.stop(id)
    if (!this.wc.isDestroyed()) this.wc.close()
  }
}

export class Canvases {
  private pages = new Map<ID, CanvasPage>()

  constructor(private readonly browser: Browser) {}

  root(profileId: ID): string {
    return join(this.browser.profiles.dir(profileId), 'Canvases')
  }

  files(id: ID): CanvasFiles | undefined {
    const hit = findCanvas(this.browser.state, id)
    return hit ? new CanvasFiles(this.root(hit.space.profileId), id) : undefined
  }

  page(id: ID): CanvasPage {
    let page = this.pages.get(id)
    if (page && !page.wc.isDestroyed()) return page
    page = new CanvasPage(id, (e, input) => {
      const cmd = commandForInput(input, process.platform === 'darwin', this.browser.state.settings.shortcuts)
      if (!cmd || !CANVAS_KEYS.has(cmd)) this.browser.handleInput(e, input)
    })
    this.pages.set(id, page)
    return page
  }

  find(id: ID, op: CanvasFindOp): void {
    const { wc } = this.page(id)
    wc.focus()
    wc.send(IPC.canvasFind, op)
  }

  showing(isShown: (view: View) => boolean): void {
    for (const page of this.pages.values()) page.setShown(isShown(page.stage))
  }

  pageOf(wc: WebContents): CanvasPage | undefined {
    for (const page of this.pages.values()) if (page.wc === wc) return page
    return undefined
  }

  /** The page saves as it goes, so closing it loses nothing. */
  private dropPage(id: ID): void {
    const page = this.pages.get(id)
    if (!page) return
    this.pages.delete(id)
    this.browser.detachEverywhere(page.stage)
    page.destroy()
  }

  create(space: Space, name = 'New Canvas'): PinnedCanvas {
    const canvas: PinnedCanvas = { kind: 'canvas', id: newId(), name, lastActive: Date.now() }
    space.pinned.push(canvas)
    return canvas
  }

  /** One at a time: a new board replaces the one still open. */
  createWhatsNew(space: Space, spotlightId: string): PinnedCanvas {
    this.discardTemporary()
    const canvas = this.create(space, spotlight(spotlightId)?.title)
    canvas.temporary = true
    const files = new CanvasFiles(this.root(space.profileId), canvas.id)
    files.writeImage(RELEASES_STILL, readFileSync(releasesStill), 'image/png')
    files.writeScene(BOARDS[spotlightId])
    return canvas
  }

  keep(id: ID): void {
    const hit = findCanvas(this.browser.state, id)
    if (hit) delete hit.canvas.temporary
  }

  discard(id: ID): void {
    const hit = findCanvas(this.browser.state, id)
    if (!hit) return
    this.dropPage(id)
    try {
      new CanvasFiles(this.root(hit.space.profileId), id).remove()
    } catch (err) {
      logError('canvas: discard', err)
    }
    hit.list.splice(hit.index, 1)
  }

  discardTemporary(): void {
    for (const space of this.browser.state.spaces) for (const canvas of spaceCanvases(space)) if (canvas.temporary) this.discard(canvas.id)
  }

  rename(id: ID, name: string): void {
    const hit = findCanvas(this.browser.state, id)
    const to = name.trim()
    if (!hit || !to || to === hit.canvas.name) return
    const from = hit.canvas.name
    hit.canvas.name = to
    const page = this.pages.get(id)
    if (page && !page.wc.isDestroyed()) page.wc.send(IPC.canvasRenamed, { from, to })
  }

  delete(id: ID): void {
    const hit = findCanvas(this.browser.state, id)
    if (!hit) return
    this.dropPage(id)
    try {
      new CanvasFiles(this.root(hit.space.profileId), id).trash()
      emptyOldTrash(this.root(hit.space.profileId))
    } catch (err) {
      logError('canvas: trash', err)
    }
    hit.list.splice(hit.index, 1)
  }

  moveFiles(id: ID, fromProfile: ID, toProfile: ID): void {
    if (fromProfile === toProfile) return
    this.dropPage(id)
    const from = join(this.root(fromProfile), id)
    const to = join(this.root(toProfile), id)
    if (!existsSync(from) || existsSync(to)) return
    mkdirSync(this.root(toProfile), { recursive: true, mode: 0o700 })
    renameSync(from, to)
  }

  private target(canvasId: ID | 'new'): PinnedCanvas | undefined {
    if (canvasId === 'new') {
      const canvas = this.create(this.browser.space)
      this.browser.changed()
      return canvas
    }
    return findCanvas(this.browser.state, canvasId)?.canvas
  }

  private deliver(canvas: PinnedCanvas, bytes: Buffer, mimeType: string, size: { width: number; height: number }, source: CaptureSource, capture?: CaptureGeometry, imageUrl?: string): void {
    const files = this.files(canvas.id)
    if (!files) return
    const fileId = files.addImage(bytes, mimeType)
    this.queue(canvas, { fileId, mimeType, width: size.width, height: size.height, data: { source, capture, imageUrl } })
  }

  private queue(canvas: PinnedCanvas, entry: QueuedInboxItem): void {
    this.files(canvas.id)?.pushInbox(entry)
    // The Send To list shows the canvas used last first.
    canvas.lastActive = Date.now()
    this.browser.changed()
    const page = this.pages.get(canvas.id)
    if (page && !page.wc.isDestroyed()) page.wc.send(IPC.canvasInbox)
    this.browser.toast(`Added to “${canvas.name}”`)
  }

  /** The selected text of a page, as a quote with the page as its source. `shownInMenu` is used when the page can't be asked: Chromium cuts what its menu holds short. */
  async addSelection(tab: LiveTab, shownInMenu: string, canvasId: ID | 'new'): Promise<void> {
    const selection = await selectedText(tab.wc).catch(() => shownInMenu)
    const quote = String(selection || shownInMenu).trim().slice(0, MAX_QUOTE_LENGTH)
    if (!quote) return
    const canvas = this.target(canvasId)
    if (canvas) this.queue(canvas, { quote, source: this.sourceOf(tab) })
  }

  private sourceOf(tab: LiveTab): CaptureSource {
    return { url: tab.wc.getURL(), title: tab.wc.getTitle(), favicon: tab.favicon }
  }

  /** `rect` is in device-independent pixels of the tab's view; `whole` captures the full length of the page instead. */
  async capture(tab: LiveTab, rect: Rect, to: CaptureTo, whole = false): Promise<void> {
    const wc = tab.wc
    if (whole) {
      const shot = await wholePage(wc)
      if (!shot) return this.browser.toast('Couldn’t capture this page')
      return this.place(tab, shot.png, to, { width: shot.width, height: shot.height })
    }
    const bounds = tab.view.getBounds()
    const r = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.round(Math.min(rect.width, bounds.width - rect.x)),
      height: Math.round(Math.min(rect.height, bounds.height - rect.y))
    }
    if (r.width < 4 || r.height < 4) return
    const image = await wc.capturePage(r)
    if (image.isEmpty()) return this.browser.toast('Couldn’t capture this page')
    const size = { width: r.width, height: r.height }
    if (to === 'copy' || to === 'save') return this.place(tab, image.toPNG(), to, size)
    const zoom = wc.getZoomFactor()
    let capture: CaptureGeometry | undefined
    try {
      const view = await viewportOf(wc)
      capture = {
        viewport: { width: view.width, height: view.height },
        rect: { x: r.x / zoom, y: r.y / zoom, width: r.width / zoom, height: r.height / zoom },
        scroll: { x: view.x, y: view.y }
      }
    } catch {}
    return this.place(tab, image.toPNG(), to, size, capture)
  }

  private async place(tab: LiveTab, png: Buffer, to: CaptureTo, size: { width: number; height: number }, capture?: CaptureGeometry): Promise<void> {
    if (to === 'copy') {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
      return this.browser.toast('Copied')
    }
    if (to === 'save') return this.savePng(png, tab.wc.getTitle() || 'Capture')
    const canvas = this.target(to)
    if (canvas) this.deliver(canvas, png, 'image/png', size, this.sourceOf(tab), capture)
  }

  async pick(tab: LiveTab, x: number, y: number, depth: number): Promise<Rect | undefined> {
    const zoom = tab.wc.getZoomFactor()
    const box = await elementBoxAt(tab.wc, Number(x) / zoom, Number(y) / zoom, depth).catch(() => null)
    return box ? { x: box.x * zoom, y: box.y * zoom, width: box.w * zoom, height: box.h * zoom } : undefined
  }

  /** Fetched with the page's session, so images behind a login work. */
  async addImage(tab: LiveTab, srcURL: string, canvasId: ID | 'new'): Promise<void> {
    let bytes: Buffer
    let mimeType: string
    try {
      if (srcURL.startsWith('data:')) {
        const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(srcURL)
        if (!m) throw new Error('bad data URL')
        mimeType = m[1]
        bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
      } else if (/^https?:/i.test(srcURL)) {
        const res = await imageOnPage(tab.wc.session, srcURL, tab.wc.getURL())
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        mimeType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
        bytes = Buffer.from(await res.arrayBuffer())
      } else {
        return this.browser.toast('This image can’t be added; try Capture instead')
      }
    } catch (err) {
      logError('canvas: add image', err)
      return this.browser.toast('Couldn’t download the image')
    }
    if (!IMAGE_TYPES[mimeType]) return this.browser.toast('This kind of image can’t be added; try Capture instead')
    if (bytes.length > MAX_IMAGE_BYTES) return this.browser.toast('The image is too big')
    const canvas = this.target(canvasId)
    if (!canvas) return
    // The page measures images main can't decode (WebP, AVIF…): a size of 0 means "its own".
    const size = nativeImage.createFromBuffer(bytes).getSize()
    this.deliver(canvas, bytes, mimeType, size, this.sourceOf(tab), undefined, srcURL)
  }

  load(id: ID): CanvasLoad {
    const hit = findCanvas(this.browser.state, id)
    const files = this.files(id)
    if (!hit || !files) throw new Error('no such canvas')
    const captureKey = bindingLabel('capture', process.platform === 'darwin', this.browser.state.settings.shortcuts)
    return { id, name: hit.canvas.name, scene: files.readScene(), files: files.readImages(), captureKey }
  }

  save(id: ID, scene: CanvasScene, newFiles: Record<string, CanvasImage>): void {
    const files = this.files(id)
    if (!files || !scene || !Array.isArray(scene.items)) return
    for (const [fileId, image] of Object.entries(newFiles ?? {})) {
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(image?.dataURL ?? '')
      if (!m || !FILE_ID.test(fileId) || !IMAGE_TYPES[m[1]]) continue
      files.writeImage(fileId, Buffer.from(m[2], 'base64'), m[1])
    }
    files.writeScene({ items: scene.items, view: scene.view, snapping: scene.snapping, appearance: isBoardAppearance(scene.appearance) ? scene.appearance : undefined, background: isBoardBackground(scene.background) ? scene.background : undefined })
  }

  play(page: CanvasPage, cards: LiveCard[]): void {
    const hit = findCanvas(this.browser.state, page.id)
    if (!hit || this.browser.incognito) return
    const wanted = new Map(cards.map((c) => [c.id, c]))
    for (const [id, live] of page.live) if (wanted.get(id)?.url !== live.url) page.stop(id)
    for (const card of wanted.values()) {
      const live = page.live.get(card.id)
      if (live) live.update(card)
      else {
        const added = new LiveCapture(this.browser, hit.space.profileId, card)
        page.live.set(card.id, added)
        page.stage.addChildView(added.view)
      }
    }
  }

  // A canvas holds whatever was pasted into it, so its page may only run what a spotlight's own button runs.
  runSpotlightAction(command: string): void {
    const offered = SPOTLIGHTS.some((feature) => feature.actions?.some((action) => action.command === command))
    if (offered) this.browser.runCommand(command)
  }

  openUrl(id: ID, url: string): void {
    const hit = findCanvas(this.browser.state, id)
    if (!hit || !/^https?:/i.test(url)) return
    this.browser.openPeek(hit.space.profileId, url)
  }

  async export(id: ID, png: Uint8Array, to: 'file' | 'clipboard'): Promise<void> {
    const hit = findCanvas(this.browser.state, id)
    if (!hit) return
    const bytes = Buffer.from(png)
    if (to === 'clipboard') {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })])
      return this.browser.toast('Copied as PNG')
    }
    await this.savePng(bytes, hit.canvas.name || 'Canvas')
  }

  private async savePng(bytes: Buffer, name: string): Promise<void> {
    const win = BrowserWindow.getFocusedWindow() ?? this.browser.window.win
    const safe = name.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || 'Capture'
    const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: `${safe}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] })
    if (canceled || !filePath) return
    writeFileSync(filePath, bytes)
  }
}
