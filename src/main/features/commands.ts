// What every shortcut, command and UI action does.
import { app, dialog, nativeTheme, type Event, type Input } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Action } from '../../shared/actions'
import { IPC } from '../../shared/ipc'
import { commandForInput, type CommandId } from '../../shared/keymap'
import { validSettingsPatch } from '../../shared/settings'
import { resizeGroup, splitOf } from '../../shared/split'
import { nextStep } from '../../shared/tour'
import { findCanvas, findFolder, findItem, spaceItems } from '../../shared/tree'
import type { ID } from '../../shared/types'
import type { Browser } from '../browser'
import { openInChrome } from '../core/chrome'
import { newId } from '../core/store'
import type { LiveTab } from '../core/tab'
import { importChoices, runImport } from '../importers'
import { bookmarksHtml } from './bookmarks-export'
import { FLOATING_DEMO_URL } from './floating-demo'
import { buildAppMenu, buildCanvasMenu, buildFolderMenu, buildItemMenu, buildSidebarMenu, buildSpaceMenu, buildSplitMenu } from './menus'
import { runPageAction } from './page-actions'

const isMac = process.platform === 'darwin'

/** Find on a canvas goes to its own page, which searches the board's texts. */
const CANVAS_FIND_OPS = { find: 'open', findNext: 'next', findPrev: 'previous' } as const

const COMMAND_ACTIONS: Partial<Record<CommandId, Action>> = {
  newTab: { type: 'overlay', mode: { kind: 'command', target: 'tab' } },
  splitAdd: { type: 'overlay', mode: { kind: 'command', target: 'split' } },
  find: { type: 'overlay', mode: { kind: 'find' } },
  history: { type: 'overlay', mode: { kind: 'library', tab: 'history' } },
  downloads: { type: 'overlay', mode: { kind: 'library', tab: 'downloads' } },
  library: { type: 'overlay', mode: { kind: 'library', tab: 'archive' } },
  settings: { type: 'overlay', mode: { kind: 'settings' } },
  trafficControl: { type: 'overlay', mode: { kind: 'settings', section: 'traffic' } },
  historySync: { type: 'overlay', mode: { kind: 'settings', section: 'sync' } },
  newSpace: { type: 'overlay', mode: { kind: 'space-editor' } },
  tour: { type: 'overlay', mode: { kind: 'tour', step: 'welcome' } },
  toggleSidebar: { type: 'toggleSidebar' },
  copyUrl: { type: 'copyUrl' },
  copyUrlMarkdown: { type: 'copyUrl', markdown: true },
  littleArc: { type: 'littleArc' },
  reopenClosed: { type: 'reopenClosed' },
  clearToday: { type: 'clearToday' },
  nextSpace: { type: 'switchSpaceRelative', delta: 1 },
  prevSpace: { type: 'switchSpaceRelative', delta: -1 },
  splitClose: { type: 'unsplit' },
  devtools: { type: 'devtools' },
  reload: { type: 'reload' },
  hardReload: { type: 'reload', hard: true },
  stop: { type: 'stop' },
  back: { type: 'back' },
  forward: { type: 'forward' },
  zoomIn: { type: 'zoom', delta: 1 },
  zoomOut: { type: 'zoom', delta: -1 },
  zoomReset: { type: 'zoom', delta: 0 },
  newFolder: { type: 'newFolder' },
  newLiveFolder: { type: 'overlay', mode: { kind: 'live-folder' } },
  openInChrome: { type: 'openInChrome' },
  importArc: { type: 'import', source: 'arc' },
  importZen: { type: 'import', source: 'zen' },
  importChrome: { type: 'import', source: 'chrome' },
  exportBookmarks: { type: 'exportBookmarks' },
  extensions: { type: 'extensionsStore' }
}

