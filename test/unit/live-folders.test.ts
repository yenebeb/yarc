import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { feedLinkInHtml, githubSearchUrl, LIVE_LIMIT, looksLikeHtml, mergeLive, parseFeed, parseGitHubSearch, type LiveEntry } from '../../src/main/features/live-sources.ts'
import { cleanLiveSource, githubPreset, githubQuery, liveFolderName, repoName } from '../../src/shared/live-folders.ts'
import type { PinnedNode, PinnedTab } from '../../src/shared/types.ts'

const BLOG = 'https://blog.example/'

describe('reading an RSS feed', () => {
  test('each item becomes an entry with its title and link', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title><link>https://blog.example/</link>
      <item><title>First post</title><link>https://blog.example/first</link></item>
      <item><title><![CDATA[Fish & <b>chips</b>]]></title><link>https://blog.example/second</link></item>
    </channel></rss>`
    assert.deepEqual(parseFeed(xml, BLOG), [
      { url: 'https://blog.example/first', title: 'First post' },
      { url: 'https://blog.example/second', title: 'Fish & chips' }
    ])
  })

  test('entities in titles are decoded', () => {
    const xml = '<rss><channel><item><title>Tom &amp; Jerry &#8212; &#x1F600;</title><link>https://blog.example/t</link></item></channel></rss>'
    assert.equal(parseFeed(xml, BLOG)[0].title, 'Tom & Jerry — 😀')
  })

  test('an item without a link uses its permalink guid, and a relative link resolves against the feed', () => {
    const xml = `<rss><channel>
      <item><title>Guid</title><guid>https://blog.example/by-guid</guid></item>
      <item><title>Not a permalink</title><guid isPermaLink="false">abc-123</guid></item>
      <item><title>Relative</title><link>/relative</link></item>
    </channel></rss>`
    assert.deepEqual(parseFeed(xml, 'https://blog.example/feed.xml').map((e) => e.url), ['https://blog.example/by-guid', 'https://blog.example/relative'])
  })

  test('an item without a title is named by its address', () => {
    assert.equal(parseFeed('<rss><item><link>https://blog.example/x</link></item></rss>', BLOG)[0].title, 'https://blog.example/x')
  })

  test('only web links are kept, so a feed cannot add a javascript:, file: or YARC page', () => {
    const xml = ['javascript:alert(1)', 'file:///etc/passwd', 'yarc://ui/index.html', 'https://blog.example/ok']
      .map((link) => `<item><title>x</title><link>${link}</link></item>`)
      .join('')
    assert.deepEqual(parseFeed(`<rss>${xml}</rss>`, BLOG).map((e) => e.url), ['https://blog.example/ok'])
  })

  test('an answer that isn’t a feed is an error, not an empty folder', () => {
    assert.throws(() => parseFeed('{"items": []}', BLOG), /isn’t an RSS or Atom feed/)
    assert.deepEqual(parseFeed('<rss><channel></channel></rss>', BLOG), [])
  })

  test('the same link twice is listed once', () => {
    const item = '<item><title>Same</title><link>https://blog.example/same</link></item>'
    assert.equal(parseFeed(`<rss>${item}${item}</rss>`, BLOG).length, 1)
  })
})

describe('reading an Atom feed', () => {
  test('entries link to their alternate page, not to themselves', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title><link rel="self" href="https://blog.example/atom"/>
      <entry><title type="html">v1.2 &lt;em&gt;released&lt;/em&gt;</title>
        <link rel="edit" href="https://blog.example/edit/12"/><link rel="alternate" type="text/html" href="https://blog.example/v1.2"/></entry>
      <entry><title>Bare link</title><link href='https://blog.example/bare'/></entry>
    </feed>`
    assert.deepEqual(parseFeed(xml, BLOG), [
      { url: 'https://blog.example/v1.2', title: 'v1.2 released' },
      { url: 'https://blog.example/bare', title: 'Bare link' }
    ])
  })
})

