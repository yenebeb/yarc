import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MAX_PANES, paneIds, placePane, previewRect, sideAt, type Side } from '../../shared/split'
import { isFloating } from '../../shared/tour'
import { findItem, tabTitle } from '../../shared/tree'
import type { AppState, ID, Rect } from '../../shared/types'
import { activeSpace, arc, cx, dispatch, displayHost, isMac, useAppState, useOverlayMode, useSpaceTheme } from './api'
import { Favicon, Icon } from './icons'
import { Tour, UpdateReady, WhatsNew } from './panels/Intro'
import { Library } from './panels/Library'
import { LiveFolderEditor } from './panels/LiveFolderEditor'
import { Settings } from './panels/Settings'
import { SharePicker } from './panels/SharePicker'
import { SpaceEditor } from './panels/SpaceEditor'
import { Sidebar } from './Sidebar'
import { Capture } from './panels/Capture'
import { CommandBar } from './panels/CommandBar'
import './styles.css'

const close = () => dispatch({ type: 'overlay', mode: { kind: 'none' } })
const endTour = () => dispatch({ type: 'endTour' })

function App() {
  const state = useAppState()
  const { mode, opened } = useOverlayMode()
  const space = state ? activeSpace(state) : undefined
  const appearanceOfRevealedSidebarOnly = mode.kind === 'sidebar' ? space?.appearance : undefined
  useSpaceTheme(space, appearanceOfRevealedSidebarOnly)

  if (!state || mode.kind === 'none') return null
  const freshOnEachOpen = `${mode.kind}-${opened}`
  switch (mode.kind) {
    case 'sidebar':
      return (
        <div className={cx(isMac ? 'mac' : 'win', state.fullscreen && 'fullscreen', state.settings.sidebarRight && 'sidebar-right')} style={{ height: '100%' }}>
          {/* Zones first so the sidebar stays on top: only over the page does a drag make a split. */}
          {state.tabDrag ? <SplitDropZones state={state} overlayInWindow={{ x: 0, y: 0 }} /> : null}
          <Sidebar state={state} floating />
        </div>
      )
    case 'find':
      return <FindBar key={freshOnEachOpen} />
    case 'notice':
      return (
        <div className="notice" role="status" onMouseDown={close}>
          {mode.text}
        </div>
      )
    case 'switcher':
      return <Switcher state={state} order={mode.order} index={mode.index} />
    case 'command':
      return (
        <>
          <div className="scrim clear" onMouseDown={close} />
          <CommandBar key={freshOnEachOpen} state={state} mode={mode} close={close} />
        </>
      )
    case 'settings':
      return (
        <>
          <div className="scrim" onMouseDown={close} />
          <Settings key={freshOnEachOpen} state={state} section={mode.section} close={close} />
        </>
      )
    case 'library':
      return (
        <>
          <div className="scrim" onMouseDown={close} />
          <Library key={`${freshOnEachOpen}-${mode.tab}`} state={state} close={close} initialTab={mode.tab} />
        </>
      )
    case 'space-editor':
      return (
        <>
          <div className="scrim" onMouseDown={close} />
          <SpaceEditor key={`${freshOnEachOpen}-${mode.spaceId}`} state={state} close={close} spaceId={mode.spaceId} />
        </>
      )
    case 'live-folder':
      return (
        <>
          <div className="scrim" onMouseDown={close} />
          <LiveFolderEditor key={`${freshOnEachOpen}-${mode.folderId}`} state={state} close={close} folderId={mode.folderId} />
        </>
      )
    case 'share-picker':
      return (
        <>
          <div className="scrim" onMouseDown={close} />
          <SharePicker key={mode.id} mode={mode} />
        </>
      )
    case 'peek':
      return <PeekFrame card={mode.card} />
    case 'split-drop':
      return <SplitDropZones state={state} overlayInWindow={state.layout.content} />
    case 'capture':
      return <Capture key={freshOnEachOpen} state={state} pageInOverlay={mode.page} close={close} />
    case 'tour':
      if (isFloating(mode.step)) return <Tour state={state} step={mode.step} close={endTour} />
      return (
        <>
          <div className="scrim intro-scrim" />
          <Tour key={freshOnEachOpen} state={state} step={mode.step} close={endTour} />
        </>
      )
    case 'update':
      return (
        <>
          <div className="scrim intro-scrim" onMouseDown={close} />
          <UpdateReady key={freshOnEachOpen} update={state.update} close={close} />
        </>
      )
    case 'whats-new':
      return (
        <>
          <div className="scrim intro-scrim" onMouseDown={close} />
          <WhatsNew key={freshOnEachOpen} releases={mode.releases} spotlights={mode.spotlights} boards={mode.boards} close={close} />
        </>
      )
  }
}

