import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { DropTarget } from '../../shared/actions'
import type { EditRequest } from '../../shared/ipc'
import { SIDEBAR_WIDTH, type AppState, type ID, type UpdateStatus } from '../../shared/types'
import { activeSpace, arc, cx, dispatch, displayHost, isMac } from './api'
import { Icon } from './icons'
import { MediaCards } from './media-cards'
import { FavoriteTile, findTab, PinnedList, readDrag, SidebarList, type Ctx, type DropHint } from './sidebar-tree'

const SWIPE_MIN_HORIZONTAL_RATIO = 1.5
const SWIPE_GESTURE_GAP_MS = 400
const SWIPE_DISTANCE = 120
const SWIPE_COOLDOWN_MS = 500

export function Sidebar({ state, floating }: { state: AppState; floating?: boolean }) {
  const space = activeSpace(state)
  const profile = state.profiles.find((owner) => owner.id === space.profileId)
  const [edit, setEdit] = useState<EditRequest>()
  const [hint, setHint] = useState<DropHint>()
  const [dragging, setDragging] = useState(false)
  const [dragId, setDragId] = useState<ID>()
  const swipe = useRef({ distance: 0, at: 0 })
  const newTabRow = useRef<HTMLDivElement>(null)

  useEffect(() => arc.onEdit(setEdit), [])
  useEffect(() => {
    if (state.newTabOpen) newTabRow.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [state.newTabOpen])

  const dragTab = dragId ? findTab(state, space, dragId) : undefined
  const ctx: Ctx = { state, space, edit, setEdit, hint, setHint, dragging, dragTab }
  const activeId = space.activeItemId
  const live = state.peek ?? (activeId ? state.live[activeId] : undefined)
  const activeItem = activeId ? findTab(state, space, activeId) : undefined
  const url = live?.url ?? activeItem?.url ?? ''
  const favorites = profile?.favorites ?? []
  const right = state.settings.sidebarRight && !floating

  const switchSpaceOnSwipe = (event: React.WheelEvent) => {
    if (Math.abs(event.deltaX) < Math.abs(event.deltaY) * SWIPE_MIN_HORIZONTAL_RATIO) return
    const now = Date.now()
    if (now - swipe.current.at > SWIPE_GESTURE_GAP_MS) swipe.current.distance = 0
    swipe.current.at = now
    swipe.current.distance += event.deltaX
    if (Math.abs(swipe.current.distance) > SWIPE_DISTANCE) {
      dispatch({ type: 'switchSpaceRelative', delta: swipe.current.distance > 0 ? 1 : -1 })
      swipe.current.distance = 0
      swipe.current.at = now + SWIPE_COOLDOWN_MS
    }
  }

  const onDrop = (event: DragEvent, to: DropTarget) => {
    event.preventDefault()
    event.stopPropagation()
    const id = readDrag(event)
    setHint(undefined)
    setDragging(false)
    if (id) dispatch({ type: 'move', id, to })
  }

  return (
    <div
      className={cx('sidebar', floating && 'floating', right && 'right')}
      style={{ width: state.settings.sidebarWidth, [right ? 'right' : 'left']: 0 }}
      onWheel={switchSpaceOnSwipe}
      onDragStart={(event) => {
        setDragging(true)
        // The row's own handler has just set what's dragged.
        const id = readDrag(event)
        setDragId(id)
        if (id && findTab(state, space, id)) dispatch({ type: 'tabDrag', id })
      }}
      onDragEnd={() => {
        // Fires however the drag ends, even with Escape or outside the window.
        setDragging(false)
        setDragId(undefined)
        setHint(undefined)
        dispatch({ type: 'tabDrag' })
      }}
    >
      <ResizeHandle width={state.settings.sidebarWidth} right={right} />
      <TopBar state={state} />

      <div className="urlbar" onClick={() => void arc.dispatch({ type: 'command', id: 'editUrl' })} title={url}>
        <Icon name={!url ? 'search' : url.startsWith('https:') ? 'lock' : 'globe'} size={13} />
        <span className={cx('host', !url && 'placeholder')}>{url ? displayHost(url) : 'Search or Enter URL…'}</span>
        {live && /^https?:/.test(live.url) ? (
          <button
            className={cx('icon-btn shield', !live.shielded && 'off')}
            title={live.shielded ? `${live.blocked} ads & trackers blocked. Click to allow ads on this site.` : 'Ads allowed on this site. Click to block them again.'}
            onClick={(event) => {
              event.stopPropagation()
              dispatch({ type: 'adblockToggleSite' })
            }}
          >
            <Icon name="shield" size={14} />
            {live.shielded && live.blocked > 0 ? <span className="count">{live.blocked > 99 ? '99+' : live.blocked}</span> : null}
          </button>
        ) : null}
        <span onClick={(event) => event.stopPropagation()}>
          {state.extensions[space.profileId]?.length ? <browser-action-list partition={`persist:profile-${space.profileId}`} tab={live ? String(live.wcId) : undefined} alignment={state.settings.sidebarRight ? 'bottom left' : 'bottom right'} /> : null}
        </span>
      </div>

      {favorites.length > 0 ? (
        <div className="favorites" onDragOver={(event) => event.preventDefault()} onDrop={(event) => onDrop(event, { section: 'favorites', index: favorites.length })}>
          {favorites.map((favorite, index) => (
            <FavoriteTile key={favorite.id} item={favorite} index={index} ctx={ctx} onDrop={onDrop} />
          ))}
        </div>
      ) : dragging ? (
        <div
          className={cx('favorites-drop', hint && 'section' in hint && hint.section === 'favorites' && 'drop-into')}
          onDragOver={(event) => {
            event.preventDefault()
            setHint({ section: 'favorites' })
          }}
          onDrop={(event) => onDrop(event, { section: 'favorites', index: 0 })}
        >
          Drop to add to Favorites
        </div>
      ) : null}

      <div className="scroll">
        <div className="space-name" onContextMenu={() => dispatch({ type: 'spaceMenu', id: space.id })}>
          {space.emoji ? <span>{space.emoji}</span> : null}
          {space.name}
        </div>

        <div
          onDragOver={(event) => {
            if (space.pinned.length === 0) {
              event.preventDefault()
              setHint({ section: 'pinned' })
            }
          }}
          onDrop={(event) => onDrop(event, { section: 'pinned', index: space.pinned.length })}
        >
          {space.pinned.length === 0 && dragging ? (
            <div className={cx('row empty-hint', hint && 'section' in hint && hint.section === 'pinned' && 'drop-into')}>Drop here to pin</div>
          ) : null}
          <PinnedList nodes={space.pinned} ctx={ctx} onDrop={onDrop} />
        </div>

        <div className="divider">
          <hr />
          {space.today.length > 0 ? (
            <button onClick={() => dispatch({ type: 'clearToday' })} title={`Clear unpinned tabs (${isMac ? '⌘⇧K' : 'Ctrl+Shift+K'})`}>
              ↓ Clear
            </button>
          ) : null}
        </div>

        <div ref={newTabRow} className={cx('row newtab', state.newTabOpen && 'active')} onClick={() => dispatch({ type: 'overlay', mode: { kind: 'command', target: 'tab' } })}>
          <Icon name="plus" size={15} />
          <span className="title">New Tab</span>
        </div>

        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 40 }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => onDrop(event, { section: 'today', index: space.today.length })}
        >
          <SidebarList list={space.today} ctx={ctx} section="today" onDrop={onDrop} />
        </div>
      </div>

      <MediaCards state={state} />
      <UpdatePill update={state.update} />
      {state.whatsNewWaiting && (state.update.state === 'none' || state.update.state === 'downloading') ? <WhatsNewPill /> : null}
      <BottomBar ctx={ctx} />
    </div>
  )
}

