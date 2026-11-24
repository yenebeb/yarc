import { useEffect, useRef, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import type { DropTarget } from '../../shared/actions'
import type { EditRequest } from '../../shared/ipc'
import { MAX_PANES, paneIds, splitRows } from '../../shared/split'
import { isAwayFromSaved, spaceItems, tabTitle } from '../../shared/tree'
import type { AppState, ID, PinnedCanvas, PinnedNode, Space, TabItem } from '../../shared/types'
import { arc, cx, dispatch, displayHost } from './api'
import { Favicon, Icon } from './icons'

const DRAG_TYPE = 'application/x-arc-item'

type RowDrop = 'before' | 'after' | 'into' | 'split-left' | 'split-right'

const DROP_CLASS: Record<RowDrop, string> = { before: 'drop-before', after: 'drop-after', into: 'drop-into', 'split-left': 'drop-split', 'split-right': 'drop-split' }

export type DropHint = { id: string; pos: RowDrop; beside?: ID } | { section: 'favorites' | 'pinned' | 'today' | `space:${string}` }

type OnDrop = (event: DragEvent, to: DropTarget) => void

export interface Ctx {
  state: AppState
  space: Space
  edit: EditRequest | undefined
  setEdit: (edit: EditRequest | undefined) => void
  hint: DropHint | undefined
  setHint: (hint: DropHint | undefined) => void
  dragging: boolean
  dragTab: TabItem | undefined
}

function itemTitle(state: AppState, item: TabItem): string {
  return tabTitle(item, state.live[item.id]?.title) || displayHost(item.url)
}

export function readDrag(event: DragEvent): string | undefined {
  return event.dataTransfer.getData(DRAG_TYPE) || undefined
}

function startDrag(event: DragEvent, id: string): void {
  event.dataTransfer.setData(DRAG_TYPE, id)
  event.dataTransfer.effectAllowed = 'move'
}

export function findTab(state: AppState, space: Space, id: ID): TabItem | undefined {
  return spaceItems(state, space).find((tab) => tab.id === id)
}

export function FavoriteTile({ item, index, ctx, onDrop }: { item: TabItem; index: number; ctx: Ctx; onDrop: OnDrop }) {
  const { state, space, hint, setHint } = ctx
  const active = space.activeItemId === item.id
  const live = state.live[item.id]
  const dropPos = hint && 'id' in hint && hint.id === item.id ? hint.pos : undefined
  return (
    <div
      className={cx('favorite', active && 'active', live && 'live', dropPos && 'drop-into')}
      title={itemTitle(state, item)}
      draggable
      onDragStart={(event) => startDrag(event, item.id)}
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        setHint({ id: item.id, pos: event.clientX < rect.left + rect.width / 2 ? 'before' : 'after' })
      }}
      onDrop={(event) => onDrop(event, { section: 'favorites', index: dropPos === 'after' ? index + 1 : index })}
      onClick={() => dispatch({ type: 'activate', id: item.id })}
      onAuxClick={(event) => event.button === 1 && dispatch({ type: 'close', id: item.id })}
      onContextMenu={() => dispatch({ type: 'itemMenu', id: item.id })}
    >
      <Favicon url={item.url} favicon={live?.favicon ?? item.favicon} />
    </div>
  )
}

export function PinnedList({ nodes, ctx, onDrop, folderId }: { nodes: PinnedNode[]; ctx: Ctx; onDrop: OnDrop; folderId?: ID }) {
  return <SidebarList list={nodes} ctx={ctx} section="pinned" folderId={folderId} onDrop={onDrop} />
}