async function exportBookmarks(browser: Browser): Promise<void> {
  const state = (browser.main ?? browser).state
  const defaultPath = join(app.getPath('downloads'), `YARC bookmarks ${new Date().toISOString().slice(0, 10)}.html`)
  const { canceled, filePath } = await dialog.showSaveDialog(browser.window.win, { defaultPath, filters: [{ name: 'Bookmarks', extensions: ['html'] }] })
  if (canceled || !filePath) return
  try {
    await writeFile(filePath, bookmarksHtml(state))
    browser.toast(`Exported ${state.spaces.length === 1 ? '1 space' : `${state.spaces.length} spaces`} as bookmarks`)
  } catch (err) {
    browser.toast(`Export failed: ${(err as Error).message}`)
  }
}

async function floatingPlayerDemo(browser: Browser): Promise<void> {
  if (!browser.state.settings.floatVideos) return browser.toast('Turn on floating videos in Settings first')
  const from = browser.space.activeItemId
  const demo = browser.tabs.newTab(FLOATING_DEMO_URL)
  demo.title = 'Floating Player Demo'
  const tab = browser.live.get(demo.id)
  for (let attempt = 0; attempt < 50 && tab && !tab.playing && !tab.destroyed; attempt++) await sleep(100)
  if (!tab?.playing || browser.space.activeItemId !== demo.id) return
  await sleep(1200)
  if (browser.space.activeItemId !== demo.id) return
  if (from && findItem(browser.state, from)) browser.activate(from)
  else browser.toast('Switch to another tab to see the video float')
}

/** Chromium drops a view's key-ups after a key-down the browser handled, until its next key-down: send one so releasing Ctrl gets through. */
function letSwitcherSeeRelease(browser: Browser): void {
  const window = browser.cur
  const overlay = window.main.overlay.webContents
  setImmediate(() => {
    if (window.switcher && !overlay.isDestroyed()) overlay.sendInputEvent({ type: 'keyDown', keyCode: 'Control', modifiers: ['control'] })
  })
}

export function handleInput(browser: Browser, event: Event, input: Input): void {
  if (browser.cur.switcher && input.type === 'keyUp' && (input.key === 'Control' || input.key === 'Meta')) {
    const target = browser.cur.switcher.order[browser.cur.switcher.index]
    browser.cur.switcher = undefined
    browser.setOverlay({ kind: 'none' }, false)
    if (target) browser.activate(target)
    return
  }
  if (browser.recordingShortcut) return
  if (input.type === 'keyDown' && input.key === 'Escape' && browser.panelInFront()) {
    event.preventDefault()
    browser.setOverlay({ kind: 'none' })
    return
  }
  const cmd = commandForInput(input, isMac, browser.state.settings.shortcuts)
  if (!cmd) return
  event.preventDefault()
  runCommand(browser, cmd)
}

