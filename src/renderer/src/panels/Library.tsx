import { useEffect, useMemo, useRef, useState } from 'react'
import type { HistoryRow } from '../../../shared/ipc'
import type { AppState, DownloadItemInfo } from '../../../shared/types'
import { activeSpace, arc, cx, dispatch, displayHost } from '../api'
import { Favicon, Icon } from '../icons'
import { countPinned, formatBytes, groupByDay, timeLabel } from './util'
import './panels.css'

type Tab = 'archive' | 'history' | 'downloads' | 'spaces'

const TABS: { id: Tab; label: string }[] = [
  { id: 'archive', label: 'Archive' },
  { id: 'history', label: 'History' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'spaces', label: 'Spaces' }
]

const PAGE = 200

export function Library({ state, close, initialTab }: { state: AppState; close: () => void; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'archive')
  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])
  return (
    <div className="panel sheet">
      <header>
        <span>Library</span>
        <span className="spacer" />
        <button className="icon-btn" title="Close" onClick={close}>
          <Icon name="x" />
        </button>
      </header>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'archive' && <Archive state={state} />}
      {tab === 'history' && <History state={state} close={close} />}
      {tab === 'downloads' && <Downloads state={state} />}
      {tab === 'spaces' && <Spaces state={state} close={close} />}
    </div>
  )
}

