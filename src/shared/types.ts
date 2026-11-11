// State shared between the main process and the UI renderers.
// The main process owns the truth; renderers receive full snapshots.
import type { SitePermissionRow } from './permissions'
import type { TourStep } from './tour'

export type ID = string

/** A tab-like sidebar entry. Favorites and pinned tabs keep `savedUrl` as their "home". */
export interface TabItem {
  id: ID
  url: string
  title: string
  favicon?: string
  /** Home URL for favorites and pinned tabs. Undefined for unpinned (Today) tabs. */
  savedUrl?: string
  savedTitle?: string
  /** Epoch ms of last activation, used for auto-archive and MRU. */
  lastActive: number
}

export interface PinnedTab extends TabItem {
  kind: 'tab'
}

export interface PinnedFolder {
  kind: 'folder'
  id: ID
  name: string
  open: boolean
  children: PinnedNode[]
}

export type PinnedNode = PinnedTab | PinnedFolder

export interface Profile {
  id: ID
  name: string
  /** Favorites belong to a profile, so every space using this profile shares them. */
  favorites: TabItem[]
}

/** One page in a split view. */
export interface SplitPane {
  itemId: ID
}

/** Panes or nested groups laid out side by side ('row') or stacked ('column'). */
export interface SplitGroup {
  dir: 'row' | 'column'
  children: SplitNode[]
  /** Relative sizes along `dir`, one per child, summing to 1. */
  sizes: number[]
}

export type SplitNode = SplitPane | SplitGroup

/** A split view: 2-4 tabs shown together, in any mix of side-by-side and stacked panes. */
export interface Split {
  id: ID
  root: SplitGroup
}

export interface Space {
  id: ID
  name: string
  emoji?: string
  /** Theme color (hex). */
  color: string
  /** Sidebar text appearance over the theme color, from Arc; unset follows the system. */
  appearance?: 'light' | 'dark'
  profileId: ID
  pinned: PinnedNode[]
  /** Unpinned ("Today") tabs, newest first. */
  today: TabItem[]
  splits: Split[]
  activeItemId?: ID
}

export interface ArchivedTab {
  id: ID
  url: string
  title: string
  favicon?: string
  spaceId: ID
  archivedAt: number
}

export type SearchEngine = 'google' | 'duckduckgo' | 'bing' | 'kagi' | 'brave'

/** Sidebar width limits in px: dragging its edge, the Settings slider and the Arc import. */
export const SIDEBAR_WIDTH = { min: 200, max: 480 }

export interface Settings {
  sidebarVisible: boolean
  sidebarWidth: number
  sidebarRight: boolean
  /** Hours of inactivity before an unpinned tab is archived. 0 = never. */
  archiveAfterHours: number
  searchEngine: SearchEngine
  /** Open links from other apps in Little Arc (true) or as a new tab in the current space (false). */
  littleArcForExternalLinks: boolean
  /** Profile used by Little Arc windows; empty = profile of the active space. */
  littleArcProfileId: ID | ''
  /** Links from pinned tabs and favorites to other sites open in Peek instead of replacing the page. */
  peekPinnedLinks: boolean
  theme: 'system' | 'light' | 'dark'
  /** Built-in ad & tracker blocking. */
  adblock: boolean
  /** Hostnames where blocking is turned off. */
  adblockAllowlist: string[]
  /** Check for new versions at startup and every few hours (installed app only). */
  autoUpdate: boolean
}

export interface PersistedState {
  version: 1
  profiles: Profile[]
  spaces: Space[]
  /** The current window's space. `Space.activeItemId`, `Space.splits` and `Settings.sidebarVisible` are also the current window's. */
  activeSpaceId: ID
  settings: Settings
  archive: ArchivedTab[]
  littleArc: LittleArcMemory
  /** The YARC version that last ran with this state, so the next newer one shows What's New. */
  lastSeenVersion?: string
  /** A downloaded update the user hasn't restarted into yet (src/main/update-escalation.ts). */
  waitingUpdate?: WaitingUpdate
  /** The open main windows (the last focused one last), restored at launch. */
  windows: WindowView[]
}

/**
 * Kept while an update waits, so the wait survives a restart that didn't install it (a crash, a
 * failed install). `from` is the version that was running; once another version runs, the update
 * went in and the record is stale.
 */
export interface WaitingUpdate {
  from: string
  /** When this version first had an update ready, in ms since the epoch. */
  since: number
  /** When the relaunch card last opened by itself. */
  askedAt?: number
}