function UpdatePill({ update }: { update: UpdateStatus }) {
  const [dismissed, setDismissed] = useState(false)
  if ((update.state !== 'ready' && update.state !== 'available') || dismissed) return null
  const ready = update.state === 'ready'
  const count = ready ? Math.max(1, update.notes?.length ?? 1) : 1
  const what = count > 1 ? `${count} updates are ready (YARC ${update.version})` : `YARC ${update.version} is ready`
  return (
    <div className="update-pill">
      <button
        className="update-pill-main"
        title={ready ? `${what}. It also installs the next time you quit.` : `Download YARC ${update.version}`}
        onClick={() => dispatch({ type: 'command', id: 'installUpdate' })}
      >
        <Icon name={ready ? 'reload' : 'download'} size={13} />
        <span>{ready ? 'Restart to Update' : 'Update Available'}</span>
      </button>
      <button className="icon-btn update-pill-close" title="Hide until YARC restarts" onClick={() => setDismissed(true)}>
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}

function WhatsNewPill() {
  return (
    <div className="update-pill">
      <button className="update-pill-main" title="See what changed in YARC" onClick={() => dispatch({ type: 'command', id: 'whatsNew' })}>
        <Icon name="bell" size={13} />
        <span>What’s New</span>
      </button>
      <button className="icon-btn update-pill-close" title="Hide until the next update" onClick={() => dispatch({ type: 'hideWhatsNew' })}>
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}

function ResizeHandle({ width, right }: { width: number; right: boolean }) {
  const drag = useRef<{ startX: number; width: number } | undefined>(undefined)
  return (
    <div
      className="sidebar-resize"
      style={right ? { left: 0 } : { right: 0 }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { startX: event.clientX, width }
      }}
      onPointerMove={(event) => {
        const start = drag.current
        if (!start) return
        const delta = right ? start.startX - event.clientX : event.clientX - start.startX
        const next = Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, start.width + delta)))
        if (next !== width) dispatch({ type: 'settings', patch: { sidebarWidth: next } })
      }}
      onPointerUp={() => (drag.current = undefined)}
    />
  )
}

