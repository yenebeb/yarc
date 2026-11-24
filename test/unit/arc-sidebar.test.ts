import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { arcTime, colorToHex, parseArcArchive, parseArcSidebar, readArcJson } from '../../src/main/importers/arc-sidebar.ts'
import type { PinnedNode } from '../../src/shared/types.ts'

const fixture = JSON.parse(readFileSync(new URL('../../docs/fixtures/StorableSidebar.sample.json', import.meta.url), 'utf8'))
const NOW = Date.UTC(2026, 10, 1)
const parsed = parseArcSidebar(fixture, { now: NOW })
const [personal, work] = parsed.spaces

const outline = (nodes: PinnedNode[]): unknown[] => nodes.map((n) => (n.kind === 'folder' ? { [n.name]: outline(n.children) } : n.kind === 'tab' ? n.title : n.name))

test('spaces in sidebar order with names, emoji and colors', () => {
  assert.equal(parsed.spaces.length, 2)
  assert.equal(personal.name, 'Personal')
  assert.equal(personal.arcId, 'thebrowser.company.defaultPersonalSpaceID')
  assert.equal(personal.emoji, '🏠')
  assert.equal(personal.color, '#55afff') // midTone, blue clamped from 1.027
  assert.equal(personal.color2, '#ff6a65') // the background gradient's last base color
  assert.equal(work.name, 'Work')
  assert.equal(work.emoji, '💼')
  assert.equal(work.color, '#336699')
  assert.equal(work.color2, undefined)
})

test('spaces map to Arc profile dirs', () => {
  assert.equal(personal.profileKey, 'Default')
  assert.equal(work.profileKey, 'Profile 1')
  assert.deepEqual(parsed.profiles.map((p) => p.key), ['Default', 'Profile 1'])
})

test('favorites per profile, in order, with savedUrl', () => {
  const [def, p1] = parsed.profiles
  assert.deepEqual(def.favorites.map((f) => f.title), ['Inbox (3) - Gmail', 'YouTube'])
  assert.deepEqual(p1.favorites.map((f) => f.title), ['Google Calendar - Week of October 26, 2026'])
  for (const f of [...def.favorites, ...p1.favorites]) {
    assert.equal(f.savedUrl, f.url)
    assert.equal('kind' in f, false)
  }
  assert.equal(def.favorites[0].url, 'https://mail.google.com/mail/u/0/#inbox')
})

test('pinned tree keeps folder nesting and order, skips non-web URLs', () => {
  assert.deepEqual(outline(personal.pinned), ['Hacker News', { Reading: ['MDN', { Recipes: ['Serious Eats'] }] }])
  assert.deepEqual(outline(work.pinned), [{ 'Project X': ['Project X › Active issues', 'Designs'] }, 'Team Wiki'])
})

test('pinned tabs: custom title wins over page title and becomes savedTitle', () => {
  const reading = personal.pinned[1]
  assert.equal(reading.kind, 'folder')
  const mdn = reading.kind === 'folder' ? reading.children[0] : undefined
  assert.equal(mdn?.kind, 'tab')
  if (mdn?.kind !== 'tab') return
  assert.equal(mdn.title, 'MDN')
  assert.equal(mdn.savedTitle, 'MDN')
  assert.equal(mdn.savedUrl, 'https://developer.mozilla.org/en-US/')
  const hn = personal.pinned[0]
  assert.equal(hn.kind === 'tab' && hn.savedTitle, undefined)
  assert.equal(hn.kind === 'tab' && hn.title, 'Hacker News')
})

test('today tabs: split view flattened in place, no savedUrl, lastActive = now', () => {
  assert.deepEqual(personal.today.map((t) => t.title), [
    'electron/electron: Build cross-platform desktop apps',
    'Introduction | Electron',
    'TypeScript: Handbook - The TypeScript Handbook'
  ])
  assert.deepEqual(work.today.map((t) => t.url), ['https://app.slack.com/client/T0000000/C0000000'])
  for (const t of [...personal.today, ...work.today]) {
    assert.equal(t.savedUrl, undefined)
    assert.equal(t.lastActive, NOW)
    assert.equal('kind' in t, false)
  }
})

