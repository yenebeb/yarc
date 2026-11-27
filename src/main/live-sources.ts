import { needsGitHubSignIn } from '../shared/live-folders.ts'
import type { ID, PinnedNode, PinnedTab } from '../shared/types'

export interface LiveEntry {
  url: string
  title: string
}

/** A live folder shows the newest this many. */
export const LIVE_LIMIT = 25

export class LiveError extends Error {}

/** github.com's own search page answers in JSON when asked to, with whatever the profile's cookies let it see. */
export function githubSearchUrl(query: string): string {
  return `https://github.com/search?q=${encodeURIComponent(query)}&type=pullrequests`
}

interface GitHubResult {
  number?: number
  hl_title?: string
  issue?: { issue?: { pull_request_id?: unknown } }
  repo?: { repository?: { name?: string; owner_login?: string } }
}

export function parseGitHubSearch(json: unknown, query: string): LiveEntry[] {
  const route = (json as { payload?: { blackbirdSearchRoute?: { results?: unknown; logged_in?: boolean } } })?.payload?.blackbirdSearchRoute
  if (!route || !Array.isArray(route.results)) throw new LiveError('GitHub’s answer wasn’t a list of pull requests.')
  if (route.logged_in === false && needsGitHubSignIn(query)) throw new LiveError('Sign in to github.com in this space to see your pull requests.')
  const entries: LiveEntry[] = []
  for (const r of route.results as GitHubResult[]) {
    const owner = r.repo?.repository?.owner_login
    const repo = r.repo?.repository?.name
    if (!owner || !repo || !Number.isInteger(r.number)) continue
    const kind = r.issue?.issue?.pull_request_id ? 'pull' : 'issues'
    const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${kind}/${r.number}`
    entries.push({ url, title: plainText(r.hl_title ?? '') || `${repo}#${r.number}` })
  }
  return unique(entries)
}

/** RSS 2.0, RSS 1.0 (RDF) and Atom. Only http(s) links are kept, resolved against `base`. */
export function parseFeed(xml: string, base: string): LiveEntry[] {
  if (!/<(rss|feed|rdf:RDF)\b/i.test(xml)) throw new LiveError('This address isn’t an RSS or Atom feed.')
  const entries: LiveEntry[] = []
  for (const [, , body] of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const url = webUrl(entryLink(body), base)
    if (!url) continue
    entries.push({ url, title: plainText(tagText(body, 'title')) || url })
  }
  return unique(entries)
}

export function looksLikeHtml(text: string): boolean {
  return /^\s*(<!--(?:(?!-->)[\s\S])*-->\s*)*<(!doctype html|html)\b/i.test(text)
}

/** The feed a web page names in `<link rel="alternate" type="application/rss+xml">`, so a site's address works too. */
export function feedLinkInHtml(html: string, base: string): string | undefined {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attributes(tag)
    if (/\balternate\b/i.test(a.rel ?? '') && /^application\/(rss|atom)\+xml$/i.test(a.type ?? '')) {
      const url = webUrl(a.href, base)
      if (url) return url
    }
  }
  return undefined
}

/**
 * The folder's children for these entries, in their order, keeping each tab that's already there (so an open one stays open);
 * tabs no longer listed go unless `keep` says they're in use. Undefined when nothing changed.
 */
export function mergeLive(children: PinnedNode[], entries: LiveEntry[], keep: (id: ID) => boolean, newId: () => ID, favicon?: (url: string) => string | undefined): PinnedNode[] | undefined {
  const byUrl = new Map<string, PinnedTab>()
  for (const n of children) if (n.kind === 'tab') byUrl.set(n.savedUrl ?? n.url, n)
  let changed = false
  const next: PinnedNode[] = entries.slice(0, LIVE_LIMIT).map((e) => {
    const old = byUrl.get(e.url)
    if (!old) return { kind: 'tab', id: newId(), url: e.url, savedUrl: e.url, title: e.title, savedTitle: e.title, favicon: favicon?.(e.url), lastActive: 0 }
    byUrl.delete(e.url)
    if (old.savedTitle !== e.title) {
      old.savedTitle = e.title
      changed = true
    }
    return old
  })
  const listed = new Set(next)
  for (const n of children) if (!listed.has(n) && (n.kind !== 'tab' || keep(n.id))) next.push(n)
  changed ||= next.length !== children.length || next.some((n, i) => n !== children[i])
  return changed ? next : undefined
}

function entryLink(body: string): string | undefined {
  const links = [...body.matchAll(/<link\b[^>]*?\/?>/gi)].map(([tag]) => attributes(tag)).filter((a) => a.href)
  const alternate = links.find((a) => !a.rel || a.rel === 'alternate')
  if (alternate) return alternate.href
  const text = tagText(body, 'link').trim()
  if (text) return text
  const guid = /<guid\b([^>]*)>([\s\S]*?)<\/guid>/i.exec(body)
  return guid && !/isPermaLink\s*=\s*["']false/i.test(guid[1]) ? decode(unwrapCdata(guid[2])).trim() : undefined
}

function tagText(body: string, tag: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(body)
  return m ? decode(unwrapCdata(m[1])) : ''
}

function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
}

/** Titles can carry markup (GitHub's search highlights, Atom's type="html"). */
function plainText(s: string): string {
  return decode(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [, name, , value] of tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) out[name.toLowerCase()] = decode(value)
  return out
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? whole
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

function webUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined
  const url = URL.parse(href.trim(), base)
  return url?.protocol === 'https:' || url?.protocol === 'http:' ? url.href : undefined
}

function unique(entries: LiveEntry[]): LiveEntry[] {
  const seen = new Set<string>()
  return entries.filter((e) => !seen.has(e.url) && !!seen.add(e.url))
}
