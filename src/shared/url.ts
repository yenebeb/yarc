import type { SearchEngine } from './types'

export const SEARCH_ENGINES: Record<SearchEngine, { name: string; url: string }> = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  kagi: { name: 'Kagi', url: 'https://kagi.com/search?q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' }
}

export function searchUrl(query: string, engine: SearchEngine): string {
  return SEARCH_ENGINES[engine].url.replace('%s', encodeURIComponent(query))
}

const SCHEME = /^(https?|file|about|chrome|chrome-extension|view-source|data|blob|mailto):/i
const LOCAL = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?(\/.*)?$/i
const DOMAIN = /^([a-z0-9-]+\.)+[a-z][a-z0-9-]{1,62}(:\d+)?([/?#].*)?$/i

export function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

export function toUrl(input: string): string | undefined {
  const text = input.trim()
  if (!text || /\s/.test(text)) return undefined
  if (SCHEME.test(text)) return text
  if (LOCAL.test(text)) return `http://${text}`
  if (DOMAIN.test(text)) return `https://${text}`
  return undefined
}

export function resolveInput(input: string, engine: SearchEngine): string {
  return toUrl(input) ?? searchUrl(input.trim(), engine)
}

const TRACKING = /^(utm_\w+|fbclid|gclid|gclsrc|dclid|gbraid|wbraid|msclkid|mc_[ce]id|igsh(id)?|twclid|ttclid|li_fat_id|yclid|_hsenc|_hsmi|mkt_tok|srsltid|ref_src)$/i
const TRACKING_ON: [host: RegExp, key: RegExp][] = [
  [/(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/, /^si$/],
  [/(^|\.)(x\.com|twitter\.com)$/, /^[st]$/]
]

/** Filters the raw query so the parameters that stay keep their exact encoding. */
export function withoutTracking(url: string): string {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return url
  }
  const onHost = TRACKING_ON.find(([host]) => host.test(u.hostname))?.[1]
  const params = u.search.slice(1).split('&')
  const kept = params.filter((p) => {
    const key = p.split('=')[0]
    return !TRACKING.test(key) && !onHost?.test(key)
  })
  if (kept.length === params.length) return url
  u.search = kept.join('&')
  return u.href
}

export function queryFromSearchUrl(url: string): string | undefined {
  try {
    const u = new URL(url)
    if (/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|kagi\.com|search\.brave\.com)$/.test(u.hostname)) {
      return u.searchParams.get('q') ?? undefined
    }
  } catch {}
  return undefined
}
