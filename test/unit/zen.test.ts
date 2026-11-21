import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseContainers, parsePrefs, parseProfilesIni, parseZenSession, readMozLz4 } from '../../src/main/importers/zen-session.ts'
import type { PinnedNode } from '../../src/shared/types.ts'

/** A mozLz4 file whose LZ4 block is the given sequences. */
function mozLz4(block: number[], size: number): Buffer {
  const header = Buffer.alloc(12)
  header.write('mozLz40\0', 0, 'latin1')
  header.writeUInt32LE(size, 8)
  return Buffer.concat([header, Buffer.from(block)])
}

/** The simplest valid LZ4 block: all literals in one final sequence. */
function literalsOnly(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8')
  const lengths: number[] = []
  let token = bytes.length
  if (token >= 15) {
    for (let rest = bytes.length - 15; ; rest -= 255) {
      lengths.push(Math.min(rest, 255))
      if (rest < 255) break
    }
    token = 15
  }
  return mozLz4([token << 4, ...lengths, ...bytes], bytes.length)
}

test('readMozLz4 decodes literals and overlapping matches', () => {
  const json = JSON.stringify({ spaces: [], tabs: [], note: 'x'.repeat(300) })
  assert.equal(readMozLz4(literalsOnly(json)).toString('utf8'), json)
  // "abc", then a match 3 back for 6 bytes (it copies bytes it is writing), then an empty last sequence.
  const abc = [0x32, 0x61, 0x62, 0x63, 3, 0, 0x00]
  assert.equal(readMozLz4(mozLz4(abc, 9)).toString('latin1'), 'abcabcabc')
})

test('readMozLz4 rejects other files and broken data', () => {
  assert.throws(() => readMozLz4(Buffer.from('{"spaces":[]}')), /Not a mozLz4 file/)
  assert.throws(() => readMozLz4(mozLz4([0x30, 0x61], 3)), /Corrupt/) // 3 literals announced, 1 present
  assert.throws(() => readMozLz4(mozLz4([0x10, 0x61, 9, 0], 5)), /Corrupt/) // match before the start
})

test('parseProfilesIni puts the install default first and keeps absolute paths', () => {
  const ini = `[Install6ED35B3CA1B5D3AF]\r\nDefault=Profiles/b.Default (release)\r\nLocked=1\r\n\r\n[Profile1]\r\nName=Old\r\nIsRelative=1\r\nPath=Profiles/a.default\r\nDefault=1\r\n\r\n[Profile0]\r\nName=Default (release)\r\nIsRelative=1\r\nPath=Profiles/b.Default (release)\r\n\r\n[Profile2]\r\nName=Elsewhere\r\nIsRelative=0\r\nPath=/Volumes/USB/zen\r\n\r\n[General]\r\nVersion=2\r\n`
  assert.deepEqual(parseProfilesIni(ini), [
    { name: 'Default (release)', path: 'Profiles/b.Default (release)', relative: true },
    { name: 'Old', path: 'Profiles/a.default', relative: true },
    { name: 'Elsewhere', path: '/Volumes/USB/zen', relative: false }
  ])
})

test('parsePrefs and parseContainers read Zen settings and container names', () => {
  const prefs = parsePrefs('// Mozilla User Preferences\nuser_pref("zen.workspaces.active", "{s2}");\nuser_pref("zen.workspaces.container-specific-essentials-enabled", true);\nuser_pref("browser.x", 3);\n')
  assert.equal(prefs.get('zen.workspaces.active'), '{s2}')
  assert.equal(prefs.get('zen.workspaces.container-specific-essentials-enabled'), true)
  assert.equal(prefs.get('browser.x'), 3)
  const containers = parseContainers({ identities: [{ userContextId: 1, public: true }, { userContextId: 6, name: 'Clients', public: true }, { userContextId: 5, name: 'Hidden', public: false }] })
  assert.deepEqual([...containers], [
    [1, 'Personal'],
    [6, 'Clients']
  ])
})