export function SidebarList({ list, ctx, section, folderId, onDrop }: { list: (PinnedNode | TabItem)[]; ctx: Ctx; section: 'pinned' | 'today'; folderId?: ID; onDrop: OnDrop }) {
  const { rows, hidden } = splitRows(ctx.space.splits, list)
  return (
    <>
      {list.map((node, index) => {
        if ('kind' in node && node.kind === 'folder') return <FolderRow key={node.id} node={node} ctx={ctx} index={index} parentId={folderId} onDrop={onDrop} />
        if ('kind' in node && node.kind === 'canvas') return <CanvasRow key={node.id} node={node} ctx={ctx} index={index} folderId={folderId} onDrop={onDrop} />
        if (hidden.has(node.id)) return null
        const ids = rows.get(node.id)
        if (!ids) return <TabRow key={node.id} item={node} ctx={ctx} section={section} folderId={folderId} index={index} onDrop={onDrop} />
        const last = Math.max(...ids.map((id) => list.findIndex((listed) => listed.id === id)))
        return <SplitRow key={`split-${node.id}`} ids={ids} ctx={ctx} section={section} folderId={folderId} index={index} after={last + 1} onDrop={onDrop} />
      })}
    </>
  )
}

function useRowDrop(ctx: Ctx, id: ID, middle: 'into' | 'split' | undefined) {
  const { hint, setHint } = ctx
  const pos = hint && 'id' in hint && hint.id === id ? hint.pos : undefined
  const canSplit = middle === 'split' && !!ctx.dragTab && ctx.dragTab.id !== id
  const onDragOver = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const offsetY = event.clientY - rect.top
    let next: RowDrop = offsetY < rect.height / 2 ? 'before' : 'after'
    if (middle === 'into' && offsetY > rect.height * 0.3 && offsetY < rect.height * 0.7) next = 'into'
    if (canSplit && offsetY > rect.height * 0.25 && offsetY < rect.height * 0.75) next = event.clientX < rect.left + rect.width / 2 ? 'split-left' : 'split-right'
    if (pos !== next) setHint({ id, pos: next })
  }
  return { pos, onDragOver, cls: pos && DROP_CLASS[pos] }
}

function SplitPreview({ state, items, beside, dragged, side }: { state: AppState; items: TabItem[]; beside: ID; dragged: TabItem; side: 'left' | 'right' }) {
  const shown = items.filter((item) => item.id !== dragged.id)
  const at = shown.findIndex((item) => item.id === beside) + (side === 'right' ? 1 : 0)
  shown.splice(at, 0, dragged)
  return (
    <span className="split-preview">
      {shown.map((item, index) => (
        <span key={item.id} className="half-wrap">
          {index > 0 ? <span className="split-divider" /> : null}
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
  onDrop: OnDrop
}) {
  const { state, space, hint, setHint, dragTab } = ctx
  const items = ids.map((id) => findTab(state, space, id)).filter((item): item is TabItem => !!item)
  const key = ids[0]
  const rowHint = hint && 'id' in hint && hint.id === key ? hint : undefined
  const active = ids.includes(space.activeItemId ?? '')
  const canSplit = !!dragTab && (ids.includes(dragTab.id) || ids.length < MAX_PANES)
  const splitting = (rowHint?.pos === 'split-left' || rowHint?.pos === 'split-right') && rowHint.beside && dragTab
  const reordering = rowHint?.pos === 'before' || rowHint?.pos === 'after'

  return (
    <div
      className={cx('row split-row', active && 'active', (reordering || splitting) && rowHint && DROP_CLASS[rowHint.pos])}
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        const offsetY = event.clientY - rect.top
        let next: DropHint = { id: key, pos: offsetY < rect.height / 2 ? 'before' : 'after' }
        if (canSplit && offsetY > rect.height * 0.25 && offsetY < rect.height * 0.75) {
          const halfWidth = rect.width / items.length
          const half = Math.min(items.length - 1, Math.max(0, Math.floor((event.clientX - rect.left) / halfWidth)))
          const left = event.clientX < rect.left + halfWidth * half + halfWidth / 2
          if (items[half].id !== dragTab?.id) next = { id: key, pos: left ? 'split-left' : 'split-right', beside: items[half].id }
        }
        if (!rowHint || rowHint.pos !== next.pos || rowHint.beside !== ('beside' in next ? next.beside : undefined)) setHint(next)
      }}
      onDrop={(event) => {
        if (splitting && rowHint?.beside && dragTab) {
          event.preventDefault()
          event.stopPropagation()
          setHint(undefined)
          dispatch({ type: 'placeInSplit', id: dragTab.id, target: rowHint.beside, side: rowHint.pos === 'split-left' ? 'left' : 'right' })
          return
        }
        const at = rowHint?.pos === 'after' ? after : index
        onDrop(event, section === 'pinned' ? { section, folderId, index: at } : { section, index: at })
      }}
    >
      {items.map((item, itemIndex) => {
        const live = state.live[item.id]
        return (
          <span key={item.id} className="half-wrap">
            {itemIndex > 0 ? <span className="split-divider" /> : null}
            <span
              className={cx('half', space.activeItemId === item.id && 'focused', !live && 'unloaded')}
              draggable
              title={live?.url ?? item.url}
              onDragStart={(event) => startDrag(event, item.id)}
              onClick={() => dispatch({ type: 'activate', id: item.id })}
              onAuxClick={(event) => event.button === 1 && dispatch({ type: 'close', id: item.id })}
              onContextMenu={() => dispatch({ type: 'itemMenu', id: item.id })}
            >
              <Favicon url={item.url} favicon={live?.favicon ?? item.favicon} />
              <span className="title">{itemTitle(state, item)}</span>
            </span>
          </span>
        )
      })}
      {splitting && rowHint?.beside && dragTab ? (
        <SplitPreview state={state} items={items} beside={rowHint.beside} dragged={dragTab} side={rowHint.pos === 'split-left' ? 'left' : 'right'} />
      ) : null}
    </div>
  )
}

function takeKeyboardFromPage(onLost: () => void): () => void {
  let stopListening: (() => void) | undefined
  let mounted = true
  void arc.focus().then(() => {
    if (mounted) stopListening = arc.onBlur(onLost)
  })
  return () => {
    mounted = false
    stopListening?.()
  }
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (value: string | undefined) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
    return takeKeyboardFromPage(() => ref.current?.blur())
  }, [])
  const finish = (value: string | undefined) => onDone(value === initial ? undefined : value)
  return (
    <input
      ref={ref}
      className="rename"
      defaultValue={initial}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(event.currentTarget.value)
        if (event.key === 'Escape') finish(undefined)
      }}
      onBlur={(event) => finish(event.currentTarget.value)}
    />
  )
}

