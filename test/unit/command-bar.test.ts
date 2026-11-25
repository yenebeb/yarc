// The command bar (⌘T): which rows it shows for what was typed, and in which order, like Arc.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { History } from '../../src/main/history.ts'
import { arrange, historyCandidates, searchedFor, type Candidate } from '../../src/main/search-rank.ts'
import type { SearchResult } from '../../src/shared/types.ts'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const DAY = 864e5

const command = (title: string): Candidate => ({ source: 'command', result: { kind: 'command', id: `cmd:${title}`, title } })

const openTab = (title: string, url: string): Candidate => ({
  source: 'tab',
  result: { kind: 'tab', id: `tab:${url}`, title, url },
  inActiveSpace: true,
  loaded: true
})

function visited(url: string, title: string, { visits = 1, daysAgo = 1 } = {}): Candidate {
  return { source: 'history', result: { kind: 'history', id: `hist:${url}`, title, url }, visitCount: visits, lastVisit: NOW - daysAgo * DAY }
}

const canvasNamed = (title: string, { inActiveSpace = true } = {}): Candidate => ({
  source: 'canvas',
  result: { kind: 'canvas', id: `canvas:${title}`, title, target: title },
  inActiveSpace
})

const archived = (title: string, url: string): Candidate => ({ source: 'archive', result: { kind: 'archive', id: `arch:${url}`, title, url } })

/** The rows the bar shows for `typed`, by title; the search for what was typed reads `Search "…"`. */
function typeInBar(typed: string, everything: Candidate[]): string[] {
  const searchRow: SearchResult = { kind: 'suggestion', id: `search:${typed}`, title: typed, url: typed, subtitle: 'Search Google' }
  return arrange(typed, searchRow, everything, NOW).map((row) => (row === searchRow ? `Search "${typed}"` : row.title))
}

describe('the top hit, above the search for what was typed', () => {
  test("typing a command's first letters puts that command first", () => {
    const rows = typeInBar('setti', [
      visited('https://dev.azure.com/org/_settings/permissions', 'Settings · Permissions', { visits: 139 }),
      openTab('Settings · Overview', 'https://dev.azure.com/org/_settings/'),
      command('Settings')
    ])
    assert.deepEqual(rows, ['Settings', 'Search "setti"', 'Settings · Overview', 'Settings · Permissions'])
  })

  test('an open tab whose name starts with what was typed is the top hit', () => {
    assert.deepEqual(typeInBar('inbox', [openTab('Inbox (3)', 'https://mail.google.com/')]), ['Inbox (3)', 'Search "inbox"'])
  })

  test('a visited site whose address starts with what was typed is the top hit, so its address completes inline', () => {
    assert.deepEqual(typeInBar('git', [visited('https://github.com/', 'GitHub')]), ['GitHub', 'Search "git"'])
  })

  test("typing a site's name completes to its front page when that was visited, not to its busiest page", () => {
    const rows = typeInBar('linear', [
      visited('https://linear.app/team/cycle', 'Cycle 31', { visits: 150 }),
      visited('https://linear.app/', 'Linear', { visits: 2 })
    ])
    assert.deepEqual(rows, ['Linear', 'Search "linear"', 'Cycle 31'])
  })

  test('the search comes first when nothing starts with what was typed', () => {
    assert.deepEqual(typeInBar('perm', [openTab('Settings · Permissions', 'https://dev.azure.com/org/_settings/permissions')]), [
      'Search "perm"',
      'Settings · Permissions'
    ])
  })

  test('a visited page whose title starts with what was typed comes after the search, because Enter would not show where it goes', () => {
    const pipelines = visited('https://dev.azure.com/org/_build', 'Pipelines - Recent', { visits: 2552 })
    assert.deepEqual(typeInBar('pipe', [pipelines]), ['Search "pipe"', 'Pipelines - Recent'])
  })

  test('a typed address stays first, before history on that site', () => {
    const typedAddress: SearchResult = { kind: 'url', id: 'url:https://github.com', title: 'https://github.com', url: 'https://github.com' }
    const rows = arrange('github.com', typedAddress, [visited('https://github.com/yenebeb/yarc', 'yarc')], NOW)
    assert.deepEqual(rows.map((r) => r.title), ['https://github.com', 'yarc'])
  })
})

