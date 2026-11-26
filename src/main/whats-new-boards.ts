// The boards What's New opens for a big feature (docs/whats-new-canvas.md): made by hand on a canvas, saved with the feature.
import { isBoardBackground, isBoardItem, type CanvasScene } from '../shared/canvas'
import canvasNotes from './boards/canvas-notes.json'
import historySync from './boards/history-sync.json'
import liveFolders from './boards/live-folders.json'

/** The id a board's card of the releases page names; the image is written with it (src/main/whats-new-releases.png). */
export const RELEASES_STILL = 'releases-still'

const board = (saved: { items: unknown[]; view?: CanvasScene['view']; background?: string }): CanvasScene => ({
  items: saved.items.filter(isBoardItem),
  view: saved.view,
  background: isBoardBackground(saved.background) ? saved.background : undefined
})

/** By spotlight id (src/shared/spotlights.ts). */
export const BOARDS: Record<string, CanvasScene> = { 'canvas-notes': board(canvasNotes), 'history-sync': board(historySync), 'live-folders': board(liveFolders) }

export const hasBoard = (spotlightId: string): boolean => Object.hasOwn(BOARDS, spotlightId)