function FolderRow({ node, ctx, index, parentId, onDrop }: { node: Extract<PinnedNode, { kind: 'folder' }>; ctx: Ctx; index: number; parentId?: ID; onDrop: OnDrop }) {
  const { pos, onDragOver, cls } = useRowDrop(ctx, node.id, 'into')
  const editing = ctx.edit?.kind === 'renameFolder' && ctx.edit.id === node.id
  return (
    <>
      <div
        className={cx('row folder', node.open && 'open', cls)}
        draggable={!editing}
        onDragStart={(event) => startDrag(event, node.id)}
        onDragOver={onDragOver}
        onDrop={(event) =>
          onDrop(event, pos === 'into' ? { section: 'pinned', folderId: node.id, index: node.children.length } : { section: 'pinned', folderId: parentId, index: pos === 'after' ? index + 1 : index })
        }
        onClick={() => dispatch({ type: 'toggleFolder', id: node.id })}
        onDoubleClick={() => ctx.setEdit({ kind: 'renameFolder', id: node.id })}
        onContextMenu={() => dispatch({ type: 'folderMenu', id: node.id })}
      >
        <Icon name={node.live ? 'liveFolder' : 'folder'} size={16} />
        {editing ? (
          <RenameInput
            initial={node.name}
            onDone={(name) => {
              ctx.setEdit(undefined)
              if (name !== undefined) dispatch({ type: 'renameFolder', id: node.id, name })
            }}
          />
        ) : (
          <span className="title">{node.name}</span>
        )}
      </div>
      {node.open && (node.children.length > 0 || node.live) ? (
        <div className="children">
          <PinnedList nodes={node.children} ctx={ctx} onDrop={onDrop} folderId={node.id} />
          {node.live && (node.liveError || !node.children.length) ? (
            <div className={cx('live-note', node.liveError && 'error')} onClick={() => dispatch({ type: 'refreshLiveFolder', id: node.id })} title="Refresh">
              {node.liveError ?? 'Nothing here right now'}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function CanvasRow({ node, ctx, index, folderId, onDrop }: { node: PinnedCanvas; ctx: Ctx; index: number; folderId?: ID; onDrop: OnDrop }) {
  const { pos, onDragOver, cls } = useRowDrop(ctx, node.id, undefined)
  const editing = ctx.edit?.kind === 'renameCanvas' && ctx.edit.id === node.id
  const active = ctx.space.activeItemId === node.id
  return (
    <div
      className={`row canvas${active ? ' active' : ''}${cls}`}
      draggable={!editing}
      onDragStart={(event) => startDrag(event, node.id)}
      onDragOver={onDragOver}
      onDrop={(event) => onDrop(event, { section: 'pinned', folderId, index: pos === 'after' ? index + 1 : index })}
      onClick={(event: MouseEvent) => {
        if (event.detail > 1) return
        dispatch({ type: 'activate', id: node.id })
      }}
      onDoubleClick={() => ctx.setEdit({ kind: 'renameCanvas', id: node.id })}
      onContextMenu={() => dispatch({ type: 'canvasMenu', id: node.id })}
    >
      <span className="favicon-wrap">
        <Icon name="canvas" size={16} />
      </span>
      {editing ? (
        <RenameInput
          initial={node.name}
          onDone={(name) => {
            ctx.setEdit(undefined)
            if (name !== undefined) dispatch({ type: 'renameCanvas', id: node.id, name })
          }}
        />
      ) : (
        <span className="title">{node.name}</span>
      )}
    </div>
  )
}

function TabRow({ item, ctx, section, folderId, index, onDrop }: { item: TabItem; ctx: Ctx; section: 'pinned' | 'today'; folderId?: ID; index: number; onDrop: OnDrop }) {
  const { state, space } = ctx
  const live = state.live[item.id]
  const active = space.activeItemId === item.id
  const inSplit = space.splits.some((split) => {
    const ids = paneIds(split.root)
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
        onClick={(event) => {
          event.stopPropagation()
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
      onDragStart={(event) => startDrag(event, item.id)}
      onDragOver={onDragOver}
      onDrop={(event) => {
        if ((pos === 'split-left' || pos === 'split-right') && ctx.dragTab) {
          event.preventDefault()
          event.stopPropagation()
          ctx.setHint(undefined)
          dispatch({ type: 'placeInSplit', id: ctx.dragTab.id, target: item.id, side: pos === 'split-left' ? 'left' : 'right' })
          return
        }
        onDrop(event, section === 'pinned' ? { section, folderId, index: pos === 'after' ? index + 1 : index } : { section, index: pos === 'after' ? index + 1 : index })
      }}
      onClick={(event: MouseEvent) => {
        // A double-click's second click starts a rename; activating again would give the page the keyboard.
        if (event.detail > 1) return
        if (event.shiftKey && !active) dispatch({ type: 'splitWith', id: item.id })
        else dispatch({ type: 'activate', id: item.id })
      }}
      onAuxClick={(event) => event.button === 1 && dispatch({ type: 'close', id: item.id })}
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
            onClick={(event) => {
              event.stopPropagation()
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
          onDone={(newTitle) => {
            ctx.setEdit(undefined)
            if (newTitle !== undefined) dispatch({ type: 'rename', id: item.id, title: newTitle })
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
        <SplitPreview state={state} items={[item]} beside={item.id} dragged={ctx.dragTab} side={pos === 'split-left' ? 'left' : 'right'} />
      ) : null}
      <button
        className="icon-btn close"
        title={section === 'today' ? 'Close tab' : 'Close (stays pinned)'}
        onClick={(event) => {
          event.stopPropagation()
          dispatch({ type: 'close', id: item.id })
        }}
      >
        <Icon name={section === 'today' ? 'x' : 'minimize'} size={14} />
      </button>
    </div>
  )
}
