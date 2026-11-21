import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import {
  arrangeInGrid,
  boundsOf,
  COLORS,
  IMAGE_TYPES,
  placedSize,
  placeNext,
  snapMove,
  type BoardItem,
  type Box,
  type CanvasImage,
  type CanvasLoad,
  type CanvasScene,
  type CardItem,
  type Color,
  type DrawItem,
  type Guide,
  type ImageItem,
  type InboxItem,
  type TextItem,
  type TextSize
} from '../../shared/canvas'
import { bindingLabel } from '../../shared/keymap'
import { arc, cx, isMac } from './api'
import { Icon, type IconName } from './icons'
import './canvas.css'

const SAVE_DELAY = 400
const UNDO_STEPS = 200
const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const SNAP_SCREEN_PX = 6
const CARD_FRAME = 6
const STROKE = 2.5
const DRAW_STROKE = 3
const LINE_HEIGHT = 1.25
const TEXT: Record<TextSize, { size: number; weight: number; label: string }> = {
  title: { size: 36, weight: 700, label: 'Title' },
  heading: { size: 24, weight: 600, label: 'Heading' },
  body: { size: 16, weight: 400, label: 'Body' }
}
const PALETTE: Record<Color, { light: string; dark: string }> = {
  ink: { light: '#1d1b22', dark: '#ecebf0' },
  grey: { light: '#8a8794', dark: '#9e9ba8' },
  red: { light: '#e5484d', dark: '#ff6369' },
  orange: { light: '#f76b15', dark: '#ff8b3e' },
  yellow: { light: '#e2a336', dark: '#ffca16' },
  green: { light: '#30a46c', dark: '#3dd68c' },
  blue: { light: '#0090ff', dark: '#70b8ff' },
  purple: { light: '#8e4ec6', dark: '#bf7af0' }
}
/** Carries the images too, so items paste into another canvas. */
const CLIP_TYPE = 'application/x-yarc-canvas'

type Tool = 'select' | 'hand' | 'text' | 'rect' | 'ellipse' | 'arrow' | 'draw'
type View = { x: number; y: number; zoom: number }
type Point = { x: number; y: number }
type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type Style = { color: Color; fill: boolean; textSize: TextSize }
type Gesture =
  | { kind: 'pan'; start: Point; view: View }
  | { kind: 'move'; start: Point; before: BoardItem[]; ids: Set<string>; clicked: string; moved: boolean }
  | { kind: 'resize'; start: Point; before: BoardItem[]; id: string; handle: Handle }
  | { kind: 'marquee'; start: Point; keep: string[] }
  | { kind: 'create'; start: Point; before: BoardItem[]; id: string }
  | { kind: 'draw'; points: number[] }

const TOOLS: { tool: Tool; icon: IconName; label: string; key: string }[] = [
  { tool: 'select', icon: 'pointer', label: 'Select', key: 'V' },
  { tool: 'hand', icon: 'hand', label: 'Move the board', key: 'H' },
  { tool: 'text', icon: 'text', label: 'Text', key: 'T' },
  { tool: 'rect', icon: 'rectangle', label: 'Rectangle', key: 'R' },
  { tool: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'O' },
  { tool: 'arrow', icon: 'arrow', label: 'Arrow', key: 'A' },
  { tool: 'draw', icon: 'pen', label: 'Draw', key: 'P' }
]

const newId = () => crypto.randomUUID()
const paint = (color: Color, dark: boolean) => PALETTE[color][dark ? 'dark' : 'light']
const toWorld = (p: Point, v: View): Point => ({ x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom })
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
const intersects = (a: Box, b: Box) => a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
const hasColor = (i: BoardItem): i is Extract<BoardItem, { color: Color }> => 'color' in i
const keepsShape = (i: BoardItem) => i.kind === 'capture' || i.kind === 'image'
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
const textFont = (size: TextSize, family: string) => `${TEXT[size].weight} ${TEXT[size].size}px ${family}`

const appearanceIsDark = () => document.documentElement.dataset.appearance === 'dark'

function useDarkAppearance(): boolean {
  const [dark, setDark] = useState(appearanceIsDark)
  useEffect(() => {
    const watch = new MutationObserver(() => setDark(appearanceIsDark()))
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance'] })
    return () => watch.disconnect()
  }, [])
  return dark
}

function smoothPath(points: number[]): string {
  if (points.length < 4) return `M ${points[0] ?? 0} ${points[1] ?? 0} l 0.01 0`
  let d = `M ${points[0]} ${points[1]}`
  for (let i = 2; i < points.length - 2; i += 2) {
    const mx = (points[i] + points[i + 2]) / 2
    const my = (points[i + 1] + points[i + 3]) / 2
    d += ` Q ${points[i]} ${points[i + 1]} ${mx} ${my}`
  }
  return `${d} L ${points[points.length - 2]} ${points[points.length - 1]}`
}

function arrowEnds(a: { width: number; height: number; flipX: boolean; flipY: boolean }) {
  return { x1: a.flipX ? a.width : 0, y1: a.flipY ? a.height : 0, x2: a.flipX ? 0 : a.width, y2: a.flipY ? 0 : a.height }
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, size = 14): string {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const side = (turn: number) => `${x2 + size * Math.cos(angle + turn)} ${y2 + size * Math.sin(angle + turn)}`
  return `M ${side(Math.PI * 0.82)} L ${x2} ${y2} L ${side(-Math.PI * 0.82)}`
}

function resized(box: Box, handle: Handle, dx: number, dy: number, keepShape: boolean) {
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

function withBox(item: BoardItem, r: ReturnType<typeof resized>): BoardItem {
  const min = item.kind === 'arrow' || item.kind === 'draw' ? 0 : 8
  const box = { ...r.box, width: Math.max(min, r.box.width), height: Math.max(min, r.box.height) }
  if (item.kind === 'arrow') return { ...item, ...box, flipX: item.flipX !== r.flipX, flipY: item.flipY !== r.flipY }
  if (item.kind === 'draw' && (r.flipX || r.flipY)) {
    const points = item.points.map((v, i) => (i % 2 === 0 ? (r.flipX ? item.drawnWidth - v : v) : r.flipY ? item.drawnHeight - v : v))
    return { ...item, ...box, points }
  }
  return { ...item, ...box }
}

function readDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image'))
    img.src = src
  })
}

