import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { dividers, dragBorder, type Divider } from '../../shared/split'
import { findItem } from '../../shared/tree'
import type { SwipeHint } from '../../shared/ipc'
import type { AppState, Rect } from '../../shared/types'
import { activeSpace, arc, cx, dispatch, displayHost, isMac, useAppState, useSpaceTheme, useToast } from './api'
import { Icon } from './icons'
import { Sidebar } from './Sidebar'
import './styles.css'

if (isMac) document.body.classList.add('vibrant')

function App() {
  const state = useAppState()
  const space = state ? activeSpace(state) : undefined
  useSpaceTheme(space, space?.appearance)
  const toast = useToast()
  if (!state || !space) return null
  const s = state.settings
  const hidden = !s.sidebarVisible
  const fullscreenPage = state.layout.views.length === 1 && state.layout.content.x === 0 && state.layout.content.y === 0

  return (
    <div className={cx(isMac ? 'mac' : 'win', hidden && 'sidebar-hidden', s.sidebarRight && 'sidebar-right', state.fullscreen && 'fullscreen')} style={{ height: '100%' }}>
      {!hidden && !fullscreenPage ? <Sidebar state={state} /> : null}
      {!isMac && !state.fullscreen && !fullscreenPage ? <CaptionStrip state={state} /> : null}
      {hidden ? (
        <>
          {isMac ? <div className="drag-strip" /> : null}
          <div
            className="peek-strip"
            style={s.sidebarRight ? { right: 0 } : { left: 0 }}
            onMouseEnter={() => dispatch({ type: 'sidebarReveal', show: true })}
          />
        </>
      ) : null}
      <ContentDecor state={state} />
      <SwipeArrow />
      <div className="notices">
        {toast ? <div className="toast">{toast}</div> : null}
      </div>
    </div>
  )
}

const SHIELD = 140

/** Behind the page, in the strip it uncovers as it slides: a shield coming in from the edge, like Chrome's, darker the closer letting go is to going. */
function SwipeArrow() {
  const [hint, setHint] = useState<SwipeHint | null>(null)
  useEffect(() => arc.onSwipe(setHint), [])
  if (!hint) return null
  const { rect, offset, step } = hint
  const back = step === 'back'
  const ready = hint.progress >= 1
  const height = ready ? SHIELD + 10 : SHIELD
  const inside = Math.min(offset, SHIELD / 2)
  const shade = ready ? 0.75 : Math.min(0.65, Math.max(hint.progress, 0.25))
  const edge = inside - SHIELD
  return (
    <div className="swipe-strip" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
      <div
        className="swipe-shield"
        style={{
          left: back ? edge : undefined,
          right: back ? undefined : edge,
          top: rect.height / 2 - height / 2,
          height,
          background: `color-mix(in srgb, var(--text) ${Math.round(shade * 100)}%, transparent)`
        }}
      />
      <div className="swipe-arrow" style={{ left: back ? 0 : undefined, right: back ? undefined : 0, width: inside, top: rect.height / 2 - 12 }}>
        <Icon name={step} size={24} stroke={2.4} />
      </div>
    </div>
  )
}

function CaptionStrip({ state }: { state: AppState }) {
  const { content } = state.layout
  const s = state.settings
  const left = s.sidebarVisible && !s.sidebarRight ? content.x : 0
  return <div className="caption-strip" style={{ left, right: 0, height: content.y }} />
}

function useStills(): Record<string, string> {
  const [stills, setStills] = useState<Record<string, string>>({})
  useEffect(() => arc.onStill(({ id, image }) => setStills((s) => ({ ...s, [id]: image }))), [])
  return stills
}

function isDarkRgb(color: string | undefined): boolean {
  const m = color?.match(/(\d+),\s*(\d+),\s*(\d+)/)
  if (!m) return false
  const [r, g, b] = [m[1], m[2], m[3]].map(Number)
  return 0.299 * r + 0.587 * g + 0.114 * b < 140
}

type PaneView = AppState['layout']['views'][number] & { bar: Rect }

