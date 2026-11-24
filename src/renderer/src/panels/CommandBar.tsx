import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CommandId } from '../../../shared/keymap'
import { matchSiteSearch, siteSearchUrl, type SiteSearch } from '../../../shared/site-search'
import type { AppState, OverlayMode, SearchResult } from '../../../shared/types'
import { arc, cx, dispatch, displayHost, shortcutLabel } from '../api'
import { Favicon, Icon, type IconName } from '../icons'
import './command-bar.css'

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

const isTabResult = (result: SearchResult) => result.kind === 'tab' || result.kind === 'pinned' || result.kind === 'favorite'

export function CommandBar({ state, mode, close }: { state: AppState; mode: Extract<OverlayMode, { kind: 'command' }>; close: () => void }) {
  const [query, setQuery] = useState(mode.initial ?? '')
  const [local, setLocal] = useState<SearchResult[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [sel, setSel] = useState(0)
  const [suffix, setSuffix] = useState('')
  const [site, setSite] = useState<{ site: SiteSearch; backspaceRestores: string }>()
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
    void arc.search(query).then((found) => {
      if (!alive) return
      setLocal(found)
      setSel(0)
    })
    const suggestTimer = setTimeout(() => void arc.suggest(query).then((fetched) => alive && setSuggestions(fetched)), 120)
    return () => {
      alive = false
      clearTimeout(suggestTimer)
    }
  }, [query, site])

  const results = useMemo(() => {
    if (site) {
      const words = query.trim()
      return words ? [{ kind: 'suggestion', id: 'site', title: words, subtitle: `Search ${site.site.name}`, url: siteSearchUrl(site.site, words) } satisfies SearchResult] : []
    }
    const seen = new Set(local.map((result) => result.title.toLowerCase()))
    const extra: SearchResult[] = suggestions
      .filter((suggestion) => !seen.has(suggestion.toLowerCase()))
      .map((suggestion) => ({ kind: 'suggestion', id: `sug:${suggestion}`, title: suggestion, url: suggestion, subtitle: '' }))
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

  const run = (result: SearchResult | undefined, alt = false) => {
    if (!result) {
      const url = site ? `https://${site.site.keyword}` : query.trim() ? query : ''
      if (url) dispatch({ type: 'open', url, where: target, splitAt: mode.splitAt })
      return
    }
    if (isTabResult(result) && result.target) {
      close()
      dispatch(target === 'split' || alt ? { type: 'splitWith', id: result.target, at: target === 'split' ? mode.splitAt : undefined } : { type: 'activate', id: result.target })
      return
    }
    if (result.kind === 'command' && result.target) {
      if (result.target.startsWith('space:')) {
        close()
        dispatch({ type: 'switchSpace', id: result.target.slice(6) })
      } else dispatch({ type: 'command', id: result.target })
      return
    }
    if (result.kind === 'archive' && result.target) return dispatch({ type: 'archiveRestore', id: result.target })
    dispatch({ type: 'open', url: result.url ?? result.title, where: alt ? 'split' : target, splitAt: target === 'split' ? mode.splitAt : undefined })
  }

  const placeholder = site ? `Search ${site.site.name}…` : PLACEHOLDER[target]

  return (
    <div className="panel command" onMouseDown={(event) => event.stopPropagation()}>
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
          onChange={(event) => {
            const value = event.target.value
            typing.current = (event.nativeEvent as InputEvent).inputType?.startsWith('insert') ?? false
            const shown = query + suffix
            const typedThroughCompletion = typing.current && suffix && shown.toLowerCase().startsWith(value.toLowerCase())
            setSuffix(typedThroughCompletion ? shown.slice(value.length) : '')
            setQuery(value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Tab' && !event.shiftKey && tabSite) {
              event.preventDefault()
              typing.current = false
              setSite({ site: tabSite, backspaceRestores: query })
              setQuery('')
              setSuffix('')
              setSel(0)
            } else if (event.key === 'Tab' && site) {
              event.preventDefault()
            } else if (event.key === 'Backspace' && site && !query) {
              event.preventDefault()
              typing.current = false
              setQuery(site.backspaceRestores)
              setSite(undefined)
            } else if (suffix && (event.key === 'ArrowRight' || event.key === 'End')) {
              typing.current = false
              setQuery(query + suffix)
              setSuffix('')
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSel((selected) => Math.min(results.length - 1, selected + 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSel((selected) => Math.max(0, selected - 1))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              run(results[sel], event.shiftKey)
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
          {results.map((result, index) => (
            <ResultRow key={result.id} result={result} selected={index === sel} activeSpaceId={state.activeSpaceId} onHover={() => setSel(index)} onClick={(event) => run(result, event.shiftKey)} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function hintFor(result: SearchResult, activeSpaceId: string) {
  if (isTabResult(result)) return result.spaceId && result.spaceId !== activeSpaceId ? 'Switch to Space & Tab' : 'Switch to Tab'
  if (result.kind === 'command' && result.target && !result.target.startsWith('space:')) return shortcutLabel(result.target as CommandId)
  if (result.kind === 'archive') return 'Restore'
  return ''
}

function ResultRow({
  result,
  selected,
  activeSpaceId,
  onHover,
  onClick
}: {
  result: SearchResult
  selected: boolean
  activeSpaceId: string
  onHover: () => void
  onClick: (event: React.MouseEvent) => void
}) {
  const icon = KIND_ICON[result.kind]
  const hint = hintFor(result, activeSpaceId)
  const isTab = isTabResult(result)
  const subtitle = isTab ? '' : result.kind === 'history' && result.url ? `— ${displayHost(result.url)}` : result.subtitle
  return (
    <div className={cx('result', selected && 'sel')} onMouseMove={selected ? undefined : onHover} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>
      <span className="ico">{icon ? <Icon name={icon} /> : <Favicon url={result.url ?? ''} favicon={result.favicon} />}</span>
      <span className="text">
        <span className="t">{result.title}</span>
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