function TopBar({ state }: { state: AppState }) {
  const space = activeSpace(state)
  const live = state.peek ?? (space.activeItemId ? state.live[space.activeItemId] : undefined)
  const toggle = (
    <button className="icon-btn sidebar-toggle" title={`Toggle sidebar (${isMac ? '⌘S' : 'Ctrl+S'})`} onClick={() => dispatch({ type: 'toggleSidebar' })}>
      <Icon name="sidebar" />
    </button>
  )
  const menu = isMac ? null : (
    <button
      className="icon-btn"
      title="Menu"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        dispatch({ type: 'appMenu', x: rect.left, y: rect.bottom + 4 })
      }}
    >
      <Icon name="menu" />
    </button>
  )
  const nav = (
    <>
      <button className="icon-btn" disabled={!live?.canGoBack} onClick={() => dispatch({ type: 'back' })} title="Back">
        <Icon name="back" />
      </button>
      <button className="icon-btn" disabled={!live?.canGoForward} onClick={() => dispatch({ type: 'forward' })} title="Forward">
        <Icon name="forward" />
      </button>
      <button
        className="icon-btn"
        disabled={!live}
        onClick={(event) => dispatch(live?.loading ? { type: 'stop' } : { type: 'reload', hard: event.shiftKey })}
        title={live?.loading ? 'Stop' : 'Reload'}
      >
        <Icon name={live?.loading ? 'x' : 'reload'} />
      </button>
    </>
  )
  return (
    <div className="topbar">
      {state.settings.sidebarRight ? (
        <>
          {nav}
          <div className="spacer" />
          {menu}
          {toggle}
        </>
      ) : (
        <>
          {toggle}
          {menu}
          <div className="spacer" />
          {nav}
        </>
      )}
    </div>
  )
}

function BottomBar({ ctx }: { ctx: Ctx }) {
  const { state, space: currentSpace, hint, setHint, dragging } = ctx
  const downloading = state.downloads.some((download) => download.state === 'progressing')
  return (
    <div className="bottombar">
      <button className="icon-btn" title="Library" onClick={() => dispatch({ type: 'overlay', mode: { kind: 'library', tab: downloading ? 'downloads' : 'archive' } })}>
        <Icon name={downloading ? 'download' : 'archive'} />
      </button>
      <div className="spaces">
        {state.spaces.map((space) => {
          const over = dragging && hint && 'section' in hint && hint.section === `space:${space.id}`
          return (
            <button
              key={space.id}
              className={cx('space-dot', space.id === currentSpace.id && 'active', over && 'drop-into')}
              title={space.name}
              onClick={() => dispatch(space.id === currentSpace.id ? { type: 'spaceMenu', id: space.id } : { type: 'switchSpace', id: space.id })}
              onContextMenu={() => dispatch({ type: 'spaceMenu', id: space.id })}
              onDragOver={(event) => {
                event.preventDefault()
                setHint({ section: `space:${space.id}` })
              }}
              onDrop={(event) => {
                event.preventDefault()
                const id = readDrag(event)
                setHint(undefined)
                if (id) dispatch({ type: 'moveToSpace', id, spaceId: space.id })
              }}
            >
              {space.emoji ? <span className="emoji">{space.emoji}</span> : <span className="dot" />}
            </button>
          )
        })}
      </div>
      <button className="icon-btn" title="New space" onClick={() => dispatch({ type: 'overlay', mode: { kind: 'space-editor' } })}>
        <Icon name="plus" />
      </button>
    </div>
  )
}

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'browser-action-list': { partition?: string; alignment?: string; tab?: string }
    }
  }
}
