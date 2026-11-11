// Everything a UI renderer can ask the main process to do.
import type { Side } from './split'
import type { ID, OverlayMode, SearchEngine, Settings } from './types'

/** Where a moved item should land. `index` is within the target list. */
export type DropTarget =
  | { section: 'favorites'; index: number }
  | { section: 'pinned'; folderId?: ID; index: number }
  | { section: 'today'; index: number }

export type Action =
  // tabs
  | { type: 'activate'; id: ID }
  | { type: 'close'; id: ID }
  | { type: 'open'; url: string; where?: 'tab' | 'current' | 'split' | 'background' | 'little' }
  | { type: 'reopenClosed' }
  | { type: 'togglePin'; id: ID }
  | { type: 'addFavorite'; id: ID }
  | { type: 'resetToSaved'; id: ID }
  | { type: 'duplicate'; id: ID }
  | { type: 'rename'; id: ID; title: string }
  | { type: 'move'; id: ID; to: DropTarget }
  | { type: 'moveToSpace'; id: ID; spaceId: ID }
  | { type: 'clearToday' }
  | { type: 'unload'; id: ID }
  | { type: 'mute'; id: ID }
  // navigation on the active tab
  | { type: 'back' }
  | { type: 'forward' }
  | { type: 'reload'; hard?: boolean }
  | { type: 'stop' }
  | { type: 'zoom'; delta: 1 | -1 | 0 }
  | { type: 'copyUrl'; markdown?: boolean }
  | { type: 'devtools' }
  // folders
  | { type: 'newFolder'; name?: string }
  | { type: 'toggleFolder'; id: ID }
  | { type: 'renameFolder'; id: ID; name: string }
  | { type: 'deleteFolder'; id: ID }
  // spaces & profiles
  | { type: 'switchSpace'; id: ID }
  | { type: 'switchSpaceRelative'; delta: 1 | -1 }
  | { type: 'switchSpaceIndex'; index: number }
  | { type: 'createSpace'; name: string; emoji?: string; color: string; profileId?: ID | 'new'; profileName?: string }
  | { type: 'updateSpace'; id: ID; name?: string; emoji?: string; color?: string; profileId?: ID }
  | { type: 'deleteSpace'; id: ID }
  | { type: 'renameProfile'; id: ID; name: string }
  // split view
  | { type: 'splitWith'; id: ID }
  | { type: 'unsplit'; id?: ID }
  /** `sizes` of the group at `path` (child indexes from the split's root). */
  | { type: 'resizeSplit'; splitId: ID; path: number[]; sizes: number[] }
  /** Drop tab `id` on `side` of `target`, making or extending a split. */
  | { type: 'placeInSplit'; id: ID; target: ID; side: Side }
  /** A tab drag from the sidebar starts (`id`) or ends (no `id`). */
  | { type: 'tabDrag'; id?: ID }
  // window & chrome
  | { type: 'toggleSidebar' }
  | { type: 'sidebarPeek'; show: boolean }
  | { type: 'overlay'; mode: OverlayMode }
  /** Skip, Start Browsing or the close button of the tour. */
  | { type: 'endTour' }
  | { type: 'settings'; patch: Partial<Settings> }
  | { type: 'searchEngine'; engine: SearchEngine }
  | { type: 'littleArc'; url?: string }
  | { type: 'peek'; op: 'close' | 'expand' | 'split' }
  | { type: 'openInChrome'; id?: ID }
  | { type: 'find'; query: string; forward?: boolean; findNext?: boolean }
  | { type: 'stopFind' }
  | { type: 'downloadOpen'; id: ID; reveal?: boolean }
  | { type: 'downloadsClear' }
  | { type: 'archiveRestore'; id: ID }
  | { type: 'archiveClear' }
  /** `keepOverlay`: from the welcome screen, which stays open for its other steps. */
  | { type: 'import'; source: 'arc' | 'zen' | 'chrome'; path?: string; keepOverlay?: boolean }
  | { type: 'command'; id: string; keepOverlay?: boolean }
  /** From the relaunch card: restart into the downloaded update, its notes already read. */
  | { type: 'relaunchUpdate' }
  | { type: 'itemMenu'; id: ID }
  | { type: 'folderMenu'; id: ID }
  | { type: 'spaceMenu'; id: ID }
  | { type: 'extensionsStore' }
  | { type: 'adblockToggleSite'; id?: ID }
  /** Settings > Site Permissions: allow or block a site's permission, or forget it so the site asks again. */
  | { type: 'sitePermission'; profileId: ID; origin: string; key: string; setting: 'allow' | 'block' | 'reset' }
