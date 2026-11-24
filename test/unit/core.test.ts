import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BINDINGS, commandForInput, type KeyInput } from '../../src/shared/keymap.ts'
import { findItem, isAwayFromSaved, profileOfItem, spaceItems } from '../../src/shared/tree.ts'
import type { PersistedState } from '../../src/shared/types.ts'
import { resolveInput, toUrl, withoutTracking } from '../../src/shared/url.ts'

test('toUrl recognises URLs, hosts and localhost', () => {
  assert.equal(toUrl('github.com'), 'https://github.com')
  assert.equal(toUrl('news.ycombinator.com/item?id=1'), 'https://news.ycombinator.com/item?id=1')
  assert.equal(toUrl('localhost:5173'), 'http://localhost:5173')
  assert.equal(toUrl('192.168.1.10/admin'), 'http://192.168.1.10/admin')
  assert.equal(toUrl('https://example.com/a b'), undefined)
  assert.equal(toUrl('about:blank'), 'about:blank')
  assert.equal(toUrl('hello world'), undefined)
  assert.equal(toUrl('arc'), undefined)
})

test('resolveInput falls back to the search engine', () => {
  assert.equal(resolveInput('cats and dogs', 'google'), 'https://www.google.com/search?q=cats%20and%20dogs')
  assert.equal(resolveInput('cats', 'duckduckgo'), 'https://duckduckgo.com/?q=cats')
})

test('withoutTracking drops tracking parameters and keeps the rest as written', () => {
  assert.equal(withoutTracking('https://example.com/a?id=42&utm_source=news&utm_medium=email&fbclid=IwAR3x#top'), 'https://example.com/a?id=42#top')
  assert.equal(withoutTracking('https://example.com/?utm_campaign=x'), 'https://example.com/')
  assert.equal(withoutTracking('https://example.com/s?q=a%20b,c&gclid=1&flag'), 'https://example.com/s?q=a%20b,c&flag')
  assert.equal(withoutTracking('https://www.youtube.com/watch?v=abc&si=xyz'), 'https://www.youtube.com/watch?v=abc')
  assert.equal(withoutTracking('https://x.com/user/status/1?s=20&t=abc'), 'https://x.com/user/status/1')
  assert.equal(withoutTracking('https://example.com/?si=keep&s=keep'), 'https://example.com/?si=keep&s=keep')
  assert.equal(withoutTracking('https://Example.com/?id=1'), 'https://Example.com/?id=1')
  assert.equal(withoutTracking('about:blank'), 'about:blank')
})

const key = (code: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  type: 'keyDown',
  code,
  key: '',
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...mods
})

test('keymap matches Arc bindings per platform', () => {
  assert.equal(commandForInput(key('KeyT', { meta: true }), true), 'newTab')
  assert.equal(commandForInput(key('KeyT', { control: true }), false), 'newTab')
  assert.equal(commandForInput(key('KeyT', { meta: true }), false), undefined)
  assert.equal(commandForInput(key('KeyS', { control: true }), false), 'toggleSidebar')
  assert.equal(commandForInput(key('Digit2', { control: true }), true), 'space2')
  assert.equal(commandForInput(key('Digit2', { alt: true }), false), 'space2')
  assert.equal(commandForInput(key('Digit3', { meta: true }), true), 'tab3')
  assert.equal(commandForInput(key('Tab', { control: true }), false), 'switcherNext')
  assert.equal(commandForInput(key('Equal', { control: true, shift: true }), false), 'splitAdd')
  assert.equal(commandForInput(key('KeyC', { meta: true, shift: true, alt: true }), true), 'copyUrlMarkdown')
  assert.equal(commandForInput(key('KeyD', { alt: true }), false), 'editUrl')
  assert.equal(commandForInput({ ...key('KeyT', { meta: true }), type: 'keyUp' }, true), undefined)
  // Plain typing never triggers commands.
  assert.equal(commandForInput(key('KeyC', { meta: true }), true), undefined)
})