function PaneBar({ state, view, active }: { state: AppState; view: PaneView; active: boolean }) {
  const live = state.live[view.id]
  const item = findItem(state, view.id)?.item
  const url = live?.url || item?.url || ''
  const { bar } = view
  const color = live?.barColor
  const focus = () => {
    if (!active) dispatch({ type: 'activate', id: view.id })
  }
  return (
    <>
      {/* Shows in the page's rounded corners, so bar and page read as one card. */}
      <div className="pane-card" style={{ left: bar.x, top: bar.y, width: bar.width, height: bar.height + view.rect.height, background: color }} />
      <div
        className={cx('pane-bar', active && 'active', isDarkRgb(color) && 'dark')}
        style={{ left: bar.x, top: bar.y, width: bar.width, height: bar.height, background: color }}
        onMouseDown={focus}
      >
        <div className="pane-nav">
          <button className="icon-btn" title="Back" disabled={!live?.canGoBack} onClick={() => dispatch({ type: 'back', id: view.id })}>
            <Icon name="back" size={15} />
          </button>
          <button className="icon-btn" title="Forward" disabled={!live?.canGoForward} onClick={() => dispatch({ type: 'forward', id: view.id })}>
            <Icon name="forward" size={15} />
          </button>
          {active ? (
            <button
              className="icon-btn"
              title={live?.loading ? 'Stop' : 'Reload'}
              disabled={!live}
              onClick={(e) => dispatch(live?.loading ? { type: 'stop', id: view.id } : { type: 'reload', id: view.id, hard: e.shiftKey })}
            >
              <Icon name={live?.loading ? 'x' : 'reload'} size={14} />
            </button>
          ) : null}
        </div>
        <div className="pane-host" title={url}>
          <button className="icon-btn link" title="Copy URL" onClick={() => dispatch({ type: 'copyUrl', id: view.id })}>
            <Icon name="link" size={13} />
          </button>
          <span
            className="host"
            onClick={() => {
              focus()
              dispatch({ type: 'command', id: 'editUrl' })
            }}
          >
            {url ? displayHost(url) : item?.title}
          </span>
        </div>
        <div className="pane-end">
          <button
            className="icon-btn split-menu"
            title="Split View"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              dispatch({ type: 'splitMenu', id: view.id, x: r.left, y: r.bottom + 4 })
            }}
          >
            <Icon name="split" size={15} />
          </button>
          <button className="icon-btn" title="Close tab" onClick={() => dispatch({ type: 'close', id: view.id })}>
            <Icon name="x" size={15} />
          </button>
        </div>
      </div>
    </>
  )
}

function ContentDecor({ state }: { state: AppState }) {
  const { content, views, splitId } = state.layout
  const space = activeSpace(state)
  const drag = useRef<{ splitId: string; divider: Divider; start: number } | undefined>(undefined)
  const stills = useStills()

  if (views.length === 0) {
    return <div className="content-empty" style={{ left: content.x, top: content.y, width: content.width, height: content.height }} />
  }
  const elsewhere = views
    .filter((v) => v.elsewhere)
    .map((v) => (
      <button
        key={`still-${v.id}`}
        className="content-elsewhere"
        style={{ left: v.rect.x, top: v.rect.y, width: v.rect.width, height: v.rect.height }}
        title="Open in another window. Click to show it here."
        onClick={() => dispatch({ type: 'activate', id: v.id })}
      >
        {stills[v.id] ? <img src={stills[v.id]} alt="" /> : null}
      </button>
    ))
  const split = splitId ? space.splits.find((sp) => sp.id === splitId) : undefined
  if (!split || views.length < 2) return <>{elsewhere}</>
  const panes = views.filter((v): v is PaneView => !!v.bar)
  const active = panes.find((v) => v.id === space.activeItemId)
  const along = (d: Divider, e: { clientX: number; clientY: number }) => (d.dir === 'row' ? e.clientX : e.clientY)

  return (
    <>
      {panes.map((v) => (
        <PaneBar key={`bar-${v.id}`} state={state} view={v} active={v === active} />
      ))}
      {elsewhere}
      {active ? (
        <div
          className="focus-ring"
          style={{ left: active.bar.x - 3, top: active.bar.y - 3, width: active.bar.width + 6, height: active.bar.height + active.rect.height + 6 }}
        />
      ) : null}
      {dividers(split.root, content).map((d) => {
        const grabArea = d.dir === 'row' ? { ...d.rect, x: d.rect.x - 2, width: d.rect.width + 4 } : { ...d.rect, y: d.rect.y - 2, height: d.rect.height + 4 }
        return (
          <div
            key={`${d.path.join('.')}-${d.index}`}
            className={`split-handle ${d.dir}`}
            style={{ left: grabArea.x, top: grabArea.y, width: grabArea.width, height: grabArea.height }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drag.current = { splitId: split.id, divider: d, start: along(d, e) }
            }}
            onPointerMove={(e) => {
              const g = drag.current
              if (!g) return
              const length = g.divider.dir === 'row' ? g.divider.group.width : g.divider.group.height
              const sizes = dragBorder(g.divider.sizes, g.divider.index, along(g.divider, e) - g.start, length)
              dispatch({ type: 'resizeSplit', splitId: g.splitId, path: g.divider.path, sizes })
            }}
            onPointerUp={() => (drag.current = undefined)}
            onDoubleClick={() => dispatch({ type: 'resizeSplit', splitId: split.id, path: d.path, sizes: d.sizes.map(() => 1) })}
          />
        )
      })}
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
