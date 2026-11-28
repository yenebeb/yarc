import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bookmarksHtml } from '../../src/main/features/bookmarks-export.ts'
import type { Profile, Space, TabItem } from '../../src/shared/types.ts'

const tab = (url: string, title: string, saved?: Partial<TabItem>): TabItem => ({ id: url, url, title, lastActive: 0, ...saved })

const space = (name: string, pinned: Space['pinned'], emoji?: string): Space => ({
  id: name,
  name,
  emoji,
  color: '#000000',
  profileId: 'p',
  pinned,
  today: [tab('https://today.example/', 'Today tab')],
  splits: []
})

test('bookmarksHtml writes a folder per space with its pinned tabs and folders, and the favorites', () => {
  const profiles: Profile[] = [{ id: 'p', name: 'Me', favorites: [tab('https://mail.example/', 'Mail')] }]
  const spaces = [
    space('Work', [
      { kind: 'tab', ...tab('https://now.example/page', 'Moved on', { savedUrl: 'https://docs.example/?a=1&b=2', savedTitle: 'Docs <home>' }) },
      { kind: 'folder', id: 'f', name: 'Reading', open: false, children: [{ kind: 'tab', ...tab('https://news.example/', 'News "daily"') }] },
      { kind: 'canvas', id: 'c', name: 'Board', lastActive: 0 }
    ], '💼'),
    space('Empty', [])
  ]
  const html = bookmarksHtml({ profiles, spaces })
  assert.match(html, /^<!DOCTYPE NETSCAPE-Bookmark-file-1>/)
  assert.ok(html.includes('<DT><H3>Favorites</H3>\n    <DL><p>\n        <DT><A HREF="https://mail.example/">Mail</A>\n    </DL><p>'))
  assert.ok(html.includes('<DT><H3>💼 Work</H3>'))
  assert.ok(html.includes('<A HREF="https://docs.example/?a=1&amp;b=2">Docs &lt;home&gt;</A>'))
  assert.ok(html.includes('        <DT><H3>Reading</H3>\n        <DL><p>\n            <DT><A HREF="https://news.example/">News &quot;daily&quot;</A>'))
  assert.ok(html.includes('<DT><H3>Empty</H3>\n    <DL><p>\n    </DL><p>'))
  assert.ok(!html.includes('Board') && !html.includes('today.example') && !html.includes('now.example'))
  assert.ok(html.trimEnd().endsWith('</DL><p>'))
})

test('bookmarksHtml names favorites by profile when there are several, and skips empty ones', () => {
  const profiles: Profile[] = [
    { id: 'a', name: 'Home', favorites: [tab('https://a.example/', 'A')] },
    { id: 'b', name: 'Work', favorites: [] }
  ]
  const html = bookmarksHtml({ profiles, spaces: [] })
  assert.ok(html.includes('<H3>Favorites (Home)</H3>'))
  assert.ok(!html.includes('Favorites (Work)'))
})
