import type { PersistedState, PinnedNode, TabItem } from '../../shared/types'

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const link = (tab: TabItem, pad: string): string => `${pad}<DT><A HREF="${escape(tab.savedUrl ?? tab.url)}">${escape(tab.savedTitle ?? tab.title)}</A>\n`

function folder(name: string, body: string, pad: string): string {
  return `${pad}<DT><H3>${escape(name)}</H3>\n${pad}<DL><p>\n${body}${pad}</DL><p>\n`
}

function pinned(nodes: PinnedNode[], pad: string): string {
  return nodes
    .map((n) => (n.kind === 'tab' ? link(n, pad) : n.kind === 'folder' ? folder(n.name, pinned(n.children, `${pad}    `), pad) : ''))
    .join('')
}

/** The Netscape bookmark file every browser imports: a folder per space with its pinned tabs, and each profile's favorites. */
export function bookmarksHtml(state: Pick<PersistedState, 'profiles' | 'spaces'>): string {
  const pad = '    '
  const favorites = state.profiles
    .filter((p) => p.favorites.length)
    .map((p) => folder(state.profiles.length > 1 ? `Favorites (${p.name})` : 'Favorites', p.favorites.map((f) => link(f, pad + pad)).join(''), pad))
  const spaces = state.spaces.map((s) => folder(s.emoji ? `${s.emoji} ${s.name}` : s.name, pinned(s.pinned, pad + pad), pad))
  return [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    `${favorites.join('')}${spaces.join('')}</DL><p>`,
    ''
  ].join('\n')
}