describe('a site address instead of a feed', () => {
  test('is recognised as a web page', () => {
    assert.equal(looksLikeHtml('<!DOCTYPE html><html><head>'), true)
    assert.equal(looksLikeHtml('  <!-- hi --><html lang="en">'), true)
    assert.equal(looksLikeHtml('<?xml version="1.0"?><rss>'), false)
    assert.equal(looksLikeHtml(`<!--${'--><!--'.repeat(5000)}`), false, 'in linear time: a page can\'t hang the browser')
  })

  test('leads to the feed the page names', () => {
    const html = `<html><head><link rel="stylesheet" href="/s.css"><link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml"></head></html>`
    assert.equal(feedLinkInHtml(html, 'https://blog.example/posts/'), 'https://blog.example/feed.xml')
  })

  test('a page without a feed has none', () => {
    assert.equal(feedLinkInHtml('<html><link rel="alternate" hreflang="de" href="/de/"></html>', BLOG), undefined)
  })
})

describe('reading a GitHub pull request search', () => {
  const result = (number: number, title: string, repo = 'yarc', owner = 'yenebeb') => ({
    number,
    hl_title: title,
    issue: { issue: { pull_request_id: number * 10 } },
    repo: { repository: { name: repo, owner_login: owner } }
  })
  const answer = (results: unknown[], loggedIn = true) => ({ payload: { blackbirdSearchRoute: { results, logged_in: loggedIn } } })

  test('asks github.com’s own search for pull requests', () => {
    assert.equal(githubSearchUrl('is:pr is:open author:@me'), 'https://github.com/search?q=is%3Apr%20is%3Aopen%20author%3A%40me&type=pullrequests')
  })

  test('each result links to its pull request, titled without search highlighting', () => {
    const entries = parseGitHubSearch(answer([result(105, 'Add <em>live</em> folders &amp; feeds'), result(7, 'Fix it', 'other', 'someone')]), 'is:pr live')
    assert.deepEqual(entries, [
      { url: 'https://github.com/yenebeb/yarc/pull/105', title: 'Add live folders & feeds' },
      { url: 'https://github.com/someone/other/pull/7', title: 'Fix it' }
    ])
  })

  test('“@me” searches ask you to sign in when GitHub doesn’t know who’s asking', () => {
    assert.throws(() => parseGitHubSearch(answer([], false), 'is:pr is:open author:@me'), /Sign in to github\.com/)
    assert.deepEqual(parseGitHubSearch(answer([], false), 'is:pr is:open repo:yenebeb/yarc'), [])
  })

  test('an answer that isn’t a search result is an error, not an empty folder', () => {
    assert.throws(() => parseGitHubSearch({ message: 'rate limited' }, 'is:pr'), /wasn’t a list/)
    assert.throws(() => parseGitHubSearch(undefined, 'is:pr'), /wasn’t a list/)
  })
})

