// The only place a view gets the ui.js preload: it loads one of YARC's own pages and can't leave it.
import { BrowserWindow, WebContentsView, type BrowserWindowConstructorOptions, type WebContents } from 'electron'
import { join } from 'node:path'
import { guardUi, uiOrigin, uiPageUrl } from './ui-origin'

export type RendererPage = 'index' | 'overlay' | 'little' | 'prompt' | 'float' | 'canvas'

function uiWebPreferences() {
  return {
    preload: join(__dirname, '../preload/ui.js'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    spellcheck: false,
    additionalArguments: [`--yarc-ui-origin=${uiOrigin()}`]
  }
}

function load(wc: WebContents, page: RendererPage, query?: Record<string, string>): void {
  guardUi(wc)
  void wc.loadURL(uiPageUrl(page, query))
}

export function uiView(page: RendererPage, query?: Record<string, string>): WebContentsView {
  const view = new WebContentsView({ webPreferences: uiWebPreferences() })
  load(view.webContents, page, query)
  return view
}

export function uiWindow(page: RendererPage, options: Omit<BrowserWindowConstructorOptions, 'webPreferences'>): BrowserWindow {
  const win = new BrowserWindow({ ...options, webPreferences: uiWebPreferences() })
  load(win.webContents, page)
  return win
}
