import { boundsOf, smoothPath, type BoardItem, type CanvasImage } from '../../shared/canvas'
import { arrowPath, DRAW_STROKE, drawScale, hasImageFile, LINE_HEIGHT, paint, STROKE, TEXT, textFont } from './canvas-item'

const CARD_FRAME = 6
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

function drawItem(ctx: CanvasRenderingContext2D, item: BoardItem, images: Map<string, HTMLImageElement | undefined>, family: string): void {
  if (hasImageFile(item)) {
    if (item.kind === 'capture') {
      const frame = framed(item)
      ctx.save()
      ctx.shadowColor = 'rgb(0 0 0 / 0.14)'
      ctx.shadowBlur = 18
      ctx.shadowOffsetY = 4
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.roundRect(frame.x, frame.y, frame.width, frame.height, 12)
      ctx.fill()
      ctx.restore()
    }
    const image = images.get(item.fileId)
    ctx.beginPath()
    ctx.roundRect(item.x, item.y, item.width, item.height, item.kind === 'capture' ? 7 : 6)
    ctx.clip()
    if (image) ctx.drawImage(image, item.x, item.y, item.width, item.height)
  } else if (item.kind === 'text') {
    const { size } = TEXT[item.size]
    ctx.font = textFont(item.size, family)
    ctx.fillStyle = paint(item.color, false)
    ctx.textBaseline = 'middle'
    // A 2D canvas draws a tab as one space; the board shows it four wide (`tab-size`).
    const lines = item.text.replaceAll('\t', '    ').split('\n')
    lines.forEach((line, lineIndex) => ctx.fillText(line, item.x, item.y + (lineIndex + 0.5) * size * LINE_HEIGHT))
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
