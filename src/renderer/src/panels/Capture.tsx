import { useEffect, useRef, useState } from 'react'
import type { CaptureTo } from '../../../shared/actions'
import { spaceCanvases } from '../../../shared/tree'
import type { AppState, ID, Rect } from '../../../shared/types'
import { activeSpace, arc, dispatch } from '../api'
import { Icon, type IconName } from '../icons'
import './capture.css'

type CanvasChoice = { id: ID; name: string; lastActive: number; space?: string }

export function Capture({ state, pageInOverlay, close }: { state: AppState; pageInOverlay: Rect; close: () => void }) {
  const [pickedInPage, setPickedInPage] = useState<Rect>()
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number }>()
  const [chosenInPage, setChosenInPage] = useState<Rect>()
  const [whole, setWhole] = useState(false)
  const depth = useRef(0)
  const pointerInPage = useRef({ x: 0, y: 0 })
  const asking = useRef(false)
  const current = activeSpace(state)
  const canvases: CanvasChoice[] = state.spaces.flatMap((space) =>
    spaceCanvases(space).map((canvas) => ({ id: canvas.id, name: canvas.name, lastActive: canvas.lastActive, space: space.id === current?.id ? undefined : space.name }))
  )

  const pick = () => {
    if (asking.current) return
    asking.current = true
    void arc.capturePick(pointerInPage.current.x, pointerInPage.current.y, depth.current).then((pickedRect) => {
      asking.current = false
      setPickedInPage(pickedRect)
    })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [close])

  const toPagePixels = (pointer: { clientX: number; clientY: number }) => ({
    x: Math.min(Math.max(pointer.clientX - pageInOverlay.x, 0), pageInOverlay.width),
    y: Math.min(Math.max(pointer.clientY - pageInOverlay.y, 0), pageInOverlay.height)
  })
  const dragRect = drag && { x: Math.min(drag.x, drag.x2), y: Math.min(drag.y, drag.y2), width: Math.abs(drag.x2 - drag.x), height: Math.abs(drag.y2 - drag.y) }
  const dragging = !!dragRect && dragRect.width + dragRect.height > 8
  const shown = chosenInPage ?? (dragging ? dragRect : pickedInPage)

  return (
    <div
      className="capture"
      onMouseMove={(event) => {
        if (chosenInPage) return
        const point = toPagePixels(event)
        pointerInPage.current = point
        if (drag) setDrag({ ...drag, x2: point.x, y2: point.y })
        else pick()
      }}
      onWheel={(event) => {
        if (chosenInPage || drag) return
        depth.current = Math.max(0, depth.current + (event.deltaY > 0 ? 1 : -1))
        pick()
      }}
      onMouseDown={(event) => {
        if (chosenInPage || event.button !== 0) return
        const point = toPagePixels(event)
        setDrag({ x: point.x, y: point.y, x2: point.x, y2: point.y })
      }}
      onMouseUp={() => {
        if (chosenInPage || !drag) return
        setDrag(undefined)
        const area = dragging ? dragRect : pickedInPage
        if (area && area.width >= 4 && area.height >= 4) setChosenInPage(area)
      }}
    >
      <div className="capture-page" style={{ left: pageInOverlay.x, top: pageInOverlay.y, width: pageInOverlay.width, height: pageInOverlay.height }}>
        {shown ? (
          <div className={`capture-area${chosenInPage ? ' chosen' : ''}`} style={{ left: shown.x, top: shown.y, width: shown.width, height: shown.height }} />
        ) : (
          <div className="capture-dim" />
        )}
        {chosenInPage ? (
          <CaptureTarget
            area={chosenInPage}
            whole={whole}
            pageInOverlay={pageInOverlay}
            canvases={canvases}
            onRetake={() => {
              setChosenInPage(undefined)
              setPickedInPage(undefined)
              setWhole(false)
            }}
          />
        ) : (
          <div className="capture-hint">
            <Icon name="capture" size={14} /> Click a part of the page or drag an area · scroll for a bigger part · Esc to cancel
            <button
              className="capture-whole"
              onMouseDown={(event) => event.stopPropagation()}
              onMouseUp={(event) => event.stopPropagation()}
              onClick={() => {
                setWhole(true)
                setChosenInPage({ x: 0, y: 0, width: pageInOverlay.width, height: pageInOverlay.height })
              }}
            >
              Whole Page
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

interface SendChoice {
  key: string
  label: string
  detail?: string
  icon: IconName
  run: () => void
}

const RECENT_CANVASES = 5

function CaptureTarget({ area, whole, pageInOverlay, canvases, onRetake }: { area: Rect; whole: boolean; pageInOverlay: Rect; canvases: CanvasChoice[]; onRetake: () => void }) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [at, setAt] = useState(0)
  const send = (to: CaptureTo) => dispatch({ type: 'capture', rect: area, to, whole })
  const words = query.trim().toLowerCase()
  const matching = canvases.filter((canvas) => canvas.name.toLowerCase().includes(words)).sort((first, second) => second.lastActive - first.lastActive)
  const listed = showAll || words ? matching : matching.slice(0, RECENT_CANVASES)
  const actions: SendChoice[] = words
    ? []
    : [
        { key: 'copy', label: 'Copy', icon: 'copy', run: () => send('copy') },
        { key: 'save', label: 'Save…', icon: 'download', run: () => send('save') },
        { key: 'retake', label: 'Retake', icon: 'capture', run: onRetake }
      ]
  const boards: SendChoice[] = [
    { key: 'new', label: 'New Canvas', icon: 'plus', run: () => send('new') },
    ...listed.map((canvas) => ({ key: canvas.id, label: canvas.name, detail: canvas.space, icon: 'canvas', run: () => send(canvas.id) }))
  ]
  const choices = [...actions, ...boards]
  const highlighted = Math.min(at, choices.length - 1)
  const more = !showAll && !words && matching.length > RECENT_CANVASES

  const width = 248
  const height = 52 + 32 * choices.length + (actions.length ? 9 : 0) + (more ? 30 : 0)
  const below = area.y + area.height + 8
  const top = below + height <= pageInOverlay.height ? below : Math.max(8, area.y - height - 8)
  const left = Math.min(Math.max(8, area.x), Math.max(8, pageInOverlay.width - width - 8))

  const row = (choice: SendChoice, index: number) => (
    <button key={choice.key} className={index === highlighted ? 'active' : ''} onMouseEnter={() => setAt(index)} onClick={choice.run}>
      <Icon name={choice.icon} size={14} /> <span className="name">{choice.label}</span>
      {choice.detail ? <span className="detail">{choice.detail}</span> : null}
    </button>
  )
  return (
    <div className="capture-target" style={{ left, top, width }} onMouseDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()}>
      <input
        autoFocus
        placeholder="Send to…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setAt(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setAt((highlighted + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            choices[highlighted]?.run()
          }
        }}
      />
      {actions.map(row)}
      {actions.length ? <div className="capture-target-line" /> : null}
      {boards.map((choice, index) => row(choice, actions.length + index))}
      {more ? (
        <button className="more" onClick={() => setShowAll(true)}>
          Show All ({matching.length})
        </button>
      ) : null}
    </div>
  )
}
