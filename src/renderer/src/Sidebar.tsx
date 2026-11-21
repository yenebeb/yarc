import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import type { DropTarget } from '../../shared/actions'
import type { EditRequest } from '../../shared/ipc'
import { MAX_PANES, paneIds } from '../../shared/split'
import { isAwayFromSaved, spaceItems } from '../../shared/tree'
import { SIDEBAR_WIDTH, type AppState, type ID, type PinnedNode, type Space, type TabItem, type UpdateStatus } from '../../shared/types'
import { activeSpace, arc, cx, dispatch, displayHost, isMac } from './api'
import { Favicon, Icon } from './icons'

const DRAG_TYPE = 'application/x-arc-item'
const SWIPE_MIN_HORIZONTAL_RATIO = 1.5
const SWIPE_GESTURE_GAP_MS = 400
const SWIPE_DISTANCE = 120
const SWIPE_COOLDOWN_MS = 500

type RowDrop = 'before' | 'after' | 'into' | 'split-left' | 'split-right'

const DROP_CLASS: Record<RowDrop, string> = { before: 'drop-before', after: 'drop-after', into: 'drop-into', 'split-left': 'drop-split', 'split-right': 'drop-split' }

/** `target`: over a split row, the tab whose half the dragged tab would go beside. */
type DropHint = { id: string; pos: RowDrop; target?: ID } | { section: 'favorites' | 'pinned' | 'today' | `space:${string}` }

interface Ctx {
  state: AppState
  space: Space
  edit: EditRequest | undefined
  setEdit: (e: EditRequest | undefined) => void
  hint: DropHint | undefined
  setHint: (h: DropHint | undefined) => void
  dragging: boolean
  dragTab: TabItem | undefined
}

function itemTitle(state: AppState, item: TabItem): string {
  return item.savedTitle || state.live[item.id]?.title || item.title || displayHost(item.url)
}

function readDrag(e: DragEvent): string | undefined {
  return e.dataTransfer.getData(DRAG_TYPE) || undefined
}

function startDrag(e: DragEvent, id: string): void {
  e.dataTransfer.setData(DRAG_TYPE, id)
  e.dataTransfer.effectAllowed = 'move'
}

export function Sidebar({ state, floating }: { state: AppState; floating?: boolean }) {
  const space = activeSpace(state)
  const profile = state.profiles.find((p) => p.id === space.profileId)
  const [edit, setEdit] = useState<EditRequest>()
  const [hint, setHint] = useState<DropHint>()
  const [dragging, setDragging] = useState(false)
  const [dragId, setDragId] = useState<ID>()
  const swipe = useRef({ x: 0, t: 0 })
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

  const switchSpaceOnSwipe = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * SWIPE_MIN_HORIZONTAL_RATIO) return
    const now = Date.now()
    if (now - swipe.current.t > SWIPE_GESTURE_GAP_MS) swipe.current.x = 0
    swipe.current.t = now
    swipe.current.x += e.deltaX
    if (Math.abs(swipe.current.x) > SWIPE_DISTANCE) {
      dispatch({ type: 'switchSpaceRelative', delta: swipe.current.x > 0 ? 1 : -1 })
      swipe.current.x = 0
      swipe.current.t = now + SWIPE_COOLDOWN_MS
    }
  }

  const onDrop = (e: DragEvent, to: DropTarget) => {
    e.preventDefault()
    e.stopPropagation()
    const id = readDrag(e)
    setHint(undefined)
    setDragging(false)
    if (id) dispatch({ type: 'move', id, to })
  }

  return (
    <div
      className={cx('sidebar', floating && 'floating', right && 'right')}
      style={{ width: state.settings.sidebarWidth, [right ? 'right' : 'left']: 0 }}
      onWheel={switchSpaceOnSwipe}
      onDragStart={(e) => {
        setDragging(true)
        // The row's own handler has just set what's dragged.
        const id = readDrag(e)
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
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'adblockToggleSite' })
            }}
          >
            <Icon name="shield" size={14} />
            {live.shielded && live.blocked > 0 ? <span className="count">{live.blocked > 99 ? '99+' : live.blocked}</span> : null}
          </button>
        ) : null}
        <span onClick={(e) => e.stopPropagation()}>
          {state.extensions[space.profileId]?.length ? <browser-action-list partition={`persist:profile-${space.profileId}`} tab={live ? String(live.wcId) : undefined} alignment={state.settings.sidebarRight ? 'bottom left' : 'bottom right'} /> : null}
        </span>
      </div>

      {favorites.length > 0 ? (
        <div className="favorites" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, { section: 'favorites', index: favorites.length })}>
          {favorites.map((f, i) => (
            <FavoriteTile key={f.id} item={f} index={i} ctx={ctx} onDrop={onDrop} />
          ))}
        </div>
      ) : dragging ? (
        <div
          className={cx('favorites-drop', hint && 'section' in hint && hint.section === 'favorites' && 'drop-into')}
          onDragOver={(e) => {
            e.preventDefault()
            setHint({ section: 'favorites' })
          }}
          onDrop={(e) => onDrop(e, { section: 'favorites', index: 0 })}
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
          onDragOver={(e) => {
            if (space.pinned.length === 0) {
              e.preventDefault()
              setHint({ section: 'pinned' })
            }
          }}
          onDrop={(e) => onDrop(e, { section: 'pinned', index: space.pinned.length })}
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
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDrop(e, { section: 'today', index: space.today.length })}
        >
          <SidebarList list={space.today} ctx={ctx} section="today" onDrop={onDrop} />
        </div>
      </div>

      <MediaCards state={state} />
      <UpdatePill update={state.update} />
      <BottomBar ctx={ctx} />
    </div>
  )
}

