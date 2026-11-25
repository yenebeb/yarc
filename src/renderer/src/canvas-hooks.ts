import { useEffect, useRef, useState, type RefObject } from 'react'
import { intersects, type BoardItem, type CanvasImage, type CanvasScene, type LiveCard } from '../../shared/canvas'
import { arc } from './api'
import { hasImageFile } from './canvas-item'
import { toScreen, type View } from './canvas-view'

const SAVE_DELAY = 400
const UNDO_STEPS = 200
const LIVE_MIN = { width: 80, height: 60 }

const appearanceIsDark = () => document.documentElement.dataset.appearance === 'dark'

export function useDarkAppearance(): boolean {
  const [dark, setDark] = useState(appearanceIsDark)
  useEffect(() => {
    const watch = new MutationObserver(() => setDark(appearanceIsDark()))
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance'] })
    return () => watch.disconnect()
  }, [])
  return dark
}

export function useStateRef<T>(initial: T | (() => T)) {
  const [value, setValue] = useState(initial)
  const ref = useRef(value)
  ref.current = value
  const set = (next: T) => {
    ref.current = next
    setValue(next)
  }
  return [value, ref, set] as const
}

export function useBoardHistory(initial: () => BoardItem[]) {
  const [items, itemsRef, setItems] = useStateRef<BoardItem[]>(initial)
  const past = useRef<BoardItem[][]>([])
  const future = useRef<BoardItem[][]>([])
  const record = (before: BoardItem[]) => {
    past.current.push(before)
    if (past.current.length > UNDO_STEPS) past.current.shift()
    future.current = []
  }
  const change = (next: BoardItem[]) => {
    record(itemsRef.current)
    setItems(next)
  }
  const undo = (redo = false): BoardItem[] | undefined => {
    const from = redo ? future.current : past.current
    const to = redo ? past.current : future.current
    const restored = from.pop()
    if (!restored) return undefined
    to.push(itemsRef.current)
    setItems(restored)
    return restored
  }
  return { items, itemsRef, setItems, record, change, undo }
}

export function useSceneSave(currentScene: () => CanvasScene, files: Map<string, CanvasImage>, fileIdsOnDisk: string[]): void {
  const onDisk = useRef(new Set(fileIdsOnDisk))
  const lastSaved = useRef('')
  const save = () => {
    const scene = currentScene()
    const json = JSON.stringify(scene)
    const shown = new Set(scene.items.filter(hasImageFile).map((item) => item.fileId))
    const newFiles: Record<string, CanvasImage> = {}
    for (const fileId of shown) {
      const file = files.get(fileId)
      if (file && !onDisk.current.has(fileId)) newFiles[fileId] = file
    }
    if (json === lastSaved.current && !Object.keys(newFiles).length) return
    arc.canvasSave(scene, newFiles)
    // Main deletes the images a saved board no longer shows, so one that comes back (undo, paste) has to be sent again.
    onDisk.current = shown
    lastSaved.current = json
  }
  const latestSave = useRef(save)
  latestSave.current = save
  useEffect(() => {
    const timer = setTimeout(save, SAVE_DELAY)
    return () => clearTimeout(timer)
  })
  useEffect(() => {
    const flush = () => latestSave.current()
    addEventListener('pagehide', flush)
    return () => removeEventListener('pagehide', flush)
  }, [])
}

export function useLiveCards(boardRef: RefObject<HTMLDivElement | null>, items: BoardItem[], view: View, menuOpen: boolean): void {
  const [shown, setShown] = useState(true)
  useEffect(() => arc.onCanvasShown(setShown), [])
  const lastSent = useRef('')
  useEffect(() => {
    const boardRect = boardRef.current?.getBoundingClientRect()
    if (!boardRect) return
    const visible = { x: 0, y: 0, width: boardRect.width, height: boardRect.height }
    const clip = { x: boardRect.left, y: boardRect.top, width: boardRect.width, height: boardRect.height }
    const cards: LiveCard[] = !shown
      ? []
      : items.flatMap((item) => {
          if (item.kind !== 'capture' || !item.live || !item.capture || !item.source) return []
          const box = toScreen(item, view)
          const hidden = menuOpen || box.width < LIVE_MIN.width || box.height < LIVE_MIN.height || !intersects(box, visible)
          return [{ id: item.id, url: item.source.url, capture: item.capture, box: { ...box, x: box.x + boardRect.left, y: box.y + boardRect.top }, clip, zoom: view.zoom, pixelRatio: devicePixelRatio, hidden }]
        })
    const json = JSON.stringify(cards)
    if (json === lastSent.current) return
    lastSent.current = json
    arc.canvasLive(cards)
  })
}
