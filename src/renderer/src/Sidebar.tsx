import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import type { DropTarget } from '../../shared/actions'
import type { EditRequest } from '../../shared/ipc'
import { paneIds } from '../../shared/split'
import { isAwayFromSaved } from '../../shared/tree'
import { SIDEBAR_WIDTH, type AppState, type ID, type PinnedNode, type Space, type TabItem, type UpdateStatus } from '../../shared/types'
import { activeSpace, arc, dispatch, displayHost, isMac } from './api'
import { Favicon, Icon } from './icons'

const DRAG_TYPE = 'application/x-arc-item'

/** Where a dragged item would land: between rows, into a folder, or beside a tab as a split view. */
type RowDrop = 'before' | 'after' | 'into' | 'split-left' | 'split-right'

type DropHint = { id: string; pos: RowDrop } | { section: 'favorites' | 'pinned' | 'today' | `space:${string}` }

interface Ctx {
  state: AppState
  space: Space
  edit: EditRequest | undefined
  setEdit: (e: EditRequest | undefined) => void
  hint: DropHint | undefined
  setHint: (h: DropHint | undefined) => void
  dragging: boolean
  /** The tab being dragged, if a tab (not a folder) is. */
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
  // Like Arc, show the highlighted "New Tab" row while the command bar makes a new tab.
  useEffect(() => {
    if (state.newTabOpen) newTabRow.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [state.newTabOpen])

  const dragTab = dragId ? findTab(state, space, dragId) : undefined
  const ctx: Ctx = { state, space, edit, setEdit, hint, setHint, dragging, dragTab }
  const activeId = space.activeItemId
  // While Peek is open, the URL field shows the Peek page, like Arc.
  const live = state.peek ?? (activeId ? state.live[activeId] : undefined)
  const activeItem = activeId ? findTab(state, space, activeId) : undefined
  const url = live?.url ?? activeItem?.url ?? ''
  const favorites = profile?.favorites ?? []
  const right = state.settings.sidebarRight && !floating

  const onWheel = (e: React.WheelEvent) => {
    // Two-finger horizontal swipe switches spaces, like Arc.
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.5) return
    const now = Date.now()
    if (now - swipe.current.t > 400) swipe.current.x = 0
    swipe.current.t = now
    swipe.current.x += e.deltaX
    if (Math.abs(swipe.current.x) > 120) {
      dispatch({ type: 'switchSpaceRelative', delta: swipe.current.x > 0 ? 1 : -1 })
      swipe.current.x = 0
      swipe.current.t = now + 500
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
      className={`sidebar${floating ? ' floating' : ''}${right ? ' right' : ''}`}
      style={{ width: state.settings.sidebarWidth, [right ? 'right' : 'left']: 0 }}
      onWheel={onWheel}
      onDragStart={(e) => {
        setDragging(true)
        // The item handlers below have just set what's dragged. A tab can also go onto the page, as a split.
        const id = readDrag(e)
        setDragId(id)
        if (id && findTab(state, space, id)) dispatch({ type: 'tabDrag', id })
      }}
      onDragEnd={() => {
        // Fires however the drag ends: a drop anywhere, Escape, or a drop outside the window.
        setDragging(false)
        setDragId(undefined)
        setHint(undefined)
        dispatch({ type: 'tabDrag' })
      }}
    >
      {/* The hidden sidebar goes away once the cursor stays away from it: the main process watches (watchPeek). */}
      <ResizeHandle width={state.settings.sidebarWidth} right={right} />
      <TopBar state={state} />

      <div className="urlbar" onClick={() => void arc.dispatch({ type: 'command', id: 'editUrl' })} title={url}>
        <Icon name={!url ? 'search' : url.startsWith('https:') ? 'lock' : 'globe'} size={13} />
        <span className={`host${url ? '' : ' placeholder'}`}>{url ? displayHost(url) : 'Search or Enter URL…'}</span>
        {live && /^https?:/.test(live.url) ? (
          <button
            className={`icon-btn shield${live.shielded ? '' : ' off'}`}
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
          {state.extensions[space.profileId]?.length ? <browser-action-list partition={`persist:profile-${space.profileId}`} tab={live ? String(live.wcId) : undefined} alignment="bottom left" /> : null}
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
          className={`favorites-drop${hint && 'section' in hint && hint.section === 'favorites' ? ' drop-into' : ''}`}
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
            <div className={`row empty-hint${hint && 'section' in hint && hint.section === 'pinned' ? ' drop-into' : ''}`}>Drop here to pin</div>
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

        <div ref={newTabRow} className={`row newtab${state.newTabOpen ? ' active' : ''}`} onClick={() => dispatch({ type: 'overlay', mode: { kind: 'command', target: 'tab' } })}>
          <Icon name="plus" size={15} />
          <span className="title">New Tab</span>
        </div>

        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 40 }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDrop(e, { section: 'today', index: space.today.length })}
        >
          {space.today.map((t, i) => (
            <TabRow key={t.id} item={t} ctx={ctx} section="today" index={i} onDrop={onDrop} />
          ))}
        </div>
      </div>

      <UpdatePill update={state.update} />
      <BottomBar ctx={ctx} />
    </div>
  )
}

/**
 * Arc's sidebar update banner, as a small pill above the bottom bar: a downloaded update installs
 * on quit, and this restarts into it now. The relaunch card only opens by itself after a long wait.
 * Hiding it lasts until YARC restarts, so a newer release doesn't bring it back.
 */
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
  const profile = state.profiles.find((p) => p.id === space.profileId)
  const fav = profile?.favorites.find((f) => f.id === id)
  if (fav) return fav
  const today = space.today.find((t) => t.id === id)
  if (today) return today
  const walk = (nodes: PinnedNode[]): TabItem | undefined => {
    for (const n of nodes) {
      if (n.kind === 'tab' && n.id === id) return n
      if (n.kind === 'folder') {
        const hit = walk(n.children)
        if (hit) return hit
      }
    }
    return undefined
  }
  return walk(space.pinned)
}