export function runCommand(browser: Browser, cmd: CommandId | string): void {
  const tab = browser.activeTab()
  const canvasId = tab ? undefined : browser.space.activeItemId
  if (canvasId && cmd in CANVAS_FIND_OPS && findCanvas(browser.state, canvasId)) return browser.canvases.find(canvasId, CANVAS_FIND_OPS[cmd as keyof typeof CANVAS_FIND_OPS])
  const findsWithNoPageToSearch = cmd === 'find' && !tab
  if (findsWithNoPageToSearch) return
  const action = Object.hasOwn(COMMAND_ACTIONS, cmd) && COMMAND_ACTIONS[cmd as CommandId]
  if (action) return void dispatch(browser, action)
  const space = browser.space
  const num = /^(space|tab)(\d)$/.exec(cmd)
  if (num) {
    const index = Number(num[2]) - 1
    if (num[1] === 'space') {
      const numbered = browser.state.spaces[index]
      if (numbered) browser.spaces.switchSpace(numbered.id)
    } else {
      const items = spaceItems(browser.state, space)
      const item = cmd === 'tab9' ? items[items.length - 1] : items[index]
      if (item) browser.activate(item.id)
    }
    return
  }
  switch (cmd as CommandId) {
    case 'editUrl':
      // The command bar replaces Peek; edit the Peek page's URL as a real tab.
      if (browser.cur.peek) browser.expandPeek()
      return browser.setOverlay({ kind: 'command', target: 'current', editCurrent: true, initial: tab?.wc.getURL() ?? '' })
    case 'newWindow':
      return browser.openNewWindow()
    case 'newIncognitoWindow':
      return void browser.openIncognito()
    case 'closeTab':
      if (browser.cur.peek) return browser.closePeek()
      if (space.activeItemId) browser.tabs.close(space.activeItemId)
      return
    case 'togglePin':
      if (space.activeItemId) browser.tabs.togglePin(space.activeItemId)
      return
    case 'nextTab':
    case 'prevTab': {
      const items = spaceItems(browser.state, space)
      if (!items.length) return
      const index = items.findIndex((item) => item.id === space.activeItemId)
      const next = items[(index + (cmd === 'nextTab' ? 1 : -1) + items.length) % items.length]
      return browser.activate(next.id)
    }
    case 'switcherNext':
    case 'switcherPrev': {
      const ids = new Set(spaceItems(browser.state, space).map((item) => item.id))
      if (!browser.cur.switcher) {
        const order = [...browser.tabs.mru.filter((id) => ids.has(id)), ...[...ids].filter((id) => !browser.tabs.mru.includes(id))]
        if (order.length < 2) return
        browser.cur.switcher = { order, index: cmd === 'switcherNext' ? 1 : order.length - 1 }
      } else {
        const count = browser.cur.switcher.order.length
        browser.cur.switcher.index = (browser.cur.switcher.index + (cmd === 'switcherNext' ? 1 : -1) + count) % count
      }
      const switcher = browser.cur.switcher
      browser.setOverlay({ kind: 'switcher', order: switcher.order, index: switcher.index })
      browser.cur.switcher = switcher
      letSwitcherSeeRelease(browser)
      return
    }
    case 'findNext':
    case 'findPrev':
      browser.window.sendToOverlay(IPC.find, { step: cmd === 'findNext' ? 1 : -1 })
      return
    case 'duplicate':
      if (tab) browser.tabs.newTab(tab.wc.getURL())
      return
    case 'focusPage':
      return void tab?.wc.focus()
    case 'setDefaultBrowser':
      return browser.makeDefaultBrowser()
    case 'checkForUpdates':
      return void browser.updater.check(true)
    case 'installUpdate':
      return void browser.updater.apply()
    case 'newCanvas':
      return browser.newCanvas()
    case 'capture':
      return browser.startCapture()
    case 'whatsNew':
      return browser.whatsNew.openWhatsNew()
    case 'floatingPlayerDemo':
      return void floatingPlayerDemo(browser)
  }
}

function tabFor(browser: Browser, action: Action): LiveTab | undefined {
  const paneBarAction = action.type === 'back' || action.type === 'forward' || action.type === 'reload' || action.type === 'stop' || action.type === 'copyUrl'
  return paneBarAction && action.id ? browser.live.get(action.id) : browser.activeTab()
}

