import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanMatch, routeFor, validRoutes } from '../../src/shared/link-routes.ts'

const routes = [
  { match: 'github.com/yenebeb', spaceId: 'work' },
  { match: 'github.com', spaceId: 'code' },
  { match: 'notion.so', spaceId: 'notes' }
]
const space = (url: string) => routeFor(routes, url)?.spaceId

test('a site rule covers the site and its subdomains, not look-alikes', () => {
  assert.equal(space('https://notion.so/page'), 'notes')
  assert.equal(space('https://www.notion.so/'), 'notes')
  assert.equal(space('https://team.notion.so/x'), 'notes')
  assert.equal(space('https://notnotion.so/'), undefined)
  assert.equal(space('https://notion.so.evil.example/'), undefined)
})

test('a rule with a path covers the pages under it, and the first match wins', () => {
  assert.equal(space('https://github.com/yenebeb'), 'work')
  assert.equal(space('https://github.com/Yenebeb/yarc/pulls?q=1'), 'work')
  assert.equal(space('https://github.com/yenebeb2/x'), 'code')
  assert.equal(space('https://gist.github.com/'), 'code')
})

test('a rule with a port matches only that port', () => {
  const local = [{ match: 'localhost:5173', spaceId: 'dev' }]
  assert.equal(routeFor(local, 'http://localhost:5173/app')?.spaceId, 'dev')
  assert.equal(routeFor(local, 'http://localhost:3000/app'), undefined)
})

test('only web links are routed', () => {
  assert.equal(space('file:///C:/github.com/a.html'), undefined)
  assert.equal(space('not a url'), undefined)
})

test('what people type is tidied to a site and path', () => {
  assert.equal(cleanMatch('  https://www.GitHub.com/yarc/?tab=1 '), 'github.com/yarc')
  assert.equal(cleanMatch('Figma.com'), 'figma.com')
})

test('routes from the UI are checked and tidied', () => {
  assert.deepEqual(validRoutes([{ match: 'https://Linear.app/', spaceId: 'a' }, { match: ' ', spaceId: 'b' }]), [{ match: 'linear.app', spaceId: 'a' }])
  assert.equal(validRoutes([{ match: 1, spaceId: 'a' }]), undefined)
  assert.equal(validRoutes('x'), undefined)
})
