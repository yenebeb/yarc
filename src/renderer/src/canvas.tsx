import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { boundsOf, IMAGE_TYPES, intersects, resized, smoothPath, snapMove, withBox, type BoardItem, type Box, type CanvasLoad, type DrawItem, type Guide, type Handle } from '../../shared/canvas'
import { MIN_WRAP_WIDTH, NOTE_WIDTH, rewrapped, toggledCheckbox } from '../../shared/canvas-notes'
import { arc, cx, isMac } from './api'
import { boardActions, useStyle } from './canvas-actions'
import { StyleBar, Toolbar, TOOLS, ZoomBar } from './canvas-bars'
import { isBlankText, isTyping, keepsShape, newId, titleOf, useBoard, type Tool } from './canvas-board'
import { useClipboard } from './canvas-clipboard'
import { useDarkAppearance, useLiveCards, useSceneSave } from './canvas-hooks'
import { useInbox, useSidebarRename } from './canvas-inbox'
import { DRAW_STROKE, ItemView, paint } from './canvas-item'
import { Menu, menuEntries } from './canvas-menu'
import { SelectionOverlay } from './canvas-overlay'
import { useTextEditing } from './canvas-text-editing'
import { boxBetween, gridBackground, toScreen, toWorld, type Point, type View } from './canvas-view'
import { Icon } from './icons'
import './canvas.css'

const SNAP_SCREEN_PX = 6

type Gesture =
  | { kind: 'pan'; start: Point; view: View }
  | { kind: 'move'; start: Point; before: BoardItem[]; ids: Set<string>; clicked: string; moved: boolean }
  | { kind: 'resize'; start: Point; before: BoardItem[]; id: string; handle: Handle }
  | { kind: 'marquee'; start: Point; keep: string[] }
  | { kind: 'create'; start: Point; before: BoardItem[]; id: string }
  | { kind: 'textbox'; start: Point; startOnScreen: Point; left: number; width: number }
  | { kind: 'draw'; points: number[] }