const NOW = Date.UTC(2026, 10, 2)
const icon = 'data:image/png;base64,AAAA'
const page = (url: string, title: string) => ({ url, title })
const pinnedTab = (space: string | null, url: string, title: string, extra: Record<string, unknown> = {}) => ({
  entries: [page(url, title), page(`${url}moved`, 'Moved on')],
  index: 2,
  pinned: true,
  zenWorkspace: space,
  _zenPinnedInitialState: { entry: page(url, title) },
  image: icon,
  lastAccessed: 1000,
  userContextId: 0,
  ...extra
})
const session = {
  spaces: [
    { uuid: '{s1}', name: 'Home', icon: '🏠', containerTabId: 0, theme: { gradientColors: [{ c: [10, 20, 30], isPrimary: false }, { c: [255, 128, 0], isPrimary: true }] } },
    { uuid: '{s2}', name: '', containerTabId: 2, theme: { gradientColors: [] } }
  ],
  folders: [
    { id: 'f1', name: 'Reading', workspaceId: '{s1}', parentId: null, collapsed: true },
    { id: 'f2', name: 'Inner', workspaceId: '{s1}', parentId: 'f1', collapsed: false },
    { id: 'f3', name: 'Empty', workspaceId: '{s1}', parentId: null, collapsed: false }
  ],
  tabs: [
    pinnedTab(null, 'https://mail.example/', 'Mail', { zenEssential: true, userContextId: 2 }),
    pinnedTab('{s1}', 'https://docs.example/', 'Docs', { zenStaticLabel: 'My docs' }),
    pinnedTab('{s1}', 'https://news.example/', 'News', { groupId: 'f2' }),
    pinnedTab('{s1}', 'https://blog.example/', 'Blog', { groupId: 'f1' }),
    pinnedTab('{s1}', 'about:preferences', 'Settings'),
    { entries: [page('https://a.example/', 'A')], index: 1, zenWorkspace: '{s1}', lastAccessed: 10 },
    { entries: [page('https://b.example/', 'B')], index: 1, zenWorkspace: '{s1}', lastAccessed: 20 },
    { entries: [page('https://glance.example/', 'G')], index: 1, zenWorkspace: '{s1}', zenIsGlance: true },
    { entries: [page('about:blank', '')], index: 1, zenWorkspace: '{s1}', pinned: true, zenIsEmpty: true, groupId: 'f3' },
    { entries: [page('https://work.example/', 'Work')], index: 1, zenWorkspace: '{s2}', lastAccessed: 30 }
  ]
}

const outline = (nodes: PinnedNode[]): unknown[] => nodes.map((n) => (n.kind === 'folder' ? { [`${n.name}${n.open ? '' : ' (closed)'}`]: outline(n.children) } : n.kind === 'tab' ? n.title : n.name))

test('parseZenSession turns spaces into spaces with a profile per container', () => {
  const parsed = parseZenSession(session, { palette: ['#123456'], containers: new Map([[2, 'Work']]), activeSpace: '{s2}', now: NOW })
  assert.deepEqual(
    parsed.profiles.map((p) => [p.key, p.name]),
    [
      ['0', 'Zen'],
      ['2', 'Work']
    ]
  )
  const [home, second] = parsed.spaces
  assert.deepEqual([home.name, home.emoji, home.color, home.profileKey], ['Home', '🏠', '#ff8000', '0'])
  assert.deepEqual([second.name, second.emoji, second.color, second.profileKey], ['Space 2', undefined, '#123456', '2'])
  assert.equal(parsed.activeSpaceId, '{s2}')
})

test('parseZenSession keeps pinned tabs at their pinned URL, in folders, with renamed titles', () => {
  const [home] = parseZenSession(session, { now: NOW }).spaces
  assert.deepEqual(outline(home.pinned), ['My docs', { 'Reading (closed)': [{ Inner: ['News'] }, 'Blog'] }, { Empty: [] }])
  const docs = home.pinned[0]
  assert.equal(docs.kind, 'tab')
  if (docs.kind !== 'tab') return
  assert.equal(docs.url, 'https://docs.example/')
  assert.equal(docs.savedUrl, 'https://docs.example/')
  assert.equal(docs.savedTitle, 'My docs')
  assert.equal(docs.favicon, icon)
})

test('parseZenSession makes other web tabs Today tabs, newest first, without Glance tabs', () => {
  const [home, second] = parseZenSession(session, { now: NOW }).spaces
  assert.deepEqual(
    home.today.map((t) => [t.title, t.savedUrl]),
    [
      ['B', undefined],
      ['A', undefined]
    ]
  )
  assert.deepEqual(
    second.today.map((t) => t.url),
    ['https://work.example/']
  )
})

test('essentials become favorites in every profile, or only their container’s when Zen keeps them apart', () => {
  const shared = parseZenSession(session, { now: NOW })
  assert.equal(shared.essentials, 1)
  assert.deepEqual(
    shared.profiles.map((p) => p.favorites.map((f) => [f.title, f.savedUrl])),
    [[['Mail', 'https://mail.example/']], [['Mail', 'https://mail.example/']]]
  )
  assert.notEqual(shared.profiles[0].favorites[0].id, shared.profiles[1].favorites[0].id)

  const apart = parseZenSession(session, { now: NOW, containerEssentials: true })
  assert.deepEqual(
    apart.profiles.map((p) => p.favorites.length),
    [0, 1]
  )
})

test('parseZenSession survives missing or odd data', () => {
  assert.deepEqual(parseZenSession(undefined), { profiles: [], spaces: [], essentials: 0, activeSpaceId: undefined })
  const looped = parseZenSession(
    {
      spaces: [{ uuid: 'x', name: 'X' }],
      folders: [
        { id: 'a', name: 'A', workspaceId: 'x', parentId: 'b' },
        { id: 'b', name: 'B', workspaceId: 'x', parentId: 'a' }
      ],
      tabs: [{ pinned: true, zenWorkspace: 'x', groupId: 'a', entries: [] }]
    },
    { now: NOW }
  )
  assert.deepEqual(outline(looped.spaces[0].pinned), [{ B: [{ A: [] }] }])
  assert.equal(looped.profiles[0].name, 'Zen')
})