test('dates: Arc seconds since 2001 become epoch ms', () => {
  const hn = personal.pinned[0]
  assert.equal(hn.kind === 'tab' && hn.lastActive, Date.UTC(2001, 0, 1) + 783050000 * 1000)
  assert.equal(parsed.profiles[0].favorites[0].lastActive, Date.UTC(2001, 0, 1) + 783000000250)
  assert.equal(arcTime(0), undefined)
  assert.equal(arcTime(1640995200000), 1640995200000) // already Unix ms
})

test('ids are unique UUIDs', () => {
  const ids: string[] = []
  const collect = (nodes: PinnedNode[]): void => {
    for (const n of nodes) {
      ids.push(n.id)
      if (n.kind === 'folder') collect(n.children)
    }
  }
  for (const s of parsed.spaces) {
    collect(s.pinned)
    ids.push(...s.today.map((t) => t.id))
  }
  for (const p of parsed.profiles) ids.push(...p.favorites.map((f) => f.id))
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.match(id, /^[0-9a-f-]{36}$/)
})

test('legacy integer emoji, missing title and no theme', () => {
  const json = structuredClone(fixture)
  const work = json.sidebar.containers[1].spaces[3]
  work.customInfo = { iconType: { emoji: 128640 } }
  delete work.title
  const out = parseArcSidebar(json, { palette: ['#123456', '#abcdef'] })
  assert.equal(out.spaces[1].emoji, '🚀')
  assert.equal(out.spaces[1].name, 'Space 2')
  assert.equal(out.spaces[1].color, '#abcdef')
})

test('named Arc icons become emoji; unknown ones fall back to the initial', () => {
  const json = structuredClone(fixture)
  const spaces = json.sidebar.containers[1].spaces
  spaces[1].customInfo = { iconType: { icon: 'planet' } }
  spaces[3].customInfo = { iconType: { icon: 'notAnIcon' } }
  const out = parseArcSidebar(json)
  assert.equal(out.spaces[0].emoji, '🪐')
  assert.equal(out.spaces[1].emoji, undefined)
})

test('falls back to newContainerIDs and parentID scanning', () => {
  const json = structuredClone(fixture)
  const c = json.sidebar.containers[1]
  c.spaces[3].containerIDs = []
  const project = c.items[c.items.findIndex((x: unknown) => x === '7BC03BED-ADEF-4F38-BA96-57DD5C298EB4') + 1]
  delete project.childrenIds
  const out = parseArcSidebar(json)
  assert.deepEqual(outline(out.spaces[1].pinned), [{ 'Project X': ['Project X › Active issues', 'Designs'] }, 'Team Wiki'])
})

test('favorites of the same profile dir on another Mac are skipped', () => {
  const json = structuredClone(fixture)
  const c = json.sidebar.containers[1]
  const other = { custom: { _0: { machineID: 'FFFFFFFF-0000-0000-0000-000000000000', directoryBasename: 'Profile 1' } } }
  c.topAppsContainerIDs.push(other, 'OTHER-MAC-TOP')
  c.items.push('OTHER-MAC-TOP', { id: 'OTHER-MAC-TOP', childrenIds: ['OTHER-MAC-FAV'], data: { itemContainer: { containerType: { topApps: { _0: other } } } } })
  c.items.push('OTHER-MAC-FAV', { id: 'OTHER-MAC-FAV', parentID: 'OTHER-MAC-TOP', childrenIds: [], data: { tab: { savedURL: 'https://other-mac.example/', savedTitle: 'Other Mac' } } })
  const out = parseArcSidebar(json)
  const work = out.profiles.find((p) => p.key === 'Profile 1')!
  assert.deepEqual(work.favorites.map((f) => f.url), parsed.profiles.find((p) => p.key === 'Profile 1')!.favorites.map((f) => f.url))
  assert.ok(out.warnings.some((w) => w.includes('another Mac')))
})

