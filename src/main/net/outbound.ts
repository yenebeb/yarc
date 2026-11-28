// Every request a feature makes that isn't a page's own: what goes out, to whom, with whose cookies. Updates and sync have their own folders.
import { net, type Session } from 'electron'
import type { Settings } from '../../shared/types'

/** `incognito`: asked through its in-memory session, never the default one. */
export async function searchSuggestions(engine: Settings['searchEngine'], query: string, incognito?: Session): Promise<string[]> {
  const asked = encodeURIComponent(query)
  const endpoint =
    engine === 'duckduckgo'
      ? `https://duckduckgo.com/ac/?type=list&q=${asked}`
      : engine === 'bing'
        ? `https://api.bing.com/osjson.aspx?query=${asked}`
        : `https://suggestqueries.google.com/complete/search?client=chrome&q=${asked}`
  try {
    const res = await (incognito ?? net).fetch(endpoint, { signal: AbortSignal.timeout(1500) })
    const data = (await res.json()) as [string, string[]]
    return (data[1] ?? []).filter((suggestion) => suggestion.toLowerCase() !== query.toLowerCase()).slice(0, 5)
  } catch {
    return []
  }
}

/** A live folder's source, with the space's profile session: its cookies, nothing of YARC's. */
export function liveSource(session: Session, url: string, accept: string, timeoutMs: number): Promise<Response> {
  return session.fetch(url, { headers: { Accept: accept }, credentials: 'include', signal: AbortSignal.timeout(timeoutMs) })
}

/** With the page's session, so images behind a login work. */
export function imageOnPage(session: Session, url: string, pageUrl: string): Promise<Response> {
  return session.fetch(url, { headers: { Referer: pageUrl } })
}