export async function dispatch(browser: Browser, action: Action): Promise<void> {
  const tab = tabFor(browser, action)
  const space = browser.space
  switch (action.type) {
    case 'activate':
      return browser.activate(action.id)
    case 'close':
      return browser.tabs.close(action.id)
    case 'open':
      browser.setOverlay({ kind: 'none' }, false)
      return browser.tabs.open(action.url, action.where, action.splitAt)
    case 'reopenClosed':
      return browser.tabs.reopenClosed()
    case 'togglePin':
      return browser.tabs.togglePin(action.id)
    case 'addFavorite':
      return browser.tabs.addFavorite(action.id)
    case 'resetToSaved':
      return browser.tabs.resetToSaved(action.id)
    case 'duplicate': {
      const item = findItem(browser.state, action.id)?.item
      if (item) browser.tabs.newTab(browser.live.get(action.id)?.wc.getURL() || item.url)
      return
    }
    case 'rename': {
      const item = findItem(browser.state, action.id)?.item
      if (!item) return
      item.savedTitle = action.title.trim() || undefined
      return browser.changed()
    }
    case 'move':
      return browser.tabs.move(action.id, action.to)
    case 'moveToSpace':
      return browser.tabs.moveToSpace(action.id, action.spaceId)
    case 'clearToday':
      return browser.tabs.clearToday()
    case 'unload':
      return browser.tabs.unload(action.id)
    case 'mute': {
      const muted = browser.live.get(action.id)
      if (muted) muted.wc.setAudioMuted(!muted.wc.isAudioMuted())
      return browser.emitSoon()
    }
    case 'media':
      return browser.media.card(action.id, action.op)
    case 'back':
    case 'forward':
    case 'reload':
    case 'stop':
    case 'zoom':
    case 'copyUrl':
    case 'devtools':
    case 'find': {
      if (!tab) return
      const toast = runPageAction(tab.wc, action)
      if (toast) browser.toast(toast)
      return action.type === 'zoom' ? browser.emitSoon() : undefined
    }
    case 'newFolder':
      space.pinned.unshift({ kind: 'folder', id: newId(), name: action.name || 'New Folder', open: true, children: [] })
      return browser.changed()
    case 'toggleFolder': {
      const folder = findFolder(space, action.id)
      if (folder) folder.open = !folder.open
      if (folder?.open && folder.live) browser.liveFolders.opened(folder.id)
      return browser.changed()
    }
    case 'renameFolder': {
      const folder = findFolder(space, action.id)
      if (folder) folder.name = action.name.trim() || folder.name
      return browser.changed()
    }
    case 'deleteFolder':
      return browser.spaces.deleteFolder(space, action.id)
    case 'saveLiveFolder':
      return browser.spaces.saveLiveFolder(space, action.id, action.name, action.source)
    case 'refreshLiveFolder':
      return void browser.liveFolders.refresh(action.id)
    case 'switchSpace':
      return browser.spaces.switchSpace(action.id)
    case 'switchSpaceRelative': {
      const list = browser.state.spaces
      const index = list.findIndex((other) => other.id === space.id)
      const next = list[index + action.delta]
      if (next) browser.spaces.switchSpace(next.id)
      return
    }
    case 'createSpace': {
      browser.setOverlay({ kind: 'none' }, false)
      const created = browser.spaces.createSpace(action)
      browser.historySync?.profilesChanged()
      return created
    }
    case 'updateSpace':
      return browser.spaces.updateSpace(action)
    case 'deleteSpace':
      return browser.spaces.deleteSpace(action.id)
    case 'renameProfile': {
      const profile = browser.store.profile(action.id)
      if (profile) profile.name = action.name
      browser.historySync?.profilesChanged()
      return browser.changed()
    }
    case 'splitWith':
      return browser.splits.splitWith(action.id, action.at)
    case 'splitMenu':
      return buildSplitMenu(browser, action.id)?.popup({ window: browser.window.win, x: Math.round(action.x), y: Math.round(action.y) })
    case 'moveInSplit':
      return browser.splits.moveInSplit(action.id, action.delta)
    case 'addSplit':
      if (!splitOf(space.splits, action.id)) return
      return browser.setOverlay({ kind: 'command', target: 'split', splitAt: { target: action.id, side: action.side } })
    case 'separateFromSplit':
      return browser.splits.separateFromSplit(action.id)
    case 'flipSplit':
      return browser.splits.flipSplit(action.id)
    case 'unsplit':
      return browser.splits.unsplit(action.id)
    case 'placeInSplit':
      browser.setTabDrag(undefined)
      return browser.splits.placeInSplit(action.id, action.target, action.side)
    case 'tabDrag':
      return browser.setTabDrag(action.id)
    case 'resizeSplit': {
      const split = space.splits.find((other) => other.id === action.splitId)
      const root = split && resizeGroup(split.root, action.path, action.sizes)
      if (!split || !root) return
      split.root = root
      return browser.relayout()
    }
    case 'toggleSidebar':
      return toggleSidebar(browser)
    case 'sidebarReveal': {
      if (browser.state.settings.sidebarVisible || browser.cur.sidebarReveal === action.show || browser.panelInFront()) return
      browser.cur.sidebarReveal = action.show
      return browser.setOverlay(action.show ? { kind: 'sidebar' } : { kind: 'none' }, false)
    }
    case 'overlay':
      return browser.setOverlay(action.mode)
    case 'previewSpaceColors':
      browser.colorPreview = { window: browser.cur, spaceId: action.spaceId, color: action.color, color2: action.color2 || undefined }
      return browser.emitSoon()
    case 'endTour':
      browser.tour = undefined
      return browser.setOverlay({ kind: 'none' })
    case 'settings':
      return changeSettings(browser, action.patch)
    case 'recordShortcut':
      browser.recordingShortcut = action.on === true
      return
    case 'littleArc':
      return void browser.openLittle(action.url)
    case 'peek':
      if (action.op === 'close') return browser.closePeek()
      return browser.expandPeek(action.op === 'split')
    case 'openInChrome':
      return openTabInChrome(browser, action.id ? browser.live.get(action.id) : tab, action.id)
    case 'stopFind':
      tab?.wc.stopFindInPage('keepSelection')
      return browser.setOverlay({ kind: 'none' })
    case 'downloadOpen':
      return browser.downloads.open(action.id, action.reveal, browser.window.win)
    case 'sharePick':
      if (browser.sharePicker.answer(action.id, action.sourceId, action.systemAudio === true) && browser.window.overlayMode.kind === 'share-picker') browser.setOverlay({ kind: 'none' })
      return
    case 'downloadsClear':
      return browser.downloads.clearFinished()
    case 'archiveRestore':
      return browser.tabs.restoreArchived(action.id)
    case 'syncPickFolder':
      return (browser.main ?? browser).historySync?.pickFolder()
    case 'syncICloud':
      return (browser.main ?? browser).historySync?.useICloud()
    case 'syncNearby':
      return (browser.main ?? browser).historySync?.setUpNearby()
    case 'syncCloud':
      return (browser.main ?? browser).historySync?.signInToDrive(action.drive)
    case 'syncServer':
      return (browser.main ?? browser).historySync?.setUpServer(action.url, action.username, action.password)
    case 'syncSignIn':
      return (browser.main ?? browser).historySync?.signInAgain()
    case 'syncConnect':
      return (browser.main ?? browser).historySync?.connect(action.password, action.create)
    case 'syncChangePassword':
      return (browser.main ?? browser).historySync?.changePassword(action.password)
    case 'syncProfile':
      return (browser.main ?? browser).historySync?.setProfileSync(action.id, action.on)
    case 'syncCancel':
      return (browser.main ?? browser).historySync?.cancelSetup()
    case 'syncOff':
      return (browser.main ?? browser).historySync?.turnOff()
    case 'archiveClear':
      browser.state.archive = []
      return browser.changed()
    case 'import': {
      if (!action.keepOverlay) browser.setOverlay({ kind: 'none' }, false)
      const summary = await runImport(browser, action.source, action.path)
      browser.historySync?.profilesChanged()
      return summary ? browser.toast(summary) : undefined
    }
    case 'exportBookmarks':
      browser.setOverlay({ kind: 'none' }, false)
      return exportBookmarks(browser)
    case 'importChoices': {
      const summary = await importChoices(browser, browser.imports.chosen(action.ids))
      if (summary) browser.toast(summary)
      browser.historySync?.profilesChanged()
      if (browser.tour === 'import') browser.setOverlay({ kind: 'tour', step: nextStep('import')! }, false)
      return
    }
    case 'relaunchUpdate':
      return void browser.updater.apply(true)
    case 'command':
      if (!action.keepOverlay) browser.setOverlay({ kind: 'none' }, false)
      return runCommand(browser, action.id)
    case 'adblockToggleSite':
      return toggleAdblockOn(browser, action.id ? browser.live.get(action.id) : tab)
    case 'sitePermission':
      if (browser.store.profile(action.profileId) && browser.profiles.setSitePermission(action.profileId, action.origin, action.key, action.setting)) browser.emitSoon()
      return
    case 'extensionPin':
      return browser.setExtensionPin(action.profileId, action.extensionId, action.pinned)
    case 'extensionsPopover': {
      const origin = browser.sidebarOrigin(browser.window.win) ?? { x: 0, y: 0 }
      return browser.setOverlay({ kind: 'extensions', profileId: action.profileId, anchor: { ...action.anchor, x: action.anchor.x + origin.x, y: action.anchor.y + origin.y } })
    }
    case 'itemMenu':
      return buildItemMenu(browser, action.id)?.popup({ window: browser.window.win })
    case 'folderMenu':
      return buildFolderMenu(browser, action.id)?.popup({ window: browser.window.win })
    case 'canvasMenu':
      return buildCanvasMenu(browser, action.id)?.popup({ window: browser.window.win })
    case 'appMenu':
      return buildAppMenu(browser).popup({ window: browser.window.win, x: Math.round(Number(action.x)), y: Math.round(Number(action.y)) })
    case 'renameCanvas':
      browser.canvases.rename(action.id, String(action.name))
      return browser.changed()
    case 'hideWhatsNew':
      browser.whatsNew.markWhatsNewSeen()
      return browser.changed()
    case 'openBoard':
      return browser.whatsNew.openBoard(String(action.spotlight))
    case 'capture': {
      const mode = browser.window.overlayMode
      browser.setOverlay({ kind: 'none' }, false)
      const page = browser.activeTab()
      if (mode.kind !== 'capture' || !page || browser.incognito) return
      return browser.canvases.capture(page, action.rect, action.to, action.whole)
    }
    case 'spaceMenu':
      return buildSpaceMenu(browser, action.id)?.popup({ window: browser.window.win })
    case 'sidebarMenu':
      return buildSidebarMenu(browser).popup({ window: browser.window.win })
    case 'extensionsStore':
      browser.setOverlay({ kind: 'none' }, false)
      browser.tabs.newTab('https://chromewebstore.google.com/category/extensions')
      return
    case 'removeExtension':
      return browser.extensions.remove(action.profileId, action.id)
  }
}