/** What one main window shows; the sidebar's contents are shared by all windows, like Arc. */
export interface WindowView {
  id: ID
  activeSpaceId: ID
  /** The tab each space shows in this window, by space id. */
  selected: Record<ID, ID>
  /** Each space's split views in this window, by space id. */
  splits: Record<ID, Split[]>
  sidebarVisible: boolean
  /** Normal (un-maximized) bounds. */
  bounds?: Rect
  maximized?: boolean
}

/** One version's entries in What's New. */
export interface ReleaseNotes {
  version: string
  changes: string[]
}

export interface LittleArcMemory {
  /** The size the user last gave a Little Arc window; absent = a size that suits the screen. */
  size?: { width: number; height: number }
  /** Hostname → profile picked with the toolbar's profile chip, like Arc remembers it per site. */
  profileByHost: Record<string, ID>
}

/** Live (runtime-only) info for an item that currently has a web page attached. */
export interface LiveInfo {
  /** webContents id, used by <browser-action-list tab=…>. */
  wcId: number
  url: string
  title: string
  favicon?: string
  loading: boolean
  audible: boolean
  muted: boolean
  canGoBack: boolean
  canGoForward: boolean
  zoom: number
  /** Ads/trackers blocked on the current page. */
  blocked: number
  /** Blocking is on for this page (globally enabled and the site isn't allowlisted). */
  shielded: boolean
}

export interface DownloadItemInfo {
  id: ID
  filename: string
  path: string
  url: string
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  received: number
  total: number
  startedAt: number
}

export interface ExtensionInfo {
  id: string
  name: string
  icon?: string
}

export interface AppState extends PersistedState {
  live: Record<ID, LiveInfo>
  downloads: DownloadItemInfo[]
  extensions: Record<ID, ExtensionInfo[]>
  platform: NodeJS.Platform
  maximized: boolean
  fullscreen: boolean
  /** True while the collapsed sidebar is temporarily shown over the page. */
  sidebarPeek: boolean
  /** The tab being dragged from the sidebar, while the page area shows split drop zones. */
  tabDrag?: ID
  /** The command bar is open to make a new tab (the sidebar highlights "New Tab", like Arc). */
  newTabOpen: boolean
  /** The page shown in Peek, if one is open. */
  peek?: LiveInfo
  /**
   * Where web pages currently sit in the window, so the UI can draw split handles and focus rings.
   * `elsewhere`: the page is shown in another window, which has it live; this one shows a still of it.
   */
  layout: { content: Rect; views: { id: ID; rect: Rect; elsewhere?: boolean }[]; splitId?: ID }
  update: UpdateStatus
  /** Each profile's answers to site permission prompts, for Settings. */
  sitePermissions: Record<ID, SitePermissionRow[]>
}

/**
 * A newer YARC. Windows and macOS download it in the background ('downloading', then 'ready'
 * to restart into); Linux, and a Mac that can't replace its app, only learn it exists ('available')
 * and download it by hand.
 */
export type UpdateStatus =
  | { state: 'none' }
  | { state: 'downloading'; version: string }
  | { state: 'ready'; version: string; /** Every version since the running one, newest first, for the relaunch card. */ notes?: ReleaseNotes[] }
  | { state: 'available'; version: string }

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type OverlayMode =
  | { kind: 'none' }
  | { kind: 'command'; initial?: string; editCurrent?: boolean; target?: 'tab' | 'split' | 'current' }
  | { kind: 'find' }
  | { kind: 'settings' }
  | { kind: 'library'; tab?: 'archive' | 'history' | 'downloads' | 'spaces' }
  | { kind: 'space-editor'; spaceId?: ID }
  | { kind: 'sidebar' }
  | { kind: 'switcher'; order: ID[]; index: number }
  /** A Peek page floats over the content; the overlay draws the dimmed backdrop and its buttons beside `card`. */
  | { kind: 'peek'; card: Rect }
  /** A sidebar tab is being dragged: the overlay covers the page area and draws split drop zones. */
  | { kind: 'split-drop' }
  /** The tour: first run, or Take the Tour. Try-it steps float over the page (shared/tour.ts). */
  | { kind: 'tour'; step: TourStep }
  /** The changes in the versions since the user's last one, newest first. */
  | { kind: 'whats-new'; releases: ReleaseNotes[] }
  | { kind: 'update' }

export interface SearchResult {
  kind: 'tab' | 'favorite' | 'pinned' | 'history' | 'suggestion' | 'url' | 'command' | 'archive'
  id: string
  title: string
  subtitle?: string
  url?: string
  favicon?: string
  /** For tabs: the item to activate. For commands: the command id. */
  target?: string
  spaceId?: ID
}