function MediaCards({ state }: { state: AppState }) {
  const [open, setOpen] = useState(false)
  const { cards, videos } = state.media
  const shown = new Set(state.layout.views.filter((v) => !v.elsewhere).map((v) => v.id))
  const list = cards.filter((id) => state.live[id] && !shown.has(id))
  if (!list.length) return null
  const newestFirst = [...list].reverse()
  const visible = open ? newestFirst : newestFirst.slice(0, 1)
  return (
    <div
      className={cx('media-cards', open && 'open')}
      data-behind={open ? 0 : Math.min(2, list.length - 1)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {visible.map((id) => (
        <MediaCard key={id} id={id} state={state} video={videos.includes(id)} expanded={open} />
      ))}
    </div>
  )
}

function MediaCard({ id, state, video, expanded }: { id: ID; state: AppState; video: boolean; expanded: boolean }) {
  const live = state.live[id]
  const op = (o: 'back' | 'toggle' | 'float' | 'dismiss') => (e: MouseEvent) => {
    e.stopPropagation()
    dispatch({ type: 'media', id, op: o })
  }
  return (
    <div className="media-card" title={live.title}>
      {expanded && (
        <div className="media-card-title">
          <span>{live.title || displayHost(live.url)}</span>
          {video && (
            <button className="icon-btn" onClick={op('float')} title="Float the Video">
              <Icon name="pip" size={14} />
            </button>
          )}
          <button className="icon-btn" onClick={op('dismiss')} title="Close (pauses it)">
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
      <div className="media-card-controls">
        <button className="icon-btn media-card-site" onClick={op('back')} title="Back to Tab">
          <Favicon url={live.url} favicon={live.favicon} />
        </button>
        <button className="icon-btn" onClick={op('toggle')} title={live.playing ? 'Pause' : 'Play'}>
          <Icon name={live.playing ? 'pause' : 'play'} size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={(e) => {
            e.stopPropagation()
            dispatch({ type: 'mute', id })
          }}
          title={live.muted ? 'Unmute Tab' : 'Mute Tab'}
        >
          <Icon name={live.muted ? 'muted' : 'speaker'} size={15} />
        </button>
      </div>
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

function findTab(state: AppState, space: Space, id: ID): TabItem | undefined {
  return spaceItems(state, space).find((t) => t.id === id)
}

function ResizeHandle({ width, right }: { width: number; right: boolean }) {
  const drag = useRef<{ startX: number; width: number } | undefined>(undefined)
  return (
    <div
      className="sidebar-resize"
      style={right ? { left: 0 } : { right: 0 }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { startX: e.clientX, width }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const delta = right ? d.startX - e.clientX : e.clientX - d.startX
        const next = Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, d.width + delta)))
        if (next !== width) dispatch({ type: 'settings', patch: { sidebarWidth: next } })
      }}
      onPointerUp={() => (drag.current = undefined)}
    />
  )
}

function TopBar({ state }: { state: AppState }) {
  const space = activeSpace(state)
  const live = state.peek ?? (space.activeItemId ? state.live[space.activeItemId] : undefined)
  return (
    <div className="topbar">
      <button className="icon-btn" title={`Toggle sidebar (${isMac ? '⌘S' : 'Ctrl+S'})`} onClick={() => dispatch({ type: 'toggleSidebar' })}>
        <Icon name="sidebar" />
      </button>
      <div className="spacer" />
      <button className="icon-btn" disabled={!live?.canGoBack} onClick={() => dispatch({ type: 'back' })} title="Back">
        <Icon name="back" />
      </button>
      <button className="icon-btn" disabled={!live?.canGoForward} onClick={() => dispatch({ type: 'forward' })} title="Forward">
        <Icon name="forward" />
      </button>
      <button
        className="icon-btn"
        disabled={!live}
        onClick={(e) => dispatch(live?.loading ? { type: 'stop' } : { type: 'reload', hard: e.shiftKey })}
        title={live?.loading ? 'Stop' : 'Reload'}
      >
        <Icon name={live?.loading ? 'x' : 'reload'} />
      </button>
    </div>
  )
}

function FavoriteTile({ item, index, ctx, onDrop }: { item: TabItem; index: number; ctx: Ctx; onDrop: (e: DragEvent, to: DropTarget) => void }) {
  const { state, space, hint, setHint } = ctx
  const active = space.activeItemId === item.id
  const live = state.live[item.id]
  const h = hint && 'id' in hint && hint.id === item.id ? hint.pos : undefined
  return (
    <div
      className={cx('favorite', active && 'active', live && 'live', h && 'drop-into')}
      title={itemTitle(state, item)}
      draggable
      onDragStart={(e) => startDrag(e, item.id)}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        setHint({ id: item.id, pos: e.clientX < r.left + r.width / 2 ? 'before' : 'after' })
      }}
      onDrop={(e) => onDrop(e, { section: 'favorites', index: h === 'after' ? index + 1 : index })}
      onClick={() => dispatch({ type: 'activate', id: item.id })}
      onAuxClick={(e) => e.button === 1 && dispatch({ type: 'close', id: item.id })}
      onContextMenu={() => dispatch({ type: 'itemMenu', id: item.id })}
    >
      <Favicon url={item.url} favicon={live?.favicon ?? item.favicon} />
    </div>
  )
}

