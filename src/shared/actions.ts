import type { Side } from './split'
import type { CloudDrive } from './sync'
import type { ID, LiveSource, OverlayMode, Rect, Settings, Space, SplitAt } from './types'

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
  | { type: 'devtoolsPopOut' }
  | { type: 'newFolder'; name?: string }
  | { type: 'toggleFolder'; id: ID }
  | { type: 'renameFolder'; id: ID; name: string }
  /** A live folder goes with its tabs; any other folder leaves them in its place. */
  | { type: 'deleteFolder'; id: ID }
  /** No `id` = a new live folder at the top of Pinned. */
  | { type: 'saveLiveFolder'; id?: ID; name: string; source: LiveSource }
  | { type: 'refreshLiveFolder'; id: ID }
  | { type: 'switchSpace'; id: ID }
  | { type: 'switchSpaceRelative'; delta: 1 | -1 }
  | { type: 'createSpace'; name: string; emoji?: string; color: string; color2?: string; appearance?: Space['appearance']; profileId?: ID | 'new'; profileName?: string }
  /** `color2: ''` goes back to one color, `appearance: ''` to following YARC's own. */
  | { type: 'updateSpace'; id: ID; name?: string; emoji?: string; color?: string; color2?: string; appearance?: Space['appearance'] | ''; profileId?: ID }
  /** Shown until the space editor closes; saved only by `updateSpace`/`createSpace`. No `spaceId` = the space being created. */
  | { type: 'previewSpaceColors'; spaceId?: ID; color: string; color2?: string }
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
  | { type: 'sidebarReveal'; show: boolean }
  | { type: 'overlay'; mode: OverlayMode }
  | { type: 'endTour' }
  | { type: 'settings'; patch: Partial<Settings> }
  /** While Settings records a shortcut, key presses reach it instead of running commands. */
  | { type: 'recordShortcut'; on: boolean }
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
  | { type: 'exportBookmarks' }
  | { type: 'importChoices'; ids: string[] }
  | { type: 'command'; id: string; keepOverlay?: boolean }
  | { type: 'relaunchUpdate' }
  // history sync
  | { type: 'syncPickFolder' }
  | { type: 'syncICloud' }
  | { type: 'syncNearby' }
  | { type: 'syncCloud'; drive: CloudDrive }
  /** Sets up a WebDAV server, or signs in to it again when it refused the password. */
  | { type: 'syncServer'; url: string; username: string; password: string }
  /** Signs in to the cloud drive again after it signed YARC out. */
  | { type: 'syncSignIn' }
  /** `create`: start a new sync with this password, in place of the one already kept there, or when nearby sync found no computer to join. */
  | { type: 'syncConnect'; password: string; create?: boolean }
  | { type: 'syncChangePassword'; password: string }
  | { type: 'syncCancel' }
  | { type: 'syncProfile'; id: ID; on: boolean }
  | { type: 'syncOff' }
  | { type: 'itemMenu'; id: ID }
  | { type: 'folderMenu'; id: ID }
  | { type: 'spaceMenu'; id: ID }
  | { type: 'sidebarMenu' }
  /** In window coordinates. */
  | { type: 'appMenu'; x: number; y: number }
  | { type: 'extensionsStore' }
  | { type: 'removeExtension'; profileId: ID; id: string }
  | { type: 'adblockToggleSite'; id?: ID }
  /** No `sourceId` = cancel. `systemAudio` is Windows only. */
  | { type: 'sharePick'; id: string; sourceId?: string; systemAudio?: boolean }
  /** `reset` forgets the answer so the site asks again. */
  | { type: 'sitePermission'; profileId: ID; origin: string; key: string; setting: 'allow' | 'block' | 'reset' }
  | { type: 'extensionPin'; profileId: ID; extensionId: string; pinned: boolean }
  /** `anchor`: the puzzle button, in the coordinates of the view that sent it. */
  | { type: 'extensionsPopover'; profileId: ID; anchor: Rect }
  | { type: 'renameCanvas'; id: ID; name: string }
  | { type: 'canvasMenu'; id: ID }
  | { type: 'hideWhatsNew' }
  /** The canvas made for a big feature (docs/whats-new-canvas.md). */
  | { type: 'openBoard'; spotlight: string }
  /** `rect` is in overlay page coordinates. */
  | { type: 'capture'; rect: Rect; to: CaptureTo; whole?: boolean }

export type CaptureTo = ID | 'new' | 'copy' | 'save'
