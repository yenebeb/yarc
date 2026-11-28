// Everything YARC's own UI can ask of the main process, except the permission prompt's answer (core/prompt-view.ts). What a web page can send is in core/page-ipc.ts.
import type { WebContents } from 'electron'
import type { Action } from '../shared/actions'
import type { CanvasImage, CanvasScene, LiveCard } from '../shared/canvas'
import { IPC, type FloatOp, type LittleAnchor, type LittleOp } from '../shared/ipc'
import type { Browser } from './browser'
import { handleUi, onUi } from './core/ui-origin'
import type { CanvasPage, Canvases } from './features/canvas'
import { isLiveCard } from './features/capture-live'
import { floatingPlayerOf } from './features/floating-player'
import { search, suggest } from './features/search'

type Sent = { sender: WebContents }

/** `browsers`: the main controller and one per incognito window. */
export function registerIpc(browsers: Iterable<Browser>): void {
  const browserOf = (event: Sent): Browser => {
    for (const browser of browsers) if (browser.takes(event.sender)) return browser
    throw new Error('IPC from a view no window owns')
  }
  const canvasOf = (event: Sent): { canvases: Canvases; page: CanvasPage } | undefined => {
    for (const browser of browsers) {
      const page = browser.canvases.pageOf(event.sender)
      if (page) return { canvases: browser.canvases, page }
    }
    return undefined
  }
  const canvasOrThrow = (event: Sent) => {
    const canvas = canvasOf(event)
    if (!canvas) throw new Error('canvas IPC from a view that isn’t a canvas page')
    return canvas
  }
  const historyOf = (browser: Browser) => browser.profiles.get(browser.space.profileId).history

  handleUi(IPC.action, (event, action: Action) => browserOf(event).dispatch(action))
  handleUi(IPC.getState, (event) => browserOf(event).snapshot())
  handleUi(IPC.getOverlay, (event) => browserOf(event).window.overlayMode)
  handleUi(IPC.search, (event, query: string) => search(browserOf(event), String(query)))
  handleUi(IPC.suggest, (event, query: string) => suggest(browserOf(event), String(query)))
  handleUi(IPC.history, (event, query: string, offset: number) => historyOf(browserOf(event)).recent(200, Math.max(0, Math.floor(Number(offset) || 0)), String(query ?? '')))
  handleUi(IPC.historyDelete, (event, url: string) => historyOf(browserOf(event)).deleteUrl(String(url)))
  handleUi(IPC.focus, (event) => event.sender.focus())
  onUi(IPC.downloadDrag, (event, id: string) => browserOf(event).downloads.drag(String(id), event.sender))
  handleUi(IPC.capturePick, (event, x: number, y: number, depth: number) => {
    const browser = browserOf(event)
    const tab = browser.activeTab()
    return tab && browser.window.overlayMode.kind === 'capture' ? browser.canvases.pick(tab, x, y, depth) : undefined
  })
  handleUi(IPC.littleOp, (event, op: LittleOp, at?: LittleAnchor) => {
    for (const little of browserOf(event).openLittles()) if (little.win.webContents === event.sender) return little.op(op, at)
  })
  handleUi(IPC.floatOp, (event, op: FloatOp) => floatingPlayerOf(event.sender.id)?.op(op))

  handleUi(IPC.canvasLoad, (event) => {
    const { canvases, page } = canvasOrThrow(event)
    return canvases.load(page.id)
  })
  onUi(IPC.canvasSave, (event, scene: CanvasScene, newFiles: Record<string, CanvasImage>) => {
    const canvas = canvasOf(event)
    if (canvas) canvas.canvases.save(canvas.page.id, scene, newFiles)
  })
  handleUi(IPC.canvasTakeInbox, (event) => {
    const { canvases, page } = canvasOrThrow(event)
    return canvases.files(page.id)?.takeInbox() ?? []
  })
  handleUi(IPC.canvasOpenUrl, (event, url: string) => {
    const { canvases, page } = canvasOrThrow(event)
    return canvases.openUrl(page.id, String(url))
  })
  handleUi(IPC.canvasSpotlightAction, (event, command: string) => canvasOrThrow(event).canvases.runSpotlightAction(String(command)))
  onUi(IPC.canvasLive, (event, cards: LiveCard[]) => {
    const canvas = canvasOf(event)
    if (canvas && Array.isArray(cards)) canvas.canvases.play(canvas.page, cards.filter(isLiveCard))
  })
  handleUi(IPC.canvasExport, (event, png: Uint8Array, to: 'file' | 'clipboard') => {
    const { canvases, page } = canvasOrThrow(event)
    return canvases.export(page.id, png, to)
  })
}
