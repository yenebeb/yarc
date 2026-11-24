import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import {
  arrangeInGrid,
  boundsOf,
  COLORS,
  IMAGE_TYPES,
  intersects,
  placedSize,
  placeNext,
  resized,
  smoothPath,
  snapMove,
  withBox,
  type BoardItem,
  type Box,
  type CanvasImage,
  type CanvasLoad,
  type CardItem,
  type Color,
  type DrawItem,
  type Guide,
  type Handle,
  type ImageItem,
  type InboxItem,
  type TextItem,
  type TextSize
} from '../../shared/canvas'
import { arc, cx, isMac } from './api'
import { useBoardHistory, useDarkAppearance, useLiveCards, useSceneSave, useStateRef } from './canvas-hooks'
import { DRAW_STROKE, hasImageFile, ItemView, LINE_HEIGHT, paint, TEXT } from './canvas-item'
import { Menu, type MenuEntry } from './canvas-menu'
import { loadImage, renderPng } from './canvas-png'
import { toScreen, toWorld, type Point, type View } from './canvas-view'
import { Icon, type IconName } from './icons'
import './canvas.css'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 4
const SNAP_SCREEN_PX = 6
const CLIP_TYPE = 'application/x-yarc-canvas'

type Tool = 'select' | 'hand' | 'text' | 'rect' | 'ellipse' | 'arrow' | 'draw'
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
const titleOf = (items: BoardItem[]) => items.find((item): item is TextItem => item.kind === 'text' && !!item.title)
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

const hasColor = (item: BoardItem): item is Extract<BoardItem, { color: Color }> => 'color' in item
const keepsShape = (item: BoardItem) => item.kind === 'capture' || item.kind === 'image'
const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
const copyOf = (item: BoardItem, offset: number): BoardItem =>
  item.kind === 'text' ? { ...item, id: newId(), x: item.x + offset, y: item.y + offset, title: false } : { ...item, id: newId(), x: item.x + offset, y: item.y + offset }

function readDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function hashOf(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A one-off copy event: needs no clipboard permission. */
function copyText(text: string): void {
  const onCopy = (event: ClipboardEvent) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    event.clipboardData?.setData('text/plain', text)
  }
  document.addEventListener('copy', onCopy, { capture: true, once: true })
  document.execCommand('copy')
}