function BoardView({ loaded }: { loaded: CanvasLoad }) {
  const spaceIsDark = useDarkAppearance()
  const [appearance, setAppearance] = useState(loaded.scene?.appearance)
  const dark = appearance ? appearance === 'dark' : spaceIsDark
  const boardRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const board = useBoard(loaded, boardRef)
  const { items, itemsRef, setItems, record, change, view, viewRef, setView, selected, selectedRef, setSelected, pointOnBoard, middle, zoomAt, zoomBy } = board
  const actions = boardActions(board)
  const { style, restyle } = useStyle(board)
  const { editing, editingRef, startText, editText, typeText, finishEdit } = useTextEditing(board, style)
  const addImageFiles = useClipboard(board, style.color, editingRef)
  useInbox(board)
  useSidebarRename(board)

  const [snapping, setSnapping] = useState(loaded.scene?.snapping ?? true)
  const [tool, setTool] = useState<Tool>('select')
  const [guides, setGuides] = useState<Guide[]>([])
  const [marquee, setMarquee] = useState<Box>()
  const [draft, setDraft] = useState<number[]>()
  const [menu, setMenu] = useState<{ at: Point; board: boolean }>()
  const [panning, setPanning] = useState(false)
  const snappingRef = useRef(snapping)
  snappingRef.current = snapping
  const gestureRef = useRef<Gesture>(undefined)
  const lastDown = useRef<{ at: number; id: string | undefined }>({ at: 0, id: undefined })
  const spaceDown = useRef(false)

  useSceneSave(() => ({ items: itemsRef.current.filter((item) => !isBlankText(item)), view: viewRef.current, snapping: snappingRef.current, appearance }), board.files, Object.keys(loaded.files))
  useLiveCards(boardRef, items, view, !!menu)

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
    const hit = target.closest('[data-id]')?.getAttribute('data-id') ?? undefined
    if (tool === 'text' || tool === 'note') {
      const textUnderPointer = itemsRef.current.find((item) => item.id === hit && item.kind === 'text')
      if (tool === 'text' && !textUnderPointer) {
        gestureRef.current = { kind: 'textbox', start: worldPoint, startOnScreen: screenPoint, left: worldPoint.x, width: 0 }
        return
      }
      setTool('select')
      return textUnderPointer ? editText(textUnderPointer.id) : startText(worldPoint, { card: true, wrapWidth: NOTE_WIDTH })
    }
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
    const linkUnderPointer = target.closest('[data-url]')?.getAttribute('data-url')
    if (linkUnderPointer && (isMac ? event.metaKey : event.ctrlKey)) return void arc.canvasOpenUrl(linkUnderPointer)
    const checkboxLine = target.closest('[data-check]')?.getAttribute('data-check')
    if (hit && checkboxLine) {
      lastDown.current = { at: 0, id: undefined }
      return change(itemsRef.current.map((item) => (item.id === hit && item.kind === 'text' ? { ...item, text: toggledCheckbox(item.text, Number(checkboxLine)) } : item)))
    }
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
      const dx = worldPoint.x - gesture.start.x
      const dy = worldPoint.y - gesture.start.y
      const changed = resizing.kind === 'text' ? rewrapped(resizing, gesture.handle, dx) : withBox(resizing, resized(resizing, gesture.handle, dx, dy, keepsShape(resizing) !== event.shiftKey))
      return setItems(gesture.before.map((item) => (item.id === gesture.id ? changed : item)))
    }
    if (gesture.kind === 'textbox') {
      gesture.left = Math.min(gesture.start.x, worldPoint.x)
      gesture.width = Math.abs(worldPoint.x - gesture.start.x)
      return setMarquee(boxBetween(gesture.startOnScreen, screenPoint))
    }
    if (gesture.kind === 'marquee') {
      const box = boxBetween(gesture.start, screenPoint)
      setMarquee(box)
      const worldBox = { x: (box.x - currentView.x) / currentView.zoom, y: (box.y - currentView.y) / currentView.zoom, width: box.width / currentView.zoom, height: box.height / currentView.zoom }
      const inside = itemsRef.current.filter((item) => intersects(worldBox, item)).map((item) => item.id)
      return setSelected([...new Set([...gesture.keep, ...inside])])
    }
    if (gesture.kind === 'create') {
      const box = boxBetween(gesture.start, worldPoint)
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
    if (gesture.kind === 'textbox') {
      setMarquee(undefined)
      setTool('select')
      const draggedWide = gesture.width >= MIN_WRAP_WIDTH
      return draggedWide ? startText({ x: gesture.left, y: gesture.start.y }, { wrapWidth: gesture.width }) : startText(gesture.start)
    }
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
    const boardElement = boardRef.current
    if (!boardElement) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const currentView = viewRef.current
      if (event.ctrlKey || event.metaKey) return zoomAt(pointOnBoard(event), currentView.zoom * Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.01)))
      const sideways = event.shiftKey && !event.deltaX
      setView({ ...currentView, x: currentView.x - (sideways ? event.deltaY : event.deltaX), y: currentView.y - (sideways ? 0 : event.deltaY) })
    }
    boardElement.addEventListener('wheel', onWheel, { passive: false })
    return () => boardElement.removeEventListener('wheel', onWheel)
  }, [])

  const pickImage = () => fileInput.current?.click()
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
      if (key === 'z') return run(() => board.undo(event.shiftKey))
      if (key === 'y') return run(() => board.undo(true))
      if (key === 'a') return run(actions.selectAll)
      if (key === 'd') return run(actions.duplicate)
      if (key === '=' || key === '+') return run(() => zoomBy(1.25))
      if (key === '-') return run(() => zoomBy(0.8))
      if (key === '0') return run(() => zoomAt(middle(), 1))
      if (event.shiftKey && event.code === 'BracketRight') return run(() => actions.reorder(true))
      if (event.shiftKey && event.code === 'BracketLeft') return run(() => actions.reorder(false))
      return
    }
    if (event.altKey) return
    if (event.key === 'Delete' || event.key === 'Backspace') return run(actions.remove)
    if (event.key === 'Escape') {
      return run(() => {
        setMenu(undefined)
        if (selectedRef.current.length) setSelected([])
        else setTool('select')
      })
    }
    if (event.key === 'Enter') {
      const [chosen, ...others] = board.selectedItems()
      if (chosen?.kind === 'text' && !others.length) run(() => editText(chosen.id))
      return
    }
    const step = event.shiftKey ? 10 : 1
    if (event.key === 'ArrowLeft') return run(() => actions.nudge(-step, 0))
    if (event.key === 'ArrowRight') return run(() => actions.nudge(step, 0))
    if (event.key === 'ArrowUp') return run(() => actions.nudge(0, -step))
    if (event.key === 'ArrowDown') return run(() => actions.nudge(0, step))
    if (event.shiftKey && event.code === 'Digit1') return run(actions.zoomToFit)
    if (key === 'i') return run(pickImage)
    const toolForKey = TOOLS.find((entry) => entry.key.toLowerCase() === key)
    if (toolForKey) return run(() => setTool(toolForKey.tool))
  }
  const latestOnKey = useRef(onKey)
  latestOnKey.current = onKey
  useEffect(() => {
    const down = (event: KeyboardEvent) => latestOnKey.current(event)
    const up = (event: KeyboardEvent) => {
      if (event.key !== ' ') return
      spaceDown.current = false
      if (gestureRef.current?.kind !== 'pan') setPanning(false)
    }
    addEventListener('keydown', down)
    addEventListener('keyup', up)
    return () => {
      removeEventListener('keydown', down)
      removeEventListener('keyup', up)
    }
  }, [])

  const chosenItems = items.filter((item) => selected.includes(item.id))
  const title = titleOf(items)
  const empty = items.every((item) => item === title) && !editing
  const hintAt = title ? { left: (title.x + title.width / 2) * view.zoom + view.x, top: (title.y + title.height) * view.zoom + view.y + 14 } : undefined

  return (
    <div className={cx('canvas-page', dark && 'dark')}>
      <div
        ref={boardRef}
        className={cx('board', `tool-${tool}`, panning && 'panning')}
        style={gridBackground(view)}
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
              files={board.files}
              nodeRef={(node) => (node ? board.textNodes.set(item.id, node) : board.textNodes.delete(item.id))}
              onTyped={(text) => typeText(item.id, text)}
              onEdited={() => finishEdit(item.id)}
              onPlay={() => actions.togglePlay(item.id)}
            />
          ))}
          {draft ? (
            <svg className="draft">
              <path d={smoothPath(draft)} stroke={paint(style.color, dark)} strokeWidth={DRAW_STROKE} />
            </svg>
          ) : null}
        </div>
        <SelectionOverlay chosen={chosenItems} view={view} guides={guides} marquee={marquee} editing={!!editing} />
        {empty ? (
          <div className={cx('empty-hint', !hintAt && 'centered')} style={hintAt ?? { left: '50%', top: '50%' }}>
            Double-click anywhere to write.
            <br />
            Capture part of any page with <kbd>{loaded.captureKey}</kbd>, or right-click an image and choose <b>Add Image to Canvas</b>.
            <br />
            You can also paste or drop images here.
          </div>
        ) : null}
      </div>

      <Toolbar tool={tool} onTool={setTool} onPickImage={pickImage} />
      <StyleBar tool={tool} chosen={chosenItems} selectionOnScreen={boundsOf(chosenItems.map((item) => toScreen(item, view)))} style={style} dark={dark} onRestyle={restyle} />
      <ZoomBar zoom={view.zoom} onZoomBy={zoomBy} onActualSize={() => zoomAt(middle(), 1)} />

      <button
        className="board-menu-button appearance-button"
        title={dark ? 'Light board' : 'Dark board'}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => setAppearance(dark ? 'light' : 'dark')}
      >
        <Icon name={dark ? 'sun' : 'moon'} size={18} />
      </button>
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

      {menu ? (
        <Menu at={menu.at} entries={menuEntries(menu.board ? [] : board.selectedItems(), actions, { on: snapping, toggle: () => setSnapping(!snapping) })} onClose={() => setMenu(undefined)} />
      ) : null}

      <input
        ref={fileInput}
        type="file"
        accept={Object.keys(IMAGE_TYPES).join(',')}
        multiple
        hidden
        onChange={(event) => {
          const list = [...(event.target.files ?? [])]
          event.target.value = ''
          if (list.length) void addImageFiles(list, board.center())
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
  return loaded ? <BoardView loaded={loaded} /> : null
}

createRoot(document.getElementById('root')!).render(<App />)
