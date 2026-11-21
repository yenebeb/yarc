// Bindings are matched on physical key codes so Option/AltGr layouts keep working.

export type CommandId =
  | 'newTab'
  | 'editUrl'
  | 'toggleSidebar'
  | 'copyUrl'
  | 'copyUrlMarkdown'
  | 'littleArc'
  | 'newWindow'
  | 'newIncognitoWindow'
  | 'closeTab'
  | 'reopenClosed'
  | 'togglePin'
  | 'clearToday'
  | 'nextTab'
  | 'prevTab'
  | 'switcherNext'
  | 'switcherPrev'
  | 'nextSpace'
  | 'prevSpace'
  | `space${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | `tab${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | 'splitAdd'
  | 'splitClose'
  | 'find'
  | 'findNext'
  | 'findPrev'
  | 'history'
  | 'downloads'
  | 'library'
  | 'devtools'
  | 'reload'
  | 'hardReload'
  | 'stop'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'back'
  | 'forward'
  | 'settings'
  | 'newSpace'
  | 'newFolder'
  | 'duplicate'
  | 'openInChrome'
  | 'importArc'
  | 'importZen'
  | 'importChrome'
  | 'exportBookmarks'
  | 'extensions'
  | 'focusPage'
  | 'setDefaultBrowser'
  | 'checkForUpdates'
  | 'installUpdate'
  | 'whatsNew'
  | 'tour'
  | 'floatingPlayerDemo'
  | 'newCanvas'
  | 'capture'

export interface Binding {
  id: CommandId
  title: string
  mac: string[]
  other: string[]
  /** Show in the command bar's action list. */
  palette?: boolean
}

const both = (...keys: string[]) => ({ mac: keys.map((k) => k.replace('Mod', 'Cmd')), other: keys.map((k) => k.replace('Mod', 'Ctrl')) })

const numbered = (prefix: 'space' | 'tab', title: string, mac: string, other: string): Binding[] =>
  [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({
    id: `${prefix}${n}` as CommandId,
    title: `${title} ${n}`,
    mac: [`${mac}+${n}`],
    other: [`${other}+${n}`]
  }))

export const BINDINGS: Binding[] = [
  { id: 'newTab', title: 'New Tab', ...both('Mod+T'), palette: false },
  { id: 'editUrl', title: 'Edit URL', mac: ['Cmd+L'], other: ['Ctrl+L', 'Alt+D'] },
  { id: 'toggleSidebar', title: 'Toggle Sidebar', ...both('Mod+S'), palette: true },
  { id: 'copyUrl', title: 'Copy URL', ...both('Mod+Shift+C'), palette: true },
  { id: 'copyUrlMarkdown', title: 'Copy URL as Markdown', ...both('Mod+Shift+Alt+C'), palette: true },
  { id: 'littleArc', title: 'New Little Window', ...both('Mod+Alt+N'), palette: true },
  { id: 'newWindow', title: 'New Window', ...both('Mod+N'), palette: true },
  { id: 'newIncognitoWindow', title: 'New Incognito Window', ...both('Mod+Shift+N'), palette: true },
  { id: 'closeTab', title: 'Close Tab', mac: ['Cmd+W'], other: ['Ctrl+W', 'Ctrl+F4'], palette: true },
  { id: 'reopenClosed', title: 'Reopen Closed Tab', ...both('Mod+Shift+T'), palette: true },
  { id: 'togglePin', title: 'Pin / Unpin Tab', ...both('Mod+D'), palette: true },
  { id: 'clearToday', title: 'Clear Unpinned Tabs', ...both('Mod+Shift+K'), palette: true },
  { id: 'nextTab', title: 'Next Tab', ...both('Mod+Alt+Down', 'Ctrl+PageDown') },
  { id: 'prevTab', title: 'Previous Tab', ...both('Mod+Alt+Up', 'Ctrl+PageUp') },
  { id: 'switcherNext', title: 'Recent Tab Switcher', mac: ['Ctrl+Tab'], other: ['Ctrl+Tab'] },
  { id: 'switcherPrev', title: 'Recent Tab Switcher (back)', mac: ['Ctrl+Shift+Tab'], other: ['Ctrl+Shift+Tab'] },
  { id: 'nextSpace', title: 'Next Space', ...both('Mod+Alt+Right'), palette: true },
  { id: 'prevSpace', title: 'Previous Space', ...both('Mod+Alt+Left'), palette: true },
  ...numbered('space', 'Switch to Space', 'Ctrl', 'Alt'),
  ...numbered('tab', 'Go to Tab', 'Cmd', 'Ctrl'),
  { id: 'splitAdd', title: 'Add Split View', mac: ['Ctrl+Shift+Equal'], other: ['Ctrl+Shift+Equal'], palette: true },
  { id: 'splitClose', title: 'Close Split View', mac: ['Ctrl+Shift+Minus'], other: ['Ctrl+Shift+Minus'], palette: true },
  { id: 'find', title: 'Find in Page', ...both('Mod+F'), palette: true },
  { id: 'findNext', title: 'Find Next', ...both('Mod+G', 'F3') },
  { id: 'findPrev', title: 'Find Previous', ...both('Mod+Shift+G', 'Shift+F3') },
  { id: 'history', title: 'Show History', ...both('Mod+Y'), palette: true },
  { id: 'downloads', title: 'Show Downloads', mac: ['Cmd+Shift+J'], other: ['Ctrl+J'], palette: true },
  { id: 'library', title: 'Open Library', mac: ['Cmd+Shift+L'], other: ['Ctrl+Shift+L'], palette: true },
  { id: 'devtools', title: 'Developer Tools', mac: ['Cmd+Alt+I', 'F12'], other: ['Ctrl+Shift+I', 'F12'], palette: true },
  { id: 'reload', title: 'Reload Page', ...both('Mod+R', 'F5'), palette: true },
  { id: 'hardReload', title: 'Hard Reload', ...both('Mod+Shift+R', 'Ctrl+F5'), palette: true },
  { id: 'stop', title: 'Stop Loading', mac: ['Cmd+Period'], other: [] },
  { id: 'zoomIn', title: 'Zoom In', mac: ['Cmd+Equal', 'Cmd+Shift+Equal', 'Cmd+NumpadAdd'], other: ['Ctrl+Equal', 'Ctrl+NumpadAdd'], palette: true },
  { id: 'zoomOut', title: 'Zoom Out', ...both('Mod+Minus', 'Mod+NumpadSubtract'), palette: true },
  { id: 'zoomReset', title: 'Actual Size', ...both('Mod+Digit0', 'Mod+Numpad0'), palette: true },
  { id: 'back', title: 'Back', mac: ['Cmd+BracketLeft'], other: ['Alt+Left', 'Ctrl+BracketLeft'] },
  { id: 'forward', title: 'Forward', mac: ['Cmd+BracketRight'], other: ['Alt+Right', 'Ctrl+BracketRight'] },
  { id: 'settings', title: 'Settings', ...both('Mod+Comma'), palette: true },
  { id: 'newSpace', title: 'New Space', mac: [], other: [], palette: true },
  { id: 'newFolder', title: 'New Folder', ...both('Mod+Alt+Shift+N'), palette: true },
  { id: 'duplicate', title: 'Duplicate Tab', ...both('Mod+Shift+D'), palette: true },
  { id: 'openInChrome', title: 'Open in Chrome', ...both('Mod+Alt+O'), palette: true },
  { id: 'importArc', title: 'Import from Arc', mac: [], other: [], palette: true },
  { id: 'importZen', title: 'Import from Zen', mac: [], other: [], palette: true },
  { id: 'importChrome', title: 'Import History & Bookmarks from Chrome', mac: [], other: [], palette: true },
  { id: 'exportBookmarks', title: 'Export Spaces as Bookmarks', mac: [], other: [], palette: true },
  { id: 'extensions', title: 'Get Extensions (Chrome Web Store)', mac: [], other: [], palette: true },
  { id: 'focusPage', title: 'Focus Page', mac: [], other: [] },
  { id: 'setDefaultBrowser', title: 'Make YARC the Default Browser', mac: [], other: [], palette: true },
  { id: 'checkForUpdates', title: 'Check for Updates…', mac: [], other: [], palette: true },
  // Listed only while an update is waiting, under the title Updater.actionTitle() gives it.
  { id: 'installUpdate', title: 'Install Update', mac: [], other: [], palette: true },
  { id: 'whatsNew', title: "What's New in YARC", mac: [], other: [], palette: true },
  { id: 'tour', title: 'Take the YARC Tour', mac: [], other: [], palette: true },
  { id: 'floatingPlayerDemo', title: 'Try the Floating Player', mac: [], other: [], palette: true },
  { id: 'newCanvas', title: 'New Canvas', mac: [], other: [], palette: true },
  { id: 'capture', title: 'Capture to Canvas', ...both('Mod+Shift+2'), palette: true }
]

export const commandTitle = (id: CommandId): string => BINDINGS.find((b) => b.id === id)?.title ?? id

export interface KeyInput {
  type: string
  code: string
  key: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

const CODE_ALIASES: Record<string, string> = {
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown'
}

function tokenToCode(token: string): string {
  if (/^[A-Z]$/.test(token)) return `Key${token}`
  if (/^[0-9]$/.test(token)) return `Digit${token}`
  return CODE_ALIASES[token] ?? token
}

interface Parsed {
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  code: string
}

function parse(accel: string): Parsed {
  const parts = accel.split('+')
  const code = tokenToCode(parts[parts.length - 1])
  const mods = new Set(parts.slice(0, -1))
  return { ctrl: mods.has('Ctrl'), meta: mods.has('Cmd'), alt: mods.has('Alt'), shift: mods.has('Shift'), code }
}

const cache = new Map<string, Parsed>()

export function matches(input: KeyInput, accel: string): boolean {
  let p = cache.get(accel)
  if (!p) cache.set(accel, (p = parse(accel)))
  return (
    input.code === p.code &&
    input.control === p.ctrl &&
    input.meta === p.meta &&
    input.alt === p.alt &&
    input.shift === p.shift
  )
}

/** On Windows/Linux, AltGr arrives as Ctrl+Alt; when it types a character (ñ, €) it's text, not a shortcut. */
export function isAltGrCharacter(input: KeyInput): boolean {
  if (!input.control || !input.alt || [...input.key].length !== 1) return false
  const base = /^Key([A-Z])$/.exec(input.code)?.[1] ?? /^Digit(\d)$/.exec(input.code)?.[1]
  return input.key.toUpperCase() !== base
}

export function commandForInput(input: KeyInput, mac: boolean): CommandId | undefined {
  if (input.type !== 'keyDown') return undefined
  if (!mac && isAltGrCharacter(input)) return undefined
  for (const b of BINDINGS) {
    for (const accel of mac ? b.mac : b.other) if (matches(input, accel)) return b.id
  }
  return undefined
}

const KEY_SYMBOLS: Record<string, string> = { Equal: '=', Minus: '-', Comma: ',', Left: '←', Right: '→', Up: '↑', Down: '↓', BracketLeft: '[', BracketRight: ']', Period: '.' }
const MAC_SYMBOLS: Record<string, string> = { ...KEY_SYMBOLS, Cmd: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }

export function bindingLabel(id: CommandId, mac: boolean): string {
  const b = BINDINGS.find((x) => x.id === id)
  const accel = (mac ? b?.mac : b?.other)?.[0]
  if (!accel) return ''
  const pretty = mac ? MAC_SYMBOLS : KEY_SYMBOLS
  return accel
    .split('+')
    .map((p) => pretty[p] ?? p.replace(/^Digit/, ''))
    .join(mac ? '' : '+')
}