function PinnedList({ nodes, ctx, onDrop, folderId }: { nodes: PinnedNode[]; ctx: Ctx; onDrop: (e: DragEvent, to: DropTarget) => void; folderId?: ID }) {
  return <SidebarList list={nodes} ctx={ctx} section="pinned" folderId={folderId} onDrop={onDrop} />
}

/** `rows`: each split's first tab in this list → its tabs here; `hidden`: the others, drawn in that row. */
function splitRows(space: Space, list: { id: ID }[]): { rows: Map<ID, ID[]>; hidden: Set<ID> } {
  const rows = new Map<ID, ID[]>()
  const hidden = new Set<ID>()
  const inList = new Set(list.map((x) => x.id))
  for (const sp of space.splits) {
    const ids = paneIds(sp.root).filter((id) => inList.has(id))
    if (ids.length < 2) continue
    const first = list.find((x) => ids.includes(x.id))!.id
    rows.set(first, ids)
    for (const id of ids) if (id !== first) hidden.add(id)
  }
  return { rows, hidden }
}

function SidebarList({
  list,
  ctx,
  section,
  folderId,
  onDrop
}: {
  list: (PinnedNode | TabItem)[]
  ctx: Ctx
  section: 'pinned' | 'today'
  folderId?: ID
  onDrop: (e: DragEvent, to: DropTarget) => void
}) {
  const { rows, hidden } = splitRows(ctx.space, list)
  return (
    <>
      {list.map((n, i) => {
        if ('kind' in n && n.kind === 'folder') return <FolderRow key={n.id} node={n} ctx={ctx} index={i} parentId={folderId} onDrop={onDrop} />
        if (hidden.has(n.id)) return null
        const ids = rows.get(n.id)
        if (!ids) return <TabRow key={n.id} item={n} ctx={ctx} section={section} folderId={folderId} index={i} onDrop={onDrop} />
        const last = Math.max(...ids.map((id) => list.findIndex((x) => x.id === id)))
        return <SplitRow key={`split-${n.id}`} ids={ids} ctx={ctx} section={section} folderId={folderId} index={i} after={last + 1} onDrop={onDrop} />
      })}
    </>
  )
}