function Board({ loaded }: { loaded: CanvasLoad }) {
  const dark = useDarkAppearance()
  const boardRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const {
    items,
    itemsRef,
    setItems,
    record,
    change,
    undo: undoItems
  } = useBoardHistory(() => loaded.scene?.items ?? [{ id: newId(), kind: 'text', x: 0, y: 0, width: 0, height: 0, text: loaded.name, size: 'title', color: 'ink', title: true }])
  const [view, viewRef, setView] = useStateRef<View>(() => loaded.scene?.view ?? { x: 96, y: 96, zoom: 1 })
  const [selected, selectedRef, setSelected] = useStateRef<string[]>([])
  const [snapping, setSnapping] = useState(loaded.scene?.snapping ?? true)
  const [tool, setTool] = useState<Tool>('select')
  const [style, setStyle] = useState<Style>({ color: 'ink', fill: false, textSize: 'body' })
  const [editing, setEditing] = useState<string>()
  const [guides, setGuides] = useState<Guide[]>([])
  const [marquee, setMarquee] = useState<Box>()
  const [draft, setDraft] = useState<number[]>()
  const [menu, setMenu] = useState<{ at: Point; board: boolean }>()
  const [panning, setPanning] = useState(false)
  const editingRef = useRef(editing)
  const snappingRef = useRef(snapping)
  editingRef.current = editing
  snappingRef.current = snapping

  const files = useRef(new Map<string, CanvasImage>(Object.entries(loaded.files)))
  const gestureRef = useRef<Gesture>(undefined)
  const editBefore = useRef<BoardItem[]>(undefined)
  const lastDown = useRef<{ at: number; id: string | undefined }>({ at: 0, id: undefined })
  const spaceDown = useRef(false)
  const lastPlaced = useRef<string>(undefined)
  const centerTitle = useRef(!loaded.scene)
  const pasteCount = useRef(0)
  const nodes = useRef(new Map<string, HTMLElement>())

  const undo = (redo = false) => {
    const restored = undoItems(redo)
    if (restored) setSelected(selectedRef.current.filter((id) => restored.some((item) => item.id === id)))
  }

  useSceneSave(() => ({ items: itemsRef.current, view: viewRef.current, snapping: snappingRef.current }), files.current, Object.keys(loaded.files))

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
  useLayoutEffect(() => {
    const title = titleOf(itemsRef.current)
    if (!centerTitle.current || !title?.width) return
    centerTitle.current = false
    const { width, height } = viewSize()
    setView({ ...viewRef.current, x: Math.round(width / 2 - (title.width / 2) * viewRef.current.zoom), y: Math.round(height / 2 - (title.height / 2) * viewRef.current.zoom) })
  })

  const pointOnBoard = (event: { clientX: number; clientY: number }): Point => {
    const rect = boardRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }
  const viewSize = () => ({ width: boardRef.current?.clientWidth ?? innerWidth, height: boardRef.current?.clientHeight ?? innerHeight })
  const middle = (): Point => ({ x: viewSize().width / 2, y: viewSize().height / 2 })
  const center = (): Point => toWorld(middle(), viewRef.current)
  const zoomAt = (anchor: Point, requestedZoom: number) => {
    const zoom = clampZoom(requestedZoom)
    const anchorInWorld = toWorld(anchor, viewRef.current)
    setView({ zoom, x: anchor.x - anchorInWorld.x * zoom, y: anchor.y - anchorInWorld.y * zoom })
  }
  const zoomBy = (factor: number) => zoomAt(middle(), viewRef.current.zoom * factor)
  const reveal = (box: Box | undefined, onlyIfHidden = false) => {
    if (!box) return
    const currentView = viewRef.current
    const { width, height } = viewSize()
    const boxOnScreen = toScreen(box, currentView)
    if (onlyIfHidden && boxOnScreen.x >= 0 && boxOnScreen.y >= 0 && boxOnScreen.x + boxOnScreen.width <= width && boxOnScreen.y + boxOnScreen.height <= height) return
    const zoom = clampZoom(Math.min(onlyIfHidden ? currentView.zoom : 1, (width - 160) / Math.max(1, box.width), (height - 200) / Math.max(1, box.height)))
    setView({ zoom, x: width / 2 - (box.x + box.width / 2) * zoom, y: height / 2 - (box.y + box.height / 2) * zoom })
  }
  const selectedItems = () => itemsRef.current.filter((item) => selectedRef.current.includes(item.id))

  const addImageFiles = async (list: File[], at: Point) => {
    const added: ImageItem[] = []
    for (const file of list) {
      if (!IMAGE_TYPES[file.type]) continue
      const dataURL = await readDataURL(file)
      const fileId = await hashOf(file)
      const decoded = await loadImage(dataURL).catch(() => undefined)
      const size = placedSize(decoded?.naturalWidth ?? 320, decoded?.naturalHeight ?? 240)
      const spot = placeNext(added[added.length - 1], size, at)
      files.current.set(fileId, { mimeType: file.type, dataURL })
      added.push({ id: newId(), kind: 'image', fileId, ...spot, ...size })
    }
    const bounds = boundsOf(added)
    if (!bounds) return
    const shift = at.x - (bounds.x + bounds.width / 2)
    const placed = added.map((item) => ({ ...item, x: item.x + shift }))
    change([...itemsRef.current, ...placed])
    setSelected(placed.map((item) => item.id))
  }

  const copySelection = (event: ClipboardEvent, cut: boolean) => {
    const chosen = selectedItems()
    if (!chosen.length || !event.clipboardData) return
    event.preventDefault()
    const used: Record<string, CanvasImage> = {}
    for (const item of chosen.filter(hasImageFile)) {
      const file = files.current.get(item.fileId)
      if (file) used[item.fileId] = file
    }
    event.clipboardData.setData(CLIP_TYPE, JSON.stringify({ items: chosen, files: used }))
    const text = chosen
      .map((item) => (item.kind === 'text' ? item.text : item.kind === 'capture' ? (item.source?.url ?? '') : ''))
      .filter(Boolean)
      .join('\n\n')
    if (text) event.clipboardData.setData('text/plain', text)
    pasteCount.current = 0
    if (cut) {
      change(itemsRef.current.filter((item) => !selectedRef.current.includes(item.id)))
      setSelected([])
    }
  }

  const paste = (event: ClipboardEvent) => {
    const data = event.clipboardData
    if (!data) return
    event.preventDefault()
    const ours = data.getData(CLIP_TYPE)
    if (ours) {
      try {
        const clip = JSON.parse(ours) as { items: BoardItem[]; files: Record<string, CanvasImage> }
        for (const [id, file] of Object.entries(clip.files ?? {})) if (!files.current.has(id)) files.current.set(id, file)
        pasteCount.current += 1
        const copies = clip.items.map((item) => copyOf(item, 24 * pasteCount.current))
        change([...itemsRef.current, ...copies])
        setSelected(copies.map((item) => item.id))
      } catch {}
      return
    }
    const images = [...data.files].filter((file) => IMAGE_TYPES[file.type])
    if (images.length) return void addImageFiles(images, center())
    const text = data.getData('text/plain').trim()
    if (!text) return
    const at = center()
    const textItem: TextItem = { id: newId(), kind: 'text', x: at.x, y: at.y, width: 0, height: 0, text, size: 'body', color: style.color }
    change([...itemsRef.current, textItem])
    setSelected([textItem.id])
  }

  const duplicate = () => {
    const copies = selectedItems().map((item) => copyOf(item, 16))
    if (!copies.length) return
    change([...itemsRef.current, ...copies])
    setSelected(copies.map((item) => item.id))
  }
  const remove = () => {
    if (!selectedRef.current.length) return
    change(itemsRef.current.filter((item) => !selectedRef.current.includes(item.id)))
    setSelected([])
  }
  const reorder = (toFront: boolean) => {
    const chosen = selectedItems()
    if (!chosen.length) return
    const rest = itemsRef.current.filter((item) => !selectedRef.current.includes(item.id))
    change(toFront ? [...rest, ...chosen] : [...chosen, ...rest])
  }
  const arrange = () => {
    const moves = arrangeInGrid(selectedItems())
    if (moves.size < 2) return
    change(itemsRef.current.map((item) => ({ ...item, ...moves.get(item.id) })))
  }
  const makeTitle = (id: string) =>
    change(itemsRef.current.map((item) => (item.kind !== 'text' ? item : item.id === id ? { ...item, title: true, size: 'title' } : item.title ? { ...item, title: false } : item)))
  const nudge = (dx: number, dy: number) => {
    if (!selectedRef.current.length) return
    change(itemsRef.current.map((item) => (selectedRef.current.includes(item.id) ? { ...item, x: item.x + dx, y: item.y + dy } : item)))
  }
  const restyle = (next: Partial<Style>) => {
    setStyle({ ...style, ...next })
    const ids = new Set(selectedRef.current)
    if (!ids.size) return
    let changed = false
    const updated = itemsRef.current.map((item): BoardItem => {
      if (!ids.has(item.id)) return item
      let restyled = item
      if (next.color && hasColor(restyled) && restyled.color !== next.color) restyled = { ...restyled, color: next.color }
      if (next.fill !== undefined && (restyled.kind === 'rect' || restyled.kind === 'ellipse') && restyled.fill !== next.fill) restyled = { ...restyled, fill: next.fill }
      if (next.textSize && restyled.kind === 'text' && restyled.size !== next.textSize) restyled = { ...restyled, size: next.textSize }
      if (restyled !== item) changed = true
      return restyled
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
    const wasThere = before.find((item) => item.id === id)
    if (!text.trim()) {
      setItems(itemsRef.current.filter((item) => item.id !== id))
      setSelected([])
      if (wasThere) record(before)
      return
    }
    if (wasThere?.kind === 'text' && wasThere.text === text) return
    record(before)
    setItems(itemsRef.current.map((item) => (item.id === id && item.kind === 'text' ? { ...item, text } : item)))
  }
  useEffect(() => {
    if (!editing) return
    const node = nodes.current.get(editing)
    if (!node) return
    node.focus()
    const range = document.createRange()
    range.selectNodeContents(node)
    range.collapse(false)
    const selection = getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [editing])

  const takeInbox = async () => {
    const queued: InboxItem[] = await arc.canvasTakeInbox()
    if (!queued.length) return
    const added: CardItem[] = []
    for (const entry of queued) {
      const natural =
        entry.width > 0 && entry.height > 0
          ? entry
          : await loadImage(entry.dataURL).then(
              (image) => ({ width: image.naturalWidth, height: image.naturalHeight }),
              () => ({ width: 320, height: 240 })
            )
      const size = placedSize(natural.width, natural.height)
      const previous = [...itemsRef.current, ...added].find((item) => item.id === lastPlaced.current)
      const title = titleOf(itemsRef.current)
      const onlyTitle = !previous && title && itemsRef.current.every((item) => item === title)
      const spot = onlyTitle ? { x: Math.round(title.x + (title.width - size.width) / 2), y: Math.round(title.y + title.height + 32) } : placeNext(previous, size, center())
      files.current.set(entry.fileId, { mimeType: entry.mimeType, dataURL: entry.dataURL })
      const card: CardItem = { id: newId(), kind: 'capture', fileId: entry.fileId, ...spot, ...size, source: entry.data.source, capture: entry.data.capture, imageUrl: entry.data.imageUrl }
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
        setItems(itemsRef.current.map((item) => (item.kind === 'text' && item.title && item.text === from ? { ...item, text: to } : item)))
      }),
    []
  )

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    setMenu(undefined)
    // A click while editing text ends the edit: the browser's default moves focus away.
    if (editingRef.current) return
    // Otherwise no default: it would take focus from a text this click starts editing.
    event.preventDefault()
    const screenPoint = pointOnBoard(event)
    const currentView = viewRef.current
    const worldPoint = toWorld(screenPoint, currentView)
    const target = event.target as Element
    if (event.button === 1 || (event.button === 0 && (tool === 'hand' || spaceDown.current))) {
      gestureRef.current = { kind: 'pan', start: screenPoint, view: currentView }
      setPanning(true)
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'text') return startText(worldPoint)
    if (tool === 'rect' || tool === 'ellipse' || tool === 'arrow') {
      const id = newId()
      const base = { id, x: worldPoint.x, y: worldPoint.y, width: 0, height: 0, color: style.color }
      const item: BoardItem = tool === 'arrow' ? { ...base, kind: 'arrow', flipX: false, flipY: false } : { ...base, kind: tool, fill: style.fill }
      gestureRef.current = { kind: 'create', start: worldPoint, before: itemsRef.current, id }
      setItems([...itemsRef.current, item])
      setSelected([id])
      return
    }
    if (tool === 'draw') {
      gestureRef.current = { kind: 'draw', points: [worldPoint.x, worldPoint.y] }
      setDraft([worldPoint.x, worldPoint.y])
      return
    }
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle') as Handle | null
    if (handle && selectedRef.current.length === 1) {
      gestureRef.current = { kind: 'resize', start: worldPoint, before: itemsRef.current, id: selectedRef.current[0], handle }
      return
    }
    const hit = target.closest('[data-id]')?.getAttribute('data-id') ?? undefined
    const now = Date.now()
    const doubleClick = now - lastDown.current.at < 350 && lastDown.current.id === hit
    lastDown.current = { at: now, id: hit }
    if (doubleClick) {
      const clicked = itemsRef.current.find((item) => item.id === hit)
      if (clicked?.kind === 'text') return editText(clicked.id)
      if (!hit) return startText(worldPoint)
    }
    if (hit) {
      let next = selectedRef.current
      if (event.shiftKey) next = next.includes(hit) ? next.filter((id) => id !== hit) : [...next, hit]
      else if (!next.includes(hit)) next = [hit]
      setSelected(next)
      if (next.includes(hit)) gestureRef.current = { kind: 'move', start: worldPoint, before: itemsRef.current, ids: new Set(next), clicked: hit, moved: false }
      return
    }
    const keep = event.shiftKey ? selectedRef.current : []
    if (!event.shiftKey) setSelected([])
    gestureRef.current = { kind: 'marquee', start: screenPoint, keep }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture) return
    const screenPoint = pointOnBoard(event)
    const currentView = viewRef.current
    const worldPoint = toWorld(screenPoint, currentView)
    if (gesture.kind === 'pan') return setView({ ...gesture.view, x: gesture.view.x + screenPoint.x - gesture.start.x, y: gesture.view.y + screenPoint.y - gesture.start.y })
    if (gesture.kind === 'move') {
      let dx = worldPoint.x - gesture.start.x
      let dy = worldPoint.y - gesture.start.y
      if (!gesture.moved && Math.hypot(dx, dy) * currentView.zoom < 3) return
      gesture.moved = true
      const bounds = boundsOf(gesture.before.filter((item) => gesture.ids.has(item.id)))
      if (snappingRef.current && !event.altKey && bounds) {
        const others = gesture.before.filter((item) => !gesture.ids.has(item.id))
        const snap = snapMove({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }, others, SNAP_SCREEN_PX / currentView.zoom)
        dx += snap.dx
        dy += snap.dy
        setGuides(snap.guides)
      }
      return setItems(gesture.before.map((item) => (gesture.ids.has(item.id) ? { ...item, x: item.x + dx, y: item.y + dy } : item)))
    }
    if (gesture.kind === 'resize') {
      const resizing = gesture.before.find((item) => item.id === gesture.id)
      if (!resizing) return
      const newBox = resized(resizing, gesture.handle, worldPoint.x - gesture.start.x, worldPoint.y - gesture.start.y, keepsShape(resizing) !== event.shiftKey)
      return setItems(gesture.before.map((item) => (item.id === gesture.id ? withBox(item, newBox) : item)))
    }
    if (gesture.kind === 'marquee') {
      const box = { x: Math.min(gesture.start.x, screenPoint.x), y: Math.min(gesture.start.y, screenPoint.y), width: Math.abs(screenPoint.x - gesture.start.x), height: Math.abs(screenPoint.y - gesture.start.y) }
      setMarquee(box)
      const worldBox = { x: (box.x - currentView.x) / currentView.zoom, y: (box.y - currentView.y) / currentView.zoom, width: box.width / currentView.zoom, height: box.height / currentView.zoom }
      const inside = itemsRef.current.filter((item) => intersects(worldBox, item)).map((item) => item.id)
      return setSelected([...new Set([...gesture.keep, ...inside])])
    }
    if (gesture.kind === 'create') {
      const box = { x: Math.min(gesture.start.x, worldPoint.x), y: Math.min(gesture.start.y, worldPoint.y), width: Math.abs(worldPoint.x - gesture.start.x), height: Math.abs(worldPoint.y - gesture.start.y) }
      if (event.shiftKey && tool !== 'arrow') box.width = box.height = Math.max(box.width, box.height)
      return setItems(
        itemsRef.current.map((item) =>
          item.id !== gesture.id ? item : item.kind === 'arrow' ? { ...item, ...box, flipX: worldPoint.x < gesture.start.x, flipY: worldPoint.y < gesture.start.y } : { ...item, ...box }
        )
      )
    }
    const last = gesture.points.length - 2
    if (Math.hypot(worldPoint.x - gesture.points[last], worldPoint.y - gesture.points[last + 1]) * currentView.zoom < 1.5) return
    gesture.points.push(worldPoint.x, worldPoint.y)
    setDraft([...gesture.points])
  }

  const onPointerUp = () => {
    const gesture = gestureRef.current
    gestureRef.current = undefined
    if (!gesture) return
    if (gesture.kind === 'pan') return setPanning(spaceDown.current)
    if (gesture.kind === 'move') {
      setGuides([])
      if (gesture.moved) return record(gesture.before)
      if (selectedRef.current.length > 1 && selectedRef.current.includes(gesture.clicked)) setSelected([gesture.clicked])
      return
    }
    if (gesture.kind === 'resize') {
      if (itemsRef.current !== gesture.before) record(gesture.before)
      return
    }
    if (gesture.kind === 'marquee') return setMarquee(undefined)
    if (gesture.kind === 'create') {
      const created = itemsRef.current.find((item) => item.id === gesture.id)
      if (created && created.width + created.height < 6) {
        const size = created.kind === 'arrow' ? { width: 120, height: 0 } : { width: 160, height: 100 }
        const left = created.kind === 'arrow' ? gesture.start.x : gesture.start.x - size.width / 2
        const top = created.kind === 'arrow' ? gesture.start.y : gesture.start.y - size.height / 2
        setItems(itemsRef.current.map((item) => (item.id === gesture.id ? { ...item, x: left, y: top, ...size } : item)))
      }
      record(gesture.before)
      setTool('select')
      return
    }
    setDraft(undefined)
    const xs = gesture.points.filter((_, index) => index % 2 === 0)
    const ys = gesture.points.filter((_, index) => index % 2 === 1)
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    const width = Math.max(...xs) - left
    const height = Math.max(...ys) - top
    const points = gesture.points.map((coordinate, index) => Math.round((coordinate - (index % 2 === 0 ? left : top)) * 10) / 10)
    const item: DrawItem = { id: newId(), kind: 'draw', x: left, y: top, width, height, color: style.color, points, drawnWidth: Math.max(1, width), drawnHeight: Math.max(1, height) }
    change([...itemsRef.current, item])
  }

  // Chromium reports a trackpad pinch as a wheel event with ctrlKey.
  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const currentView = viewRef.current
      if (event.ctrlKey || event.metaKey) return zoomAt(pointOnBoard(event), currentView.zoom * Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.01)))
      const sideways = event.shiftKey && !event.deltaX
      setView({ ...currentView, x: currentView.x - (sideways ? event.deltaY : event.deltaX), y: currentView.y - (sideways ? 0 : event.deltaY) })
    }
    board.addEventListener('wheel', onWheel, { passive: false })
    return () => board.removeEventListener('wheel', onWheel)
  }, [])

  const onKey = (event: KeyboardEvent) => {
    if (editingRef.current || isTyping(event.target)) return
    const commandHeld = isMac ? event.metaKey : event.ctrlKey
    const key = event.key.toLowerCase()
    const run = (action: () => void) => {
      event.preventDefault()
      action()
    }
    if (event.key === ' ') {
      spaceDown.current = true
      return run(() => setPanning(true))
    }
    if (commandHeld) {
      if (key === 'z') return run(() => undo(event.shiftKey))
      if (key === 'y') return run(() => undo(true))
      if (key === 'a') return run(() => setSelected(itemsRef.current.map((item) => item.id)))
      if (key === 'd') return run(duplicate)
      if (key === '=' || key === '+') return run(() => zoomBy(1.25))
      if (key === '-') return run(() => zoomBy(0.8))
      if (key === '0') return run(() => zoomAt(middle(), 1))
      if (event.shiftKey && event.code === 'BracketRight') return run(() => reorder(true))
      if (event.shiftKey && event.code === 'BracketLeft') return run(() => reorder(false))
      return
    }
    if (event.altKey) return
    if (event.key === 'Delete' || event.key === 'Backspace') return run(remove)
    if (event.key === 'Escape') {
      return run(() => {
        setMenu(undefined)
        if (selectedRef.current.length) setSelected([])
        else setTool('select')
      })
    }
    const step = event.shiftKey ? 10 : 1
    if (event.key === 'ArrowLeft') return run(() => nudge(-step, 0))
    if (event.key === 'ArrowRight') return run(() => nudge(step, 0))
    if (event.key === 'ArrowUp') return run(() => nudge(0, -step))
    if (event.key === 'ArrowDown') return run(() => nudge(0, step))
    if (event.shiftKey && event.code === 'Digit1') return run(() => reveal(boundsOf(itemsRef.current)))
    if (key === 'i') return run(() => fileInput.current?.click())
    const toolForKey = TOOLS.find((entry) => entry.key.toLowerCase() === key)
    if (toolForKey) return run(() => setTool(toolForKey.tool))
  }
  const handlers = useRef({ onKey, copySelection, paste })
  handlers.current = { onKey, copySelection, paste }
  useEffect(() => {
    const meantForBoard = (event: Event) => !editingRef.current && !isTyping(event.target)
    const down = (event: KeyboardEvent) => handlers.current.onKey(event)
    const up = (event: KeyboardEvent) => {
      if (event.key !== ' ') return
      spaceDown.current = false
      if (gestureRef.current?.kind !== 'pan') setPanning(false)
    }
    const onCopy = (event: ClipboardEvent) => meantForBoard(event) && handlers.current.copySelection(event, false)
    const onCut = (event: ClipboardEvent) => meantForBoard(event) && handlers.current.copySelection(event, true)
    const onPaste = (event: ClipboardEvent) => meantForBoard(event) && handlers.current.paste(event)
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

  const shortcut = (key: string) => (isMac ? `⌘${key}` : `Ctrl+${key}`)
  const menuEntries = (board: boolean): (MenuEntry | '-')[] => {
    const chosen = board ? [] : selectedItems()
    const one = chosen.length === 1 ? chosen[0] : undefined
    const entries: (MenuEntry | '-')[] = []
    if (chosen.length) {
      entries.push(
        { label: 'Cut', keys: shortcut('X'), run: () => document.execCommand('cut') },
        { label: 'Copy', keys: shortcut('C'), run: () => document.execCommand('copy') },
        { label: 'Duplicate', keys: shortcut('D'), run: duplicate },
        { label: 'Delete', keys: '⌫', run: remove },
        '-',
        { label: 'Bring to Front', keys: shortcut('⇧]'), run: () => reorder(true) },
        { label: 'Send to Back', keys: shortcut('⇧['), run: () => reorder(false) }
      )
      if (one?.kind === 'text' && !one.title) entries.push({ label: 'Make Title', run: () => makeTitle(one.id) })
      if (one?.kind === 'capture' && one.source) {
        const url = one.source.url
        entries.push('-', { label: 'Open Page', run: () => void arc.canvasOpenUrl(url) }, { label: 'Copy Page Address', run: () => copyText(url) })
      }
      if (chosen.length > 1) entries.push('-', { label: 'Arrange in Grid', run: arrange })
      entries.push('-')
    } else {
      entries.push(
        { label: 'Select All', keys: shortcut('A'), run: () => setSelected(itemsRef.current.map((item) => item.id)) },
        { label: 'Zoom to Fit', keys: '⇧1', run: () => reveal(boundsOf(itemsRef.current)) },
        '-'
      )
    }
    entries.push({ label: 'Snap to Objects', checked: snapping, run: () => setSnapping(!snapping) })
    if (!chosen.length) entries.push('-', { label: 'Export as PNG…', run: () => void exportPng('file') }, { label: 'Copy as PNG', run: () => void exportPng('clipboard') })
    return entries
  }

  useLiveCards(boardRef, items, view, !!menu)
  const togglePlay = (id: string) => setItems(itemsRef.current.map((item) => (item.id === id && item.kind === 'capture' ? { ...item, live: !item.live || undefined } : item)))
  const single = selected.length === 1 ? items.find((item) => item.id === selected[0]) : undefined
  const handles: Handle[] = !single || single.kind === 'text' || editing ? [] : keepsShape(single) ? ['nw', 'ne', 'sw', 'se'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  const chosenItems = items.filter((item) => selected.includes(item.id))
  const styled = chosenItems.filter(hasColor)
  const showColors = tool === 'text' || tool === 'rect' || tool === 'ellipse' || tool === 'arrow' || tool === 'draw' || styled.length > 0
  const showFill = tool === 'rect' || tool === 'ellipse' || chosenItems.some((item) => item.kind === 'rect' || item.kind === 'ellipse')
  const showSizes = tool === 'text' || chosenItems.some((item) => item.kind === 'text')
  const currentColor = styled[0]?.color ?? style.color
  const firstShape = chosenItems.find((item) => item.kind === 'rect' || item.kind === 'ellipse')
  const currentFill = firstShape && (firstShape.kind === 'rect' || firstShape.kind === 'ellipse') ? firstShape.fill : style.fill
  const currentSize = chosenItems.find((item): item is TextItem => item.kind === 'text')?.size ?? style.textSize

  const title = titleOf(items)
  const empty = items.every((item) => item === title) && !editing
  const hintAt = title ? { left: (title.x + title.width / 2) * view.zoom + view.x, top: (title.y + title.height) * view.zoom + view.y + 14 } : undefined

  return (
    <div className="canvas-page">
      <div
        ref={boardRef}
        className={cx('board', `tool-${tool}`, panning && 'panning')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(event) => {
          event.preventDefault()
          const hit = (event.target as Element).closest('[data-id]')?.getAttribute('data-id')
          if (hit && !selectedRef.current.includes(hit)) setSelected([hit])
          if (!hit) setSelected([])
          setMenu({ at: { x: event.clientX, y: event.clientY }, board: false })
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const list = [...event.dataTransfer.files]
          if (list.length) void addImageFiles(list, toWorld(pointOnBoard(event), viewRef.current))
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
              onPlay={() => togglePlay(item.id)}
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
            const box = toScreen(item, view)
            return <div key={item.id} className="selection" style={{ left: box.x - 3, top: box.y - 3, width: box.width + 6, height: box.height + 6 }} />
          })}
          {single
            ? handles.map((handle) => {
                const box = toScreen(single, view)
                const left = handle.includes('w') ? box.x - 3 : handle.includes('e') ? box.x + box.width + 3 : box.x + box.width / 2
                const top = handle.includes('n') ? box.y - 3 : handle.includes('s') ? box.y + box.height + 3 : box.y + box.height / 2
                return <div key={handle} className={`handle handle-${handle}`} data-handle={handle} style={{ left, top }} />
              })
            : null}
          {guides.map((guide, index) => {
            const at = guide.axis === 'x' ? guide.at * view.zoom + view.x : guide.at * view.zoom + view.y
            const from = guide.axis === 'x' ? guide.from * view.zoom + view.y : guide.from * view.zoom + view.x
            const to = guide.axis === 'x' ? guide.to * view.zoom + view.y : guide.to * view.zoom + view.x
            return <div key={index} className="guide" style={guide.axis === 'x' ? { left: at, top: from, height: to - from } : { top: at, left: from, width: to - from }} />
          })}
          {marquee ? <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} /> : null}
        </div>
        {empty ? (
          <div className={cx('empty-hint', !hintAt && 'centered')} style={hintAt ?? { left: '50%', top: '50%' }}>
            Capture part of any page with <kbd>{loaded.captureKey}</kbd>, or right-click an image and choose <b>Add Image to Canvas</b>.
            <br />
            You can also paste or drop images here.
          </div>
        ) : null}
      </div>

      <div className="toolbar" onPointerDown={(event) => event.stopPropagation()}>
        {TOOLS.map((entry) => (
          <button key={entry.tool} className={cx(tool === entry.tool && 'on')} title={`${entry.label} (${entry.key})`} onClick={() => setTool(entry.tool)}>
            <Icon name={entry.icon} size={18} />
          </button>
        ))}
        <button title="Image from a file (I)" onClick={() => fileInput.current?.click()}>
          <Icon name="image" size={18} />
        </button>
        {showColors ? (
          <>
            <span className="toolbar-line" />
            {COLORS.map((color) => (
              <button key={color} className={cx('swatch', currentColor === color && 'on')} title={color} onClick={() => restyle({ color })}>
                <span style={{ background: paint(color, dark) }} />
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
            {(['title', 'heading', 'body'] as const).map((size) => (
              <button key={size} className={cx('size', currentSize === size && 'on')} title={TEXT[size].label} onClick={() => restyle({ textSize: size })}>
                {size === 'title' ? 'L' : size === 'heading' ? 'M' : 'S'}
              </button>
            ))}
          </>
        ) : null}
      </div>

      <div className="zoombar" onPointerDown={(event) => event.stopPropagation()}>
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
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setMenu({ at: { x: rect.right - 220, y: rect.bottom + 6 }, board: true })
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
        onChange={(event) => {
          const list = [...(event.target.files ?? [])]
          event.target.value = ''
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
