// YARC's own pages (sidebar, overlay, Little Arc toolbar, permission prompt) come from yarc://ui/,
// not file://. That gives the UI an origin of its own, which the preload and every IPC handler
// check, and lets file:// pages in tabs run without Electron's extra file privileges (the
// GrantFileProtocolExtraPrivileges fuse is off, scripts/after-pack.mjs).
import { app, ipcMain, protocol, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { logError } from './log'

const SCHEME = 'yarc'
const ORIGIN = `${SCHEME}://ui`

/** Packaged builds: no inline scripts, no frames, no plugins; images only from data:, crx: (extension icons) and https. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: crx: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff'
}

/** The dev server while developing (`pnpm dev`), else yarc://ui. A packaged app never uses the dev server. */
function devServer(): string | undefined {
  return app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL || undefined
}

export function uiOrigin(): string {
  const dev = devServer()
  return dev ? new URL(dev).origin : ORIGIN
}

export function uiPageUrl(page: string): string {
  return `${devServer() ?? ORIGIN}/${page}.html`
}

/**
 * Before app ready: yarc: behaves like https (secure, standard origin, fetch). Electron keeps only
 * the last registerSchemesAsPrivileged call, so this one also repeats electron-chrome-extensions'
 * crx: (extension icons), which it registers when it's imported.
 */
export function registerUiScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'crx', privileges: { bypassCSP: true } }
  ])
}

/** Serves the built renderer from yarc://ui/ in the default session, the one UI views use. Tabs' profile sessions don't have it. */
export function serveUi(): void {
  const root = join(__dirname, '../renderer')
  protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url)
    const file = normalize(join(root, decodeURIComponent(url.pathname)))
    if (url.host !== 'ui' || !file.startsWith(root + sep)) return new Response('Not found', { status: 404 })
    try {
      const body = await readFile(file)
      const headers: Record<string, string> = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }
      if (extname(file) === '.html') headers['Content-Security-Policy'] = CSP
      return new Response(body, { headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

/** Whether an IPC message comes from the main frame of one of YARC's own pages. */
export function fromUi(e: IpcMainInvokeEvent): boolean {
  const frame = e.senderFrame
  if (!frame || frame !== e.sender.mainFrame) return false
  return frame.url.startsWith(`${uiOrigin()}/`)
}

/** ipcMain.handle for UI channels: anything else (a web page, an extension) is refused. */
export function handleUi<A extends unknown[], R>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => R): void {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!fromUi(e)) throw new Error(`${channel}: not from YARC's UI`)
    try {
      return await fn(e, ...(args as A))
    } catch (err) {
      // Otherwise it only reaches the sidebar's console, which a packaged build can't open.
      logError(`${channel}${actionType(args[0])}`, err)
      throw err
    }
  })
}

/** An action's type (never its URLs or text), to say which sidebar action failed. */
function actionType(arg: unknown): string {
  const type = arg && typeof arg === 'object' && 'type' in arg ? arg.type : undefined
  return typeof type === 'string' ? ` ${type}` : ''
}

/**
 * A UI view never leaves its page: no link, dropped URL or window.open can load a web page into it
 * (it would get window.arc). Its own loadURL/loadFile calls from main don't emit will-navigate.
 */
export function guardUi(wc: WebContents): void {
  wc.on('will-navigate', (e) => e.preventDefault())
  wc.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame) e.preventDefault()
  })
  wc.on('will-attach-webview', (e) => e.preventDefault())
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
}