function useRowDrop(ctx: Ctx, id: ID, middle: 'into' | 'split' | undefined) {
  const { hint, setHint } = ctx
  const pos = hint && 'id' in hint && hint.id === id ? hint.pos : undefined
  const canSplit = middle === 'split' && !!ctx.dragTab && ctx.dragTab.id !== id
  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - r.top
    let next: RowDrop = y < r.height / 2 ? 'before' : 'after'
    if (middle === 'into' && y > r.height * 0.3 && y < r.height * 0.7) next = 'into'
    if (canSplit && y > r.height * 0.25 && y < r.height * 0.75) next = e.clientX < r.left + r.width / 2 ? 'split-left' : 'split-right'
    if (pos !== next) setHint({ id, pos: next })
  }
  return { pos, onDragOver, cls: pos && DROP_CLASS[pos] }
}

function SplitPreview({ state, items, target, dragged, side }: { state: AppState; items: TabItem[]; target: ID; dragged: TabItem; side: 'left' | 'right' }) {
  const shown = items.filter((x) => x.id !== dragged.id)
  const at = shown.findIndex((x) => x.id === target) + (side === 'right' ? 1 : 0)
  shown.splice(at, 0, dragged)
  return (
    <span className="split-preview">
      {shown.map((item, i) => (
        <span key={item.id} className="half-wrap">
          {i > 0 ? <span className="split-divider" /> : null}
          <span className={cx('half', item === dragged && 'incoming')}>
            <Favicon url={item.url} favicon={state.live[item.id]?.favicon ?? item.favicon} />
            <span className="title">{itemTitle(state, item)}</span>
          </span>
        </span>
      ))}
    </span>
  )
}

function SplitRow({
  ids,
  ctx,
  section,
  folderId,
  index,
  after,
  onDrop
}: {
  ids: ID[]
  ctx: Ctx
  section: 'pinned' | 'today'
  folderId?: ID
  index: number
  after: number
  onDrop: (e: DragEvent, to: DropTarget) => void
}) {
  const { state, space, hint, setHint, dragTab } = ctx
  const items = ids.map((id) => findTab(state, space, id)).filter((x): x is TabItem => !!x)
  const key = ids[0]
  const h = hint && 'id' in hint && hint.id === key ? hint : undefined
  const active = ids.includes(space.activeItemId ?? '')
  const canSplit = !!dragTab && (ids.includes(dragTab.id) || ids.length < MAX_PANES)
  const splitting = (h?.pos === 'split-left' || h?.pos === 'split-right') && h.target && dragTab
  const reordering = h?.pos === 'before' || h?.pos === 'after'

  return (
    <div
      className={cx('row split-row', active && 'active', (reordering || splitting) && h && DROP_CLASS[h.pos])}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        const y = e.clientY - r.top
        let next: DropHint = { id: key, pos: y < r.height / 2 ? 'before' : 'after' }
        if (canSplit && y > r.height * 0.25 && y < r.height * 0.75) {
          const halfWidth = r.width / items.length
          const half = Math.min(items.length - 1, Math.max(0, Math.floor((e.clientX - r.left) / halfWidth)))
          const left = e.clientX < r.left + halfWidth * half + halfWidth / 2
          if (items[half].id !== dragTab?.id) next = { id: key, pos: left ? 'split-left' : 'split-right', target: items[half].id }
        }
        if (!h || h.pos !== next.pos || h.target !== ('target' in next ? next.target : undefined)) setHint(next)
      }}
      onDrop={(e) => {
        if (splitting && h?.target && dragTab) {
          e.preventDefault()
          e.stopPropagation()
          setHint(undefined)
          dispatch({ type: 'placeInSplit', id: dragTab.id, target: h.target, side: h.pos === 'split-left' ? 'left' : 'right' })
          return
        }
        const at = h?.pos === 'after' ? after : index
        onDrop(e, section === 'pinned' ? { section, folderId, index: at } : { section, index: at })
      }}
    >
      {items.map((item, i) => {
        const live = state.live[item.id]
        return (
          <span key={item.id} className="half-wrap">
            {i > 0 ? <span className="split-divider" /> : null}
            <span
              className={cx('half', space.activeItemId === item.id && 'focused', !live && 'unloaded')}
              draggable
              title={live?.url ?? item.url}
              onDragStart={(e) => startDrag(e, item.id)}
              onClick={() => dispatch({ type: 'activate', id: item.id })}
              onAuxClick={(e) => e.button === 1 && dispatch({ type: 'close', id: item.id })}
              onContextMenu={() => dispatch({ type: 'itemMenu', id: item.id })}
            >
              <Favicon url={item.url} favicon={live?.favicon ?? item.favicon} />
              <span className="title">{itemTitle(state, item)}</span>
            </span>
          </span>
        )
      })}
      {splitting && h?.target && dragTab ? (
        <SplitPreview state={state} items={items} target={h.target} dragged={dragTab} side={h.pos === 'split-left' ? 'left' : 'right'} />
      ) : null}
    </div>
  )
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (value: string | undefined) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
    // Take the keyboard from the page; losing it afterwards ends the rename like a click elsewhere.
    let stopListening: (() => void) | undefined
    let mounted = true
    void arc.focus().then(() => {
      if (mounted) stopListening = arc.onBlur(() => ref.current?.blur())
    })
    return () => {
      mounted = false
      stopListening?.()
    }
  }, [])
  const finish = (value: string | undefined) => onDone(value === initial ? undefined : value)
  return (
    <input
      ref={ref}
      className="rename"
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(undefined)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  )
}