describe('refreshing a live folder', () => {
  let n = 0
  const newId = () => `new-${++n}`
  const notInUse = () => false
  const tab = (id: string, url: string, title = id): PinnedTab => ({ kind: 'tab', id, url, savedUrl: url, title, savedTitle: title, lastActive: 0 })
  const entry = (url: string, title = url): LiveEntry => ({ url, title })
  const ids = (nodes: PinnedNode[] | undefined) => nodes?.map((x) => x.id)

  test('new entries become pinned tabs that open their link', () => {
    n = 0
    const next = mergeLive([], [entry('https://a.example/', 'A')], notInUse, newId, (url) => `${new URL(url).origin}/favicon.ico`)
    assert.deepEqual(next, [{ kind: 'tab', id: 'new-1', url: 'https://a.example/', savedUrl: 'https://a.example/', title: 'A', savedTitle: 'A', favicon: 'https://a.example/favicon.ico', lastActive: 0 }])
  })

  test('tabs already there keep their id, in the order the source lists them', () => {
    const a = tab('a', 'https://a.example/')
    const b = tab('b', 'https://b.example/')
    const next = mergeLive([a, b], [entry(b.url, 'b'), entry(a.url, 'a')], notInUse, newId)
    assert.deepEqual(ids(next), ['b', 'a'])
    assert.equal(next![0], b)
  })

  test('tabs the source no longer lists leave', () => {
    const a = tab('a', 'https://a.example/')
    const gone = tab('gone', 'https://gone.example/')
    assert.deepEqual(ids(mergeLive([a, gone], [entry(a.url, 'a')], notInUse, newId)), ['a'])
  })

  test('…unless their tab is in use, which stays at the end until it’s closed', () => {
    const a = tab('a', 'https://a.example/')
    const open = tab('open', 'https://open.example/')
    assert.deepEqual(ids(mergeLive([open, a], [entry(a.url, 'a')], (id) => id === 'open', newId)), ['a', 'open'])
  })

  test('a changed title is taken from the source', () => {
    const a = tab('a', 'https://a.example/', 'Old')
    const next = mergeLive([a], [entry(a.url, 'New')], notInUse, newId)
    assert.equal((next![0] as PinnedTab).savedTitle, 'New')
  })

  test('nothing changes when the source says the same thing', () => {
    const a = tab('a', 'https://a.example/')
    assert.equal(mergeLive([a], [entry(a.url, 'a')], notInUse, newId), undefined)
  })

  test(`only the first ${LIVE_LIMIT} entries are shown`, () => {
    const many = Array.from({ length: LIVE_LIMIT + 5 }, (_, i) => entry(`https://x.example/${i}`))
    assert.equal(mergeLive([], many, notInUse, newId)!.length, LIVE_LIMIT)
  })
})

describe('choosing a live folder’s source', () => {
  test('the GitHub choices are searches anyone could type on github.com', () => {
    assert.equal(githubQuery('mine', '', ''), 'is:pr is:open author:@me')
    assert.equal(githubQuery('review', '', ''), 'is:pr is:open review-requested:@me')
    assert.equal(githubQuery('repo', 'https://github.com/yenebeb/yarc.git', ''), 'is:pr is:open repo:yenebeb/yarc')
    assert.equal(githubQuery('custom', '', '  is:pr label:bug  '), 'is:pr label:bug')
  })

  test('a saved search reopens on the choice that made it', () => {
    for (const preset of ['mine', 'review'] as const) assert.deepEqual(githubPreset(githubQuery(preset, '', '')), { preset, repo: '' })
    assert.deepEqual(githubPreset('is:pr is:open repo:yenebeb/yarc'), { preset: 'repo', repo: 'yenebeb/yarc' })
    assert.deepEqual(githubPreset('is:pr is:open repo:yenebeb/yarc label:bug'), { preset: 'custom', repo: '' })
  })

  test('a repository can be pasted as its address', () => {
    assert.equal(repoName('github.com/yenebeb/yarc/pulls'), 'yenebeb/yarc')
    assert.equal(repoName(' yenebeb/yarc '), 'yenebeb/yarc')
  })

  test('a feed address without a scheme gets https, and only web addresses are accepted', () => {
    assert.deepEqual(cleanLiveSource({ kind: 'feed', url: 'blog.example/feed' }), { kind: 'feed', url: 'https://blog.example/feed' })
    assert.equal(cleanLiveSource({ kind: 'feed', url: 'file:///etc/passwd' }), undefined)
    assert.equal(cleanLiveSource({ kind: 'feed', url: 'yarc://ui/index.html' }), undefined)
    assert.equal(cleanLiveSource({ kind: 'github', query: '   ' }), undefined)
  })

  test('an unnamed folder is named after its source', () => {
    assert.equal(liveFolderName({ kind: 'github', query: 'is:pr is:open review-requested:@me' }), 'Review Requests')
    assert.equal(liveFolderName({ kind: 'github', query: 'is:pr is:open repo:yenebeb/yarc' }), 'yarc Pull Requests')
    assert.equal(liveFolderName({ kind: 'feed', url: 'https://www.blog.example/feed.xml' }), 'blog.example')
  })
})
