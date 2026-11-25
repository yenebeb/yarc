import type { Box } from '../../shared/canvas'

export type Point = { x: number; y: number }
export type View = { x: number; y: number; zoom: number }

export const toWorld = (point: Point, view: View): Point => ({ x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom })
export const toScreen = (box: Box, view: View): Box => ({ x: box.x * view.zoom + view.x, y: box.y * view.zoom + view.y, width: box.width * view.zoom, height: box.height * view.zoom })

export const boxBetween = (corner: Point, opposite: Point): Box => ({
  x: Math.min(corner.x, opposite.x),
  y: Math.min(corner.y, opposite.y),
  width: Math.abs(opposite.x - corner.x),
  height: Math.abs(opposite.y - corner.y)
})

/** How far a stretch from `start` to `end` reaches out of `min`…`max`: negative before `min`, positive past `max`. */
export const reachesOutBy = (start: number, end: number, min: number, max: number): number => Math.min(0, start - min) + Math.max(0, end - max)

const GRID_STEP = 24
const ZOOM_WHERE_DOTS_CROWD = 0.5

/** The board's dot grid follows panning and zooming; zoomed far out, every fourth dot is left so they don't crowd. */
export function gridBackground(view: View): { backgroundSize: string; backgroundPosition: string } {
  const step = GRID_STEP * view.zoom * (view.zoom < ZOOM_WHERE_DOTS_CROWD ? 4 : 1)
  return { backgroundSize: `${step}px ${step}px`, backgroundPosition: `${view.x}px ${view.y}px` }
}

type Size = { width: number; height: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

/** Where a bar goes for a selection at `anchor`: centered above it, below it when there's no room above, and never out of `page`. */
export function placeBarBy(anchor: Box, bar: Size, page: Size, gap = 14, edge = 8): Point {
  const above = anchor.y - gap - bar.height
  const y = above >= edge ? above : anchor.y + anchor.height + gap
  const x = anchor.x + anchor.width / 2 - bar.width / 2
  return { x: clamp(x, edge, page.width - bar.width - edge), y: clamp(y, edge, page.height - bar.height - edge) }
}
