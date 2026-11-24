import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchSiteSearch, SITE_SEARCHES, siteSearchUrl } from '../../src/shared/site-search.ts'

const name = (input: string) => matchSiteSearch(input)?.name

test('the site search list: 19 sites and 8 search engines, each with a %s search URL', () => {
  assert.equal(SITE_SEARCHES.length, 27)
  for (const s of SITE_SEARCHES) assert.match(s.url, /^https:\/\/[^%]+%s/, s.name)
  assert.equal(new Set(SITE_SEARCHES.map((s) => s.keyword)).size, SITE_SEARCHES.length)
})

test('matchSiteSearch matches keyword and name prefixes', () => {
  assert.equal(name('youtube'), 'YouTube')
  assert.equal(name('you'), 'YouTube')
  assert.equal(name('YouTube.com'), 'YouTube')
  assert.equal(name('https://www.youtube.com/'), 'YouTube')
  assert.equal(name('gmail'), 'Gmail')
  assert.equal(name('mail.google'), 'Gmail')
  assert.equal(name('google m'), 'Google Maps')
  assert.equal(name('apple music'), 'Apple Music')
  assert.equal(name('wiki'), 'Wikipedia')
  assert.equal(name('google'), 'Google')
  assert.equal(name('bing'), 'Microsoft Bing')
  assert.equal(name('duck'), 'DuckDuckGo')
  assert.equal(name('brave'), 'Brave')
  assert.equal(name('perp'), 'Perplexity')
  assert.equal(matchSiteSearch('twitter')?.keyword, 'twitter.com')
  assert.equal(matchSiteSearch('x')?.keyword, 'x.com')
  for (const s of SITE_SEARCHES) assert.equal(matchSiteSearch(s.keyword), s, s.keyword)
})

test('matchSiteSearch ignores single letters, queries and other sites', () => {
  assert.equal(name(''), undefined)
  assert.equal(name('y'), undefined)
  assert.equal(name('youtube cats'), undefined)
  assert.equal(name('youtube.com/watch?v=1'), undefined)
  assert.equal(name('example.com'), undefined)
})

test('siteSearchUrl encodes the query into the site\'s URL', () => {
  const site = (n: string) => SITE_SEARCHES.find((s) => s.name === n)!
  assert.equal(siteSearchUrl(site('YouTube'), ' lofi beats '), 'https://www.youtube.com/results?search_query=lofi%20beats')
  assert.equal(siteSearchUrl(site('Spotify'), 'a&b'), 'https://open.spotify.com/search/a%26b')
  assert.equal(siteSearchUrl(site('Amazon'), 'usb-c'), 'https://www.amazon.com/s?k=usb-c')
})
