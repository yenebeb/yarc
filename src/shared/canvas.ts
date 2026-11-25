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

export const TEXT_SIZES = ['title', 'heading', 'body'] as const
export type TextSize = (typeof TEXT_SIZES)[number]

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
  /** Lines wrap at this width; without it the text is as wide as its longest line (titles, labels). */
  wrapWidth?: number
  /** Drawn on a card: a note. */
  card?: boolean
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
  /** The board's own look; without it the board follows its space. */
  appearance?: BoardAppearance
}

export type BoardAppearance = 'light' | 'dark'
export const isBoardAppearance = (value: unknown): value is BoardAppearance => value === 'light' || value === 'dark'

export interface CanvasLoad {
  id: string
  name: string
  scene: CanvasScene | undefined
  files: Record<string, CanvasImage>
  captureKey: string
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

type Fields = Record<string, unknown>
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null
const isRealNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const isColor = (value: unknown) => COLORS.some((color) => color === value)
const isFileId = (value: unknown) => typeof value === 'string' && FILE_ID.test(value)
const isOptionalText = (value: unknown) => value === undefined || typeof value === 'string'
const isOptionalSource = (value: unknown) => value === undefined || (isFields(value) && typeof value.url === 'string' && typeof value.title === 'string' && isOptionalText(value.favicon))
const isShape = (item: Fields) => isColor(item.color) && typeof item.fill === 'boolean'
const isOptionalWrapWidth = (value: unknown) => value === undefined || (isRealNumber(value) && value > 0)
const isOptionalFlag = (value: unknown) => value === undefined || typeof value === 'boolean'
const isText = (item: Fields) =>
  typeof item.text === 'string' && TEXT_SIZES.some((size) => size === item.size) && isColor(item.color) && isOptionalWrapWidth(item.wrapWidth) && isOptionalFlag(item.card)

const HAS_ITS_OWN_FIELDS: Record<string, (item: Fields) => boolean> = {
  capture: (item) => isFileId(item.fileId) && isOptionalSource(item.source),
  image: (item) => isFileId(item.fileId),
  text: isText,
  rect: isShape,
  ellipse: isShape,
  arrow: (item) => isColor(item.color) && typeof item.flipX === 'boolean' && typeof item.flipY === 'boolean',
  draw: (item) => isColor(item.color) && Array.isArray(item.points) && item.points.every(isRealNumber) && isRealNumber(item.drawnWidth) && isRealNumber(item.drawnHeight)
} satisfies Record<BoardItem['kind'], (item: Fields) => boolean>

/** A clipboard or a canvas.json written elsewhere can hold anything, and the board can't draw an item with a field missing. */
export function isBoardItem(value: unknown): value is BoardItem {
  if (!isFields(value) || typeof value.id !== 'string' || typeof value.kind !== 'string' || !Object.hasOwn(HAS_ITS_OWN_FIELDS, value.kind)) return false
  return [value.x, value.y, value.width, value.height].every(isRealNumber) && HAS_ITS_OWN_FIELDS[value.kind](value)
}

/** `spot`, or the first place a step down and right of it where no item already starts: a second paste doesn't hide the first. */
export function freeSpot(taken: Box[], spot: { x: number; y: number }, step = 24): { x: number; y: number } {
  const isTaken = taken.some((box) => Math.abs(box.x - spot.x) < 1 && Math.abs(box.y - spot.y) < 1)
  return isTaken ? freeSpot(taken, { x: spot.x + step, y: spot.y + step }, step) : spot
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

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const intersects = (a: Box, b: Box) => a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height

export function smoothPath(points: number[]): string {
  if (points.length < 4) return `M ${points[0] ?? 0} ${points[1] ?? 0} l 0.01 0`
  let d = `M ${points[0]} ${points[1]}`
  for (let i = 2; i < points.length - 2; i += 2) {
    const mx = (points[i] + points[i + 2]) / 2
    const my = (points[i + 1] + points[i + 3]) / 2
    d += ` Q ${points[i]} ${points[i + 1]} ${mx} ${my}`
  }
  return `${d} L ${points[points.length - 2]} ${points[points.length - 1]}`
}

export function arrowEnds(a: { width: number; height: number; flipX: boolean; flipY: boolean }) {
  return { x1: a.flipX ? a.width : 0, y1: a.flipY ? a.height : 0, x2: a.flipX ? 0 : a.width, y2: a.flipY ? 0 : a.height }
}

export function arrowHead(x1: number, y1: number, x2: number, y2: number, size = 14): string {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const side = (turn: number) => `${x2 + size * Math.cos(angle + turn)} ${y2 + size * Math.sin(angle + turn)}`
  return `M ${side(Math.PI * 0.82)} L ${x2} ${y2} L ${side(-Math.PI * 0.82)}`
}

export function resized(box: Box, handle: Handle, dx: number, dy: number, keepShape: boolean) {
  let left = box.x
  let top = box.y
  let right = box.x + box.width
  let bottom = box.y + box.height
  if (handle.includes('w')) left += dx
  if (handle.includes('e')) right += dx
  if (handle.includes('n')) top += dy
  if (handle.includes('s')) bottom += dy
  if (keepShape && handle.length === 2 && box.width > 0 && box.height > 0) {
    const ratio = box.width / box.height
    let w = right - left
    let h = bottom - top
    if (Math.abs(w) / ratio > Math.abs(h)) h = (Math.sign(h) || 1) * (Math.abs(w) / ratio)
    else w = (Math.sign(w) || 1) * Math.abs(h) * ratio
    if (handle.includes('w')) left = right - w
    else right = left + w
    if (handle.includes('n')) top = bottom - h
    else bottom = top + h
  }
  return {
    box: { x: Math.min(left, right), y: Math.min(top, bottom), width: Math.abs(right - left), height: Math.abs(bottom - top) },
    flipX: right < left,
    flipY: bottom < top
  }
}

export function withBox(item: BoardItem, r: ReturnType<typeof resized>): BoardItem {
  const min = item.kind === 'arrow' || item.kind === 'draw' ? 0 : 8
  const box = { ...r.box, width: Math.max(min, r.box.width), height: Math.max(min, r.box.height) }
  if (item.kind === 'arrow') return { ...item, ...box, flipX: item.flipX !== r.flipX, flipY: item.flipY !== r.flipY }
  if (item.kind === 'draw' && (r.flipX || r.flipY)) {
    const points = item.points.map((v, i) => (i % 2 === 0 ? (r.flipX ? item.drawnWidth - v : v) : r.flipY ? item.drawnHeight - v : v))
    return { ...item, ...box, points }
  }
  return { ...item, ...box }
}
