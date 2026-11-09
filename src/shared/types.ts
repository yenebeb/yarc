import type { Shortcuts } from './keymap'
import type { LinkRoute } from './link-routes'
import type { SitePermissionRow } from './permissions'
import type { Side } from './split'
import type { TourStep } from './tour'
import type { HistorySyncStatus } from './sync'

export type ID = string

export interface TabItem {
  id: ID
  url: string
  title: string
  favicon?: string
  /** Home URL for favorites and pinned tabs; unset for Today tabs. */
  savedUrl?: string
  savedTitle?: string
  /** Epoch ms; drives auto-archive and MRU. */
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
  /** Set on a live folder, whose children come from it (src/main/live-folders.ts). */
  live?: LiveSource
  /** Why the last refresh failed; cleared by the next one that works. */
  liveError?: string
}

/** `query` uses GitHub's own search syntax, e.g. `is:pr is:open author:@me`. */
export type LiveSource = { kind: 'github'; query: string } | { kind: 'feed'; url: string }

/** Its contents are files in its profile's folder (src/main/canvas-store.ts), not in state.json. */
export interface PinnedCanvas {
  kind: 'canvas'
  /** Also the name of its folder under Profiles/<profile>/Canvases/. */
  id: ID
  name: string
  lastActive: number
}

export type PinnedNode = PinnedTab | PinnedFolder | PinnedCanvas

export interface Profile {
  id: ID
  name: string
  favorites: TabItem[]
  /** Random ID naming this profile's history in the sync folder, the same on every device that syncs it. */
  syncKey?: string
  /** Whether this profile's history syncs while sync is on; unset means it does. */
  syncHistory?: boolean
}

export interface SplitPane {
  itemId: ID
}

export interface SplitGroup {
  dir: 'row' | 'column'
  children: SplitNode[]
  /** One per child, summing to 1. */
  sizes: number[]
}

export type SplitNode = SplitPane | SplitGroup

/** 2-4 tabs shown together. */
export interface Split {
  id: ID
  root: SplitGroup
}

