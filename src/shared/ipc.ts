import type { Action } from './actions'
import type { CanvasImage, CanvasLoad, CanvasScene, InboxItem, LiveCard } from './canvas'
import type { AppState, OverlayMode, Rect, SearchResult } from './types'
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
  still: 'arc:still',
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
  floatOp: 'arc:float-op',
  canvasLoad: 'arc:canvas-load',
  canvasSave: 'arc:canvas-save',
  canvasInbox: 'arc:canvas-inbox',
  canvasTakeInbox: 'arc:canvas-take-inbox',
  canvasRenamed: 'arc:canvas-renamed',
  canvasOpenUrl: 'arc:canvas-open-url',
  canvasExport: 'arc:canvas-export',
  canvasLive: 'arc:canvas-live',
  canvasShown: 'arc:canvas-shown',
  capturePick: 'arc:capture-pick'
} as const

export interface EditRequest {
  kind: 'rename' | 'renameFolder' | 'renameCanvas'
  id: string
}

export interface PageStill {
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

/** 'sync' asks for the current state once the toolbar listens. */
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

export interface FloatState {
  url: string
  title: string
  playing: boolean
  muted: boolean
}

/** 'sync' asks for the state once the controls listen. Drag positions are screen points. */
export type FloatOp =
  | { kind: 'sync' | 'back' | 'toggle' | 'minimize' | 'close' }
  | { kind: 'skip'; seconds: number }
  | { kind: 'drag'; phase: 'start' | 'move' | 'end'; x: number; y: number }

/** In window coordinates. */
export interface LittleAnchor {
  x: number
  y: number
}

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
  onStill(cb: (s: PageStill) => void): () => void
  dispatch(action: Action): Promise<void>
  search(query: string): Promise<SearchResult[]>
  suggest(query: string): Promise<string[]>
  history(query: string, offset: number): Promise<HistoryRow[]>
  deleteHistory(url: string): Promise<void>
  little(op: LittleOp, at?: LittleAnchor): Promise<void>
  onPrompt(cb: (p: PermissionPrompt | null) => void): () => void
  prompt(op: PromptOp): Promise<void>
  /** Gives this view the keyboard; a page may have it, even after a click here. */
  focus(): Promise<void>
  /** Lost the keyboard to another view; the document isn't told and its focused element gets no blur. */
  onBlur(cb: () => void): () => void
  onFloat(cb: (s: FloatState) => void): () => void
  float(op: FloatOp): Promise<void>
  canvasLoad(): Promise<CanvasLoad>
  /** Fire-and-forget, so it still works while the page unloads. */
  canvasSave(scene: CanvasScene, newFiles: Record<string, CanvasImage>): void
  canvasTakeInbox(): Promise<InboxItem[]>
  onCanvasInbox(cb: () => void): () => void
  onCanvasRenamed(cb: (r: { from: string; to: string }) => void): () => void
  canvasOpenUrl(url: string): Promise<void>
  canvasExport(png: Uint8Array, to: 'file' | 'clipboard'): Promise<void>
  /** Every live card, each time one moves, resizes or is hidden; none while the page isn't shown. */
  canvasLive(cards: LiveCard[]): void
  /** Taking the page out of the window doesn't hide its document. */
  onCanvasShown(cb: (shown: boolean) => void): () => void
  /** In overlay page coordinates; `depth` steps out to the element's ancestors. */
  capturePick(x: number, y: number, depth: number): Promise<Rect | undefined>
}