async function hashOf(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A one-off copy event: needs no clipboard permission. */
function copyText(text: string): void {
  const onCopy = (e: ClipboardEvent) => {
    e.preventDefault()
    e.stopImmediatePropagation()
    e.clipboardData?.setData('text/plain', text)
  }
  document.addEventListener('copy', onCopy, { capture: true, once: true })
  document.execCommand('copy')
}

async function renderPng(items: BoardItem[], files: Map<string, CanvasImage>): Promise<Uint8Array | undefined> {
  const bounds = boundsOf(items.map((i) => (i.kind === 'capture' ? { x: i.x - CARD_FRAME, y: i.y - CARD_FRAME, width: i.width + 2 * CARD_FRAME, height: i.height + 2 * CARD_FRAME } : i)))
  if (!bounds) return undefined
  const pad = 32
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil((bounds.width + 2 * pad) * scale)
  canvas.height = Math.ceil((bounds.height + 2 * pad) * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.translate(pad - bounds.x, pad - bounds.y)
  const family = getComputedStyle(document.body).fontFamily
  const images = new Map<string, HTMLImageElement | undefined>()
  for (const item of items) {
    if ((item.kind === 'capture' || item.kind === 'image') && !images.has(item.fileId)) {
      const file = files.get(item.fileId)
      images.set(item.fileId, file ? await loadImage(file.dataURL).catch(() => undefined) : undefined)
    }
  }
  for (const item of items) {
    ctx.save()
    if (item.kind === 'capture' || item.kind === 'image') {
      if (item.kind === 'capture') {
        ctx.save()
        ctx.shadowColor = 'rgb(0 0 0 / 0.14)'
        ctx.shadowBlur = 18
        ctx.shadowOffsetY = 4
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.roundRect(item.x - CARD_FRAME, item.y - CARD_FRAME, item.width + 2 * CARD_FRAME, item.height + 2 * CARD_FRAME, 12)
        ctx.fill()
        ctx.restore()
      }
      const img = images.get(item.fileId)
      ctx.beginPath()
      ctx.roundRect(item.x, item.y, item.width, item.height, item.kind === 'capture' ? 7 : 6)
      ctx.clip()
      if (img) ctx.drawImage(img, item.x, item.y, item.width, item.height)
    } else if (item.kind === 'text') {
      const { size } = TEXT[item.size]
      ctx.font = textFont(item.size, family)
      ctx.fillStyle = paint(item.color, false)
      ctx.textBaseline = 'middle'
      item.text.split('\n').forEach((line, n) => ctx.fillText(line, item.x, item.y + (n + 0.5) * size * LINE_HEIGHT))
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
      const { x1, y1, x2, y2 } = arrowEnds(item)
      ctx.translate(item.x, item.y)
      ctx.lineWidth = STROKE
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = paint(item.color, false)
      ctx.stroke(new Path2D(`M ${x1} ${y1} L ${x2} ${y2} ${arrowHead(x1, y1, x2, y2)}`))
    } else if (item.kind === 'draw') {
      const sx = item.width / item.drawnWidth || 1
      const sy = item.height / item.drawnHeight || 1
      ctx.translate(item.x, item.y)
      ctx.scale(sx, sy)
      ctx.lineWidth = DRAW_STROKE / ((sx + sy) / 2)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = paint(item.color, false)
      ctx.stroke(new Path2D(smoothPath(item.points)))
    }
    ctx.restore()
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  return blob ? new Uint8Array(await blob.arrayBuffer()) : undefined
}

function ItemView({
  item,
  selected,
  editing,
  dark,
  files,
  nodeRef,
  onEdited
}: {
  item: BoardItem
  selected: boolean
  editing: boolean
  dark: boolean
  files: Map<string, CanvasImage>
  nodeRef: (node: HTMLElement | null) => void
  onEdited: (text: string) => void
}) {
  const place: CSSProperties = { left: item.x, top: item.y, width: item.width, height: item.height }
  const cls = cx('item', item.kind, selected && 'selected')
  if (item.kind === 'capture') {
    const source = item.source
    return (
      <div className={cx(cls, 'card')} data-id={item.id} style={place}>
        <div className="frame" />
        <img src={files.get(item.fileId)?.dataURL} alt={source?.title ?? ''} draggable={false} />
        {source ? (
          <div className="footer">
            {source.favicon ? <img className="favicon" src={source.favicon} alt="" draggable={false} /> : <Icon name="globe" size={15} />}
            <span className="title">{source.title || source.url}</span>
            <button title="Open the page" onPointerDown={(e) => e.stopPropagation()} onClick={() => void arc.canvasOpenUrl(source.url)}>
              <Icon name="external" size={14} />
            </button>
          </div>
        ) : null}
      </div>
    )
  }
  if (item.kind === 'image') {
    return (
      <div className={cls} data-id={item.id} style={place}>
        <img src={files.get(item.fileId)?.dataURL} alt="" draggable={false} />
      </div>
    )
  }
  if (item.kind === 'text') {
    const t = TEXT[item.size]
    return (
      <div
        ref={nodeRef}
        className={cx(cls, editing && 'editing')}
        data-id={item.id}
        style={{ left: item.x, top: item.y, color: paint(item.color, dark), fontSize: t.size, fontWeight: t.weight, lineHeight: LINE_HEIGHT }}
        contentEditable={editing ? 'plaintext-only' : undefined}
        suppressContentEditableWarning
        spellCheck={editing}
        onBlur={editing ? (e) => onEdited(e.currentTarget.innerText.replace(/\n$/, '')) : undefined}
        onKeyDown={
          editing
            ? (e) => {
                if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
              }
            : undefined
        }
      >
        {item.text}
      </div>
    )
  }
  if (item.kind === 'rect' || item.kind === 'ellipse') {
    const color = paint(item.color, dark)
    return <div className={cls} data-id={item.id} style={{ ...place, borderColor: color, background: item.fill ? `${color}2e` : 'transparent' }} />
  }
  if (item.kind === 'arrow') {
    const { x1, y1, x2, y2 } = arrowEnds(item)
    const d = `M ${x1} ${y1} L ${x2} ${y2} ${arrowHead(x1, y1, x2, y2)}`
    return (
      <svg className={cls} data-id={item.id} style={{ left: item.x, top: item.y }} width={Math.max(1, item.width)} height={Math.max(1, item.height)}>
        <path className="hit" d={d} />
        <path d={d} stroke={paint(item.color, dark)} strokeWidth={STROKE} />
      </svg>
    )
  }
  if (item.kind !== 'draw') return null
  const sx = item.width / item.drawnWidth || 1
  const sy = item.height / item.drawnHeight || 1
  const d = smoothPath(item.points)
  return (
    <svg
      className={cls}
      data-id={item.id}
      style={{ left: item.x, top: item.y }}
      width={Math.max(1, item.width)}
      height={Math.max(1, item.height)}
      viewBox={`0 0 ${Math.max(1, item.drawnWidth)} ${Math.max(1, item.drawnHeight)}`}
      preserveAspectRatio="none"
    >
      <path className="hit" d={d} strokeWidth={14 / ((sx + sy) / 2)} />
      <path d={d} stroke={paint(item.color, dark)} strokeWidth={DRAW_STROKE / ((sx + sy) / 2)} />
    </svg>
  )
}

interface MenuEntry {
  label: string
  keys?: string
  checked?: boolean
  run: () => void
}

function Menu({ at, entries, onClose }: { at: Point; entries: (MenuEntry | '-')[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState(at)
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPlace({ x: Math.max(8, Math.min(at.x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(at.y, innerHeight - r.height - 8)) })
  }, [at])
  return (
    <div ref={ref} className="menu" style={{ left: place.x, top: place.y }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {entries.map((e, i) =>
        e === '-' ? (
          <div key={i} className="menu-line" />
        ) : (
          <button
            key={i}
            onClick={() => {
              onClose()
              e.run()
            }}
          >
            <span className="check">{e.checked ? '✓' : ''}</span>
            <span className="label">{e.label}</span>
            {e.keys ? <span className="keys">{e.keys}</span> : null}
          </button>
        )
      )}
    </div>
  )
}

function Board({ loaded }: { loaded: CanvasLoad }) {
  const dark = useDarkAppearance()
  const boardRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const [items, setItemsState] = useState<BoardItem[]>(
    () => loaded.scene?.items ?? [{ id: newId(), kind: 'text', x: 0, y: 0, width: 0, height: 0, text: loaded.name, size: 'title', color: 'ink', title: true }]
  )
  const [view, setViewState] = useState<View>(() => loaded.scene?.view ?? { x: 96, y: 96, zoom: 1 })
  const [selected, setSelectedState] = useState<string[]>([])
  const [snapping, setSnapping] = useState(loaded.scene?.snapping ?? true)
  const [tool, setTool] = useState<Tool>('select')
  const [style, setStyle] = useState<Style>({ color: 'ink', fill: false, textSize: 'body' })
  const [editing, setEditing] = useState<string>()
  const [guides, setGuides] = useState<Guide[]>([])
  const [marquee, setMarquee] = useState<Box>()
  const [draft, setDraft] = useState<number[]>()
  const [menu, setMenu] = useState<{ at: Point; board: boolean }>()
  const [panning, setPanning] = useState(false)

  // The latest state, for event handlers registered once.
  const itemsRef = useRef(items)
  const viewRef = useRef(view)
  const selectedRef = useRef(selected)
  const editingRef = useRef(editing)
  const snappingRef = useRef(snapping)
  itemsRef.current = items
  viewRef.current = view
  selectedRef.current = selected
  editingRef.current = editing
  snappingRef.current = snapping
  const setItems = (next: BoardItem[]) => {
    itemsRef.current = next
    setItemsState(next)
  }
  const setView = (next: View) => {
    viewRef.current = next
    setViewState(next)
  }
  const setSelected = (next: string[]) => {
    selectedRef.current = next
    setSelectedState(next)
  }

  const files = useRef(new Map<string, CanvasImage>(Object.entries(loaded.files)))
  /** Images main has on disk; the others go with the next save. */
  const stored = useRef(new Set(Object.keys(loaded.files)))
  const past = useRef<BoardItem[][]>([])
  const future = useRef<BoardItem[][]>([])
  const gesture = useRef<Gesture>(undefined)
  const editBefore = useRef<BoardItem[]>(undefined)
  const lastDown = useRef<{ at: number; id: string | undefined }>({ at: 0, id: undefined })
  const spaceDown = useRef(false)
  const lastPlaced = useRef<string>(undefined)
  const pasteCount = useRef(0)
  const nodes = useRef(new Map<string, HTMLElement>())


  const record = (before: BoardItem[]) => {
    past.current.push(before)
    if (past.current.length > UNDO_STEPS) past.current.shift()
    future.current = []
  }
  const change = (next: BoardItem[]) => {
    record(itemsRef.current)
    setItems(next)
  }
  const undo = (redo = false) => {
    const from = redo ? future.current : past.current
    const to = redo ? past.current : future.current
    const state = from.pop()
    if (!state) return
    to.push(itemsRef.current)
    setItems(state)
    setSelected(selectedRef.current.filter((id) => state.some((i) => i.id === id)))
  }


  const lastSaved = useRef('')
  const save = () => {
    const scene: CanvasScene = { items: itemsRef.current, view: viewRef.current, snapping: snappingRef.current }
    const json = JSON.stringify(scene)
    const newFiles: Record<string, CanvasImage> = {}
    for (const item of scene.items) {
      if ((item.kind === 'capture' || item.kind === 'image') && !stored.current.has(item.fileId)) {
        const file = files.current.get(item.fileId)
        if (file) newFiles[item.fileId] = file
      }
    }
    if (json === lastSaved.current && !Object.keys(newFiles).length) return
    arc.canvasSave(scene, newFiles)
    for (const id of Object.keys(newFiles)) stored.current.add(id)
    lastSaved.current = json
  }
  useEffect(() => {
    const timer = setTimeout(save, SAVE_DELAY)
    return () => clearTimeout(timer)
  })
  useEffect(() => {
    const flush = () => save()
    addEventListener('pagehide', flush)
    return () => removeEventListener('pagehide', flush)
  }, [])

  useLayoutEffect(() => {
    let changed = false
    const next = items.map((item) => {
      const node = item.kind === 'text' ? nodes.current.get(item.id) : undefined
      if (!node || item.kind !== 'text') return item
      const width = node.offsetWidth
      const height = node.offsetHeight
      if (Math.abs(width - item.width) < 0.5 && Math.abs(height - item.height) < 0.5) return item
      changed = true
      return { ...item, width, height }
    })
    if (changed) setItems(next)
  })


  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = boardRef.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }
  const viewSize = () => ({ width: boardRef.current?.clientWidth ?? innerWidth, height: boardRef.current?.clientHeight ?? innerHeight })
  const middle = (): Point => ({ x: viewSize().width / 2, y: viewSize().height / 2 })
  const center = (): Point => toWorld(middle(), viewRef.current)
  const zoomAt = (p: Point, zoom: number) => {
    const v = viewRef.current
    const z = clampZoom(zoom)
    const w = toWorld(p, v)
    setView({ zoom: z, x: p.x - w.x * z, y: p.y - w.y * z })
  }
  const zoomBy = (factor: number) => zoomAt(middle(), viewRef.current.zoom * factor)
  const reveal = (box: Box | undefined, onlyIfHidden = false) => {
    if (!box) return
    const v = viewRef.current
    const { width, height } = viewSize()
    const shown = { x: box.x * v.zoom + v.x, y: box.y * v.zoom + v.y, width: box.width * v.zoom, height: box.height * v.zoom }
    if (onlyIfHidden && shown.x >= 0 && shown.y >= 0 && shown.x + shown.width <= width && shown.y + shown.height <= height) return
    const zoom = clampZoom(Math.min(onlyIfHidden ? v.zoom : 1, (width - 160) / Math.max(1, box.width), (height - 200) / Math.max(1, box.height)))
    setView({ zoom, x: width / 2 - (box.x + box.width / 2) * zoom, y: height / 2 - (box.y + box.height / 2) * zoom })
  }
  const selectedItems = () => itemsRef.current.filter((i) => selectedRef.current.includes(i.id))

  const addImageFiles = async (list: File[], at: Point) => {
    const added: ImageItem[] = []
    for (const file of list) {
      if (!IMAGE_TYPES[file.type]) continue
      const dataURL = await readDataURL(file)
      const fileId = await hashOf(file)
      const img = await loadImage(dataURL).catch(() => undefined)
      const size = placedSize(img?.naturalWidth ?? 320, img?.naturalHeight ?? 240)
      const spot = placeNext(added[added.length - 1], size, at)
      files.current.set(fileId, { mimeType: file.type, dataURL })
      added.push({ id: newId(), kind: 'image', fileId, ...spot, ...size })
    }
    const bounds = boundsOf(added)
    if (!bounds) return
    const shift = at.x - (bounds.x + bounds.width / 2)
    const placed = added.map((i) => ({ ...i, x: i.x + shift }))
    change([...itemsRef.current, ...placed])
    setSelected(placed.map((i) => i.id))
  }

  const copySelection = (e: ClipboardEvent, cut: boolean) => {
    const chosen = selectedItems()
    if (!chosen.length || !e.clipboardData) return
    e.preventDefault()
    const used: Record<string, CanvasImage> = {}
    for (const i of chosen) {
      const file = i.kind === 'capture' || i.kind === 'image' ? files.current.get(i.fileId) : undefined
      if (file && (i.kind === 'capture' || i.kind === 'image')) used[i.fileId] = file
    }
    e.clipboardData.setData(CLIP_TYPE, JSON.stringify({ items: chosen, files: used }))
    const text = chosen
      .map((i) => (i.kind === 'text' ? i.text : i.kind === 'capture' ? (i.source?.url ?? '') : ''))
      .filter(Boolean)
      .join('\n\n')
    if (text) e.clipboardData.setData('text/plain', text)
    pasteCount.current = 0
    if (cut) {
      change(itemsRef.current.filter((i) => !selectedRef.current.includes(i.id)))
      setSelected([])
    }
  }

  const paste = (e: ClipboardEvent) => {
    const data = e.clipboardData
    if (!data) return
    e.preventDefault()
    const ours = data.getData(CLIP_TYPE)
    if (ours) {
      try {
        const clip = JSON.parse(ours) as { items: BoardItem[]; files: Record<string, CanvasImage> }
        for (const [id, file] of Object.entries(clip.files ?? {})) if (!files.current.has(id)) files.current.set(id, file)
        pasteCount.current += 1
        const offset = 24 * pasteCount.current
        const copies = clip.items.map((i): BoardItem => (i.kind === 'text' ? { ...i, id: newId(), x: i.x + offset, y: i.y + offset, title: false } : { ...i, id: newId(), x: i.x + offset, y: i.y + offset }))
        change([...itemsRef.current, ...copies])
        setSelected(copies.map((i) => i.id))
      } catch {}
      return
    }
    const images = [...data.files].filter((f) => IMAGE_TYPES[f.type])
    if (images.length) return void addImageFiles(images, center())
    const text = data.getData('text/plain').trim()
    if (!text) return
    const at = center()
    const item: TextItem = { id: newId(), kind: 'text', x: at.x, y: at.y, width: 0, height: 0, text, size: 'body', color: style.color }
    change([...itemsRef.current, item])
    setSelected([item.id])
  }

  const duplicate = () => {
    const copies = selectedItems().map((i): BoardItem => (i.kind === 'text' ? { ...i, id: newId(), x: i.x + 16, y: i.y + 16, title: false } : { ...i, id: newId(), x: i.x + 16, y: i.y + 16 }))
    if (!copies.length) return
    change([...itemsRef.current, ...copies])
    setSelected(copies.map((i) => i.id))
  }
  const remove = () => {
    if (!selectedRef.current.length) return
    change(itemsRef.current.filter((i) => !selectedRef.current.includes(i.id)))
    setSelected([])
  }
  const reorder = (toFront: boolean) => {
    const chosen = selectedItems()
    if (!chosen.length) return
    const rest = itemsRef.current.filter((i) => !selectedRef.current.includes(i.id))
    change(toFront ? [...rest, ...chosen] : [...chosen, ...rest])
  }
  const arrange = () => {
    const moves = arrangeInGrid(selectedItems())
    if (moves.size < 2) return
    change(itemsRef.current.map((i) => ({ ...i, ...moves.get(i.id) })))
  }
  const makeTitle = (id: string) =>
    change(itemsRef.current.map((i) => (i.kind !== 'text' ? i : i.id === id ? { ...i, title: true, size: 'title' } : i.title ? { ...i, title: false } : i)))
  const nudge = (dx: number, dy: number) => {
    if (!selectedRef.current.length) return
    change(itemsRef.current.map((i) => (selectedRef.current.includes(i.id) ? { ...i, x: i.x + dx, y: i.y + dy } : i)))
  }
  const restyle = (next: Partial<Style>) => {
    setStyle({ ...style, ...next })
    const ids = new Set(selectedRef.current)
    if (!ids.size) return
    let changed = false
    const updated = itemsRef.current.map((i): BoardItem => {
      if (!ids.has(i.id)) return i
      let out = i
      if (next.color && hasColor(out) && out.color !== next.color) out = { ...out, color: next.color }
      if (next.fill !== undefined && (out.kind === 'rect' || out.kind === 'ellipse') && out.fill !== next.fill) out = { ...out, fill: next.fill }
      if (next.textSize && out.kind === 'text' && out.size !== next.textSize) out = { ...out, size: next.textSize }
      if (out !== i) changed = true
      return out
    })
    if (changed) change(updated)
  }
  const exportPng = async (to: 'file' | 'clipboard') => {
    const png = await renderPng(itemsRef.current, files.current)
    if (png) await arc.canvasExport(png, to)
  }

  const startText = (at: Point) => {
    const item: TextItem = { id: newId(), kind: 'text', x: at.x, y: at.y - (TEXT[style.textSize].size * LINE_HEIGHT) / 2, width: 0, height: 0, text: '', size: style.textSize, color: style.color }
    editBefore.current = itemsRef.current
    setItems([...itemsRef.current, item])
    setSelected([item.id])
    setEditing(item.id)
    setTool('select')
  }
  const editText = (id: string) => {
    editBefore.current = itemsRef.current
    setSelected([id])
    setEditing(id)
  }
  const finishEdit = (id: string, text: string) => {
    const before = editBefore.current ?? itemsRef.current
    editBefore.current = undefined
    setEditing(undefined)
    const wasThere = before.find((i) => i.id === id)
    if (!text.trim()) {
      setItems(itemsRef.current.filter((i) => i.id !== id))
      setSelected([])
      if (wasThere) record(before)
      return
    }
    if (wasThere?.kind === 'text' && wasThere.text === text) return
    record(before)
    setItems(itemsRef.current.map((i) => (i.id === id && i.kind === 'text' ? { ...i, text } : i)))
  }
  useEffect(() => {
    if (!editing) return
    const node = nodes.current.get(editing)
    if (!node) return
    node.focus()
    const range = document.createRange()
    range.selectNodeContents(node)
    range.collapse(false)
    const sel = getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }, [editing])


  const takeInbox = async () => {
    const queued: InboxItem[] = await arc.canvasTakeInbox()
    if (!queued.length) return
    const added: CardItem[] = []
    for (const q of queued) {
      const natural =
        q.width > 0 && q.height > 0
          ? q
          : await loadImage(q.dataURL).then(
              (img) => ({ width: img.naturalWidth, height: img.naturalHeight }),
              () => ({ width: 320, height: 240 })
            )
      const size = placedSize(natural.width, natural.height)
      const previous = [...itemsRef.current, ...added].find((i) => i.id === lastPlaced.current)
      const spot = placeNext(previous, size, center())
      files.current.set(q.fileId, { mimeType: q.mimeType, dataURL: q.dataURL })
      const card: CardItem = { id: newId(), kind: 'capture', fileId: q.fileId, ...spot, ...size, source: q.data.source, capture: q.data.capture, imageUrl: q.data.imageUrl }
      added.push(card)
      lastPlaced.current = card.id
    }
    change([...itemsRef.current, ...added])
    reveal(boundsOf(added), true)
  }
  useEffect(() => {
    void takeInbox()
    return arc.onCanvasInbox(() => void takeInbox())
  }, [])

  useEffect(
    () =>
      arc.onCanvasRenamed(({ from, to }) => {
        setItems(itemsRef.current.map((i) => (i.kind === 'text' && i.title && i.text === from ? { ...i, text: to } : i)))
      }),
    []
  )


  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    setMenu(undefined)
    // A click while editing text ends the edit: the browser's default moves focus away.
    if (editingRef.current) return
    // Otherwise no default: it would take focus from a text this click starts editing.
    e.preventDefault()
    const p = local(e)
    const v = viewRef.current
    const w = toWorld(p, v)
    const target = e.target as Element
    if (e.button === 1 || (e.button === 0 && (tool === 'hand' || spaceDown.current))) {
      gesture.current = { kind: 'pan', start: p, view: v }
      setPanning(true)
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    if (tool === 'text') return startText(w)
    if (tool === 'rect' || tool === 'ellipse' || tool === 'arrow') {
      const id = newId()
      const base = { id, x: w.x, y: w.y, width: 0, height: 0, color: style.color }
      const item: BoardItem = tool === 'arrow' ? { ...base, kind: 'arrow', flipX: false, flipY: false } : { ...base, kind: tool, fill: style.fill }
      gesture.current = { kind: 'create', start: w, before: itemsRef.current, id }
      setItems([...itemsRef.current, item])
      setSelected([id])
      return
    }
    if (tool === 'draw') {
      gesture.current = { kind: 'draw', points: [w.x, w.y] }
      setDraft([w.x, w.y])
      return
    }
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle') as Handle | null
    if (handle && selectedRef.current.length === 1) {
      gesture.current = { kind: 'resize', start: w, before: itemsRef.current, id: selectedRef.current[0], handle }
      return
    }
    const hit = target.closest('[data-id]')?.getAttribute('data-id') ?? undefined
    const now = Date.now()
    const double = now - lastDown.current.at < 350 && lastDown.current.id === hit
    lastDown.current = { at: now, id: hit }
    if (double) {
      const item = itemsRef.current.find((i) => i.id === hit)
      if (item?.kind === 'text') return editText(item.id)
      if (!hit) return startText(w)
    }
    if (hit) {
      let next = selectedRef.current
      if (e.shiftKey) next = next.includes(hit) ? next.filter((id) => id !== hit) : [...next, hit]
      else if (!next.includes(hit)) next = [hit]
      setSelected(next)
      if (next.includes(hit)) gesture.current = { kind: 'move', start: w, before: itemsRef.current, ids: new Set(next), clicked: hit, moved: false }
      return
    }
    const keep = e.shiftKey ? selectedRef.current : []
    if (!e.shiftKey) setSelected([])
    gesture.current = { kind: 'marquee', start: p, keep }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g) return
    const p = local(e)
    const v = viewRef.current
    const w = toWorld(p, v)
    if (g.kind === 'pan') return setView({ ...g.view, x: g.view.x + p.x - g.start.x, y: g.view.y + p.y - g.start.y })
    if (g.kind === 'move') {
      let dx = w.x - g.start.x
      let dy = w.y - g.start.y
      if (!g.moved && Math.hypot(dx, dy) * v.zoom < 3) return
      g.moved = true
      const bounds = boundsOf(g.before.filter((i) => g.ids.has(i.id)))
      if (snappingRef.current && !e.altKey && bounds) {
        const others = g.before.filter((i) => !g.ids.has(i.id))
        const snap = snapMove({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }, others, SNAP_SCREEN_PX / v.zoom)
        dx += snap.dx
        dy += snap.dy
        setGuides(snap.guides)
      }
      return setItems(g.before.map((i) => (g.ids.has(i.id) ? { ...i, x: i.x + dx, y: i.y + dy } : i)))
    }
    if (g.kind === 'resize') {
      const item = g.before.find((i) => i.id === g.id)
      if (!item) return
      const r = resized(item, g.handle, w.x - g.start.x, w.y - g.start.y, keepsShape(item) !== e.shiftKey)
      return setItems(g.before.map((i) => (i.id === g.id ? withBox(i, r) : i)))
    }
    if (g.kind === 'marquee') {
      const box = { x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), width: Math.abs(p.x - g.start.x), height: Math.abs(p.y - g.start.y) }
      setMarquee(box)
      const world = { x: (box.x - v.x) / v.zoom, y: (box.y - v.y) / v.zoom, width: box.width / v.zoom, height: box.height / v.zoom }
      const inside = itemsRef.current.filter((i) => intersects(world, i)).map((i) => i.id)
      return setSelected([...new Set([...g.keep, ...inside])])
    }
    if (g.kind === 'create') {
      const box = { x: Math.min(g.start.x, w.x), y: Math.min(g.start.y, w.y), width: Math.abs(w.x - g.start.x), height: Math.abs(w.y - g.start.y) }
      if (e.shiftKey && tool !== 'arrow') box.width = box.height = Math.max(box.width, box.height)
      return setItems(itemsRef.current.map((i) => (i.id !== g.id ? i : i.kind === 'arrow' ? { ...i, ...box, flipX: w.x < g.start.x, flipY: w.y < g.start.y } : { ...i, ...box })))
    }
    const last = g.points.length - 2
    if (Math.hypot(w.x - g.points[last], w.y - g.points[last + 1]) * v.zoom < 1.5) return
    g.points.push(w.x, w.y)
    setDraft([...g.points])
  }

  const onPointerUp = () => {
    const g = gesture.current
    gesture.current = undefined
    if (!g) return
    if (g.kind === 'pan') return setPanning(spaceDown.current)
    if (g.kind === 'move') {
      setGuides([])
      if (g.moved) return record(g.before)
      if (selectedRef.current.length > 1 && selectedRef.current.includes(g.clicked)) setSelected([g.clicked])
      return
    }
    if (g.kind === 'resize') {
      if (itemsRef.current !== g.before) record(g.before)
      return
    }
    if (g.kind === 'marquee') return setMarquee(undefined)
    if (g.kind === 'create') {
      const item = itemsRef.current.find((i) => i.id === g.id)
      if (item && item.width + item.height < 6) {
        const size = item.kind === 'arrow' ? { width: 120, height: 0 } : { width: 160, height: 100 }
        const x = item.kind === 'arrow' ? g.start.x : g.start.x - size.width / 2
        const y = item.kind === 'arrow' ? g.start.y : g.start.y - size.height / 2
        setItems(itemsRef.current.map((i) => (i.id === g.id ? { ...i, x, y, ...size } : i)))
      }
      record(g.before)
      setTool('select')
      return
    }
    setDraft(undefined)
    const xs = g.points.filter((_, i) => i % 2 === 0)
    const ys = g.points.filter((_, i) => i % 2 === 1)
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    const width = Math.max(...xs) - x
    const height = Math.max(...ys) - y
    const points = g.points.map((n, i) => Math.round((n - (i % 2 === 0 ? x : y)) * 10) / 10)
    const item: DrawItem = { id: newId(), kind: 'draw', x, y, width, height, color: style.color, points, drawnWidth: Math.max(1, width), drawnHeight: Math.max(1, height) }
    change([...itemsRef.current, item])
  }

  // Chromium reports a trackpad pinch as a wheel event with ctrlKey.
  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      if (e.ctrlKey || e.metaKey) return zoomAt(local(e), v.zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01)))
      const sideways = e.shiftKey && !e.deltaX
      setView({ ...v, x: v.x - (sideways ? e.deltaY : e.deltaX), y: v.y - (sideways ? 0 : e.deltaY) })
    }
    board.addEventListener('wheel', onWheel, { passive: false })
    return () => board.removeEventListener('wheel', onWheel)
  }, [])


  const onKey = (e: KeyboardEvent) => {
    if (editingRef.current || isTyping(e.target)) return
    const mod = isMac ? e.metaKey : e.ctrlKey
    const key = e.key.toLowerCase()
    const run = (action: () => void) => {
      e.preventDefault()
      action()
    }
    if (e.key === ' ') {
      spaceDown.current = true
      return run(() => setPanning(true))
    }
    if (mod) {
      if (key === 'z') return run(() => undo(e.shiftKey))
      if (key === 'y') return run(() => undo(true))
      if (key === 'a') return run(() => setSelected(itemsRef.current.map((i) => i.id)))
      if (key === 'd') return run(duplicate)
      if (key === '=' || key === '+') return run(() => zoomBy(1.25))
      if (key === '-') return run(() => zoomBy(0.8))
      if (key === '0') return run(() => zoomAt(middle(), 1))
      if (e.shiftKey && e.code === 'BracketRight') return run(() => reorder(true))
      if (e.shiftKey && e.code === 'BracketLeft') return run(() => reorder(false))
      return
    }
    if (e.altKey) return
    if (e.key === 'Delete' || e.key === 'Backspace') return run(remove)
    if (e.key === 'Escape') {
      return run(() => {
        setMenu(undefined)
        if (selectedRef.current.length) setSelected([])
        else setTool('select')
      })
    }
    const step = e.shiftKey ? 10 : 1
    if (e.key === 'ArrowLeft') return run(() => nudge(-step, 0))
    if (e.key === 'ArrowRight') return run(() => nudge(step, 0))
    if (e.key === 'ArrowUp') return run(() => nudge(0, -step))
    if (e.key === 'ArrowDown') return run(() => nudge(0, step))
    if (e.shiftKey && e.code === 'Digit1') return run(() => reveal(boundsOf(itemsRef.current)))
    if (key === 'i') return run(() => fileInput.current?.click())
    const t = TOOLS.find((x) => x.key.toLowerCase() === key)
    if (t) return run(() => setTool(t.tool))
  }
  const handlers = useRef({ onKey, copySelection, paste })
  handlers.current = { onKey, copySelection, paste }
  useEffect(() => {
    const free = (e: Event) => !editingRef.current && !isTyping(e.target)
    const down = (e: KeyboardEvent) => handlers.current.onKey(e)
    const up = (e: KeyboardEvent) => {
      if (e.key !== ' ') return
      spaceDown.current = false
      if (gesture.current?.kind !== 'pan') setPanning(false)
    }
    const onCopy = (e: ClipboardEvent) => free(e) && handlers.current.copySelection(e, false)
    const onCut = (e: ClipboardEvent) => free(e) && handlers.current.copySelection(e, true)
    const onPaste = (e: ClipboardEvent) => free(e) && handlers.current.paste(e)
    addEventListener('keydown', down)
    addEventListener('keyup', up)
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      removeEventListener('keydown', down)
      removeEventListener('keyup', up)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  }, [])


  const shortcut = (k: string) => (isMac ? `⌘${k}` : `Ctrl+${k}`)
  const menuEntries = (board: boolean): (MenuEntry | '-')[] => {
    const chosen = board ? [] : selectedItems()
    const one = chosen.length === 1 ? chosen[0] : undefined
    const out: (MenuEntry | '-')[] = []
    if (chosen.length) {
      out.push(
        { label: 'Cut', keys: shortcut('X'), run: () => document.execCommand('cut') },
        { label: 'Copy', keys: shortcut('C'), run: () => document.execCommand('copy') },
        { label: 'Duplicate', keys: shortcut('D'), run: duplicate },
        { label: 'Delete', keys: '⌫', run: remove },
        '-',
        { label: 'Bring to Front', keys: shortcut('⇧]'), run: () => reorder(true) },
        { label: 'Send to Back', keys: shortcut('⇧['), run: () => reorder(false) }
      )
      if (one?.kind === 'text' && !one.title) out.push({ label: 'Make Title', run: () => makeTitle(one.id) })
      if (one?.kind === 'capture' && one.source) {
        const url = one.source.url
        out.push('-', { label: 'Open Page', run: () => void arc.canvasOpenUrl(url) }, { label: 'Copy Page Address', run: () => copyText(url) })
      }
      if (chosen.length > 1) out.push('-', { label: 'Arrange in Grid', run: arrange })
      out.push('-')
    } else {
      out.push(
        { label: 'Select All', keys: shortcut('A'), run: () => setSelected(itemsRef.current.map((i) => i.id)) },
        { label: 'Zoom to Fit', keys: '⇧1', run: () => reveal(boundsOf(itemsRef.current)) },
        '-'
      )
    }
    out.push({ label: 'Snap to Objects', checked: snapping, run: () => setSnapping(!snapping) })
    if (!chosen.length) out.push('-', { label: 'Export as PNG…', run: () => void exportPng('file') }, { label: 'Copy as PNG', run: () => void exportPng('clipboard') })
    return out
  }


  const onScreen = (b: Box): Box => ({ x: b.x * view.zoom + view.x, y: b.y * view.zoom + view.y, width: b.width * view.zoom, height: b.height * view.zoom })
  const single = selected.length === 1 ? items.find((i) => i.id === selected[0]) : undefined
  const handles: Handle[] = !single || single.kind === 'text' || editing ? [] : keepsShape(single) ? ['nw', 'ne', 'sw', 'se'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  const chosenItems = items.filter((i) => selected.includes(i.id))
  const styled = chosenItems.filter(hasColor)
  const showColors = tool === 'text' || tool === 'rect' || tool === 'ellipse' || tool === 'arrow' || tool === 'draw' || styled.length > 0
  const showFill = tool === 'rect' || tool === 'ellipse' || chosenItems.some((i) => i.kind === 'rect' || i.kind === 'ellipse')
  const showSizes = tool === 'text' || chosenItems.some((i) => i.kind === 'text')
  const currentColor = styled[0]?.color ?? style.color
  const firstShape = chosenItems.find((i) => i.kind === 'rect' || i.kind === 'ellipse')
  const currentFill = firstShape && (firstShape.kind === 'rect' || firstShape.kind === 'ellipse') ? firstShape.fill : style.fill
  const currentSize = chosenItems.find((i): i is TextItem => i.kind === 'text')?.size ?? style.textSize

  const title = items.find((i): i is TextItem => i.kind === 'text' && !!i.title)
  const empty = items.every((i) => i === title) && !editing
  const hintAt = title ? { left: title.x * view.zoom + view.x, top: (title.y + title.height) * view.zoom + view.y + 14 } : undefined

  return (
    <div className="canvas-page">
      <div
        ref={boardRef}
        className={cx('board', `tool-${tool}`, panning && 'panning')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => {
          e.preventDefault()
          const hit = (e.target as Element).closest('[data-id]')?.getAttribute('data-id')
          if (hit && !selectedRef.current.includes(hit)) setSelected([hit])
          if (!hit) setSelected([])
          setMenu({ at: { x: e.clientX, y: e.clientY }, board: false })
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const list = [...e.dataTransfer.files]
          if (list.length) void addImageFiles(list, toWorld(local(e), viewRef.current))
        }}
      >
        <div className="world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          {items.map((item) => (
            <ItemView
              key={item.id}
              item={item}
              selected={selected.includes(item.id)}
              editing={editing === item.id}
              dark={dark}
              files={files.current}
              nodeRef={(node) => (node ? nodes.current.set(item.id, node) : nodes.current.delete(item.id))}
              onEdited={(text) => finishEdit(item.id, text)}
            />
          ))}
          {draft ? (
            <svg className="draft">
              <path d={smoothPath(draft)} stroke={paint(style.color, dark)} strokeWidth={DRAW_STROKE} />
            </svg>
          ) : null}
        </div>
        <div className="overlay">
          {chosenItems.map((item) => {
            const b = onScreen(item)
            return <div key={item.id} className="selection" style={{ left: b.x - 3, top: b.y - 3, width: b.width + 6, height: b.height + 6 }} />
          })}
          {single
            ? handles.map((h) => {
                const b = onScreen(single)
                const x = h.includes('w') ? b.x - 3 : h.includes('e') ? b.x + b.width + 3 : b.x + b.width / 2
                const y = h.includes('n') ? b.y - 3 : h.includes('s') ? b.y + b.height + 3 : b.y + b.height / 2
                return <div key={h} className={`handle handle-${h}`} data-handle={h} style={{ left: x, top: y }} />
              })
            : null}
          {guides.map((g, i) => {
            const at = g.axis === 'x' ? g.at * view.zoom + view.x : g.at * view.zoom + view.y
            const from = g.axis === 'x' ? g.from * view.zoom + view.y : g.from * view.zoom + view.x
            const to = g.axis === 'x' ? g.to * view.zoom + view.y : g.to * view.zoom + view.x
            return <div key={i} className="guide" style={g.axis === 'x' ? { left: at, top: from, height: to - from } : { top: at, left: from, width: to - from }} />
          })}
          {marquee ? <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} /> : null}
        </div>
        {empty ? (
          <div className={cx('empty-hint', !hintAt && 'centered')} style={hintAt ?? { left: '50%', top: '50%' }}>
            Capture part of any page with <kbd>{bindingLabel('capture', isMac)}</kbd>, or right-click an image and choose <b>Add Image to Canvas</b>.
            <br />
            You can also paste or drop images here.
          </div>
        ) : null}
      </div>

      <div className="toolbar" onPointerDown={(e) => e.stopPropagation()}>
        {TOOLS.map((t) => (
          <button key={t.tool} className={cx(tool === t.tool && 'on')} title={`${t.label} (${t.key})`} onClick={() => setTool(t.tool)}>
            <Icon name={t.icon} size={18} />
          </button>
        ))}
        <button title="Image from a file (I)" onClick={() => fileInput.current?.click()}>
          <Icon name="image" size={18} />
        </button>
        {showColors ? (
          <>
            <span className="toolbar-line" />
            {COLORS.map((c) => (
              <button key={c} className={cx('swatch', currentColor === c && 'on')} title={c} onClick={() => restyle({ color: c })}>
                <span style={{ background: paint(c, dark) }} />
              </button>
            ))}
          </>
        ) : null}
        {showFill ? (
          <>
            <span className="toolbar-line" />
            <button className={cx('fill', currentFill && 'on')} title="Fill" onClick={() => restyle({ fill: !currentFill })}>
              <span style={{ borderColor: paint(currentColor, dark), background: currentFill ? `${paint(currentColor, dark)}55` : 'transparent' }} />
            </button>
          </>
        ) : null}
        {showSizes ? (
          <>
            <span className="toolbar-line" />
            {(['title', 'heading', 'body'] as const).map((s) => (
              <button key={s} className={cx('size', currentSize === s && 'on')} title={TEXT[s].label} onClick={() => restyle({ textSize: s })}>
                {s === 'title' ? 'L' : s === 'heading' ? 'M' : 'S'}
              </button>
            ))}
          </>
        ) : null}
      </div>

      <div className="zoombar" onPointerDown={(e) => e.stopPropagation()}>
        <button title={`Zoom out (${shortcut('-')})`} onClick={() => zoomBy(0.8)}>
          <Icon name="minus" size={16} />
        </button>
        <button className="zoom" title={`Actual size (${shortcut('0')})`} onClick={() => zoomAt(middle(), 1)}>
          {Math.round(view.zoom * 100)}%
        </button>
        <button title={`Zoom in (${shortcut('+')})`} onClick={() => zoomBy(1.25)}>
          <Icon name="plus" size={16} />
        </button>
      </div>

      <button
        className="board-menu-button"
        title="More"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu({ at: { x: r.right - 220, y: r.bottom + 6 }, board: true })
        }}
      >
        <Icon name="more" size={18} />
      </button>

      {menu ? <Menu at={menu.at} entries={menuEntries(menu.board)} onClose={() => setMenu(undefined)} /> : null}

      <input
        ref={fileInput}
        type="file"
        accept={Object.keys(IMAGE_TYPES).join(',')}
        multiple
        hidden
        onChange={(e) => {
          const list = [...(e.target.files ?? [])]
          e.target.value = ''
          if (list.length) void addImageFiles(list, center())
        }}
      />
    </div>
  )
}

function App() {
  const [loaded, setLoaded] = useState<CanvasLoad>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    arc.canvasLoad().then(setLoaded, () => setFailed(true))
  }, [])
  if (failed) return <div className="board-message">This canvas couldn’t be opened.</div>
  return loaded ? <Board loaded={loaded} /> : null
}

createRoot(document.getElementById('root')!).render(<App />)
