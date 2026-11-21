import type { ID } from './types'

/** Links from other apps whose address matches `match` open in `spaceId`. */
export interface LinkRoute {
  match: string
  spaceId: ID
}

/** "https://www.GitHub.com/yarc/" → "github.com/yarc". */
export function cleanMatch(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
}

/** A rule for a site also covers its subdomains; one with a path covers the pages under it. */
export function routeFor(routes: readonly LinkRoute[], url: string): LinkRoute | undefined {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return undefined
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined
  const host = u.host.toLowerCase().replace(/^www\./, '')
  const path = u.pathname.toLowerCase().replace(/\/+$/, '')
  return routes.find((r) => {
    const [site, ...rest] = cleanMatch(r.match).split('/')
    const under = rest.length ? `/${rest.join('/')}` : ''
    return !!site && (host === site || host.endsWith(`.${site}`)) && (path === under || path.startsWith(`${under}/`))
  })
}

export function validRoutes(value: unknown): LinkRoute[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ok = (r: unknown): r is LinkRoute => !!r && typeof (r as LinkRoute).match === 'string' && typeof (r as LinkRoute).spaceId === 'string'
  return value.every(ok) ? value.map((r) => ({ match: cleanMatch(r.match), spaceId: r.spaceId })).filter((r) => r.match) : undefined
}
