import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { CaptureTo } from '../../shared/actions'
import { bindingLabel, type CommandId } from '../../shared/keymap'
import { matchSiteSearch, siteSearchUrl, type SiteSearch } from '../../shared/site-search'
import { MAX_PANES, paneIds, placePane, previewRect, sideAt, type Side } from '../../shared/split'
import { isFloating } from '../../shared/tour'
import { findItem, spaceCanvases } from '../../shared/tree'
import type { AppState, ID, OverlayMode, Rect, SearchResult } from '../../shared/types'
import { activeSpace, arc, cx, dispatch, displayHost, isMac, useAppState, useOverlayMode, useSpaceTheme } from './api'
import { Favicon, Icon, type IconName } from './icons'
import { Tour, UpdateReady, WhatsNew } from './panels/Intro'
import { Library } from './panels/Library'
import { Settings } from './panels/Settings'
import { SharePicker } from './panels/SharePicker'
import { SpaceEditor } from './panels/SpaceEditor'
import { Sidebar } from './Sidebar'
import './styles.css'

const close = () => dispatch({ type: 'overlay', mode: { kind: 'none' } })
const endTour = () => dispatch({ type: 'endTour' })

function App() {
  const state = useAppState()
  const mode = useOverlayMode()
  const space = state ? activeSpace(state) : undefined
  // Only the revealed sidebar takes the space's appearance; the command bar and panels follow the system.
  useSpaceTheme(space, mode.kind === 'sidebar' ? space?.appearance : undefined)
  // Remount panels each time they open so inputs start fresh.
  const [generation, setGeneration] = useState(0)
  const last = useRef<OverlayMode['kind']>('none')
  useEffect(() => {
    if (mode.kind !== last.current) setGeneration((g) => g + 1)
    last.current = mode.kind
  }, [mode])

  if (!state || mode.kind === 'none') return null
  const key = `${mode.kind}-${generation}`
  switch (mode.kind) {
    case 'sidebar':
      return (
        <div className={cx(isMac ? 'mac' : 'win', state.fullscreen && 'fullscreen', state.settings.sidebarRight && 'sidebar-right')} style={{ height: '100%' }}>
          {/* Zones first so the sidebar stays on top: only over the page does a drag make a split. */}
          {state.tabDrag ? <SplitDropZones state={state} origin={{ x: 0, y: 0 }} /> : null}
          <Sidebar state={state} floating />
        </div>
      )
    case 'find':
      return <FindBar key={key} />
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
          <CommandBar key={key} state={state} mode={mode} />
        </>
      )
    case 'settings':
      return (
        <>
          <div className="scrim" onMouseDown={close} />
          <Settings key={key} state={state} close={close} />
        </>
      )
    case 'library':
      return (
        <>
          <div className="scrim" onMouseDown={close} />
          <Library key={`${key}-${mode.tab}`} state={state} close={close} initialTab={mode.tab} />
        </>
      )
    case 'space-editor':
      return (
        <>
          <div className="scrim" onMouseDown={close} />
          <SpaceEditor key={`${key}-${mode.spaceId}`} state={state} close={close} spaceId={mode.spaceId} />
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
      return <SplitDropZones state={state} origin={state.layout.content} />
    case 'capture':
      return <Capture key={key} state={state} page={mode.page} />
    case 'tour':
      if (isFloating(mode.step)) return <Tour state={state} step={mode.step} close={endTour} />
      return (
        <>
          <div className="scrim intro-scrim" />
          <Tour key={key} state={state} step={mode.step} close={endTour} />
        </>
      )
    case 'update':
      return (
        <>
          <div className="scrim intro-scrim" onMouseDown={close} />
          <UpdateReady key={key} update={state.update} close={close} />
        </>
      )
    case 'whats-new':
      return (
        <>
          <div className="scrim intro-scrim" onMouseDown={close} />
          <WhatsNew key={key} releases={mode.releases} spotlights={mode.spotlights} close={close} />
        </>
      )
  }
}

