import type { Side } from './split'
import type { ID, OverlayMode, SearchEngine, Settings, SplitAt } from './types'

/** `index` is within the target list. */
export type DropTarget =
  | { section: 'favorites'; index: number }
  | { section: 'pinned'; folderId?: ID; index: number }
  | { section: 'today'; index: number }

export type Action =
  | { type: 'activate'; id: ID }
  | { type: 'close'; id: ID }
  | { type: 'open'; url: string; where?: 'tab' | 'current' | 'split' | 'background' | 'little'; splitAt?: SplitAt }
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
  | { type: 'media'; id: ID; op: 'back' | 'toggle' | 'float' | 'dismiss' }
  /** Navigation acts on tab `id` (a split pane's bar), else the active tab. */
  | { type: 'back'; id?: ID }
  | { type: 'forward'; id?: ID }
  | { type: 'reload'; hard?: boolean; id?: ID }
  | { type: 'stop'; id?: ID }
  | { type: 'copyUrl'; markdown?: boolean; id?: ID }
  | { type: 'zoom'; delta: 1 | -1 | 0 }
  | { type: 'devtools' }
  | { type: 'newFolder'; name?: string }
  | { type: 'toggleFolder'; id: ID }
  | { type: 'renameFolder'; id: ID; name: string }
  | { type: 'deleteFolder'; id: ID }
  | { type: 'switchSpace'; id: ID }
  | { type: 'switchSpaceRelative'; delta: 1 | -1 }
  | { type: 'switchSpaceIndex'; index: number }
  | { type: 'createSpace'; name: string; emoji?: string; color: string; profileId?: ID | 'new'; profileName?: string }
  | { type: 'updateSpace'; id: ID; name?: string; emoji?: string; color?: string; profileId?: ID }
  | { type: 'deleteSpace'; id: ID }
  | { type: 'renameProfile'; id: ID; name: string }
  /** `at`: next to a given pane instead of at the right of the split. */
  | { type: 'splitWith'; id: ID; at?: SplitAt }
  | { type: 'unsplit'; id?: ID }
  /** `path`: child indexes from the split's root to the group. */
  | { type: 'resizeSplit'; splitId: ID; path: number[]; sizes: number[] }
  | { type: 'placeInSplit'; id: ID; target: ID; side: Side }
  /** At window point x, y. */
  | { type: 'splitMenu'; id: ID; x: number; y: number }
  | { type: 'moveInSplit'; id: ID; delta: -1 | 1 }
  /** The command bar opens a tab on `side` of pane `id`. */
  | { type: 'addSplit'; id: ID; side: Side }
  | { type: 'separateFromSplit'; id: ID }
  | { type: 'flipSplit'; id: ID }
  /** Starts with an `id`, ends without one. */
  | { type: 'tabDrag'; id?: ID }
  | { type: 'toggleSidebar' }
  | { type: 'sidebarPeek'; show: boolean }
  | { type: 'overlay'; mode: OverlayMode }
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
  | { type: 'relaunchUpdate' }
  | { type: 'itemMenu'; id: ID }
  | { type: 'folderMenu'; id: ID }
  | { type: 'spaceMenu'; id: ID }
  | { type: 'extensionsStore' }
  | { type: 'adblockToggleSite'; id?: ID }
  /** No `sourceId` = cancel. `systemAudio` is Windows only. */
  | { type: 'sharePick'; id: string; sourceId?: string; systemAudio?: boolean }
  /** `reset` forgets the answer so the site asks again. */
  | { type: 'sitePermission'; profileId: ID; origin: string; key: string; setting: 'allow' | 'block' | 'reset' }
