// Native menus: the page context menu and the macOS application menu.
import { app, clipboard, dialog, Menu, type ContextMenuParams, type MenuItemConstructorOptions } from 'electron'
import { IPC, type EditRequest } from '../shared/ipc'
import { paneIds, splitMenuModel } from '../shared/split'
import { findFolder, findItem, isAwayFromSaved } from '../shared/tree'
import { SEARCH_ENGINES, searchUrl } from '../shared/url'
import type { CommandId } from '../shared/keymap'
import type { Browser } from './browser'
import type { LiveTab } from './tab'

export function buildContextMenu(browser: Browser, tab: LiveTab, p: ContextMenuParams): Menu {
  const wc = tab.wc
  const items: MenuItemConstructorOptions[] = []
  const sep = () => {
    if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' })
  }

  if (p.linkURL) {
    items.push(
      { label: 'Open Link in New Tab', click: () => browser.open(p.linkURL, 'background') },
      { label: 'Open Link in Split View', click: () => browser.open(p.linkURL, 'split') },
      { label: 'Open Link in Little Arc', click: () => browser.openLittle(p.linkURL) },
      { label: 'Open Link in Incognito Window', click: () => browser.openIncognito(p.linkURL) },
      { label: 'Copy Link', click: () => clipboard.writeText(p.linkURL) }
    )
    sep()
  }
  if (p.mediaType === 'image' && p.srcURL) {
    items.push(
      { label: 'Open Image in New Tab', click: () => browser.open(p.srcURL, 'background') },
      { label: 'Save Image As…', click: () => wc.downloadURL(p.srcURL) },
      { label: 'Copy Image', click: () => wc.copyImageAt(p.x, p.y) },
      { label: 'Copy Image Address', click: () => clipboard.writeText(p.srcURL) }
    )
    sep()
  }
  if (p.isEditable) {
    for (const suggestion of p.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: suggestion, click: () => wc.replaceMisspelling(suggestion) })
    }
    if (p.misspelledWord) {
      items.push({ label: 'Add to Dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) })
      sep()
    }
    items.push(
      { role: 'undo', enabled: p.editFlags.canUndo },
      { role: 'redo', enabled: p.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: p.editFlags.canCut },
      { role: 'copy', enabled: p.editFlags.canCopy },
      { role: 'paste', enabled: p.editFlags.canPaste },
      { role: 'pasteAndMatchStyle', enabled: p.editFlags.canPaste },
      { role: 'selectAll' }
    )
    sep()
  } else if (p.selectionText.trim()) {
    const text = p.selectionText.trim()
    const engine = browser.store.state.settings.searchEngine
    const short = text.length > 24 ? `${text.slice(0, 24)}…` : text
    items.push(
      { role: 'copy' },
      { label: `Search ${SEARCH_ENGINES[engine].name} for “${short}”`, click: () => browser.open(searchUrl(text, engine), 'tab') }
    )
    sep()
  }
  if (!p.linkURL && !p.isEditable && !p.selectionText.trim() && p.mediaType === 'none') {
    items.push(
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
      { label: 'Copy URL', click: () => browser.dispatch({ type: 'copyUrl' }) },
      { label: 'Open in Chrome', click: () => browser.dispatch({ type: 'openInChrome', id: tab.itemId }) }
    )
    sep()
  }
  const fromExtensions = browser.extensions.contextMenuItems(tab, p)
  if (fromExtensions.length) {
    sep()
    items.push(...(fromExtensions as unknown as MenuItemConstructorOptions[]))
    sep()
  }
  items.push({ label: 'Inspect', click: () => wc.inspectElement(p.x, p.y) })
  return Menu.buildFromTemplate(items)
}

/** macOS needs an application menu for Cmd+C/V/Q etc. Arc shortcuts are handled separately. */
/**
 * A menu item's click that runs a command in the main window. The app outlives its last window on
 * macOS; menu commands reopen it first, like Arc. Wait until it shows: showing moves focus, which
 * would close a just-opened command bar.
 */
function commandRunner(browser: Browser): (cmd: CommandId) => () => void {
  return (cmd) => () => {
    browser.useFocused()
    const win = browser.window?.win
    if (win && !win.isDestroyed()) {
      browser.focusWindow()
      return browser.runCommand(cmd)
    }
    browser.openWindow()
    browser.window.win.once('show', () => browser.runCommand(cmd))
  }
}

