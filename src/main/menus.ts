import { app, clipboard, dialog, Menu, type ContextMenuParams, type MenuItemConstructorOptions, type WebContents } from 'electron'
import { join } from 'node:path'
import { IPC, type EditRequest } from '../shared/ipc'
import { paneIds, splitMenuModel } from '../shared/split'
import { findCanvas, findFolder, findItem, isAwayFromSaved, spaceCanvases } from '../shared/tree'
import { THEMES } from '../shared/settings'
import { SEARCH_ENGINES, searchUrl } from '../shared/url'
import { bindingLabel, commandTitle, type CommandId } from '../shared/keymap'
import type { Browser } from './browser'
import { chromeInstalled } from './chrome'
import type { LiveTab } from './tab'
import type { Settings } from '../shared/types'

const WEB_LINK = /^https?:/i

/** A submenu of the space's canvases, and a new one, for what a page offers to put on a canvas. */
function addToCanvasItem(browser: Browser, label: string, add: (canvasId: string) => void): MenuItemConstructorOptions {
  const canvases = spaceCanvases(browser.space)
  return {
    label,
    submenu: [
      ...canvases.map((canvas) => ({ label: canvas.name, click: () => add(canvas.id) })),
      ...(canvases.length ? [{ type: 'separator' as const }] : []),
      { label: 'New Canvas', click: () => add('new') }
    ]
  }
}

