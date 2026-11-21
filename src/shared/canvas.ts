import type { Rect } from './types'

export interface CaptureSource {
  url: string
  title: string
  favicon?: string
}

/** In the page's CSS pixels, kept for live captures (docs/canvas.md section 4). */
export interface CaptureGeometry {
  viewport: { width: number; height: number }
  rect: Rect
  scroll: { x: number; y: number }
}

export interface YarcImageData {
  source?: CaptureSource
  capture?: CaptureGeometry
  imageUrl?: string
}

export interface CanvasImage {
  mimeType: string
  dataURL: string
}

/** Main can't lay out a board, so the canvas page places these. */
export interface InboxItem {
  fileId: string
  mimeType: string
  dataURL: string
  width: number
  height: number
  data: YarcImageData
}

/** `ink` is black on a light board and white on a dark one. */
export const COLORS = ['ink', 'grey', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const
export type Color = (typeof COLORS)[number]

export type TextSize = 'title' | 'heading' | 'body'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

interface ItemBox extends Box {
  id: string
}

export interface CardItem extends ItemBox {
  kind: 'capture'
  fileId: string
  source?: CaptureSource
  capture?: CaptureGeometry
  imageUrl?: string
  /** Shows the real page in its picture box (docs/canvas.md 4.1). */
  live?: boolean
}

/** A live card's picture box and the board it's cut to, in the canvas page's CSS pixels; `hidden` while it's too small to read or something is drawn over it. */
export interface LiveCard {
  id: string
  url: string
  capture: CaptureGeometry
  box: Box
  clip: Box
  zoom: number
  pixelRatio: number
  hidden: boolean
}

export interface ImageItem extends ItemBox {
  kind: 'image'
  fileId: string
}

/** Its box is measured by the page from the text; the canvas's title has `title`. */
export interface TextItem extends ItemBox {
  kind: 'text'
  text: string
  size: TextSize
  color: Color
  title?: boolean
}

export interface ShapeItem extends ItemBox {
  kind: 'rect' | 'ellipse'
  color: Color
  fill: boolean
}

/** Top-left to bottom-right of its box, unless flipped. */
export interface ArrowItem extends ItemBox {
  kind: 'arrow'
  color: Color
  flipX: boolean
  flipY: boolean
}

/** `points` are x, y pairs drawn in a `drawnWidth` × `drawnHeight` box, stretched to the item's box. */
export interface DrawItem extends ItemBox {
  kind: 'draw'
  color: Color
  points: number[]
  drawnWidth: number
  drawnHeight: number
}

export type BoardItem = CardItem | ImageItem | TextItem | ShapeItem | ArrowItem | DrawItem

export interface CanvasScene {
  items: BoardItem[]
  view?: { x: number; y: number; zoom: number }
  snapping?: boolean
}

export interface CanvasLoad {
  id: string
  name: string
  scene: CanvasScene | undefined
  files: Record<string, CanvasImage>
}

/** The image's SHA-256: never a path. */
export const FILE_ID = /^[A-Za-z0-9_-]{1,128}$/

export const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico'
}

/** The full-resolution image is kept. */
export const MAX_PLACED = 480

export function placedSize(width: number, height: number, max = MAX_PLACED): { width: number; height: number } {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.round(w * scale), height: Math.round(h * scale) }
}

/** Beside the previous capture, top-aligned, so a series lines up; the first one centered on `center`. */
export function placeNext(previous: Box | undefined, size: { width: number; height: number }, center: { x: number; y: number }, gap = 24): { x: number; y: number } {
  if (previous) return { x: previous.x + previous.width + gap, y: previous.y }
  return { x: Math.round(center.x - size.width / 2), y: Math.round(center.y - size.height / 2) }
}

/** Rows of about √n boxes in reading order, from their top-left corner; a row is as tall as its tallest box. */
export function arrangeInGrid<T extends Box & { id: string }>(boxes: T[], gap = 24): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  if (!boxes.length) return out
  const left = Math.min(...boxes.map((b) => b.x))
  const top = Math.min(...boxes.map((b) => b.y))
  // Reading order: boxes whose tops are within half the smallest height of each other share a row.
  const band = Math.max(1, Math.min(...boxes.map((b) => b.height)) / 2)
  const ordered = [...boxes].sort((a, b) => (Math.abs(a.y - b.y) < band ? a.x - b.x : a.y - b.y))
  const perRow = Math.ceil(Math.sqrt(ordered.length))
  let y = top
  for (let i = 0; i < ordered.length; i += perRow) {
    const row = ordered.slice(i, i + perRow)
    let x = left
    for (const b of row) {
      out.set(b.id, { x, y })
      x += b.width + gap
    }
    y += Math.max(...row.map((b) => b.height)) + gap
  }
  return out
}

export interface Guide {
  axis: 'x' | 'y'
  at: number
  from: number
  to: number
}

const lines = (b: Box, axis: 'x' | 'y') => (axis === 'x' ? [b.x, b.x + b.width / 2, b.x + b.width] : [b.y, b.y + b.height / 2, b.y + b.height])

/** `moving` has already followed the pointer: the extra shift onto another box's nearest edge or center line within `threshold`. */
export function snapMove(moving: Box, others: Box[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const shift = { x: 0, y: 0 }
  const guides: Guide[] = []
  for (const axis of ['x', 'y'] as const) {
    let best: { delta: number; at: number } | undefined
    for (const other of others) {
      for (const mine of lines(moving, axis)) {
        for (const theirs of lines(other, axis)) {
          const delta = theirs - mine
          if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at: theirs }
        }
      }
    }
    if (!best) continue
    shift[axis] = best.delta
    const moved = { ...moving, x: moving.x + shift.x, y: moving.y + shift.y }
    for (const other of others) {
      if (!lines(other, axis).some((l) => Math.abs(l - best.at) < 0.5)) continue
      const cross = axis === 'x' ? 'y' : 'x'
      const size = cross === 'x' ? 'width' : 'height'
      guides.push({ axis, at: best.at, from: Math.min(moved[cross], other[cross]), to: Math.max(moved[cross] + moved[size], other[cross] + other[size]) })
    }
  }
  return { dx: shift.x, dy: shift.y, guides }
}

export function boundsOf(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y }
}