export interface Space {
  id: ID
  name: string
  emoji?: string
  color: string
  /** Where the sidebar's gradient ends; unset is `color` alone. */
  color2?: string
  /** Sidebar text appearance over the theme color; unset follows the system. */
  appearance?: 'light' | 'dark'
  profileId: ID
  pinned: PinnedNode[]
  /** Newest first. */
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

export const SIDEBAR_WIDTH = { min: 200, max: 480 }

export type SettingsSection = 'general' | 'traffic' | 'profiles' | 'sync' | 'sites' | 'import' | 'extensions' | 'shortcuts' | 'about'

export interface Settings {
  sidebarVisible: boolean
  sidebarWidth: number
  sidebarRight: boolean
  /** 0 = never. */
  archiveAfterHours: number
  searchEngine: SearchEngine
  littleArcForExternalLinks: boolean
  /** Checked before `littleArcForExternalLinks`; the first match wins. */
  linkRoutes: LinkRoute[]
  /** 0 = never. */
  littleCloseAfterHours: number
  /** Empty = profile of the active space. */
  littleArcProfileId: ID | ''
  /** Links from pinned tabs and favorites to other sites open in Peek instead of replacing the page. */
  peekPinnedLinks: boolean
  theme: 'system' | 'light' | 'dark'
  adblock: boolean
  adblockAllowlist: string[]
  autoUpdate: boolean
  floatVideos: boolean
  shortcuts: Shortcuts
  /** History sync through `syncFolder` (see src/main/sync). */
  syncHistory: boolean
  syncFolder: string
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
  /** So the next newer version shows What's New. */
  lastSeenVersion?: string
  seenSpotlights?: string[]
  waitingUpdate?: WaitingUpdate
  /** The last focused one last. */
  windows: WindowView[]
}

/** Survives a restart that didn't install the update; stale once a version other than `from` runs. */
export interface WaitingUpdate {
  from: string
  /** When this version first had an update ready, in ms since the epoch. */
  since: number
  /** When the relaunch card last opened by itself. */
  askedAt?: number
}

/** What one main window shows; the sidebar's contents are shared by all windows. */
export interface WindowView {
  id: ID
  activeSpaceId: ID
  /** Space id → tab id. */
  selected: Record<ID, ID>
  splits: Record<ID, Split[]>
  sidebarVisible: boolean
  /** Normal (un-maximized) bounds. */
  bounds?: Rect
  maximized?: boolean
}

/** A browser profile found on this computer that the tour can import. `name` is empty when it's the browser's only profile. */
export interface ImportChoice {
  id: string
  browser: string
  name: string
  detail: string
  ticked: boolean
}

export interface ReleaseNotes {
  version: string
  changes: string[]
  /** GitHub logins of the outside contributors whose PRs this version has. */
  thanks: string[]
}

export interface LittleArcMemory {
  /** Absent = a size that suits the screen. */
  size?: { width: number; height: number }
  profileByHost: Record<string, ID>
}

export interface LiveInfo {
  wcId: number
  url: string
  title: string
  favicon?: string
  loading: boolean
  audible: boolean
  muted: boolean
  /** May be silent; false once paused or ended. */
  playing: boolean
  canGoBack: boolean
  canGoForward: boolean
  zoom: number
  /** Ads/trackers blocked on the current page. */
  blocked: number
  /** Globally enabled and the site isn't allowlisted. */
  shielded: boolean
  /** The color along the top of the page, for its bar in a split view. */
  barColor?: string
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
  sidebarReveal: boolean
  /** While set, the page area shows split drop zones. */
  tabDrag?: ID
  /** The command bar is open to make a new tab, so the sidebar highlights "New Tab". */
  newTabOpen: boolean
  peek?: LiveInfo
  /** `elsewhere`: live in another window, shown here as a still. `bar`: a split pane's bar above the page. */
  layout: { content: Rect; views: { id: ID; rect: Rect; bar?: Rect; elsewhere?: boolean }[]; splitId?: ID }
  update: UpdateStatus
  sitePermissions: Record<ID, SitePermissionRow[]>
  /** Only on the tour's import step; undefined while still looking. */
  importChoices?: ImportChoice[]
  /** Tabs playing out of sight. `cards`: oldest first. `videos`: cards whose video can float again. */
  media: { cards: ID[]; floating?: ID; videos: ID[] }
  historySync: HistorySyncStatus
}

/** 'available': Linux, or a Mac that can't replace its app, downloads it by hand. */
export type UpdateStatus =
  | { state: 'none' }
  | { state: 'downloading'; version: string }
  | { state: 'ready'; version: string; /** Every version since the running one, newest first. */ notes?: ReleaseNotes[] }
  | { state: 'available'; version: string }

export interface SplitAt {
  target: ID
  side: Side
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ShareSource {
  id: string
  name: string
  screen: boolean
  /** A data: URL. */
  thumbnail: string
}

export type OverlayMode =
  | { kind: 'none' }
  | { kind: 'command'; initial?: string; editCurrent?: boolean; target?: 'tab' | 'split' | 'current'; splitAt?: SplitAt }
  | { kind: 'find' }
  | { kind: 'share-picker'; id: string; site: string; sources: ShareSource[]; systemAudio: boolean }
  /** A short message over the top of the page that doesn't take the keyboard. */
  | { kind: 'notice'; text: string }
  | { kind: 'settings'; section?: SettingsSection }
  | { kind: 'library'; tab?: 'archive' | 'history' | 'downloads' | 'spaces' }
  | { kind: 'space-editor'; spaceId?: ID }
  /** No `folderId` = a new one. */
  | { kind: 'live-folder'; folderId?: ID }
  | { kind: 'sidebar' }
  | { kind: 'switcher'; order: ID[]; index: number }
  /** The overlay draws the dimmed backdrop and Peek's buttons beside `card`. */
  | { kind: 'peek'; card: Rect }
  | { kind: 'split-drop' }
  | { kind: 'tour'; step: TourStep }
  /** Spotlight cards first, then the releases since the user's last version, newest first. */
  | { kind: 'whats-new'; releases: ReleaseNotes[]; spotlights: string[] }
  | { kind: 'update' }
  /** `page`: where the active page sits in the overlay, which covers the content area. */
  | { kind: 'capture'; page: Rect }

export interface SearchResult {
  /** `pastSearch`: something searched for before, found in history; its `url` is the query. */
  kind: 'tab' | 'favorite' | 'pinned' | 'history' | 'pastSearch' | 'suggestion' | 'url' | 'command' | 'archive'
  id: string
  title: string
  subtitle?: string
  url?: string
  favicon?: string
  /** For tabs: the item to activate. For commands: the command id. */
  target?: string
  spaceId?: ID
}