function FolderRow({
  node,
  ctx,
  index,
  parentId,
  onDrop
}: {
  node: Extract<PinnedNode, { kind: 'folder' }>
  ctx: Ctx
  index: number
  parentId?: ID
  onDrop: (e: DragEvent, to: DropTarget) => void
}) {
  const { pos, onDragOver, cls } = useRowDrop(ctx, node.id, 'into')
  const editing = ctx.edit?.kind === 'renameFolder' && ctx.edit.id === node.id
  return (
    <>
      <div
        className={cx('row folder', node.open && 'open', cls)}
        draggable={!editing}
        onDragStart={(e) => startDrag(e, node.id)}
        onDragOver={onDragOver}
        onDrop={(e) =>
          onDrop(e, pos === 'into' ? { section: 'pinned', folderId: node.id, index: node.children.length } : { section: 'pinned', folderId: parentId, index: pos === 'after' ? index + 1 : index })
        }
        onClick={() => dispatch({ type: 'toggleFolder', id: node.id })}
        onDoubleClick={() => ctx.setEdit({ kind: 'renameFolder', id: node.id })}
        onContextMenu={() => dispatch({ type: 'folderMenu', id: node.id })}
      >
        <Icon name="folder" size={16} />
        {editing ? (
          <RenameInput
            initial={node.name}
            onDone={(v) => {
              ctx.setEdit(undefined)
              if (v !== undefined) dispatch({ type: 'renameFolder', id: node.id, name: v })
            }}
          />
        ) : (
          <span className="title">{node.name}</span>
        )}
      </div>
      {node.open && node.children.length > 0 ? (
        <div className="children">
          <PinnedList nodes={node.children} ctx={ctx} onDrop={onDrop} folderId={node.id} />
        </div>
      ) : null}
    </>
  )
}

