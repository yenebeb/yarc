import type { SitePermissionRow } from './permissions'
import type { Side } from './split'
import type { TourStep } from './tour'

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
}

export type PinnedNode = PinnedTab | PinnedFolder

export interface Profile {
  id: ID
  name: string
  favorites: TabItem[]
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

export interface Settings {
  sidebarVisible: boolean
  sidebarWidth: number
  sidebarRight: boolean
  /** 0 = never. */
  archiveAfterHours: number
  searchEngine: SearchEngine
  littleArcForExternalLinks: boolean
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

export interface ReleaseNotes {
  version: string
  changes: string[]
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
  sidebarPeek: boolean
  /** While set, the page area shows split drop zones. */
  tabDrag?: ID
  /** The command bar is open to make a new tab, so the sidebar highlights "New Tab". */
  newTabOpen: boolean
  peek?: LiveInfo
  /** `elsewhere`: live in another window, shown here as a still. `bar`: a split pane's bar above the page. */
  layout: { content: Rect; views: { id: ID; rect: Rect; bar?: Rect; elsewhere?: boolean }[]; splitId?: ID }
  update: UpdateStatus
  sitePermissions: Record<ID, SitePermissionRow[]>
  /** Tabs playing out of sight. `cards`: oldest first. `videos`: cards whose video can float again. */
  media: { cards: ID[]; floating?: ID; videos: ID[] }
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
  | { kind: 'settings' }
  | { kind: 'library'; tab?: 'archive' | 'history' | 'downloads' | 'spaces' }
  | { kind: 'space-editor'; spaceId?: ID }
  | { kind: 'sidebar' }
  | { kind: 'switcher'; order: ID[]; index: number }
  /** The overlay draws the dimmed backdrop and Peek's buttons beside `card`. */
  | { kind: 'peek'; card: Rect }
  | { kind: 'split-drop' }
  | { kind: 'tour'; step: TourStep }
  /** Spotlight cards first, then the releases since the user's last version, newest first. */
  | { kind: 'whats-new'; releases: ReleaseNotes[]; spotlights: string[] }
  | { kind: 'update' }

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