function toggleSidebar(browser: Browser): void {
  const settings = browser.state.settings
  settings.sidebarVisible = !settings.sidebarVisible
  browser.cur.sidebarReveal = false
  if (browser.window.overlayMode.kind === 'sidebar') browser.window.setOverlay({ kind: 'none' }, undefined)
  browser.relayout()
  if (browser.tour && browser.window.overlayMode.kind === 'none') browser.setOverlay({ kind: 'tour', step: browser.tour }, false)
  browser.tourEvent('toggleSidebar')
}

function changeSettings(browser: Browser, patch: Extract<Action, { type: 'settings' }>['patch']): void {
  Object.assign(browser.state.settings, validSettingsPatch(browser.state.settings, patch, isMac))
  browser.adblock.sync(browser.state.settings)
  if (patch.theme) nativeTheme.themeSource = patch.theme
  if (patch.autoUpdate !== undefined) browser.updater.sync()
  if (patch.sidebarRight !== undefined) for (const other of browser.wins) if (other !== browser.cur) browser.inWin(other, () => browser.layout())
  browser.relayout()
}

async function openTabInChrome(browser: Browser, tab: LiveTab | undefined, id?: ID): Promise<void> {
  const url = tab?.wc.getURL() || (id ? findItem(browser.state, id)?.item.url : undefined)
  if (!url) return
  const ok = await openInChrome(url)
  browser.toast(ok ? 'Opened in Chrome' : 'Chrome was not found on browser computer')
}

function toggleAdblockOn(browser: Browser, tab: LiveTab | undefined): void {
  const toggled = tab && browser.adblock.toggleSite(browser.state.settings, tab.wc)
  if (!toggled) return
  browser.toast(toggled.allowed ? `Ads allowed on ${toggled.host}` : `Blocking ads on ${toggled.host}`)
  browser.changed()
}
