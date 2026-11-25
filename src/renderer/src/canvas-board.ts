import { useLayoutEffect, useRef, type RefObject } from 'react'
import { isBoardItem, type BoardItem, type Box, type CanvasImage, type CanvasLoad, type Color, type TextItem, type TextSize } from '../../shared/canvas'
import { useBoardHistory, useStateRef } from './canvas-hooks'
import { toScreen, toWorld, type Point, type View } from './canvas-view'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 4

export type Tool = 'select' | 'hand' | 'text' | 'note' | 'rect' | 'ellipse' | 'arrow' | 'draw'
export type Style = { color: Color; fill: boolean; textSize: TextSize }

export const newId = () => crypto.randomUUID()
export const titleOf = (items: BoardItem[]) => items.find((item): item is TextItem => item.kind === 'text' && !!item.title)
export const hasColor = (item: BoardItem): item is Extract<BoardItem, { color: Color }> => 'color' in item
export const keepsShape = (item: BoardItem) => item.kind === 'capture' || item.kind === 'image'
export const isBlankText = (item: BoardItem) => item.kind === 'text' && !item.text.trim()
export const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
export const copyOf = (item: BoardItem, shift: Point): BoardItem =>
  item.kind === 'text' ? { ...item, id: newId(), x: item.x + shift.x, y: item.y + shift.y, title: false } : { ...item, id: newId(), x: item.x + shift.x, y: item.y + shift.y }
const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

/** The board's items, what of it the window shows, and what is selected. */
export function useBoard(loaded: CanvasLoad, boardRef: RefObject<HTMLDivElement | null>) {
  const {
    items,
    itemsRef,
    setItems,
    record,
    change,
    undo: undoItems
  } = useBoardHistory(() => loaded.scene?.items.filter(isBoardItem) ?? [{ id: newId(), kind: 'text', x: 0, y: 0, width: 0, height: 0, text: loaded.name, size: 'title', color: 'ink', title: true }])
  const [view, viewRef, setView] = useStateRef<View>(() => loaded.scene?.view ?? { x: 96, y: 96, zoom: 1 })
  const [selected, selectedRef, setSelected] = useStateRef<string[]>([])
  const files = useRef(new Map<string, CanvasImage>(Object.entries(loaded.files))).current
  const textNodes = useRef(new Map<string, HTMLElement>()).current
  const centerTitle = useRef(!loaded.scene)

  const undo = (redo = false) => {
    const restored = undoItems(redo)
    if (restored) setSelected(selectedRef.current.filter((id) => restored.some((item) => item.id === id)))
  }
  const selectedItems = () => itemsRef.current.filter((item) => selectedRef.current.includes(item.id))

  const pointOnBoard = (event: { clientX: number; clientY: number }): Point => {
    const rect = boardRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }
  const viewSize = () => ({ width: boardRef.current?.clientWidth ?? innerWidth, height: boardRef.current?.clientHeight ?? innerHeight })
  const middle = (): Point => ({ x: viewSize().width / 2, y: viewSize().height / 2 })
  const center = (): Point => toWorld(middle(), viewRef.current)
  const shownPartOfBoard = (): Box => {
    const { width, height } = viewSize()
    return { ...toWorld({ x: 0, y: 0 }, viewRef.current), width: width / viewRef.current.zoom, height: height / viewRef.current.zoom }
  }
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

  useLayoutEffect(() => {
    let changed = false
    const measured = items.map((item) => {
      const node = item.kind === 'text' ? textNodes.get(item.id) : undefined
      if (!node || item.kind !== 'text') return item
      const width = node.offsetWidth
      const height = node.offsetHeight
      if (Math.abs(width - item.width) < 0.5 && Math.abs(height - item.height) < 0.5) return item
      changed = true
      return { ...item, width, height }
    })
    if (changed) setItems(measured)
  })
  useLayoutEffect(() => {
    const title = titleOf(itemsRef.current)
    if (!centerTitle.current || !title?.width) return
    centerTitle.current = false
    const { width, height } = viewSize()
    setView({ ...viewRef.current, x: Math.round(width / 2 - (title.width / 2) * viewRef.current.zoom), y: Math.round(height / 2 - (title.height / 2) * viewRef.current.zoom) })
  })

  return {
    boardRef,
    items,
    itemsRef,
    setItems,
    record,
    change,
    undo,
    view,
    viewRef,
    setView,
    selected,
    selectedRef,
    setSelected,
    selectedItems,
    files,
    textNodes,
    pointOnBoard,
    middle,
    center,
    shownPartOfBoard,
    zoomAt,
    zoomBy,
    reveal
  }
}

export type Board = ReturnType<typeof useBoard>