/** The sidebar's inner edge: drag it to make the sidebar wider or narrower, like Arc. */
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
      className={`favorite${active ? ' active' : ''}${live ? ' live' : ''}${h ? ' drop-into' : ''}`}
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
  return (
    <>
      {nodes.map((n, i) =>
        n.kind === 'folder' ? (
          <FolderRow key={n.id} node={n} ctx={ctx} index={i} parentId={folderId} onDrop={onDrop} />
        ) : (
          <TabRow key={n.id} item={n} ctx={ctx} section="pinned" folderId={folderId} index={i} onDrop={onDrop} />
        )
      )}
    </>
  )
}

/**
 * What dropping on a row does. A folder row's middle drops into the folder. A tab row's middle
 * makes a split view with the dragged tab, on the left or right as the cursor is (Arc); its top
 * and bottom quarters reorder, like the edges of every row.
 */
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
  const cls =
    pos === 'before' ? ' drop-before' : pos === 'after' ? ' drop-after' : pos === 'into' ? ' drop-into' : pos === 'split-left' || pos === 'split-right' ? ' drop-split' : ''
  return { pos, onDragOver, cls }
}

/** Over a tab row: the row as the split it would become, the dragged tab on its side (like Arc's split rows). */
function SplitPreview({ state, target, dragged, side }: { state: AppState; target: TabItem; dragged: TabItem; side: 'left' | 'right' }) {
  const half = (item: TabItem, incoming: boolean) => (
    <span className={`half${incoming ? ' incoming' : ''}`}>
      <Favicon url={item.url} favicon={state.live[item.id]?.favicon ?? item.favicon} />
      <span className="title">{itemTitle(state, item)}</span>
    </span>
  )
  return (
    <span className="split-preview">
      {side === 'left' ? half(dragged, true) : half(target, false)}
      <span className="split-divider" />
      {side === 'left' ? half(target, false) : half(dragged, true)}
    </span>
  )
}

/** Inline rename. Enter or leaving the field saves; Escape, or no change, keeps the title as it was. */
function RenameInput({ initial, onDone }: { initial: string; onDone: (value: string | undefined) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
    // Typing must reach this field, not the page that has the keyboard. Once it's ours, losing it
    // (to a page, a tab switch, the command bar) ends the rename like a click elsewhere does.
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
        className={`row folder${node.open ? ' open' : ''}${cls}`}
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
      className={`row${active ? ' active' : ''}${inSplit ? ' in-split' : ''}${live ? '' : ' unloaded'}${cls}`}
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
        // A double-click's first click selects the tab and its second starts a rename: selecting
        // again would hand the keyboard back to the page.
        if (e.detail > 1) return
        if (e.shiftKey && !active) dispatch({ type: 'splitWith', id: item.id })
        else dispatch({ type: 'activate', id: item.id })
      }}
      onAuxClick={(e) => e.button === 1 && dispatch({ type: 'close', id: item.id })}
      onDoubleClick={() => ctx.setEdit({ kind: 'rename', id: item.id })}
      onContextMenu={() => dispatch({ type: 'itemMenu', id: item.id })}
      title={live?.url ?? item.url}
    >
      <span className={`favicon-wrap${away ? ' away' : ''}`}>
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
        <SplitPreview state={state} target={item} dragged={ctx.dragTab} side={pos === 'split-left' ? 'left' : 'right'} />
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
              className={`space-dot${s.id === space.id ? ' active' : ''}${over ? ' drop-into' : ''}`}
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
