import type { Action } from './actions'
import type { AppState, OverlayMode, SearchResult } from './types'
import type { HistoryRow, LittleState } from './ipc-types'
import type { PermissionPrompt, PromptOp } from './permissions'

export type { HistoryRow, LittleState } from './ipc-types'

export const IPC = {
  state: 'arc:state',
  overlay: 'arc:overlay',
  toast: 'arc:toast',
  find: 'arc:find',
  little: 'arc:little-state',
  edit: 'arc:edit',
  snapshot: 'arc:snapshot',
  action: 'arc:action',
  getState: 'arc:get-state',
  getOverlay: 'arc:get-overlay',
  search: 'arc:search',
  suggest: 'arc:suggest',
  history: 'arc:history',
  historyDelete: 'arc:history-delete',
  littleOp: 'arc:little-op',
  prompt: 'arc:prompt',
  promptOp: 'arc:prompt-op',
  focus: 'arc:focus',
  blur: 'arc:blur',
  float: 'arc:float',
  floatOp: 'arc:float-op'
} as const

/** Main asks the sidebar to start inline editing (after a native context menu choice). */
export interface EditRequest {
  kind: 'rename' | 'renameFolder'
  id: string
}

/** A still image of a page another window shows live, for the pane it leaves empty here. */
export interface PageSnapshot {
  id: string
  /** A data: URL. */
  image: string
}

/** Find-in-page results, or a request to step to the next/previous match (Cmd+G). */
export interface FindEvent {
  matches?: number
  active?: number
  step?: 1 | -1
}

/** Toolbar requests; 'sync' asks for the current state once the toolbar listens. */
export type LittleOp =
  | 'sync'
  | 'openInMain'
  | 'close'
  | 'copyUrl'
  | 'back'
  | 'forward'
  | 'reload'
  | 'profileMenu'
  | 'spaceMenu'

/** What the floating player's controls show. */
export interface FloatState {
  url: string
  title: string
  playing: boolean
  muted: boolean
}

/** The floating player's controls; 'sync' asks for the state once they listen. Drag positions are screen points. */
export type FloatOp =
  | { kind: 'sync' | 'back' | 'toggle' | 'minimize' | 'close' }
  | { kind: 'skip'; seconds: number }
  | { kind: 'drag'; phase: 'start' | 'move' | 'end'; x: number; y: number }

/** Where a Little Window toolbar menu opens, in window coordinates. */
export interface LittleAnchor {
  x: number
  y: number
}

/** The API the preload exposes to UI renderers as `window.arc`. */
export interface ArcApi {
  platform: NodeJS.Platform
  getState(): Promise<AppState>
  getOverlay(): Promise<OverlayMode>
  onState(cb: (s: AppState) => void): () => void
  onOverlay(cb: (m: OverlayMode) => void): () => void
  onToast(cb: (text: string) => void): () => void
  onFind(cb: (f: FindEvent) => void): () => void
  onLittle(cb: (s: LittleState) => void): () => void
  onEdit(cb: (e: EditRequest) => void): () => void
  onSnapshot(cb: (s: PageSnapshot) => void): () => void
  dispatch(action: Action): Promise<void>
  search(query: string): Promise<SearchResult[]>
  suggest(query: string): Promise<string[]>
  history(query: string, offset: number): Promise<HistoryRow[]>
  deleteHistory(url: string): Promise<void>
  little(op: LittleOp, at?: LittleAnchor): Promise<void>
  /** The site permission prompt (prompt.html): what to ask, or null for nothing. */
  onPrompt(cb: (p: PermissionPrompt | null) => void): () => void
  prompt(op: PromptOp): Promise<void>
  /** Gives this view the keyboard; a page may have it, even after a click here. */
  focus(): Promise<void>
  /**
   * This view lost the keyboard to another view (a page, the overlay). The document itself isn't
   * told: its focused element stays focused and gets no blur event.
   */
  onBlur(cb: () => void): () => void
  /** The floating player's controls (float.html). */
  onFloat(cb: (s: FloatState) => void): () => void
  float(op: FloatOp): Promise<void>
}
