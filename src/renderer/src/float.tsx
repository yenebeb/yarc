import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { FloatOp, FloatState } from '../../shared/ipc'
import { arc, cx, displayHost } from './api'
import { Icon } from './icons'
import './float.css'

/** So a double-click's presses don't move the player. */
const DRAG_SLOP = 3
const MIN_WIDTH_FOR_SKIP_BUTTONS = 280

const send = (op: FloatOp) => void arc.float(op)

const onButton = (e: { target: EventTarget }) => e.target instanceof Element && !!e.target.closest('button')

function useWidth(): number {
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const on = () => setWidth(window.innerWidth)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return width
}

function App() {
  const [s, setS] = useState<FloatState>()
  const width = useWidth()
  const drag = useRef<{ x: number; y: number; moving: boolean }>(undefined)

  useEffect(() => {
    const off = arc.onFloat(setS)
    send({ kind: 'sync' })
    return off
  }, [])
  useEffect(() => {
    if (s?.title) document.title = s.title
  }, [s?.title])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'k') send({ kind: 'toggle' })
      else if (e.key === 'ArrowLeft') send({ kind: 'skip', seconds: -15 })
      else if (e.key === 'ArrowRight') send({ kind: 'skip', seconds: 15 })
      else if (e.key === 'Escape') send({ kind: 'close' })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || onButton(e)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.screenX, y: e.screenY, moving: false }
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    if (!d.moving) {
      if (Math.hypot(e.screenX - d.x, e.screenY - d.y) < DRAG_SLOP) return
      d.moving = true
      send({ kind: 'drag', phase: 'start', x: d.x, y: d.y })
    }
    send({ kind: 'drag', phase: 'move', x: e.screenX, y: e.screenY })
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = undefined
    if (d?.moving) send({ kind: 'drag', phase: 'end', x: e.screenX, y: e.screenY })
  }
  const doubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onButton(e)) send({ kind: 'back' })
  }

  const playing = s?.playing ?? true
  return (
    <div
      className={cx('float', !playing && 'paused')}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={doubleClick}
      title={s?.title}
    >
      <div className="float-scrim" />
      <div className="float-top">
        <button className="float-btn" onClick={() => send({ kind: 'back' })} title="Back to Tab">
          <Icon name="toTab" size={15} />
        </button>
        <span className="float-host">{s ? displayHost(s.url) : ''}</span>
        <button className="float-btn" onClick={() => send({ kind: 'minimize' })} title="Keep Playing in the Sidebar">
          <Icon name="minus" size={15} stroke={2.2} />
        </button>
        <button className="float-btn" onClick={() => send({ kind: 'close' })} title="Close (pauses the video)">
          <Icon name="x" size={14} stroke={2.2} />
        </button>
      </div>
      <div className="float-middle">
        {width >= MIN_WIDTH_FOR_SKIP_BUTTONS && (
          <button className="float-btn float-skip" onClick={() => send({ kind: 'skip', seconds: -15 })} title="Back 15 Seconds">
            <Icon name="skipBack" size={20} />
            <span>15</span>
          </button>
        )}
        <button className="float-btn float-play" onClick={() => send({ kind: 'toggle' })} title={playing ? 'Pause' : 'Play'}>
          <Icon name={playing ? 'pause' : 'play'} size={22} />
        </button>
        {width >= MIN_WIDTH_FOR_SKIP_BUTTONS && (
          <button className="float-btn float-skip" onClick={() => send({ kind: 'skip', seconds: 15 })} title="Ahead 15 Seconds">
            <Icon name="skipAhead" size={20} />
            <span>15</span>
          </button>
        )}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
