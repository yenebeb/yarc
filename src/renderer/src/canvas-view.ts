import type { Box } from '../../shared/canvas'

export type Point = { x: number; y: number }
export type View = { x: number; y: number; zoom: number }

export const toWorld = (point: Point, view: View): Point => ({ x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom })
export const toScreen = (box: Box, view: View): Box => ({ x: box.x * view.zoom + view.x, y: box.y * view.zoom + view.y, width: box.width * view.zoom, height: box.height * view.zoom })

/** How far a stretch from `start` to `end` reaches out of `min`…`max`: negative before `min`, positive past `max`. */
export const reachesOutBy = (start: number, end: number, min: number, max: number): number => Math.min(0, start - min) + Math.max(0, end - max)