test('AltGr characters are typed, not treated as Ctrl+Alt shortcuts (Windows)', () => {
  // US-International: AltGr+N types ñ and arrives as Ctrl+Alt+N.
  assert.equal(commandForInput({ ...key('KeyN', { control: true, alt: true }), key: 'ñ' }, false), undefined)
  assert.equal(commandForInput({ ...key('KeyO', { control: true, alt: true }), key: 'ó' }, false), undefined)
  // Layouts where Ctrl+Alt+N types nothing still get the shortcut.
  assert.equal(commandForInput({ ...key('KeyN', { control: true, alt: true }), key: 'n' }, false), 'littleArc')
  assert.equal(commandForInput({ ...key('ArrowDown', { control: true, alt: true }), key: 'ArrowDown' }, false), 'nextTab')
  // macOS never has AltGr; Cmd+Option+N with a composed key still works.
  assert.equal(commandForInput({ ...key('KeyN', { meta: true, alt: true }), key: '˜' }, true), 'littleArc')
})

test('no key combination is bound to two commands', () => {
  for (const platform of ['mac', 'other'] as const) {
    const seen = new Map<string, string>()
    for (const b of BINDINGS) {
      for (const accel of b[platform]) {
        const prev = seen.get(accel)
        assert.ok(!prev || prev === b.id, `${platform}: ${accel} is bound to both ${prev} and ${b.id}`)
        seen.set(accel, b.id)
      }
    }
  }
})

function sample(): PersistedState {
  return {
    version: 1,
    profiles: [
      { id: 'p1', name: 'Default', favorites: [{ id: 'f1', url: 'https://mail.example', title: 'Mail', savedUrl: 'https://mail.example', lastActive: 0 }] },
      { id: 'p2', name: 'Work', favorites: [] }
    ],
    spaces: [
      {
        id: 's1',
        name: 'Personal',
        color: '#000',
        profileId: 'p1',
        pinned: [
          { kind: 'folder', id: 'd1', name: 'Dev', open: true, children: [{ kind: 'tab', id: 't2', url: 'https://gh.example/x', savedUrl: 'https://gh.example', title: 'GH', lastActive: 0 }] }
        ],
        today: [{ id: 't1', url: 'https://a.example', title: 'A', lastActive: 0 }],
        splits: []
      },
      { id: 's2', name: 'Work', color: '#fff', profileId: 'p2', pinned: [], today: [{ id: 't3', url: 'https://b.example', title: 'B', lastActive: 0 }], splits: [] }
    ],
    activeSpaceId: 's1',
    settings: {} as PersistedState['settings'],
    archive: [],
    littleArc: { profileByHost: {} },
    windows: []
  }
}

test('findItem locates favorites, nested pinned tabs and Today tabs', () => {
  const s = sample()
  assert.equal(findItem(s, 'f1')?.loc.kind, 'favorite')
  const pinned = findItem(s, 't2')
  assert.equal(pinned?.loc.kind, 'pinned')
  assert.equal(pinned?.loc.kind === 'pinned' && pinned.loc.folder?.id, 'd1')
  assert.equal(findItem(s, 't3')?.loc.kind, 'today')
  assert.equal(findItem(s, 'd1'), undefined)
})

test('items resolve to the profile of their space', () => {
  const s = sample()
  assert.equal(profileOfItem(s, 'f1'), 'p1')
  assert.equal(profileOfItem(s, 't2'), 'p1')
  assert.equal(profileOfItem(s, 't3'), 'p2')
})

test('spaceItems orders favorites, pinned, then Today', () => {
  const s = sample()
  assert.deepEqual(spaceItems(s, s.spaces[0]).map((i) => i.id), ['f1', 't2', 't1'])
  assert.deepEqual(spaceItems(s, s.spaces[1]).map((i) => i.id), ['t3'])
})

test('isAwayFromSaved ignores hashes and trailing slashes', () => {
  const item = { id: 'x', url: '', title: '', lastActive: 0, savedUrl: 'https://x.example/app' }
  assert.equal(isAwayFromSaved(item, 'https://x.example/app/#inbox'), false)
  assert.equal(isAwayFromSaved(item, 'https://x.example/app/settings'), true)
  assert.equal(isAwayFromSaved({ ...item, savedUrl: undefined }, 'https://y.example'), false)
})