test('cached icons are attached by Arc item id', () => {
  const out = parseArcSidebar(fixture, { favicon: (id) => `data:image/png;base64,${id}` })
  const tabs = out.spaces.flatMap((s) => [...s.today, ...s.pinned.filter((n) => n.kind === 'tab')])
  assert.ok(tabs.length > 0)
  for (const t of tabs) assert.match(t.favicon ?? '', /^data:image\/png;base64,.+/)
  assert.equal(parseArcSidebar(fixture).spaces[0].today[0]?.favicon, undefined)
})

test('topApps fallback without topAppsContainerIDs', () => {
  const json = structuredClone(fixture)
  delete json.sidebar.containers[1].topAppsContainerIDs
  const out = parseArcSidebar(json)
  const fav = Object.fromEntries(out.profiles.map((p) => [p.key, p.favorites.length]))
  assert.deepEqual(fav, { Default: 2, 'Profile 1': 1 })
})

test('color clamping and invalid colors', () => {
  assert.equal(colorToHex({ red: -0.2, green: 1.5, blue: 0.5 }), '#00ff80')
  assert.equal(colorToHex({ red: 1, green: 1, blue: 1, alpha: 0 }), undefined)
  assert.equal(colorToHex({ red: 'x', green: 0, blue: 0 }), undefined)
})

test('malformed input returns an empty result without throwing', () => {
  for (const bad of [null, undefined, 42, 'x', [], {}, { sidebar: { containers: 'nope' } }, { version: 1, sidebar: { containers: [{ global: {} }, { spaces: ['orphan'] }] } }]) {
    const out = parseArcSidebar(bad)
    assert.deepEqual(out.spaces, [])
    assert.deepEqual(out.profiles, [])
  }
})

test('cycles and dangling children are skipped', () => {
  const json = {
    sidebar: {
      containers: [
        {
          spaces: ['S', { id: 'S', title: 'Loop', containerIDs: ['pinned', 'R'] }],
          items: [
            'R', { id: 'R', childrenIds: ['A', 'missing'], data: { itemContainer: {} } },
            'A', { id: 'A', title: 'A', childrenIds: ['B'], data: { list: {} } },
            'B', { id: 'B', title: 'B', childrenIds: ['A'], data: { list: {} } },
            'E', { id: 'E', parentID: 'R', data: { easel: {} } }
          ]
        }
      ]
    }
  }
  const out = parseArcSidebar(json)
  assert.deepEqual(outline(out.spaces[0].pinned), [{ A: [{ B: [] }] }])
  assert.ok(out.warnings.some((w) => w.includes('missing')))
})

test('readArcJson repairs raw backslashes from Windows paths', () => {
  const text = '{"url":"file:///C:\\Users\\me\\a.html","home":"C:\\users","ok":"\\u0041"}'
  assert.throws(() => JSON.parse(text))
  assert.deepEqual(readArcJson(text), { url: 'file:///C:\\Users\\me\\a.html', home: 'C:\\users', ok: 'A' })
})

test('archive entries (flat pairs or plain objects)', () => {
  const entry = (url: string, at: number) => ({
    reason: 'auto',
    archivedAt: at,
    source: { space: { _0: '235E9467-D8F1-46F0-A855-EB9EC2BFFCB0' } },
    sidebarItem: { id: url, title: null, data: { tab: { savedURL: url, savedTitle: 'T ' + url } } }
  })
  const archive = { items: ['x', entry('https://a.test/', 783000000), entry('https://b.test/', 783100000), { sidebarItem: { data: { list: {} } } }, entry('arc://x', 1)] }
  const out = parseArcArchive(archive)
  assert.deepEqual(out.map((a) => a.url), ['https://b.test/', 'https://a.test/'])
  assert.equal(out[1].archivedAt, Date.UTC(2001, 0, 1) + 783000000 * 1000)
  assert.equal(out[0].spaceArcId, '235E9467-D8F1-46F0-A855-EB9EC2BFFCB0')
  assert.equal(out[0].title, 'T https://b.test/')
  assert.equal(parseArcSidebar(fixture, { archive }).archive?.length, 2)
  assert.equal(parsed.archive, undefined)
})