export function buildContextMenu(browser: Browser, tab: LiveTab, p: ContextMenuParams): Menu {
  const wc = tab.wc
  const items: MenuItemConstructorOptions[] = []
  const sep = () => {
    if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' })
  }

  if (p.linkURL) {
    // Loaded from main, which Chromium doesn't stop from opening local URLs a web page could never navigate to itself.
    if (WEB_LINK.test(p.linkURL) || (/^file:/i.test(p.linkURL) && /^file:/i.test(p.pageURL))) {
      items.push({ label: 'Open Link in New Tab', click: () => browser.open(p.linkURL, 'background') })
      if (WEB_LINK.test(p.linkURL) && tab.host === browser) items.push({ label: 'Open Link in Peek', click: () => browser.peekLink(tab, p.linkURL) })
      items.push(
        { label: 'Open Link in Split View', click: () => browser.open(p.linkURL, 'split') },
        { label: 'Open Link in a Little Window', click: () => browser.openLittle(p.linkURL) },
        { label: 'Open Link in Incognito Window', click: () => browser.openIncognito(p.linkURL) }
      )
    }
    items.push({ label: 'Copy Link', click: () => clipboard.writeText(p.linkURL) })
    sep()
  }
  if (p.mediaType === 'image' && p.srcURL) {
    if (WEB_LINK.test(p.srcURL) || /^(data:image\/|blob:https?:)/i.test(p.srcURL)) {
      items.push({ label: 'Open Image in New Tab', click: () => browser.open(p.srcURL, 'background') })
    }
    if (!browser.incognito && (WEB_LINK.test(p.srcURL) || /^data:image\//i.test(p.srcURL))) {
      items.push(addToCanvasItem(browser, 'Add Image to Canvas', (canvasId) => void browser.canvases.addImage(tab, p.srcURL, canvasId)))
    }
    items.push(
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
    if (!browser.incognito) items.push(addToCanvasItem(browser, 'Add Selection to Canvas', (canvasId) => void browser.canvases.addSelection(tab, text, canvasId)))
    sep()
  }
  if (!p.linkURL && !p.isEditable && !p.selectionText.trim() && p.mediaType === 'none') {
    items.push(
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => wc.reload() },
      { type: 'separator' },
      { label: 'Save Page As…', click: () => void savePageAs(browser, wc) },
      { label: 'Print…', click: () => wc.print() },
      { type: 'separator' },
      { label: 'Copy URL', click: () => browser.dispatch({ type: 'copyUrl' }) }
    )
    if (chromeInstalled()) items.push({ label: 'Open in Chrome', click: () => browser.dispatch({ type: 'openInChrome', id: tab.itemId }) })
    items.push({ type: 'separator' }, { label: 'View Page Source', click: () => browser.open(`view-source:${wc.getURL()}`, 'tab') })
    sep()
  }
  const fromExtensions = browser.extensions.contextMenuItems(tab, p)
  if (fromExtensions.length) {
    sep()
    items.push(...(fromExtensions as unknown as MenuItemConstructorOptions[]))
    sep()
  }
  items.push({ label: 'Inspect', click: () => browser.inspect(tab, p.x, p.y) })
  return Menu.buildFromTemplate(items)
}

async function savePageAs(browser: Browser, wc: WebContents): Promise<void> {
  const name = wc.getTitle().replace(/[\\/:*?"<>|]/g, '-').trim() || 'Page'
  const { canceled, filePath } = await dialog.showSaveDialog(browser.window.win, {
    defaultPath: join(app.getPath('downloads'), `${name}.html`),
    filters: [{ name: 'Web Page, Complete', extensions: ['html'] }]
  })
  if (canceled || !filePath) return
  try {
    if (wc.isDestroyed()) throw new Error('The tab closed while the dialog was open')
    await wc.savePage(filePath, 'HTMLComplete')
  } catch {
    browser.toast('Couldn’t save the page')
  }
}

/** Waits until a reopened window shows: showing moves focus, which would close a just-opened command bar. */
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

export function installDockMenu(browser: Browser): void {
  if (process.platform !== 'darwin') return
  const littles = () => browser.openLittles()
  const build = () => {
    const open = littles().length > 0
    app.dock?.setMenu(
      Menu.buildFromTemplate([
        { label: commandTitle('newWindow'), click: () => browser.openNewWindow() },
        { label: commandTitle('newIncognitoWindow'), click: () => browser.openIncognito() },
        { label: commandTitle('littleArc'), click: () => browser.openLittle() },
        { type: 'separator' },
        { label: 'Show Little Windows', enabled: open, click: () => littles().forEach((l) => l.win.show()) },
        { label: 'Close Little Windows', enabled: open, click: () => littles().forEach((l) => l.win.close()) }
      ])
    )
  }
  build()
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
  const g = appMenuGroups(browser)
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        ...g.about,
        { type: 'separator' },
        g.settings,
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
    { label: 'File', submenu: [...g.windows, { type: 'separator' }, ...g.transfer] },
    { role: 'editMenu' },
    { label: 'View', submenu: [g.toggleSidebar, { role: 'togglefullscreen' }, g.devtools] },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** The sidebar's menu button, for platforms without a menu bar. */
export function buildAppMenu(browser: Browser): Menu {
  const g = appMenuGroups(browser)
  const sep = { type: 'separator' as const }
  return Menu.buildFromTemplate([
    ...g.windows,
    sep,
    { label: 'Import and Export', submenu: g.transfer },
    sep,
    { role: 'togglefullscreen', label: 'Full Screen', accelerator: 'F11', registerAccelerator: false },
    g.devtools,
    sep,
    ...g.about,
    sep,
    g.settings,
    sep,
    { role: 'quit', label: 'Exit' }
  ])
}

/** Shared by the macOS menu bar and the sidebar's menu button. */
function appMenuGroups(browser: Browser) {
  const run = commandRunner(browser)
  // Shown, not registered: keymap.ts already handles every shortcut. The macOS menu bar shows none.
  const keys = (id: CommandId) =>
    process.platform === 'darwin' ? {} : { accelerator: bindingLabel(id, false, browser.state.settings.shortcuts) || undefined, registerAccelerator: false }
  const item = (id: CommandId, label = commandTitle(id), click = run(id)): MenuItemConstructorOptions => ({ label, click, ...keys(id) })
  const opensDialog = (id: CommandId) => item(id, `${commandTitle(id)}…`)
  const { state } = browser.updater.status
  const update =
    state === 'available' ? item('installUpdate', 'Update Available…') : state === 'ready' ? item('installUpdate', 'Restart to Update') : item('checkForUpdates')
  return {
    about: [update, item('whatsNew', "What's New"), item('tour', 'Take the Tour')],
    settings: opensDialog('settings'),
    windows: [
      item('newTab'),
      item('newWindow', undefined, () => browser.openNewWindow()),
      item('newIncognitoWindow', undefined, () => browser.openIncognito()),
      item('littleArc'),
      item('newSpace')
    ],
    transfer: [
      opensDialog('importArc'),
      opensDialog('importZen'),
      item('importChrome', 'Import from Chrome…'),
      { type: 'separator' as const },
      opensDialog('exportBookmarks')
    ],
    toggleSidebar: item('toggleSidebar'),
    devtools: item('devtools')
  }
}

function requestEdit(browser: Browser, req: EditRequest): void {
  browser.window.ui.send(IPC.edit, req)
}

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
    { label: 'Share Split View…', enabled: false }
  ])
}

export function buildCanvasMenu(browser: Browser, id: string): Menu | undefined {
  const hit = findCanvas(browser.store.state, id)
  if (!hit) return undefined
  const state = browser.store.state
  const items: MenuItemConstructorOptions[] = [{ label: 'Rename…', click: () => requestEdit(browser, { kind: 'renameCanvas', id }) }]
  if (hit.canvas.temporary) {
    items.unshift({
      label: 'Keep This Canvas',
      click: () => {
        browser.canvases.keep(id)
        browser.changed()
      }
    })
  }
  if (state.spaces.length > 1) {
    items.push({
      label: 'Move to Space',
      submenu: state.spaces.filter((s) => s.id !== hit.space.id).map((s) => ({ label: `${s.emoji ?? ''} ${s.name}`.trim(), click: () => void browser.dispatch({ type: 'moveToSpace', id, spaceId: s.id }) }))
    })
  }
  items.push(
    { type: 'separator' },
    {
      label: 'Delete Canvas…',
      click: async () => {
        const { response } = await dialog.showMessageBox(browser.window.win, {
          type: 'warning',
          buttons: ['Delete', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          message: `Delete the canvas “${hit.canvas.name}”?`,
          detail: 'Its files stay in the profile’s trash folder for 30 days.'
        })
        if (response !== 0) return
        browser.canvases.delete(id)
        browser.layout()
        browser.changed()
      }
    }
  )
  return Menu.buildFromTemplate(items)
}

export function buildFolderMenu(browser: Browser, id: string): Menu | undefined {
  const folder = findFolder(browser.store.activeSpace, id)
  if (!folder) return undefined
  const toggle: MenuItemConstructorOptions = { label: folder.open ? 'Collapse Folder' : 'Expand Folder', click: () => void browser.dispatch({ type: 'toggleFolder', id }) }
  const rename: MenuItemConstructorOptions = { label: 'Rename…', click: () => requestEdit(browser, { kind: 'renameFolder', id }) }
  if (folder.live) {
    return Menu.buildFromTemplate([
      toggle,
      { label: 'Refresh Now', click: () => void browser.dispatch({ type: 'refreshLiveFolder', id }) },
      { label: 'Edit Live Folder…', click: () => browser.setOverlay({ kind: 'live-folder', folderId: id }) },
      rename,
      { type: 'separator' },
      { label: 'Delete Live Folder', click: () => void browser.dispatch({ type: 'deleteFolder', id }) }
    ])
  }
  return Menu.buildFromTemplate([
    toggle,
    rename,
    { type: 'separator' },
    { label: 'Delete Folder (keep tabs)', click: () => void browser.dispatch({ type: 'deleteFolder', id }) }
  ])
}

export function buildSidebarMenu(browser: Browser): Menu {
  const { settings } = browser.store.state
  const patch = (changes: Partial<Settings>) => void browser.dispatch({ type: 'settings', patch: changes })
  return Menu.buildFromTemplate([
    { label: 'New Space…', click: () => browser.setOverlay({ kind: 'space-editor' }) },
    { label: 'Edit Space…', click: () => browser.setOverlay({ kind: 'space-editor', spaceId: browser.store.activeSpace.id }) },
    { type: 'separator' },
    {
      label: 'Appearance',
      submenu: THEMES.map(({ value, label }) => ({ label, type: 'radio', checked: settings.theme === value, click: () => patch({ theme: value }) }))
    },
    { type: 'separator' },
    { label: 'Sidebar on the Left', type: 'radio', checked: !settings.sidebarRight, click: () => patch({ sidebarRight: false }) },
    { label: 'Sidebar on the Right', type: 'radio', checked: settings.sidebarRight, click: () => patch({ sidebarRight: true }) }
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