describe('canvases in the bar', () => {
  test("typing a canvas's first letters puts it first, above the search for what was typed", () => {
    assert.deepEqual(typeInBar('kitch', [openTab('Kitchen shop with everything for a home cook', 'https://shop.example/kitchen'), canvasNamed('Kitchen ideas')]), [
      'Kitchen ideas',
      'Search "kitch"',
      'Kitchen shop with everything for a home cook'
    ])
  })

  test('a canvas is found by a word in its name too, but not as a top hit', () => {
    assert.deepEqual(typeInBar('ideas', [canvasNamed('Kitchen ideas')]), ['Search "ideas"', 'Kitchen ideas'])
  })

  test('a canvas of the space you are in comes before one of another space', () => {
    assert.deepEqual(typeInBar('trip', [canvasNamed('Trip (work)', { inActiveSpace: false }), canvasNamed('Trip (home)')]), ['Trip (home)', 'Search "trip"', 'Trip (work)'])
  })

  test('a canvas whose name has nothing of what was typed is left out', () => {
    assert.deepEqual(typeInBar('zebra', [canvasNamed('Kitchen ideas')]), ['Search "zebra"'])
  })
})

describe('the order of the other rows', () => {
  test('a name that starts with what was typed beats one that only contains it, even a command', () => {
    const rows = typeInBar('his', [command('Show History'), visited('https://example.com/rome', 'History of Rome')])
    assert.deepEqual(rows, ['Search "his"', 'History of Rome', 'Show History'])
  })

  test('at the same strength of match, commands and open tabs come before history', () => {
    const rows = typeInBar('page', [visited('https://example.com/', 'Home page', { visits: 500 }), command('Reload Page')])
    assert.deepEqual(rows, ['Search "page"', 'Reload Page', 'Home page'])
  })

  test('a command whose whole name is nearly what was typed beats a long tab title that starts the same', () => {
    const rows = typeInBar('setti', [openTab('Settings · Permissions (Bar of the Future) - Settings', 'https://dev.azure.com/'), command('Settings')])
    assert.deepEqual(rows[0], 'Settings')
  })

  test('of two pages in history, the one visited more often comes first', () => {
    const rows = typeInBar('docs', [visited('https://a.example/docs', 'Docs: once', { visits: 1 }), visited('https://b.example/docs', 'Docs: daily', { visits: 40 })])
    assert.deepEqual(rows, ['Search "docs"', 'Docs: daily', 'Docs: once'])
  })

  test('a page visited yesterday beats one visited as often half a year ago', () => {
    const rows = typeInBar('docs', [
      visited('https://a.example/docs', 'Docs: last spring', { visits: 10, daysAgo: 180 }),
      visited('https://b.example/docs', 'Docs: yesterday', { visits: 10, daysAgo: 1 })
    ])
    assert.deepEqual(rows, ['Search "docs"', 'Docs: yesterday', 'Docs: last spring'])
  })

  test('archived tabs come after history', () => {
    const rows = typeInBar('report', [archived('Report Q3', 'https://example.com/q3'), visited('https://example.com/q4', 'Report Q4')])
    assert.deepEqual(rows, ['Search "report"', 'Report Q4', 'Report Q3'])
  })

  test('typed words find a page in any order', () => {
    assert.deepEqual(typeInBar('future bar', [visited('https://dev.azure.com/', 'Bar of the Future - Repos')]), [
      'Search "future bar"',
      'Bar of the Future - Repos'
    ])
  })

  test('letters typed in order still find a command, after everything that matches better', () => {
    const rows = typeInBar('stg', [command('Settings'), visited('https://example.com/stg', 'Staging')])
    assert.deepEqual(rows, ['Search "stg"', 'Staging', 'Settings'])
  })

  test('leaves out what does not match', () => {
    assert.deepEqual(typeInBar('setti', [command('Reload Page'), visited('https://example.com/', 'Home')]), ['Search "setti"'])
  })
})

