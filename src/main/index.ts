import { app, BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Browser } from './browser'
import { askForClientCertificates } from './client-certificates'
import { Extensions } from './extensions'
import { startLog } from './log'
import { installAppMenu, installDockMenu } from './menus'
import { profileDir } from './profile-dir'
import { Profiles } from './profiles'
import { registerUiScheme, serveUi } from './ui-origin'
import { browserUserAgent, userAgentFor } from './useragent'

// A packaged YARC never opens a DevTools port or pipe: another program could start it with one
// and read every page and cookie (Chrome refuses it for its default profile too). The fuses in
// scripts/after-pack.mjs close Node's own --inspect. The end-to-end tests drive an unpackaged build.
if (app.isPackaged && ['remote-debugging-port', 'remote-debugging-pipe'].some((s) => app.commandLine.hasSwitch(s))) {
  console.error('YARC does not allow remote debugging')
  process.exit(1)
}

// Tests and portable setups can point the profile somewhere else.
if (process.env.YARC_USER_DATA) app.setPath('userData', process.env.YARC_USER_DATA)
else app.setPath('userData', profileDir(app.getPath('appData'), app.isPackaged ? 'YARC' : 'YARC (dev)'))
// What goes wrong in main, for bug reports: ~/Library/Logs/YARC/main.log on macOS,
// %APPDATA%\YARC\logs\main.log on Windows. Dev builds and tests log inside their own profile.
startLog(join(app.isPackaged && !process.env.YARC_USER_DATA ? app.getPath('logs') : join(app.getPath('userData'), 'logs'), 'main.log'))

app.userAgentFallback = browserUserAgent(app.userAgentFallback)
registerUiScheme()
askForClientCertificates()
// macOS (and Linux) About panel: the same notice as Settings > About and NOTICE.
app.setAboutPanelOptions({
  applicationName: 'YARC',
  applicationVersion: app.getVersion(),
  copyright: 'Copyright © 2026 YARC contributors. GPL-3.0-or-later.',
  credits: "Not affiliated with The Browser Company. 'Arc' is a trademark of The Browser Company."
})
// Pages read navigator.userAgent from their webContents, so switch it as a tab heads to a host that
// needs another UA. The request that starts the navigation is already sent: profiles.ts fixes its header.
app.on('web-contents-created', (_e, wc) => {
  // No page, of any kind, gets a <webview> (it could carry its own preload and preferences).
  wc.on('will-attach-webview', (e) => e.preventDefault())
  wc.on('did-start-navigation', (e) => {
    if (!e.isMainFrame || e.isSameDocument) return
    const ua = userAgentFor(e.url, wc.session.getUserAgent())
    if (wc.getUserAgent() !== ua) wc.setUserAgent(ua)
  })
})
// Windows groups taskbar buttons and routes notifications by this id (matches electron-builder's appId).
if (process.platform === 'win32') app.setAppUserModelId('org.arcshell.browser')

/** Taskbar jump-list tasks arrive as flags, in a fresh launch or a second instance. */
type LaunchTask = 'newTab' | 'newWindow' | 'littleArc' | 'incognito'
function taskArg(argv: string[]): LaunchTask | undefined {
  if (argv.includes('--new-tab')) return 'newTab'
  if (argv.includes('--new-window')) return 'newWindow'
  if (argv.includes('--little-arc')) return 'littleArc'
  if (argv.includes('--incognito')) return 'incognito'
  return undefined
}

function runTask(browser: Browser, task: LaunchTask): void {
  if (task === 'littleArc') return void browser.openLittle()
  if (task === 'incognito') return void browser.openIncognito()
  if (task === 'newWindow') return browser.openNewWindow()
  browser.focusWindow()
  browser.runCommand('newTab')
}

function installJumpList(): void {
  if (process.platform !== 'win32' || !app.isPackaged) return
  const task = (args: string, title: string, description: string) => ({
    program: process.execPath,
    arguments: args,
    iconPath: process.execPath,
    iconIndex: 0,
    title,
    description
  })
  app.setUserTasks([
    task('--new-tab', 'New Tab', 'Open the command bar in YARC'),
    task('--new-window', 'New Window', 'Open another YARC window'),
    task('--little-arc', 'New Little Window', 'Open a small window for a quick lookup'),
    task('--incognito', 'New Incognito Window', 'Browse without saving history, cookies or site data')
  ])
}

// Links arrive as URLs; double-clicked .html files (Windows) arrive as plain paths.
function urlArg(argv: string[]): string | undefined {
  for (const a of argv.slice(1)) {
    if (/^(https?|file):/i.test(a)) return a
    if (/\.(html?|xhtml|svg|pdf)$/i.test(a) && existsSync(a)) return pathToFileURL(a).href
  }
  return undefined
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let browser: Browser | undefined
  let pendingUrl: string | undefined = urlArg(process.argv)
  let pendingTask: LaunchTask | undefined = taskArg(process.argv)

  app.on('second-instance', (_e, argv) => {
    const url = urlArg(argv)
    const task = taskArg(argv)
    if (!browser) {
      pendingUrl = url
      pendingTask = task
      return
    }
    if (url) browser.openExternalUrl(url)
    else if (task) runTask(browser, task)
    else browser.focusWindow()
  })

  // macOS delivers links (as the default browser) through open-url, possibly before ready.
  app.on('open-url', (e, url) => {
    e.preventDefault()
    if (browser) browser.openExternalUrl(url)
    else pendingUrl = url
  })

  app.on('open-file', (e, path) => {
    e.preventDefault()
    const url = pathToFileURL(path).href
    if (browser) browser.openExternalUrl(url)
    else pendingUrl = url
  })

  app.whenReady().then(async () => {
    Profiles.purgeDeleted()
    serveUi()
    Extensions.prepareUiSession()
    const b = new Browser()
    await b.restoreSessions()
    // Links and tasks that arrive meanwhile wait in pendingUrl / pendingTask.
    browser = b
    // End-to-end tests drive the controller directly.
    if (process.env.YARC_TEST) Object.assign(globalThis, { arcBrowser: browser })
    installAppMenu(browser)
    installDockMenu(browser)
    browser.start()
    installJumpList()
    if (pendingUrl) browser.openExternalUrl(pendingUrl)
    else if (pendingTask) runTask(browser, pendingTask)
    pendingUrl = undefined
    pendingTask = undefined

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) browser?.openWindow()
      else browser?.focusWindow()
    })
  })

  app.on('before-quit', () => browser?.shutdown())
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
