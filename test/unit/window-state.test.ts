// Several main windows share one sidebar; each shows its own space, tab, splits and sidebar.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyView, captureView, cascade, inAnyView, newView, stateForView, viewFromState } from '../../src/main/features/window-state.ts'
import type { PersistedState, Split, TabItem } from '../../src/shared/types.ts'

const tab = (id: string): TabItem => ({ id, url: `https://${id}.example`, title: id, lastActive: 0 })
const split = (id: string, a: string, b: string): Split => ({ id, root: { dir: 'row', children: [{ itemId: a }, { itemId: b }], sizes: [0.5, 0.5] } })

/** Two spaces: Home (mail, news, docs) and Work (jira), sharing one profile. */
function sidebar(): PersistedState {
  return {
    version: 1,
    profiles: [{ id: 'p', name: 'Default', favorites: [] }],
    spaces: [
      { id: 'home', name: 'Home', color: '#fff', profileId: 'p', pinned: [{ ...tab('mail'), kind: 'tab' }], today: [tab('news'), tab('docs')], splits: [] },
      { id: 'work', name: 'Work', color: '#000', profileId: 'p', pinned: [], today: [tab('jira')], splits: [] }
    ],
    activeSpaceId: 'home',
    settings: { sidebarVisible: true } as PersistedState['settings'],
    archive: [],
    littleArc: { profileByHost: {} },
    windows: []
  }
}

const home = (s: PersistedState) => s.spaces[0]
const work = (s: PersistedState) => s.spaces[1]

// ---------------------------------------------------------------- switching windows

test('each window keeps its own space, tab, splits and sidebar when you switch between them', () => {
  const state = sidebar()
  home(state).activeItemId = 'news'
  const first = viewFromState(state, 'first')
  const second = newView('second', 'work')

  applyView(state, second) // the second window comes to the front
  work(state).activeItemId = 'jira'
  state.settings.sidebarVisible = false
  captureView(state, second)

  applyView(state, first) // and back to the first
  assert.equal(state.activeSpaceId, 'home')
  assert.equal(home(state).activeItemId, 'news')
  assert.equal(work(state).activeItemId, undefined, 'the first window never opened a tab in Work')
  assert.equal(state.settings.sidebarVisible, true)

  applyView(state, second)
  assert.equal(state.activeSpaceId, 'work')
  assert.equal(work(state).activeItemId, 'jira')
  assert.equal(home(state).activeItemId, undefined)
  assert.equal(state.settings.sidebarVisible, false)
})

test('a split made in one window is not split in the other', () => {
  const state = sidebar()
  const first = viewFromState(state, 'first')
  home(state).splits = [split('s1', 'news', 'docs')]
  captureView(state, first)

  applyView(state, newView('second', 'home'))
  assert.deepEqual(home(state).splits, [])

  applyView(state, first)
  assert.deepEqual(home(state).splits, [split('s1', 'news', 'docs')])
})

test('a pin made in one window shows in the other: the sidebar itself is shared', () => {
  const state = sidebar()
  const first = viewFromState(state, 'first')
  const second = newView('second', 'home')
  applyView(state, second)
  home(state).pinned.push({ ...tab('docs'), kind: 'tab' })
  home(state).today = home(state).today.filter((t) => t.id !== 'docs')
  captureView(state, second)

  applyView(state, first)
  assert.deepEqual(
    home(state).pinned.map((n) => n.id),
    ['mail', 'docs']
  )
})

// ---------------------------------------------------------------- tabs changed by another window

test('a tab closed in another window is no longer selected when this window comes back', () => {
  const state = sidebar()
  home(state).activeItemId = 'news'
  const first = viewFromState(state, 'first')
  home(state).today = home(state).today.filter((t) => t.id !== 'news') // closed in the other window
  applyView(state, first)
  assert.equal(home(state).activeItemId, undefined)
})

test('a split loses a tab that moved to another space, and ends when one tab is left', () => {
  const state = sidebar()
  home(state).splits = [split('s1', 'news', 'docs')]
  const first = viewFromState(state, 'first')
  home(state).today = [tab('news')]
  work(state).today.push(tab('docs')) // moved to Work from the other window
  applyView(state, first)
  assert.deepEqual(home(state).splits, [])
})

test('a window on a deleted space shows the first space', () => {
  const state = sidebar()
  const onWork = newView('w', 'work')
  state.spaces = [home(state)]
  applyView(state, onWork)
  assert.equal(state.activeSpaceId, 'home')
})

// ---------------------------------------------------------------- what other windows' UIs get

test("another window's UI sees its own view without changing the state", () => {
  const state = sidebar()
  home(state).activeItemId = 'news'
  const other = { ...newView('other', 'work'), selected: { work: 'jira' }, sidebarVisible: false }

  const seen = stateForView(state, other)
  assert.equal(seen.activeSpaceId, 'work')
  assert.equal(work(seen).activeItemId, 'jira')
  assert.equal(home(seen).activeItemId, undefined)
  assert.equal(seen.settings.sidebarVisible, false)

  assert.equal(state.activeSpaceId, 'home', 'the current window is untouched')
  assert.equal(home(state).activeItemId, 'news')
  assert.equal(state.settings.sidebarVisible, true)
})

// ---------------------------------------------------------------- new windows

test('a new window shows the given space with nothing selected and the sidebar out, like Arc', () => {
  const view = newView('new', 'work', { x: 10, y: 10, width: 800, height: 600 })
  assert.equal(view.activeSpaceId, 'work')
  assert.deepEqual(view.selected, {})
  assert.deepEqual(view.splits, {})
  assert.equal(view.sidebarVisible, true)
})

test('a new window cascades down and right from the current one', () => {
  const screen = { x: 0, y: 25, width: 1728, height: 1092 }
  assert.deepEqual(cascade({ x: 100, y: 80, width: 1200, height: 800 }, screen), { x: 122, y: 102, width: 1200, height: 800 })
})

test('a new window that would leave the screen starts at its top-left corner', () => {
  const screen = { x: 0, y: 25, width: 1728, height: 1092 }
  assert.deepEqual(cascade({ x: 0, y: 25, width: 1728, height: 1092 }, screen), { x: 0, y: 25, width: 1728, height: 1092 })
})

// ---------------------------------------------------------------- auto-archive

test('a Today tab counts as shown when any window selects it or has it in a split', () => {
  const views = [
    { ...newView('a', 'home'), selected: { home: 'news' } },
    { ...newView('b', 'home'), splits: { home: [split('s1', 'docs', 'mail')] } }
  ]
  assert.equal(inAnyView(views, 'news'), true)
  assert.equal(inAnyView(views, 'docs'), true)
  assert.equal(inAnyView(views, 'jira'), false)
})
