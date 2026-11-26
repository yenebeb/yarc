// Never used for web pages. Runs sandboxed: everything it imports is bundled into it (electron.vite.config.ts).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'
import { IPC, type ArcApi } from '../shared/ipc'

function listen<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, value: T) => cb(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const api: ArcApi = {
  platform: process.platform,
  getState: () => ipcRenderer.invoke(IPC.getState),
  getOverlay: () => ipcRenderer.invoke(IPC.getOverlay),
  onState: (cb) => listen(IPC.state, cb),
  onOverlay: (cb) => listen(IPC.overlay, cb),
  onToast: (cb) => listen(IPC.toast, cb),
  onFind: (cb) => listen(IPC.find, cb),
  onLittle: (cb) => listen(IPC.little, cb),
  onEdit: (cb) => listen(IPC.edit, cb),
  onStill: (cb) => listen(IPC.still, cb),
  onSwipe: (cb) => listen(IPC.swipe, cb),
  dispatch: (action) => ipcRenderer.invoke(IPC.action, action),
  search: (query) => ipcRenderer.invoke(IPC.search, query),
  suggest: (query) => ipcRenderer.invoke(IPC.suggest, query),
  history: (query, offset) => ipcRenderer.invoke(IPC.history, query, offset),
  deleteHistory: (url) => ipcRenderer.invoke(IPC.historyDelete, url),
  little: (op, at) => ipcRenderer.invoke(IPC.littleOp, op, at),
  onPrompt: (cb) => listen(IPC.prompt, cb),
  prompt: (op) => ipcRenderer.invoke(IPC.promptOp, op),
  focus: () => ipcRenderer.invoke(IPC.focus),
  onBlur: (cb) => listen(IPC.blur, cb),
  onFloat: (cb) => listen(IPC.float, cb),
  float: (op) => ipcRenderer.invoke(IPC.floatOp, op),
  canvasLoad: () => ipcRenderer.invoke(IPC.canvasLoad),
  canvasSave: (scene, newFiles) => ipcRenderer.send(IPC.canvasSave, scene, newFiles),
  canvasTakeInbox: () => ipcRenderer.invoke(IPC.canvasTakeInbox),
  onCanvasInbox: (cb) => listen(IPC.canvasInbox, cb),
  onCanvasFind: (cb) => listen(IPC.canvasFind, cb),
  onCanvasRenamed: (cb) => listen(IPC.canvasRenamed, cb),
  canvasOpenUrl: (url) => ipcRenderer.invoke(IPC.canvasOpenUrl, url),
  canvasSpotlightAction: (command) => ipcRenderer.invoke(IPC.canvasSpotlightAction, command),
  canvasExport: (png, to) => ipcRenderer.invoke(IPC.canvasExport, png, to),
  canvasLive: (cards) => ipcRenderer.send(IPC.canvasLive, cards),
  onCanvasShown: (cb) => listen(IPC.canvasShown, cb),
  capturePick: (x, y, depth) => ipcRenderer.invoke(IPC.capturePick, x, y, depth),
  dragDownload: (id) => ipcRenderer.send(IPC.downloadDrag, id)
}

// Never for a web page that ends up in a UI view somehow (main refuses its IPC too: ui-origin.ts).
const uiOrigin = process.argv.find((a) => a.startsWith('--yarc-ui-origin='))?.slice('--yarc-ui-origin='.length)
if (uiOrigin && location.origin === uiOrigin) {
  contextBridge.exposeInMainWorld('arc', api)
  const showsExtensionButtons = !['little.html', 'prompt.html', 'float.html', 'canvas.html'].some((page) => location.pathname.endsWith(page))
  if (showsExtensionButtons) injectBrowserAction()
}