function Archive({ state }: { state: AppState }) {
  const [filter, setFilter] = useState('')
  const spaces = useMemo(() => new Map(state.spaces.map((s) => [s.id, s])), [state.spaces])
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const items = state.archive
      .filter((a) => !q || a.title.toLowerCase().includes(q) || a.url.toLowerCase().includes(q))
      .sort((a, b) => b.archivedAt - a.archivedAt)
    return groupByDay(items, (a) => a.archivedAt)
  }, [state.archive, filter])
  const clear = () => {
    if (window.confirm('Clear the archive? Archived tabs from every space will be removed. This can’t be undone.')) dispatch({ type: 'archiveClear' })
  }
  return (
    <div className="body">
      <div className="toolbar">
        <input className="text-input" placeholder="Filter archived tabs" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
        <button className="btn" onClick={clear} disabled={state.archive.length === 0}>
          Clear archive
        </button>
      </div>
      {groups.length === 0 && (
        <div className="empty-state">{filter ? 'No archived tabs match.' : 'Closed and auto-archived tabs show up here.'}</div>
      )}
      {groups.map((g) => (
        <div key={g.key}>
          <div className="day-label">{g.label}</div>
          {g.items.map((a) => {
            const sp = spaces.get(a.spaceId)
            return (
              <div key={a.id} className="list-row click" title={a.url} onClick={() => dispatch({ type: 'archiveRestore', id: a.id })}>
                <Favicon url={a.url} favicon={a.favicon} />
                <span className="t">
                  {a.title || a.url}
                  <small>{displayHost(a.url)}</small>
                </span>
                {sp && state.spaces.length > 1 && <span className="s">{sp.emoji ?? sp.name}</span>}
                <span className="s">{timeLabel(a.archivedAt)}</span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function History({ state, close }: { state: AppState; close: () => void }) {
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const req = useRef(0)
  const space = activeSpace(state)
  const profile = state.profiles.find((p) => p.id === space.profileId)

  const loadAtLeast = async (q: string, count: number) => {
    const id = ++req.current
    setLoading(true)
    const out: HistoryRow[] = []
    let last = PAGE
    while (out.length < count && last === PAGE) {
      const page = await arc.history(q, out.length)
      if (id !== req.current) return
      out.push(...page)
      last = page.length
    }
    setRows(out)
    setMore(last === PAGE)
    setLoading(false)
  }

  useEffect(() => {
    const t = setTimeout(() => void loadAtLeast(query, PAGE), 150)
    return () => clearTimeout(t)
  }, [query, space.profileId])

  const loadMore = async () => {
    const id = ++req.current
    setLoading(true)
    const page = await arc.history(query, rows.length)
    if (id !== req.current) return
    setRows((r) => [...r, ...page])
    setMore(page.length === PAGE)
    setLoading(false)
  }

  const remove = async (url: string) => {
    setRows((r) => r.filter((x) => x.url !== url))
    await arc.deleteHistory(url)
    await loadAtLeast(query, Math.max(PAGE, rows.length))
  }

  const groups = useMemo(() => groupByDay(rows, (r) => r.time), [rows])

  return (
    <div className="body">
      <div className="toolbar">
        <input className="text-input" placeholder="Search history" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </div>
      <p className="note muted" style={{ margin: '0 0 4px' }}>
        History of the <strong>{profile?.name ?? 'current'}</strong> profile, used by the active space.
      </p>
      {!loading && rows.length === 0 && <div className="empty-state">{query ? 'Nothing in history matches.' : 'No history yet.'}</div>}
      {groups.map((g) => (
        <div key={g.key}>
          <div className="day-label">{g.label}</div>
          {g.items.map((r, i) => (
            <div
              key={`${r.url}-${r.time}-${i}`}
              className="list-row click"
              title={r.url}
              onClick={() => {
                dispatch({ type: 'open', url: r.url, where: 'tab' })
                close()
              }}
            >
              <Favicon url={r.url} />
              <span className="t">
                {r.title || r.url}
                <small>{displayHost(r.url)}</small>
              </span>
              <span className="s">{timeLabel(r.time)}</span>
              <button
                className="icon-btn hover-x"
                title="Remove from history"
                onClick={(e) => {
                  e.stopPropagation()
                  void remove(r.url)
                }}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      ))}
      {more && (
        <div className="load-more">
          <button className="btn" disabled={loading} onClick={() => void loadMore()}>
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}

function dlStatus(d: DownloadItemInfo): string {
  switch (d.state) {
    case 'progressing':
      return d.total > 0 ? `${formatBytes(d.received)} of ${formatBytes(d.total)}` : formatBytes(d.received)
    case 'completed':
      return formatBytes(d.total || d.received)
    case 'cancelled':
      return 'Cancelled'
    case 'interrupted':
      return 'Failed'
  }
}

function Downloads({ state }: { state: AppState }) {
  const items = useMemo(() => [...state.downloads].sort((a, b) => b.startedAt - a.startedAt), [state.downloads])
  const anyDone = items.some((d) => d.state !== 'progressing')
  return (
    <div className="body">
      <div className="toolbar">
        <span className="muted" style={{ flex: 1 }}>
          Downloads from this session
        </span>
        <button className="btn" disabled={!anyDone} onClick={() => dispatch({ type: 'downloadsClear' })}>
          Clear
        </button>
      </div>
      {items.length === 0 && <div className="empty-state">No downloads yet.</div>}
      {items.map((d) => {
        const done = d.state === 'completed'
        const pct = d.total > 0 ? Math.min(100, (d.received / d.total) * 100) : 0
        return (
          <div
            key={d.id}
            className={cx('list-row', done && 'click')}
            title={d.path || d.url}
            draggable={done}
            onDragStart={(e) => {
              e.preventDefault()
              arc.dragDownload(d.id)
            }}
            onClick={() => done && dispatch({ type: 'downloadOpen', id: d.id })}
          >
            <Icon name="download" />
            <div className="dl-main">
              <span className="t">{d.filename}</span>
              {d.state === 'progressing' && (
                <div className={cx('progress', d.total <= 0 && 'indeterminate')}>
                  <div style={d.total > 0 ? { width: `${pct}%` } : undefined} />
                </div>
              )}
            </div>
            <span className="s">{dlStatus(d)}</span>
            {done && (
              <button
                className="btn small"
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'downloadOpen', id: d.id, reveal: true })
                }}
              >
                Show in folder
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Spaces({ state, close }: { state: AppState; close: () => void }) {
  const profiles = useMemo(() => new Map(state.profiles.map((p) => [p.id, p.name])), [state.profiles])
  return (
    <div className="body">
      <div className="toolbar">
        <span className="muted" style={{ flex: 1 }}>
          {state.spaces.length} {state.spaces.length === 1 ? 'space' : 'spaces'}
        </span>
        <button className="btn" onClick={() => dispatch({ type: 'overlay', mode: { kind: 'space-editor' } })}>
          New space
        </button>
      </div>
      {state.spaces.map((s) => {
        const pinned = countPinned(s.pinned)
        return (
          <div
            key={s.id}
            className={cx('list-row click', s.id === state.activeSpaceId && 'current')}
            onClick={() => {
              dispatch({ type: 'switchSpace', id: s.id })
              close()
            }}
          >
            <span className="space-emoji" style={{ background: `color-mix(in oklab, ${s.color} 22%, transparent)` }}>
              {s.emoji ? s.emoji : <span className="dot" style={{ background: s.color }} />}
            </span>
            <span className="t">
              {s.name}
              <small>{profiles.get(s.profileId) ?? 'Unknown profile'}</small>
            </span>
            <span className="s">
              {pinned} pinned · {s.today.length} today
            </span>
            <span className="swatch" style={{ background: s.color }} title={s.color} />
            <button
              className="btn small"
              onClick={(e) => {
                e.stopPropagation()
                dispatch({ type: 'overlay', mode: { kind: 'space-editor', spaceId: s.id } })
              }}
            >
              Edit
            </button>
          </div>
        )
      })}
    </div>
  )
}
