import type { SearchResult } from '../shared/types'
import type { HistoryEntry } from './history'

export const Match = {
  none: 0,
  /** "stg" in "Settings"; only shown when nothing better fills the bar. */
  letters: 1,
  inside: 2,
  /** In any order: "future bar" in "Bar of the Future". */
  words: 3,
  wordStart: 4,
  start: 5
} as const
export type Match = (typeof Match)[keyof typeof Match]

const WORD_BREAK = /[\s/.\-_:?=&#|·,()[\]@+]/

function startsAWord(text: string, part: string): boolean {
  for (let i = text.indexOf(part); i >= 0; i = text.indexOf(part, i + 1)) {
    if (i === 0 || WORD_BREAK.test(text[i - 1])) return true
  }
  return false
}

function hasLettersInOrder(text: string, letters: string): boolean {
  let next = 0
  for (const ch of text) if (ch === letters[next]) next++
  return next === letters.length
}

export function matchText(text: string, query: string): Match {
  const t = text.toLowerCase()
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return Match.none
  if (t.startsWith(q)) return Match.start
  if (startsAWord(t, q)) return Match.wordStart
  const words = q.split(' ')
  if (words.length > 1 && words.every((w) => startsAWord(t, w))) return Match.words
  if (words.every((w) => t.includes(w))) return Match.inside
  const letters = q.replace(/ /g, '')
  if (letters.length > 2 && hasLettersInOrder(t, letters)) return Match.letters
  return Match.none
}

export const bareUrl = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '')

export function searchedFor(url: string): string | undefined {
  const u = URL.parse(url)
  if (!u) return undefined
  const host = u.hostname.replace(/^www\./, '')
  const path = u.pathname
  const isResultsPage =
    (/^google\.[a-z.]+$/.test(host) && path === '/search') ||
    (host === 'bing.com' && path === '/search') ||
    (host === 'duckduckgo.com' && path === '/') ||
    (host === 'kagi.com' && path === '/search') ||
    (host === 'search.brave.com' && path === '/search')
  if (!isResultsPage) return undefined
  return u.searchParams.get('q')?.trim() || undefined
}

/** A search engine's results pages become the searches, once each. */
export function historyCandidates(entries: HistoryEntry[], query: string): Candidate[] {
  const pages: Candidate[] = []
  const searches = new Map<string, Extract<Candidate, { source: 'history' }>>()
  for (const h of entries) {
    const searched = searchedFor(h.url)
    if (!searched) {
      const result: SearchResult = { kind: 'history', id: `hist:${h.url}`, title: h.title || h.url, subtitle: h.url, url: h.url }
      pages.push({ source: 'history', result, visitCount: h.visitCount, lastVisit: h.lastVisit })
      continue
    }
    const key = searched.toLowerCase()
    const alreadyTheSecondRow = key === query.toLowerCase()
    if (alreadyTheSecondRow) continue
    const known = searches.get(key)
    if (known) {
      known.visitCount += h.visitCount
      known.lastVisit = Math.max(known.lastVisit, h.lastVisit)
    } else {
      searches.set(key, {
        source: 'history',
        result: { kind: 'pastSearch', id: `past:${key}`, title: searched, url: searched },
        visitCount: h.visitCount,
        lastVisit: h.lastVisit
      })
    }
  }
  return [...pages, ...searches.values()]
}

const DAY = 864e5

/** 0 to about 12. */
export function frecency(visitCount: number, lastVisit: number, now: number): number {
  const days = (now - lastVisit) / DAY
  const recency = days < 4 ? 1 : days < 14 ? 0.7 : days < 31 ? 0.5 : days < 90 ? 0.3 : 0.1
  return Math.log2(1 + visitCount) * recency
}

export type Candidate =
  | { source: 'command'; result: SearchResult }
  | { source: 'tab'; result: SearchResult; inActiveSpace: boolean; loaded: boolean }
  | { source: 'history'; result: SearchResult; visitCount: number; lastVisit: number }
  | { source: 'archive'; result: SearchResult }
  | { source: 'canvas'; result: SearchResult; inActiveSpace: boolean }

interface Ranked {
  candidate: Candidate
  match: Match
  score: number
}

function bestMatch(result: SearchResult, query: string): { match: Match; length: number } {
  const byTitle = matchText(result.title, query)
  // A past search matches on what was searched, not on the engine's URL.
  if (!result.url || result.kind === 'pastSearch') return { match: byTitle, length: result.title.length }
  const url = bareUrl(result.url)
  const byUrl = matchText(url, query)
  return byUrl > byTitle ? { match: byUrl, length: url.length } : { match: byTitle, length: result.title.length }
}

const OWN_BASE = 500
const HISTORY_BASE = 200

function rankOne(candidate: Candidate, query: string, now: number): Ranked {
  const { match, length } = bestMatch(candidate.result, query)
  const coverage = Math.min(1, query.trim().length / Math.max(1, length))
  let within = 0
  switch (candidate.source) {
    case 'command':
      within = OWN_BASE + coverage * 200 + 30
      break
    case 'canvas':
      within = OWN_BASE + coverage * 200 + (candidate.inActiveSpace ? 20 : 0)
      break
    case 'tab':
      within = OWN_BASE + coverage * 200 + (candidate.inActiveSpace ? 20 : 0) + (candidate.loaded ? 10 : 0)
      break
    case 'history':
      within = HISTORY_BASE + Math.min(250, frecency(candidate.visitCount, candidate.lastVisit, now) * 20)
      break
    case 'archive':
      within = 0
  }
  return { candidate, match, score: match * 1000 + within }
}

export function rank(candidates: Candidate[], query: string, now = Date.now()): Candidate[] {
  return candidates
    .map((c) => rankOne(c, query, now))
    .filter((r) => r.match !== Match.none)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.candidate)
}

/** Above "Search for …". */
export function isTopHit(candidate: Candidate, query: string, typedUrl: boolean): boolean {
  const { result } = candidate
  if (candidate.source === 'command' || candidate.source === 'tab' || candidate.source === 'canvas') return bestMatch(result, query).match === Match.start
  if (candidate.source !== 'history' || typedUrl || result.kind === 'pastSearch' || !result.url || /\s/.test(query.trim())) return false
  return bareUrl(result.url).toLowerCase().startsWith(query.trim().toLowerCase())
}

/** The renderer adds the search engine's suggestions after these. */
export function arrange(query: string, typed: SearchResult, candidates: Candidate[], now = Date.now(), limit = 20): SearchResult[] {
  const ranked = rank(candidates, query, now)
  const best = ranked[0]
  if (!best || !isTopHit(best, query, typed.kind === 'url')) return [typed, ...ranked.map((c) => c.result)].slice(0, limit)
  // Typing a site's name completes to the site itself when it was visited, not to its busiest page.
  const top = (best.source === 'history' && ranked.find((c) => c.source === 'history' && isRootOf(c.result.url, best.result.url))) || best
  const rest = ranked.filter((c) => c !== top).map((c) => c.result)
  return [top.result, typed, ...rest].slice(0, limit)
}

function isRootOf(url: string | undefined, page: string | undefined): boolean {
  if (!url || !page) return false
  const root = URL.parse(url)
  return !!root && root.pathname === '/' && !root.search && !root.hash && root.origin === URL.parse(page)?.origin
}
