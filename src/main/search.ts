import { net } from 'electron'
import { BINDINGS } from '../shared/keymap'
import { spaceCanvases, spaceItems, tabTitle } from '../shared/tree'
import type { SearchResult } from '../shared/types'
import { SEARCH_ENGINES, toUrl } from '../shared/url'
import type { Browser } from './browser'
import { arrange, historyCandidates, type Candidate } from './search-rank'

export function search(browser: Browser, raw: string): SearchResult[] {
  const query = raw.trim()
  const state = browser.store.state
  const active = browser.store.activeSpace
  const live = browser.live

  const tabs: Candidate[] = []
  const seen = new Set<string>()
  const spaces = [active, ...state.spaces.filter((s) => s !== active)]
  for (const space of spaces) {
    for (const item of spaceItems(state, space)) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      const title = tabTitle(item, live.get(item.id)?.wc.getTitle())
      const url = item.url
      const isFav = state.profiles.some((p) => p.favorites.includes(item))
      const result: SearchResult = {
        kind: isFav ? 'favorite' : item.savedUrl ? 'pinned' : 'tab',
        id: `tab:${item.id}`,
        title,
        subtitle: space === active ? url : `${space.emoji ?? ''} ${space.name} · ${url}`.trim(),
        url,
        favicon: item.favicon,
        target: item.id,
        spaceId: space.id
      }
      tabs.push({ source: 'tab', result, inActiveSpace: space === active, loaded: live.has(item.id) })
    }
  }
  if (!query) {
    const weight = (t: Candidate) => (t.source === 'tab' ? (t.inActiveSpace ? 2 : 0) + (t.loaded ? 1 : 0) : 0)
    return [...tabs].sort((a, b) => weight(b) - weight(a)).slice(0, 8).map((t) => t.result)
  }

  const url = toUrl(query)
  const typed: SearchResult = url
    ? { kind: 'url', id: `url:${url}`, title: url, subtitle: 'Open URL', url }
    : {
        kind: 'suggestion',
        id: `search:${query}`,
        title: query,
        subtitle: `Search ${SEARCH_ENGINES[state.settings.searchEngine].name}`,
        url: query
      }

  const commands: Candidate[] = []
  for (const b of BINDINGS) {
    if (!b.palette) continue
    const title = b.id === 'installUpdate' ? browser.updater.actionTitle() : b.title
    if (title) commands.push({ source: 'command', result: { kind: 'command', id: `cmd:${b.id}`, title, target: b.id } })
  }
  for (const space of state.spaces) {
    const title = `Switch to ${space.emoji ?? ''} ${space.name}`.replace(/\s+/g, ' ')
    commands.push({ source: 'command', result: { kind: 'command', id: `space:${space.id}`, title, target: `space:${space.id}` } })
  }

  const canvases: Candidate[] = spaces.flatMap((space) =>
    spaceCanvases(space).map((canvas): Candidate => {
      const subtitle = space === active ? 'Canvas' : `${space.emoji ?? ''} ${space.name} · Canvas`.trim()
      return { source: 'canvas', inActiveSpace: space === active, result: { kind: 'canvas', id: `canvas:${canvas.id}`, title: canvas.name, subtitle, target: canvas.id, spaceId: space.id } }
    })
  )

  const history = historyCandidates(browser.profiles.get(active.profileId).history.search(query), query)

  const archive: Candidate[] = state.archive.map((a) => ({
    source: 'archive',
    result: { kind: 'archive', id: `arch:${a.id}`, title: a.title, subtitle: `Archived · ${a.url}`, url: a.url, favicon: a.favicon, target: a.id }
  }))

  const openUrls = new Set([typed.url, ...tabs.map((t) => t.result.url)])
  const elsewhere = [...history, ...archive].filter((c) => !c.result.url || !openUrls.has(c.result.url))
  return arrange(query, typed, [...commands, ...tabs, ...canvases, ...elsewhere])
}

export async function suggest(browser: Browser, query: string): Promise<string[]> {
  const q = query.trim()
  if (!q || toUrl(q)) return []
  const engine = browser.store.state.settings.searchEngine
  const endpoint =
    engine === 'duckduckgo'
      ? `https://duckduckgo.com/ac/?type=list&q=${encodeURIComponent(q)}`
      : engine === 'bing'
        ? `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`
        : `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(q)}`
  try {
    // Incognito asks through its own in-memory session, never the default one.
    const fetcher = browser.incognito ? browser.profiles.get(browser.space.profileId).session : net
    const res = await fetcher.fetch(endpoint, { signal: AbortSignal.timeout(1500) })
    const data = (await res.json()) as [string, string[]]
    return (data[1] ?? []).filter((s) => s.toLowerCase() !== q.toLowerCase()).slice(0, 5)
  } catch {
    return []
  }
}
