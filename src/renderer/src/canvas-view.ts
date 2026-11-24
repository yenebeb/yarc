import type { Box } from '../../shared/canvas'

export type Point = { x: number; y: number }
export type View = { x: number; y: number; zoom: number }

export const toWorld = (point: Point, view: View): Point => ({ x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom })
export const toScreen = (box: Box, view: View): Box => ({ x: box.x * view.zoom + view.x, y: box.y * view.zoom + view.y, width: box.width * view.zoom, height: box.height * view.zoom })
