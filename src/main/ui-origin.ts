// Not file://: the UI gets an origin the preload and IPC handlers check, and file:// tabs run without extra privileges.
import { app, ipcMain, protocol, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { logError } from './log'

const SCHEME = 'yarc'
const ORIGIN = `${SCHEME}://ui`

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

function devServer(): string | undefined {
  return app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL || undefined
}

export function uiOrigin(): string {
  const dev = devServer()
  return dev ? new URL(dev).origin : ORIGIN
}

export function uiPageUrl(page: string, query?: Record<string, string>): string {
  const search = query ? `?${new URLSearchParams(query)}` : ''
  return `${devServer() ?? ORIGIN}/${page}.html${search}`
}

/** Before app ready. Electron keeps only the last call, so it repeats electron-chrome-extensions' crx:. */
export function registerUiScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'crx', privileges: { bypassCSP: true } }
  ])
}

/** In the default session, the one UI views use; tabs' profile sessions don't have it. */
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

export function fromUi(e: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const frame = e.senderFrame
  if (!frame || frame !== e.sender.mainFrame) return false
  return frame.url.startsWith(`${uiOrigin()}/`)
}

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

/** For messages without an answer; refused like handleUi's. */
export function onUi<A extends unknown[]>(channel: string, fn: (e: IpcMainEvent, ...args: A) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (!fromUi(e)) return
    try {
      fn(e, ...(args as A))
    } catch (err) {
      logError(channel, err)
    }
  })
}

/** Never its URLs or text. */
function actionType(arg: unknown): string {
  const type = arg && typeof arg === 'object' && 'type' in arg ? arg.type : undefined
  return typeof type === 'string' ? ` ${type}` : ''
}

/** A web page loaded into a UI view would get window.arc. Main's own loadURL doesn't emit will-navigate. */
export function guardUi(wc: WebContents): void {
  wc.on('will-navigate', (e) => e.preventDefault())
  wc.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame) e.preventDefault()
  })
  wc.on('will-attach-webview', (e) => e.preventDefault())
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
}