type Point = { x: number; y: number }
type PaneView = AppState['layout']['views'][number]

const distance = (rect: Rect, point: Point) =>
  Math.hypot(Math.max(rect.x - point.x, 0, point.x - rect.x - rect.width), Math.max(rect.y - point.y, 0, point.y - rect.y - rect.height))

function nearestPaneWithBar(views: PaneView[], point: Point) {
  const panes = views.map((view) => ({ id: view.id, rect: view.bar ? { ...view.bar, height: view.bar.height + view.rect.height } : view.rect }))
  return panes.reduce((nearest, pane) => (distance(pane.rect, point) < distance(nearest.rect, point) ? pane : nearest))
}

function useEndMissedTabDrag() {
  useEffect(() => {
    const shown = Date.now()
    const endTabDrag = (event: MouseEvent) => {
      if (event.type === 'mousedown' || (event.buttons === 0 && Date.now() - shown > 300)) dispatch({ type: 'tabDrag' })
    }
    window.addEventListener('mousemove', endTabDrag)
    window.addEventListener('mousedown', endTabDrag)
    return () => {
      window.removeEventListener('mousemove', endTabDrag)
      window.removeEventListener('mousedown', endTabDrag)
    }
  }, [])
}

function SplitDropZones({ state, overlayInWindow }: { state: AppState; overlayInWindow: Point }) {
  const [zone, setZone] = useState<{ target: ID; side: Side; rect: Rect }>()
  const dragged = state.tabDrag ? findItem(state, state.tabDrag)?.item : undefined
  const { content, views, splitId } = state.layout
  const split = splitId ? activeSpace(state).splits.find((candidate) => candidate.id === splitId) : undefined
  useEndMissedTabDrag()

  const zoneAt = (clientX: number, clientY: number) => {
    if (!dragged || views.length === 0) return undefined
    const pointInWindow = { x: clientX + overlayInWindow.x, y: clientY + overlayInWindow.y }
    const pane = nearestPaneWithBar(views, pointInWindow)
    const side = sideAt(pane.rect, pointInWindow.x, pointInWindow.y)
    const root = split && paneIds(split.root).includes(pane.id) ? split.root : undefined
    if (!placePane(root, pane.id, dragged.id, side)) return undefined
    return { target: pane.id, side, rect: previewRect(pane.rect, side) }
  }

  const full = !!split && paneIds(split.root).length >= MAX_PANES && !paneIds(split.root).includes(dragged?.id ?? '')
  return (
    <div
      className="split-drop"
      style={{ left: content.x - overlayInWindow.x, top: content.y - overlayInWindow.y, width: content.width, height: content.height }}
      onDragOver={(event) => {
        const next = zoneAt(event.clientX, event.clientY)
        if (next) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }
        if (next?.target !== zone?.target || next?.side !== zone?.side) setZone(next)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setZone(undefined)
      }}
      onDrop={(event) => {
        event.preventDefault()
        const dropZone = zoneAt(event.clientX, event.clientY)
        setZone(undefined)
        if (dropZone && dragged) dispatch({ type: 'placeInSplit', id: dragged.id, target: dropZone.target, side: dropZone.side })
        else dispatch({ type: 'tabDrag' })
      }}
    >
      {zone && dragged ? (
        <div
          className={`split-drop-zone ${zone.side}`}
          style={{ left: zone.rect.x - content.x, top: zone.rect.y - content.y, width: zone.rect.width, height: zone.rect.height }}
        >
          <span className="split-drop-tab">
            <Favicon url={dragged.url} favicon={state.live[dragged.id]?.favicon ?? dragged.favicon} />
            <span>{state.live[dragged.id]?.title || dragged.title || displayHost(dragged.url)}</span>
          </span>
        </div>
      ) : full ? (
        <div className="split-drop-full">Split View holds up to 4 tabs</div>
      ) : null}
    </div>
  )
}