describe('searches made before', () => {
  const googled = (query: string, extra = '') => `https://www.google.com/search?q=${encodeURIComponent(query)}${extra}`

  test("reads what was searched from a search engine's results page", () => {
    assert.equal(searchedFor(googled('play on multiple sonos')), 'play on multiple sonos')
    assert.equal(searchedFor('https://duckduckgo.com/?q=lofi+beats'), 'lofi beats')
    assert.equal(searchedFor('https://www.bing.com/search?q=yarc'), 'yarc')
    assert.equal(searchedFor('https://www.google.com/maps?q=amsterdam'), undefined)
    assert.equal(searchedFor('https://github.com/search?q=yarc'), undefined)
  })

  test('shows a past search as what was searched, once, however many result pages it left in history', () => {
    const entries = [
      { url: googled('sonos mac'), title: 'sonos mac - Google Search', visitCount: 2, lastVisit: NOW - DAY },
      { url: googled('sonos mac', '&sca_esv=1&udm=2'), title: 'google.com/search?q=sonos mac', visitCount: 1, lastVisit: NOW }
    ]
    const searches = historyCandidates(entries, 'sonos')
    assert.deepEqual(
      searches.map((s) => ({ kind: s.result.kind, title: s.result.title, opens: s.result.url })),
      [{ kind: 'pastSearch', title: 'sonos mac', opens: 'sonos mac' }]
    )
  })

  test('leaves out the past search for exactly what was typed, because the second row already searches it', () => {
    const entries = [{ url: googled('linear'), title: 'linear - Google Search', visitCount: 1, lastVisit: NOW }]
    assert.deepEqual(historyCandidates(entries, 'linear'), [])
  })

  test('ranks a past search by what was searched, not by the search engine address', () => {
    const entries = [{ url: googled('sonos mac'), title: 'sonos mac - Google Search', visitCount: 1, lastVisit: NOW }]
    assert.deepEqual(typeInBar('goo', historyCandidates(entries, 'goo')), ['Search "goo"'])
  })
})

describe('what history the bar is given', () => {
  function historyOf(pages: { url: string; title: string; visits?: number }[]): History {
    const history = new History(undefined, NOW)
    for (const page of pages) for (let i = 0; i < (page.visits ?? 1); i++) history.visit(page.url, page.title, NOW - DAY)
    return history
  }
  const urlsFound = (history: History, typed: string) => history.search(typed).map((h) => h.url)

  test('finds every page that contains the typed words, not only the eight most visited', () => {
    const runs = Array.from({ length: 30 }, (_, n) => ({ url: `https://ci.example/run/${n}`, title: `Pipeline run ${n}` }))
    assert.equal(urlsFound(historyOf(runs), 'pipeline run').length, runs.length)
  })

  test('finds a page by words that are apart in its title', () => {
    const history = historyOf([{ url: 'https://dev.azure.com/org/_git', title: 'Bar of the Future - Repos' }])
    assert.deepEqual(urlsFound(history, 'future repos'), ['https://dev.azure.com/org/_git'])
  })

  test('finds a site whose address starts with what was typed, even among many busier pages that only contain it', () => {
    const busier = Array.from({ length: 600 }, (_, n) => ({ url: `https://login.example/online/${n}`, title: 'Sign in', visits: 3 }))
    const history = historyOf([...busier, { url: 'https://linear.app/', title: 'Linear' }])
    assert.ok(urlsFound(history, 'lin').includes('https://linear.app/'))
  })

  test('takes % and _ in what was typed literally', () => {
    const history = historyOf([
      { url: 'https://example.com/a_b', title: 'with an underscore' },
      { url: 'https://example.com/axb', title: 'without' }
    ])
    assert.deepEqual(urlsFound(history, 'a_b'), ['https://example.com/a_b'])
  })
})