/** Coordinates are in the page's own pixels; `page` is where the page sits in this overlay. */
function Capture({ state, page }: { state: AppState; page: Rect }) {
  const [picked, setPicked] = useState<Rect>()
  const [drag, setDrag] = useState<{ x: number; y: number; x2: number; y2: number }>()
  const [chosen, setChosen] = useState<Rect>()
  const [whole, setWhole] = useState(false)
  const depth = useRef(0)
  const pointer = useRef({ x: 0, y: 0 })
  const asking = useRef(false)
  const current = activeSpace(state)
  const canvases = state.spaces.flatMap((space) => spaceCanvases(space).map((c) => ({ id: c.id, name: c.name, lastActive: c.lastActive, space: space.id === current?.id ? undefined : space.name })))

  const pick = () => {
    if (asking.current) return
    asking.current = true
    void arc.capturePick(pointer.current.x, pointer.current.y, depth.current).then((r) => {
      asking.current = false
      setPicked(r)
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  const local = (e: { clientX: number; clientY: number }) => ({
    x: Math.min(Math.max(e.clientX - page.x, 0), page.width),
    y: Math.min(Math.max(e.clientY - page.y, 0), page.height)
  })
  const dragRect = drag && { x: Math.min(drag.x, drag.x2), y: Math.min(drag.y, drag.y2), width: Math.abs(drag.x2 - drag.x), height: Math.abs(drag.y2 - drag.y) }
  const dragging = !!dragRect && dragRect.width + dragRect.height > 8
  const shown = chosen ?? (dragging ? dragRect : picked)

  return (
    <div
      className="capture"
      onMouseMove={(e) => {
        if (chosen) return
        const p = local(e)
        pointer.current = p
        if (drag) setDrag({ ...drag, x2: p.x, y2: p.y })
        else pick()
      }}
      onWheel={(e) => {
        if (chosen || drag) return
        depth.current = Math.max(0, depth.current + (e.deltaY > 0 ? 1 : -1))
        pick()
      }}
      onMouseDown={(e) => {
        if (chosen || e.button !== 0) return
        const p = local(e)
        setDrag({ x: p.x, y: p.y, x2: p.x, y2: p.y })
      }}
      onMouseUp={() => {
        if (chosen || !drag) return
        setDrag(undefined)
        const area = dragging ? dragRect : picked
        if (area && area.width >= 4 && area.height >= 4) setChosen(area)
      }}
    >
      <div className="capture-page" style={{ left: page.x, top: page.y, width: page.width, height: page.height }}>
        {shown ? (
          <div className={`capture-area${chosen ? ' chosen' : ''}`} style={{ left: shown.x, top: shown.y, width: shown.width, height: shown.height }} />
        ) : (
          <div className="capture-dim" />
        )}
        {chosen ? (
          <CaptureTarget area={chosen} whole={whole} page={page} canvases={canvases} onRetake={() => { setChosen(undefined); setPicked(undefined); setWhole(false) }} />
        ) : (
          <div className="capture-hint">
            <Icon name="capture" size={14} /> Click a part of the page or drag an area · scroll for a bigger part · Esc to cancel
            <button
              className="capture-whole"
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
              onClick={() => {
                setWhole(true)
                setChosen({ x: 0, y: 0, width: page.width, height: page.height })
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

function CaptureTarget({ area, whole, page, canvases, onRetake }: { area: Rect; whole: boolean; page: Rect; canvases: { id: ID; name: string; lastActive: number; space?: string }[]; onRetake: () => void }) {
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [at, setAt] = useState(0)
  const send = (to: CaptureTo) => dispatch({ type: 'capture', rect: area, to, whole })
  const words = query.trim().toLowerCase()
  const matching = canvases.filter((c) => c.name.toLowerCase().includes(words)).sort((a, b) => b.lastActive - a.lastActive)
  const RECENT = 5
  const listed = showAll || words ? matching : matching.slice(0, RECENT)
  const actions: SendChoice[] = words
    ? []
    : [
        { key: 'copy', label: 'Copy', icon: 'copy', run: () => send('copy') },
        { key: 'save', label: 'Save…', icon: 'download', run: () => send('save') },
        { key: 'retake', label: 'Retake', icon: 'capture', run: onRetake }
      ]
  const boards: SendChoice[] = [
    { key: 'new', label: 'New Canvas', icon: 'plus', run: () => send('new') },
    ...listed.map((c) => ({ key: c.id, label: c.name, detail: c.space, icon: 'canvas', run: () => send(c.id) }))
  ]
  const choices = [...actions, ...boards]
  const chosen = Math.min(at, choices.length - 1)
  const more = !showAll && !words && matching.length > RECENT

  const width = 248
  const height = 52 + 32 * choices.length + (actions.length ? 9 : 0) + (more ? 30 : 0)
  const below = area.y + area.height + 8
  const top = below + height <= page.height ? below : Math.max(8, area.y - height - 8)
  const left = Math.min(Math.max(8, area.x), Math.max(8, page.width - width - 8))

  const row = (c: SendChoice, i: number) => (
    <button key={c.key} className={i === chosen ? 'active' : ''} onMouseEnter={() => setAt(i)} onClick={c.run}>
      <Icon name={c.icon} size={14} /> <span className="name">{c.label}</span>
      {c.detail ? <span className="detail">{c.detail}</span> : null}
    </button>
  )
  return (
    <div className="capture-target" style={{ left, top, width }} onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
      <input
        autoFocus
        placeholder="Send to…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setAt(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setAt((chosen + (e.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            choices[chosen]?.run()
          }
        }}
      />
      {actions.map(row)}
      {actions.length ? <div className="capture-target-line" /> : null}
      {boards.map((c, i) => row(c, actions.length + i))}
      {more ? (
        <button className="more" onClick={() => setShowAll(true)}>
          Show All ({matching.length})
        </button>
      ) : null}
    </div>
  )
}


const distance = (r: Rect, x: number, y: number) => Math.hypot(Math.max(r.x - x, 0, x - r.x - r.width), Math.max(r.y - y, 0, y - r.y - r.height))

/** `origin`: where this overlay sits in the window, since layout rects are in window pixels. */
function SplitDropZones({ state, origin }: { state: AppState; origin: { x: number; y: number } }) {
  const [zone, setZone] = useState<{ target: ID; side: Side; rect: Rect }>()
  const dragged = state.tabDrag ? findItem(state, state.tabDrag)?.item : undefined
  const { content, views, splitId } = state.layout
  const split = splitId ? activeSpace(state).splits.find((sp) => sp.id === splitId) : undefined

  // Should the sidebar ever miss a drag end, this layer still never keeps the page's clicks.
  useEffect(() => {
    const shown = Date.now()
    const end = (e: MouseEvent) => {
      if (e.type === 'mousedown' || (e.buttons === 0 && Date.now() - shown > 300)) dispatch({ type: 'tabDrag' })
    }
    window.addEventListener('mousemove', end)
    window.addEventListener('mousedown', end)
    return () => {
      window.removeEventListener('mousemove', end)
      window.removeEventListener('mousedown', end)
    }
  }, [])

  const zoneAt = (clientX: number, clientY: number) => {
    if (!dragged || views.length === 0) return undefined
    const x = clientX + origin.x
    const y = clientY + origin.y
    // The nearest pane (bar included), so the gaps between panes don't flicker.
    const panes = views.map((v) => ({ id: v.id, rect: v.bar ? { ...v.bar, height: v.bar.height + v.rect.height } : v.rect }))
    const pane = panes.reduce((a, b) => (distance(b.rect, x, y) < distance(a.rect, x, y) ? b : a))
    const side = sideAt(pane.rect, x, y)
    const root = split && paneIds(split.root).includes(pane.id) ? split.root : undefined
    if (!placePane(root, pane.id, dragged.id, side)) return undefined
    return { target: pane.id, side, rect: previewRect(pane.rect, side) }
  }

  const full = !!split && paneIds(split.root).length >= MAX_PANES && !paneIds(split.root).includes(dragged?.id ?? '')
  return (
    <div
      className="split-drop"
      style={{ left: content.x - origin.x, top: content.y - origin.y, width: content.width, height: content.height }}
      onDragOver={(e) => {
        const next = zoneAt(e.clientX, e.clientY)
        if (next) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }
        if (next?.target !== zone?.target || next?.side !== zone?.side) setZone(next)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setZone(undefined)
      }}
      onDrop={(e) => {
        e.preventDefault()
        const z = zoneAt(e.clientX, e.clientY)
        setZone(undefined)
        if (z && dragged) dispatch({ type: 'placeInSplit', id: dragged.id, target: z.target, side: z.side })
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

const MAX_RESULTS = 5

const PLACEHOLDER = { tab: 'Search or Enter URL…', split: 'Open in split view…', current: 'Edit URL or search…' }

const completionText = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')

const KIND_ICON: Partial<Record<SearchResult['kind'], IconName>> = {
  suggestion: 'search',
  history: 'clock',
  pastSearch: 'clock',
  command: 'command',
  url: 'globe',
  archive: 'archive'
}

function CommandBar({ state, mode }: { state: AppState; mode: Extract<OverlayMode, { kind: 'command' }> }) {
  const [query, setQuery] = useState(mode.initial ?? '')
  const [local, setLocal] = useState<SearchResult[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [sel, setSel] = useState(0)
  const [suffix, setSuffix] = useState('')
  /** `typed`: what Backspace brings back. */
  const [site, setSite] = useState<{ site: SiteSearch; typed: string }>()
  const typing = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const target = mode.target ?? 'tab'

  useEffect(() => {
    input.current?.focus()
    if (mode.editCurrent) input.current?.select()
  }, [mode.editCurrent])

  useEffect(() => {
    if (site) return
    let alive = true
    void arc.search(query).then((r) => {
      if (!alive) return
      setLocal(r)
      setSel(0)
    })
    const t = setTimeout(() => void arc.suggest(query).then((s) => alive && setSuggestions(s)), 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [query, site])

  const results = useMemo(() => {
    if (site) {
      const q = query.trim()
      return q ? [{ kind: 'suggestion', id: 'site', title: q, subtitle: `Search ${site.site.name}`, url: siteSearchUrl(site.site, q) } satisfies SearchResult] : []
    }
    const seen = new Set(local.map((r) => r.title.toLowerCase()))
    const extra: SearchResult[] = suggestions
      .filter((s) => !seen.has(s.toLowerCase()))
      .map((s) => ({ kind: 'suggestion', id: `sug:${s}`, title: s, url: s, subtitle: '' }))
    return [...local, ...extra].slice(0, MAX_RESULTS)
  }, [local, suggestions, site, query])

  const tabSite = site ? undefined : matchSiteSearch(query)

  useEffect(() => {
    const top = results[0]
    if (!typing.current || !query || !top?.url || !/^https?:/i.test(top.url)) return setSuffix('')
    const shown = completionText(top.url)
    setSuffix(shown.toLowerCase().startsWith(query.toLowerCase()) ? shown.slice(query.length) : '')
  }, [results, query])

  useLayoutEffect(() => {
    if (suffix) input.current?.setSelectionRange(query.length, query.length + suffix.length)
  }, [suffix, query])

  useEffect(() => {
    listRef.current?.querySelector('.result.sel')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const run = (r: SearchResult | undefined, alt = false) => {
    if (!r) {
      const url = site ? `https://${site.site.keyword}` : query.trim() ? query : ''
      if (url) dispatch({ type: 'open', url, where: target, splitAt: mode.splitAt })
      return
    }
    if ((r.kind === 'tab' || r.kind === 'favorite' || r.kind === 'pinned') && r.target) {
      close()
      dispatch(target === 'split' || alt ? { type: 'splitWith', id: r.target, at: target === 'split' ? mode.splitAt : undefined } : { type: 'activate', id: r.target })
      return
    }
    if (r.kind === 'command' && r.target) {
      if (r.target.startsWith('space:')) {
        close()
        dispatch({ type: 'switchSpace', id: r.target.slice(6) })
      } else dispatch({ type: 'command', id: r.target })
      return
    }
    if (r.kind === 'archive' && r.target) return dispatch({ type: 'archiveRestore', id: r.target })
    dispatch({ type: 'open', url: r.url ?? r.title, where: alt ? 'split' : target, splitAt: target === 'split' ? mode.splitAt : undefined })
  }

  const placeholder = site ? `Search ${site.site.name}…` : PLACEHOLDER[target]

  return (
    <div className="panel command" onMouseDown={(e) => e.stopPropagation()}>
      <div className="field">
        <Icon name="search" size={18} />
        {site ? (
          <span className="site-chip">
            <Favicon url={`https://${site.site.keyword}`} favicon={site.site.favicon} />
            {site.site.name}
          </span>
        ) : null}
        <input
          ref={input}
          value={query + suffix}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => {
            const value = e.target.value
            typing.current = (e.nativeEvent as InputEvent).inputType?.startsWith('insert') ?? false
            // Typing through the completion keeps the rest of it until new results arrive.
            const shown = query + suffix
            setSuffix(typing.current && suffix && shown.toLowerCase().startsWith(value.toLowerCase()) ? shown.slice(value.length) : '')
            setQuery(value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && !e.shiftKey && tabSite) {
              e.preventDefault()
              typing.current = false
              setSite({ site: tabSite, typed: query })
              setQuery('')
              setSuffix('')
              setSel(0)
            } else if (e.key === 'Tab' && site) {
              e.preventDefault()
            } else if (e.key === 'Backspace' && site && !query) {
              e.preventDefault()
              typing.current = false
              setQuery(site.typed)
              setSite(undefined)
            } else if (suffix && (e.key === 'ArrowRight' || e.key === 'End')) {
              typing.current = false
              setQuery(query + suffix)
              setSuffix('')
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((s) => Math.min(results.length - 1, s + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(0, s - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(results[sel], e.shiftKey)
            }
          }}
        />
        {tabSite ? (
          <span className="tab-hint">
            Search {tabSite.name} <kbd className="kbd">Tab</kbd>
          </span>
        ) : null}
        {target === 'split' ? <span className="target">Split View</span> : null}
      </div>
      {results.length > 0 ? (
        <div className="results" ref={listRef}>
          {results.map((r, i) => (
            <ResultRow key={r.id} r={r} sel={i === sel} activeSpaceId={state.activeSpaceId} onHover={() => setSel(i)} onClick={(e) => run(r, e.shiftKey)} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ResultRow({
  r,
  sel,
  activeSpaceId,
  onHover,
  onClick
}: {
  r: SearchResult
  sel: boolean
  activeSpaceId: string
  onHover: () => void
  onClick: (e: React.MouseEvent) => void
}) {
  const icon = KIND_ICON[r.kind]
  let hint = ''
  if (r.kind === 'tab' || r.kind === 'pinned' || r.kind === 'favorite') hint = r.spaceId && r.spaceId !== activeSpaceId ? 'Switch to Space & Tab' : 'Switch to Tab'
  else if (r.kind === 'command' && r.target && !r.target.startsWith('space:')) hint = bindingLabel(r.target as CommandId, isMac)
  else if (r.kind === 'archive') hint = 'Restore'
  const isTab = r.kind === 'tab' || r.kind === 'pinned' || r.kind === 'favorite'
  const subtitle = isTab ? '' : r.kind === 'history' && r.url ? `— ${displayHost(r.url)}` : r.subtitle
  return (
    <div className={cx('result', sel && 'sel')} onMouseMove={sel ? undefined : onHover} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      <span className="ico">{icon ? <Icon name={icon} /> : <Favicon url={r.url ?? ''} favicon={r.favicon} />}</span>
      <span className="text">
        <span className="t">{r.title}</span>
        {subtitle ? <span className="s">{subtitle}</span> : null}
      </span>
      {hint ? <span className="hint">{hint}</span> : null}
      {isTab ? (
        <span className="go">
          <Icon name="forward" size={14} />
        </span>
      ) : null}
    </div>
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
    return arc.onFind((f) => {
      if (f.step) {
        if (queryRef.current) dispatch({ type: 'find', query: queryRef.current, forward: f.step > 0, findNext: true })
        input.current?.focus()
      } else if (f.matches !== undefined) setCount({ active: f.active ?? 0, matches: f.matches })
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
        onChange={(e) => {
          setQuery(e.target.value)
          if (!e.target.value) setCount(undefined)
          dispatch({ type: 'find', query: e.target.value })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && query) dispatch({ type: 'find', query, forward: !e.shiftKey, findNext: true })
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
        {visible.map((id, i) => {
          const item = findItem(state, id)?.item
          if (!item) return null
          const live = state.live[id]
          return (
            <div key={id} className={cx('switch-card', i === index % visible.length && 'sel')}>
              <Favicon url={item.url} favicon={live?.favicon ?? item.favicon} />
              <span className="t">{item.savedTitle || live?.title || item.title}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