function PeekFrame({ card }: { card: Rect }) {
  const peek = (op: 'close' | 'expand' | 'split') => () => dispatch({ type: 'peek', op })
  return (
    <>
      <div className="scrim" onMouseDown={peek('close')} />
      <div className="peek-buttons" style={{ left: card.x + card.width, top: card.y, width: card.x }}>
        <button title="Close (Esc)" onClick={peek('close')}>
          <Icon name="x" />
        </button>
        <button title={`Open as a tab (${isMac ? '⌘O' : 'Ctrl+O'})`} onClick={peek('expand')}>
          <Icon name="expand" />
        </button>
        <button title="Open in split view" onClick={peek('split')}>
          <Icon name="split" />
        </button>
      </div>
    </>
  )
}

function FindBar() {
  const [query, setQuery] = useState('')
  const [count, setCount] = useState<{ active: number; matches: number }>()
  const input = useRef<HTMLInputElement>(null)
  const queryRef = useRef('')
  queryRef.current = query

  useEffect(() => {
    input.current?.focus()
    return arc.onFind((found) => {
      if (found.step) {
        if (queryRef.current) dispatch({ type: 'find', query: queryRef.current, forward: found.step > 0, findNext: true })
        input.current?.focus()
      } else if (found.matches !== undefined) setCount({ active: found.active ?? 0, matches: found.matches })
    })
  }, [])

  return (
    <div className="findbar">
      <Icon name="search" size={15} />
      <input
        ref={input}
        value={query}
        placeholder="Find in page"
        spellCheck={false}
        onChange={(event) => {
          setQuery(event.target.value)
          if (!event.target.value) setCount(undefined)
          dispatch({ type: 'find', query: event.target.value })
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && query) dispatch({ type: 'find', query, forward: !event.shiftKey, findNext: true })
        }}
      />
      {count && query ? (
        <span className="count">
          {count.matches ? count.active : 0}/{count.matches}
        </span>
      ) : null}
      <button className="icon-btn" title="Previous" onClick={() => query && dispatch({ type: 'find', query, forward: false, findNext: true })}>
        <Icon name="up" />
      </button>
      <button className="icon-btn" title="Next" onClick={() => query && dispatch({ type: 'find', query, forward: true, findNext: true })}>
        <Icon name="down" />
      </button>
      <button className="icon-btn" title="Close" onClick={() => dispatch({ type: 'stopFind' })}>
        <Icon name="x" />
      </button>
    </div>
  )
}

function Switcher({ state, order, index }: { state: AppState; order: string[]; index: number }) {
  const visible = order.slice(0, 8)
  return (
    <>
      <div className="scrim" style={{ background: 'transparent' }} />
      <div className="panel switcher">
        {visible.map((id, position) => {
          const item = findItem(state, id)?.item
          if (!item) return null
          const live = state.live[id]
          return (
            <div key={id} className={cx('switch-card', position === index % visible.length && 'sel')}>
              <Favicon url={item.url} favicon={live?.favicon ?? item.favicon} />
              <span className="t">{tabTitle(item, live?.title)}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
