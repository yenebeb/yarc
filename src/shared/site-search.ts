export interface SiteSearch {
  name: string
  keyword: string
  /** `%s` is the query. */
  url: string
  favicon: string
}

/** Prefix matches go to the first one. */
export const SITE_SEARCHES: SiteSearch[] = [
  { name: 'Amazon', keyword: 'amazon.com', url: 'https://www.amazon.com/s?k=%s', favicon: 'https://www.amazon.com/favicon.ico' },
  { name: 'Apple Music', keyword: 'music.apple.com', url: 'https://music.apple.com/us/search?term=%s', favicon: 'https://music.apple.com/favicon.ico' },
  { name: 'Asana', keyword: 'asana.com', url: 'https://app.asana.com/0/search?q=%s', favicon: 'https://asana.com/favicon.ico' },
  { name: 'Brave', keyword: 'search.brave.com', url: 'https://search.brave.com/search?q=%s', favicon: 'https://search.brave.com/favicon.ico' },
  {
    name: 'Dropbox',
    keyword: 'dropbox.com',
    url: 'https://www.dropbox.com/search/personal?&query=%s',
    favicon: 'https://cfl.dropboxstatic.com/static/metaserver/static/images/favicon-vfl8lUR9B.ico'
  },
  { name: 'DuckDuckGo', keyword: 'duckduckgo.com', url: 'https://duckduckgo.com/?q=%s', favicon: 'https://duckduckgo.com/favicon.ico' },
  { name: 'Ecosia', keyword: 'ecosia.org', url: 'https://www.ecosia.org/search?q=%s', favicon: 'https://www.ecosia.org/favicon.ico' },
  { name: 'Figma', keyword: 'figma.com', url: 'https://www.figma.com/files/search?q=%s', favicon: 'https://static.figma.com/app/icon/1/favicon.png' },
  { name: 'GitHub', keyword: 'github.com', url: 'https://github.com/search?q=%s', favicon: 'https://github.com/favicon.ico' },
  { name: 'Gmail', keyword: 'mail.google.com', url: 'https://mail.google.com/mail/ca/u/0/#apps/%s', favicon: 'https://mail.google.com/favicon.ico' },
  { name: 'Google', keyword: 'google.com', url: 'https://www.google.com/search?q=%s', favicon: 'https://www.google.com/favicon.ico' },
  {
    name: 'Google Calendar',
    keyword: 'calendar.google.com',
    url: 'https://calendar.google.com/calendar/u/0/r/search?q=%s',
    favicon: 'https://calendar.google.com/googlecalendar/images/favicons_2020q4/calendar_14.ico'
  },
  {
    name: 'Google Docs',
    keyword: 'docs.google.com',
    url: 'https://docs.google.com/document/u/0/?q=%s',
    favicon: 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico'
  },
  { name: 'Google Drive', keyword: 'drive.google.com', url: 'https://drive.google.com/drive/search?q=%s', favicon: 'https://drive.google.com/favicon.ico' },
  {
    name: 'Google Maps',
    keyword: 'maps.google.com',
    url: 'https://www.google.com/maps/search/%s',
    favicon: 'https://www.google.com/images/branding/product/ico/maps15_bnuw3a_32dp.ico'
  },
  { name: 'LinkedIn', keyword: 'linkedin.com', url: 'https://linkedin.com/search/results/all/?keywords=%s', favicon: 'https://www.linkedin.com/favicon.ico' },
  { name: 'Microsoft Bing', keyword: 'bing.com', url: 'https://www.bing.com/search?q=%s', favicon: 'https://www.bing.com/favicon.ico' },
  { name: 'Perplexity', keyword: 'perplexity.ai', url: 'https://www.perplexity.ai/search?q=%s', favicon: 'https://www.perplexity.ai/favicon.ico' },
  { name: 'PrivacyWall', keyword: 'privacywall.org', url: 'https://www.privacywall.org/search/secure/?q=%s', favicon: 'https://www.privacywall.org/favicon.ico' },
  { name: 'Qwant', keyword: 'qwant.com', url: 'https://www.qwant.com/?q=%s', favicon: 'https://www.qwant.com/favicon.ico' },
  { name: 'Reddit', keyword: 'reddit.com', url: 'https://www.reddit.com/search/?q=%s', favicon: 'https://reddit.com/favicon.ico' },
  { name: 'SoundCloud', keyword: 'soundcloud.com', url: 'https://soundcloud.com/search?q=%s', favicon: 'https://soundcloud.com/favicon.ico' },
  { name: 'Spotify', keyword: 'spotify.com', url: 'https://open.spotify.com/search/%s', favicon: 'https://www.scdn.co/i/_global/favicon.ico' },
  { name: 'Wikipedia', keyword: 'wikipedia.org', url: 'https://wikipedia.org/w/index.php?search=%s', favicon: 'https://en.wikipedia.org/favicon.ico' },
  { name: 'X', keyword: 'x.com', url: 'https://x.com/search?q=%s', favicon: 'https://x.com/favicon.ico' },
  { name: 'X', keyword: 'twitter.com', url: 'https://twitter.com/search?q=%s', favicon: 'https://x.com/favicon.ico' },
  { name: 'YouTube', keyword: 'youtube.com', url: 'https://www.youtube.com/results?search_query=%s', favicon: 'https://www.youtube.com/favicon.ico' }
]

/** A keyword it starts ("you" → youtube.com), else a name it starts; one letter only matches a whole name ("x"). */
export function matchSiteSearch(input: string): SiteSearch | undefined {
  const text = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
  if (!text) return undefined
  const exact = SITE_SEARCHES.find((s) => s.keyword === text || s.name.toLowerCase() === text)
  if (exact || text.length < 2) return exact
  return SITE_SEARCHES.find((s) => s.keyword.startsWith(text)) ?? SITE_SEARCHES.find((s) => s.name.toLowerCase().startsWith(text))
}

export function siteSearchUrl(site: SiteSearch, query: string): string {
  return site.url.replace('%s', encodeURIComponent(query.trim()))
}