function TabRow({
  item,
  ctx,
  section,
  folderId,
  index,
  onDrop
}: {
  item: TabItem
  ctx: Ctx
  section: 'pinned' | 'today'
  folderId?: ID
  index: number
  onDrop: (e: DragEvent, to: DropTarget) => void
}) {
  const { state, space } = ctx
  const live = state.live[item.id]
  const active = space.activeItemId === item.id
  const inSplit = space.splits.some((sp) => {
    const ids = paneIds(sp.root)
    return ids.includes(item.id) && ids.includes(space.activeItemId ?? '')
  })
  const away = section === 'pinned' && isAwayFromSaved(item, live?.url)
  const { pos, onDragOver, cls } = useRowDrop(ctx, item.id, 'split')
  const editing = ctx.edit?.kind === 'rename' && ctx.edit.id === item.id
  const title = itemTitle(state, item)

  let status: ReactNode = null
  if (live?.loading && !live.audible) status = <span className="spinner" />
  else if (live?.audible || live?.muted)
    status = (
      <button
        className="icon-btn audio"
        onClick={(e) => {
          e.stopPropagation()
          dispatch({ type: 'mute', id: item.id })
        }}
        title={live.muted ? 'Unmute' : 'Mute'}
      >
        <Icon name={live.muted ? 'muted' : 'speaker'} size={14} />
      </button>
    )

  return (
    <div
      className={cx('row', active && 'active', inSplit && 'in-split', !live && 'unloaded', cls)}
      draggable={!editing}
      onDragStart={(e) => startDrag(e, item.id)}
      onDragOver={onDragOver}
      onDrop={(e) => {
        if ((pos === 'split-left' || pos === 'split-right') && ctx.dragTab) {
          e.preventDefault()
          e.stopPropagation()
          ctx.setHint(undefined)
          dispatch({ type: 'placeInSplit', id: ctx.dragTab.id, target: item.id, side: pos === 'split-left' ? 'left' : 'right' })
          return
        }
        onDrop(e, section === 'pinned' ? { section, folderId, index: pos === 'after' ? index + 1 : index } : { section, index: pos === 'after' ? index + 1 : index })
      }}
      onClick={(e: MouseEvent) => {
        // A double-click's second click starts a rename; activating again would give the page the keyboard.
        if (e.detail > 1) return
        if (e.shiftKey && !active) dispatch({ type: 'splitWith', id: item.id })
        else dispatch({ type: 'activate', id: item.id })
      }}
      onAuxClick={(e) => e.button === 1 && dispatch({ type: 'close', id: item.id })}
      onDoubleClick={() => ctx.setEdit({ kind: 'rename', id: item.id })}
      onContextMenu={() => dispatch({ type: 'itemMenu', id: item.id })}
      title={live?.url ?? item.url}
    >
      <span className={cx('favicon-wrap', away && 'away')}>
        <Favicon url={item.url} favicon={live?.favicon ?? item.favicon} />
        {away ? (
          <button
            className="reset"
            title="Back to pinned URL"
            onClick={(e) => {
              e.stopPropagation()
              dispatch({ type: 'resetToSaved', id: item.id })
            }}
          >
            <Icon name="reset" size={12} />
          </button>
        ) : null}
      </span>
      {editing ? (
        <RenameInput
          initial={title}
          onDone={(v) => {
            ctx.setEdit(undefined)
            if (v !== undefined) dispatch({ type: 'rename', id: item.id, title: v })
          }}
        />
      ) : (
        <span className="title">
          {away ? <span className="slash">/</span> : null}
          {title}
        </span>
      )}
      {status}
      {(pos === 'split-left' || pos === 'split-right') && ctx.dragTab ? (
        <SplitPreview state={state} items={[item]} target={item.id} dragged={ctx.dragTab} side={pos === 'split-left' ? 'left' : 'right'} />
      ) : null}
      <button
        className="icon-btn close"
        title={section === 'today' ? 'Close tab' : 'Close (stays pinned)'}
        onClick={(e) => {
          e.stopPropagation()
          dispatch({ type: 'close', id: item.id })
        }}
      >
        <Icon name={section === 'today' ? 'x' : 'minimize'} size={14} />
      </button>
    </div>
  )
}

function BottomBar({ ctx }: { ctx: Ctx }) {
  const { state, space, hint, setHint, dragging } = ctx
  const downloading = state.downloads.some((d) => d.state === 'progressing')
  return (
    <div className="bottombar">
      <button className="icon-btn" title="Library" onClick={() => dispatch({ type: 'overlay', mode: { kind: 'library', tab: downloading ? 'downloads' : 'archive' } })}>
        <Icon name={downloading ? 'download' : 'archive'} />
      </button>
      <div className="spaces">
        {state.spaces.map((s) => {
          const over = dragging && hint && 'section' in hint && hint.section === `space:${s.id}`
          return (
            <button
              key={s.id}
              className={cx('space-dot', s.id === space.id && 'active', over && 'drop-into')}
              title={s.name}
              onClick={() => dispatch({ type: 'switchSpace', id: s.id })}
              onContextMenu={() => dispatch({ type: 'spaceMenu', id: s.id })}
              onDragOver={(e) => {
                e.preventDefault()
                setHint({ section: `space:${s.id}` })
              }}
              onDrop={(e) => {
                e.preventDefault()
                const id = readDrag(e)
                setHint(undefined)
                if (id) dispatch({ type: 'moveToSpace', id, spaceId: s.id })
              }}
            >
              {s.emoji ? <span className="emoji">{s.emoji}</span> : <span className="dot" />}
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