/** The Dock icon's menu on macOS, like Arc's. */
export function installDockMenu(browser: Browser): void {
  if (process.platform !== 'darwin') return
  const littles = () => [...browser.littles].filter((l) => !l.win.isDestroyed())
  const build = () => {
    const open = littles().length > 0
    app.dock?.setMenu(
      Menu.buildFromTemplate([
        { label: 'New Window', click: () => browser.openNewWindow() },
        { label: 'New Incognito Window', click: () => browser.openIncognito() },
        { label: 'New Little Arc Window', click: () => browser.openLittle() },
        { type: 'separator' },
        { label: 'Show Little Arc Windows', enabled: open, click: () => littles().forEach((l) => l.win.show()) },
        { label: 'Close Little Arc Windows', enabled: open, click: () => littles().forEach((l) => l.win.close()) }
      ])
    )
  }
  build()
  // Little Arc windows come and go: the last two items are only enabled while there are some.
  app.on('browser-window-created', (_e, win) => {
    setImmediate(build)
    win.on('closed', () => setImmediate(build))
  })
}

export function installAppMenu(browser: Browser): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  const run = commandRunner(browser)
  // Like Arc: "Update Available…" replaces "Check for Updates…" once a new version is known.
  const updateItem = (): MenuItemConstructorOptions => {
    const { state } = browser.updater.status
    if (state === 'available') return { label: 'Update Available…', click: run('installUpdate') }
    if (state === 'ready') return { label: 'Restart to Update', click: run('installUpdate') }
    return { label: 'Check for Updates…', click: run('checkForUpdates') }
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        updateItem(),
        { label: "What's New", click: run('whatsNew') },
        { label: 'Take the Tour', click: run('tour') },
        { type: 'separator' },
        { label: 'Settings…', click: run('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', click: run('newTab') },
        { label: 'New Window', click: () => browser.openNewWindow() },
        { label: 'New Incognito Window', click: () => browser.openIncognito() },
        { label: 'New Little Arc Window', click: run('littleArc') },
        { label: 'New Space', click: run('newSpace') },
        { type: 'separator' },
        { label: 'Import from Arc…', click: run('importArc') },
        { label: 'Import from Zen…', click: run('importZen') },
        { label: 'Import from Chrome…', click: run('importChrome') }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', click: run('toggleSidebar') },
        { role: 'togglefullscreen' },
        { label: 'Developer Tools', click: run('devtools') }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function requestEdit(browser: Browser, req: EditRequest): void {
  browser.window.ui.send(IPC.edit, req)
}

/** Right-click menu for a sidebar tab (favorite, pinned or Today). */
export function buildItemMenu(browser: Browser, id: string): Menu | undefined {
  const state = browser.store.state
  const found = findItem(state, id)
  if (!found) return undefined
  const { item, loc } = found
  const live = browser.live.get(id)
  const url = live?.wc.getURL() || item.url
  const d = (a: Parameters<Browser['dispatch']>[0]) => () => void browser.dispatch(a)
  const space = browser.store.activeSpace
  const items: MenuItemConstructorOptions[] = []
  if (loc.kind === 'today') {
    items.push({ label: 'Pin Tab', click: d({ type: 'togglePin', id }) }, { label: 'Add to Favorites', click: d({ type: 'addFavorite', id }) })
  } else if (loc.kind === 'pinned') {
    items.push({ label: 'Unpin Tab', click: d({ type: 'togglePin', id }) }, { label: 'Add to Favorites', click: d({ type: 'addFavorite', id }) })
  } else {
    items.push({ label: 'Remove from Favorites', click: d({ type: 'move', id, to: { section: 'today', index: 0 } }) })
  }
  if (item.savedUrl && isAwayFromSaved(item, url)) items.push({ label: 'Back to Pinned URL', click: d({ type: 'resetToSaved', id }) })
  items.push({ type: 'separator' })
  if (space.activeItemId && space.activeItemId !== id) items.push({ label: 'Open in Split View', click: d({ type: 'splitWith', id }) })
  if (space.splits.some((sp) => paneIds(sp.root).includes(id))) items.push({ label: 'Remove from Split View', click: d({ type: 'unsplit', id }) })
  items.push(
    { label: 'Duplicate', click: d({ type: 'duplicate', id }) },
    { label: 'Copy URL', click: () => clipboard.writeText(url) },
    { label: 'Rename…', click: () => requestEdit(browser, { kind: 'rename', id }) }
  )
  if (loc.kind !== 'favorite' && state.spaces.length > 1) {
    items.push({
      label: 'Move to Space',
      submenu: state.spaces
        .filter((s) => s.id !== loc.spaceId)
        .map((s) => ({ label: `${s.emoji ?? ''} ${s.name}`.trim(), click: d({ type: 'moveToSpace', id, spaceId: s.id }) }))
    })
  }
  if (live?.info().audible || live?.wc.isAudioMuted()) items.push({ label: live.wc.isAudioMuted() ? 'Unmute Tab' : 'Mute Tab', click: d({ type: 'mute', id }) })
  items.push({ label: 'Open in Chrome', click: d({ type: 'openInChrome', id }) }, { type: 'separator' })
  if (loc.kind !== 'today' && live) items.push({ label: 'Unload Tab', click: d({ type: 'unload', id }) })
  items.push({ label: loc.kind === 'today' ? 'Close Tab' : 'Close (keep in sidebar)', click: d({ type: 'close', id }) })
  return Menu.buildFromTemplate(items)
}

/** The menu of a split pane's split view button, in Arc's order and wording. */
export function buildSplitMenu(browser: Browser, id: string): Menu | undefined {
  const split = browser.store.activeSpace.splits.find((sp) => paneIds(sp.root).includes(id))
  if (!split) return undefined
  const m = splitMenuModel(split.root, id)
  const d = (a: Parameters<Browser['dispatch']>[0]) => () => void browser.dispatch(a)
  return Menu.buildFromTemplate([
    { label: m.moveBack.label, enabled: m.moveBack.enabled, click: d({ type: 'moveInSplit', id, delta: -1 }) },
    { label: m.moveForward.label, enabled: m.moveForward.enabled, click: d({ type: 'moveInSplit', id, delta: 1 }) },
    { type: 'separator' },
    { label: m.addAfter.label, enabled: m.canAdd, click: d({ type: 'addSplit', id, side: m.addAfter.side }) },
    { label: m.addBefore.label, enabled: m.canAdd, click: d({ type: 'addSplit', id, side: m.addBefore.side }) },
    { type: 'separator' },
    { label: 'Separate Tab from Split', click: d({ type: 'separateFromSplit', id }) },
    { label: m.convert, click: d({ type: 'flipSplit', id }) },
    { type: 'separator' },
    // Arc shares a split as a link on its servers; YARC has nothing to share it to.
    { label: 'Share Split View…', enabled: false }
  ])
}

export function buildFolderMenu(browser: Browser, id: string): Menu | undefined {
  const folder = findFolder(browser.store.activeSpace, id)
  if (!folder) return undefined
  return Menu.buildFromTemplate([
    { label: folder.open ? 'Collapse Folder' : 'Expand Folder', click: () => void browser.dispatch({ type: 'toggleFolder', id }) },
    { label: 'Rename…', click: () => requestEdit(browser, { kind: 'renameFolder', id }) },
    { type: 'separator' },
    { label: 'Delete Folder (keep tabs)', click: () => void browser.dispatch({ type: 'deleteFolder', id }) }
  ])
}

export function buildSpaceMenu(browser: Browser, id: string): Menu | undefined {
  const space = browser.store.space(id)
  if (!space) return undefined
  const state = browser.store.state
  const profile = browser.store.profile(space.profileId)
  return Menu.buildFromTemplate([
    { label: 'Edit Space…', click: () => browser.setOverlay({ kind: 'space-editor', spaceId: id }) },
    { label: `Profile: ${profile?.name ?? '?'}`, enabled: false },
    { type: 'separator' },
    {
      label: 'Delete Space…',
      enabled: state.spaces.length > 1,
      click: async () => {
        const shared = state.spaces.some((s) => s.id !== id && s.profileId === space.profileId)
        const { response } = await dialog.showMessageBox(browser.window.win, {
          type: 'warning',
          buttons: ['Delete', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          message: `Delete the space “${space.name}”?`,
          detail: shared
            ? 'Its pinned and Today tabs will be removed. The profile is shared with another space and is kept.'
            : 'Its tabs, and the profile’s cookies, history and extensions, will be permanently removed.'
        })
        if (response === 0) void browser.dispatch({ type: 'deleteSpace', id })
      }
    }
  ])
}
