import { boundsOf, smoothPath, type BoardItem, type Box, type CanvasImage, type TextItem } from '../../shared/canvas'
import { isListed, noteLine, wrappedRows, type NoteLine } from '../../shared/canvas-notes'
import { arrowPath, DRAW_STROKE, drawScale, hasImageFile, LINE_HEIGHT, lineTextSize, LIST_INDENT_EM, NOTE_PADDING, paint, STROKE, TEXT, textFont } from './canvas-item'

const CARD_FRAME = 6
const CHECKED_OPACITY = 0.55
const PADDING = 32
const SCALE = 2

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('image'))
    image.src = src
  })
}

const framed = (item: BoardItem) =>
  item.kind === 'capture' ? { x: item.x - CARD_FRAME, y: item.y - CARD_FRAME, width: item.width + 2 * CARD_FRAME, height: item.height + 2 * CARD_FRAME } : item

async function loadImages(items: BoardItem[], files: Map<string, CanvasImage>): Promise<Map<string, HTMLImageElement | undefined>> {
  const images = new Map<string, HTMLImageElement | undefined>()
  for (const item of items) {
    if (hasImageFile(item) && !images.has(item.fileId)) {
      const file = files.get(item.fileId)
      images.set(item.fileId, file ? await loadImage(file.dataURL).catch(() => undefined) : undefined)
    }
  }
  return images
}

function drawCard(ctx: CanvasRenderingContext2D, box: Box, radius: number): void {
  ctx.save()
  ctx.shadowColor = 'rgb(0 0 0 / 0.14)'
  ctx.shadowBlur = 18
  ctx.shadowOffsetY = 4
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(box.x, box.y, box.width, box.height, radius)
  ctx.fill()
  ctx.restore()
}

/** The bullet or checkbox of a list line, in the column `left` of its text, like the board's `.marker`. */
function drawMarker(ctx: CanvasRenderingContext2D, line: NoteLine, column: { left: number; width: number }, rowMiddle: number, fontSize: number): void {
  if (line.mark === 'bullet') {
    ctx.textAlign = 'center'
    ctx.fillText('•', column.left + column.width / 2, rowMiddle)
    ctx.textAlign = 'left'
  }
  if (line.mark !== 'unchecked' && line.mark !== 'checked') return
  const side = 0.8 * fontSize
  const left = column.left + 0.3 * fontSize
  const top = rowMiddle - side / 2
  ctx.lineWidth = 0.09 * fontSize
  ctx.beginPath()
  ctx.roundRect(left, top, side, side, 0.2 * fontSize)
  if (line.mark === 'checked') {
    ctx.moveTo(left + 0.22 * side, top + 0.52 * side)
    ctx.lineTo(left + 0.42 * side, top + 0.72 * side)
    ctx.lineTo(left + 0.78 * side, top + 0.28 * side)
  }
  ctx.stroke()
}

/** The board lets the browser break a wrapped text's lines; a 2D canvas doesn't, so they're broken here with `measureText`. */
function drawText(ctx: CanvasRenderingContext2D, item: TextItem, family: string): void {
  const padding = item.card ? NOTE_PADDING : { x: 0, y: 0 }
  if (item.card) drawCard(ctx, item, 10)
  const color = paint(item.color, false)
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.textBaseline = 'middle'
  let top = item.y + padding.y
  for (const typed of item.text.split('\n')) {
    const line = noteLine(typed)
    const size = lineTextSize(item, line)
    const fontSize = TEXT[size].size
    const rowHeight = fontSize * LINE_HEIGHT
    const indent = isListed(line) ? (line.level + 1) * LIST_INDENT_EM * fontSize : 0
    const left = item.x + padding.x + indent
    const room = item.wrapWidth === undefined ? Infinity : item.wrapWidth - 2 * padding.x - indent
    ctx.font = textFont(size, family)
    ctx.globalAlpha = line.mark === 'checked' ? CHECKED_OPACITY : 1
    // A 2D canvas draws a tab as one space; the board shows it four wide (`tab-size`).
    const rows = wrappedRows(line.text.replaceAll('\t', '    '), room, (text) => ctx.measureText(text).width)
    drawMarker(ctx, line, { left: left - LIST_INDENT_EM * fontSize, width: LIST_INDENT_EM * fontSize }, top + rowHeight / 2, fontSize)
    rows.forEach((row, rowIndex) => {
      const rowMiddle = top + (rowIndex + 0.5) * rowHeight
      ctx.fillText(row, left, rowMiddle)
      if (line.mark === 'checked') ctx.fillRect(left, rowMiddle, ctx.measureText(row).width, 1)
    })
    top += rows.length * rowHeight
  }
}

function drawItem(ctx: CanvasRenderingContext2D, item: BoardItem, images: Map<string, HTMLImageElement | undefined>, family: string): void {
  if (hasImageFile(item)) {
    if (item.kind === 'capture') drawCard(ctx, framed(item), 12)
    const image = images.get(item.fileId)
    ctx.beginPath()
    ctx.roundRect(item.x, item.y, item.width, item.height, item.kind === 'capture' ? 7 : 6)
    ctx.clip()
    if (image) ctx.drawImage(image, item.x, item.y, item.width, item.height)
  } else if (item.kind === 'text') {
    drawText(ctx, item, family)
  } else if (item.kind === 'rect' || item.kind === 'ellipse') {
    const color = paint(item.color, false)
    ctx.beginPath()
    if (item.kind === 'rect') ctx.roundRect(item.x, item.y, item.width, item.height, 4)
    else ctx.ellipse(item.x + item.width / 2, item.y + item.height / 2, item.width / 2, item.height / 2, 0, 0, Math.PI * 2)
    if (item.fill) {
      ctx.fillStyle = `${color}2e`
      ctx.fill()
    }
    ctx.lineWidth = STROKE
    ctx.strokeStyle = color
    ctx.stroke()
  } else if (item.kind === 'arrow') {
    ctx.translate(item.x, item.y)
    ctx.lineWidth = STROKE
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = paint(item.color, false)
    ctx.stroke(new Path2D(arrowPath(item)))
  } else if (item.kind === 'draw') {
    const { scaleX, scaleY } = drawScale(item)
    ctx.translate(item.x, item.y)
    ctx.scale(scaleX, scaleY)
    ctx.lineWidth = DRAW_STROKE / ((scaleX + scaleY) / 2)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = paint(item.color, false)
    ctx.stroke(new Path2D(smoothPath(item.points)))
  }
}

export async function renderPng(items: BoardItem[], files: Map<string, CanvasImage>): Promise<Uint8Array | undefined> {
  const bounds = boundsOf(items.map(framed))
  if (!bounds) return undefined
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil((bounds.width + 2 * PADDING) * SCALE)
  canvas.height = Math.ceil((bounds.height + 2 * PADDING) * SCALE)
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(SCALE, SCALE)
  ctx.translate(PADDING - bounds.x, PADDING - bounds.y)
  const family = getComputedStyle(document.body).fontFamily
  const images = await loadImages(items, files)
  for (const item of items) {
    ctx.save()
    drawItem(ctx, item, images, family)
    ctx.restore()
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined
}
