import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  bestToken,
  decide,
  modifyRequestHeaders,
  modifyResponseHeaders,
  PreparedRequest,
  redirectTarget,
  RuleIndex,
  ruleError,
  type HeaderInfo,
  type Match,
  type NetRequest,
  type Rule,
  type RuleAction,
  type RuleCondition
} from '../../src/main/net/net-rules.ts'

const block: RuleAction = { type: 'block' }
const allow: RuleAction = { type: 'allow' }
let nextId = 1
const rule = (condition: RuleCondition, action: RuleAction = block, priority?: number): Rule => ({ id: nextId++, priority, action, condition })

const script = (url: string, initiator = 'https://news.example/'): NetRequest => ({ url, type: 'script', initiator })
const page = (url: string): NetRequest => ({ url, type: 'main_frame' })

function blocks(condition: RuleCondition, request: NetRequest): boolean {
  return new RuleIndex('test', [rule(condition)]).match(new PreparedRequest(request)).length > 0
}

function verdict(rules: Rule[], request: NetRequest, allowedUpTo = 0) {
  return decide(new RuleIndex('test', rules).match(new PreparedRequest(request)), allowedUpTo)
}

describe('urlFilter', () => {
  test('plain text matches anywhere in the URL, ignoring case', () => {
    assert.equal(blocks({ urlFilter: '/ads/' }, script('https://cdn.example/ADS/banner.js')), true)
    assert.equal(blocks({ urlFilter: '/ads/' }, script('https://cdn.example/news/banner.js')), false)
  })

  test('|| anchors at the start of the domain or any subdomain, not mid-label', () => {
    const tracker = { urlFilter: '||tracker.example^' }
    assert.equal(blocks(tracker, script('https://tracker.example/t.js')), true)
    assert.equal(blocks(tracker, script('https://eu.tracker.example/t.js')), true)
    assert.equal(blocks(tracker, script('https://nottracker.example/t.js')), false)
    assert.equal(blocks(tracker, script('https://cdn.example/?ref=tracker.example')), false)
  })

  test('^ is a separator or the end of the URL, but not a letter, digit or _-.%', () => {
    assert.equal(blocks({ urlFilter: 'ads^' }, script('https://cdn.example/ads?x=1')), true)
    assert.equal(blocks({ urlFilter: 'ads^' }, script('https://cdn.example/ads')), true)
    assert.equal(blocks({ urlFilter: 'ads^' }, script('https://cdn.example/ads.js')), false)
  })

  test('| anchors the start or end of the URL, and * is any text', () => {
    assert.equal(blocks({ urlFilter: '|https://cdn.example/*.js|' }, script('https://cdn.example/a/b.js')), true)
    assert.equal(blocks({ urlFilter: '|https://cdn.example/*.js|' }, script('https://cdn.example/a/b.js?v=2')), false)
    assert.equal(blocks({ urlFilter: '|https://cdn.example/' }, script('https://mirror.example/?u=https://cdn.example/')), false)
  })

  test('isUrlFilterCaseSensitive makes case count', () => {
    assert.equal(blocks({ urlFilter: '/Ads/', isUrlFilterCaseSensitive: true }, script('https://cdn.example/ads/x.js')), false)
    assert.equal(blocks({ urlFilter: '/Ads/', isUrlFilterCaseSensitive: true }, script('https://cdn.example/Ads/x.js')), true)
  })
})

describe('regexFilter', () => {
  test('matches like a regular expression, with RE2 named groups understood', () => {
    assert.equal(blocks({ regexFilter: '^https://cdn\\.example/[0-9]+\\.js$' }, script('https://cdn.example/123.js')), true)
    assert.equal(blocks({ regexFilter: '(?P<n>[0-9]+)\\.js$' }, script('https://cdn.example/a.js')), false)
  })
})

describe('which requests a rule applies to', () => {
  test('by default every resource type except the page itself', () => {
    assert.equal(blocks({ urlFilter: '||ads.example^' }, script('https://ads.example/x.js')), true)
    assert.equal(blocks({ urlFilter: '||ads.example^' }, page('https://ads.example/')), false)
    assert.equal(blocks({ urlFilter: '||ads.example^', resourceTypes: ['main_frame'] }, page('https://ads.example/')), true)
    assert.equal(blocks({ urlFilter: '||ads.example^', excludedResourceTypes: ['script'] }, page('https://ads.example/')), true)
  })

  test('requestDomains match a domain and its subdomains; the excluded list wins', () => {
    const condition = { requestDomains: ['ads.example'], excludedRequestDomains: ['ok.ads.example'] }
    assert.equal(blocks(condition, script('https://ads.example/x.js')), true)
    assert.equal(blocks(condition, script('https://eu.ads.example/x.js')), true)
    assert.equal(blocks(condition, script('https://ok.ads.example/x.js')), false)
    assert.equal(blocks(condition, script('https://myads.example/x.js')), false)
  })

  test('initiatorDomains look at who asked; a request nobody asked for never matches them', () => {
    const condition = { urlFilter: '/widget.js', initiatorDomains: ['news.example'] }
    assert.equal(blocks(condition, script('https://cdn.example/widget.js', 'https://www.news.example')), true)
    assert.equal(blocks(condition, script('https://cdn.example/widget.js', 'https://blog.example')), false)
    assert.equal(blocks(condition, { url: 'https://cdn.example/widget.js', type: 'script' }), false)
    assert.equal(blocks({ urlFilter: '/widget.js', excludedInitiatorDomains: ['news.example'] }, script('https://cdn.example/widget.js')), false)
  })

  test('domainType compares sites, so a subdomain is still first party', () => {
    const fromNews = (url: string) => script(url, 'https://www.news.co.uk/')
    assert.equal(blocks({ domainType: 'thirdParty' }, fromNews('https://cdn.news.co.uk/a.js')), false)
    assert.equal(blocks({ domainType: 'thirdParty' }, fromNews('https://cdn.other.co.uk/a.js')), true)
    assert.equal(blocks({ domainType: 'firstParty' }, fromNews('https://cdn.news.co.uk/a.js')), true)
  })

  test('request methods and tab ids', () => {
    const post = { url: 'https://api.example/log', type: 'xmlhttprequest', method: 'POST', tabId: 7 } as const
    assert.equal(blocks({ requestMethods: ['post'] }, post), true)
    assert.equal(blocks({ excludedRequestMethods: ['post'] }, post), false)
    assert.equal(blocks({ tabIds: [7] }, post), true)
    assert.equal(blocks({ excludedTabIds: [7] }, post), false)
  })

  test('rules conditioned on response headers are left out rather than guessed at', () => {
    assert.equal(blocks({ urlFilter: 'ads', responseHeaders: [{ header: 'x' }] }, script('https://ads.example/')), false)
  })
})

describe('the index finds the same rules as checking each one', () => {
  test('rules keyed by token, request domain, initiator domain or nothing all match', () => {
    const rules = [
      rule({ urlFilter: '||tracker.example^' }),
      rule({ requestDomains: ['pixel.example', 'beacon.example'] }),
      rule({ initiatorDomains: ['news.example'], resourceTypes: ['image'] }),
      rule({ urlFilter: '*/banner*' })
    ]
    const index = new RuleIndex('test', rules)
    const ids = (r: NetRequest) => index.match(new PreparedRequest(r)).map((m) => m.rule.id)
    assert.deepEqual(ids(script('https://a.tracker.example/x')), [rules[0].id])
    assert.deepEqual(ids(script('https://beacon.example/x')), [rules[1].id])
    assert.deepEqual(ids({ url: 'https://img.example/x.png', type: 'image', initiator: 'https://news.example' }), [rules[2].id])
    assert.deepEqual(ids(script('https://cdn.example/top/banner-1.js')), [rules[3].id])
  })

  test('a rule listed under two of a host’s domains matches once', () => {
    const index = new RuleIndex('test', [rule({ requestDomains: ['example', 'ads.example'] })])
    assert.equal(index.match(new PreparedRequest(script('https://ads.example/'))).length, 1)
  })

  test('the token is the longest whole word a matching URL must contain', () => {
    assert.equal(bestToken('||doubleclick.net^'), 'doubleclick')
    assert.equal(bestToken('/adserver*'), undefined)
    assert.equal(bestToken('ads.js'), undefined)
    assert.equal(bestToken('|https://www.example.com/'), 'example')
  })

  test('invalid rules are skipped', () => {
    assert.equal(new RuleIndex('test', [rule({ urlFilter: '' }), rule({ regexFilter: '(' }), rule({ urlFilter: 'ok' })]).size, 1)
  })
})

describe('which rule wins', () => {
  test('the higher priority wins', () => {
    const v = verdict([rule({ urlFilter: 'ads' }, block, 1), rule({ urlFilter: 'ads' }, allow, 2)], script('https://ads.example/'))
    assert.equal(v.action, undefined)
  })

  test('at equal priority, allow beats block, which beats redirect', () => {
    const redirect: RuleAction = { type: 'redirect', redirect: { url: 'https://elsewhere.example/' } }
    assert.equal(verdict([rule({ urlFilter: 'ads' }), rule({ urlFilter: 'ads' }, allow)], script('https://ads.example/')).action, undefined)
    assert.equal(verdict([rule({ urlFilter: 'ads' }, redirect), rule({ urlFilter: 'ads' })], script('https://ads.example/')).action?.rule.action.type, 'block')
  })

  test('allowAllRequests on a frame lets through what isn’t a higher priority', () => {
    const rules = [rule({ urlFilter: 'ads' }, block, 1), rule({ urlFilter: 'tracker' }, block, 5)]
    assert.equal(verdict(rules, script('https://ads.example/'), 2).action, undefined)
    assert.equal(verdict(rules, script('https://tracker.example/'), 2).action?.rule.id, rules[1].id)
  })

  test('modifyHeaders applies above any allow, and not to a blocked request', () => {
    const csp: RuleAction = { type: 'modifyHeaders', responseHeaders: [{ header: 'csp', operation: 'set', value: 'x' }] }
    assert.equal(verdict([rule({ urlFilter: 'site' }, csp, 3), rule({ urlFilter: 'site' }, allow, 2)], script('https://site.example/')).headers.length, 1)
    assert.equal(verdict([rule({ urlFilter: 'site' }, csp, 1), rule({ urlFilter: 'site' }, allow, 2)], script('https://site.example/')).headers.length, 0)
    assert.equal(verdict([rule({ urlFilter: 'site' }, csp, 3), rule({ urlFilter: 'site' })], script('https://site.example/')).headers.length, 0)
  })
})

describe('redirects', () => {
  const target = (action: RuleAction, url: string, condition: RuleCondition = {}) => redirectTarget(rule(condition, action), url, 'extid')

  test('to a URL, or to a file in the extension', () => {
    assert.equal(target({ type: 'redirect', redirect: { url: 'https://x.example/' } }, 'https://a.example/'), 'https://x.example/')
    assert.equal(target({ type: 'redirect', redirect: { extensionPath: '/noop.js' } }, 'https://a.example/'), 'chrome-extension://extid/noop.js')
  })

  test('upgradeScheme moves http to https and ws to wss, and leaves https alone', () => {
    assert.equal(target({ type: 'upgradeScheme' }, 'http://a.example/x'), 'https://a.example/x')
    assert.equal(target({ type: 'upgradeScheme' }, 'ws://a.example/x'), 'wss://a.example/x')
    assert.equal(target({ type: 'upgradeScheme' }, 'https://a.example/x'), undefined)
  })

  test('a query transform drops tracking parameters and adds others', () => {
    const transform: RuleAction = { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: ['utm_source'], addOrReplaceParams: [{ key: 'ref', value: 'yarc' }] } } } }
    assert.equal(target(transform, 'https://a.example/p?utm_source=mail&id=3'), 'https://a.example/p?id=3&ref=yarc')
  })

  test('a transform that changes nothing is no redirect', () => {
    const transform: RuleAction = { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: ['utm_source'] } } } }
    assert.equal(target(transform, 'https://a.example/p?id=3'), undefined)
  })

  test('regexSubstitution fills in the groups the regexFilter captured', () => {
    const action: RuleAction = { type: 'redirect', redirect: { regexSubstitution: 'https://\\1.example/$\\2' } }
    assert.equal(target(action, 'http://www.a.example/x', { regexFilter: '^http://www\\.(a)\\.example/(.*)' }), 'https://a.example/$x')
  })
})

describe('modifyHeaders', () => {
  const match = (action: RuleAction): Match => ({ rule: rule({}, action), rulesetId: 'test' })
  const headers = (...h: HeaderInfo[]): RuleAction => ({ type: 'modifyHeaders', requestHeaders: h, responseHeaders: h })

  test('set, remove and append, matching names whatever their case', () => {
    const out = modifyRequestHeaders({ Cookie: 'a=1', Accept: 'text/html', 'X-Old': '1' }, [
      match(headers({ header: 'cookie', operation: 'remove' }, { header: 'accept', operation: 'append', value: 'image/png' }, { header: 'x-new', operation: 'set', value: '2' }))
    ])
    assert.deepEqual(out, { Accept: 'text/html, image/png', 'X-Old': '1', 'x-new': '2' })
  })

  test('a header set by a higher-priority rule can’t be changed by a lower one', () => {
    const out = modifyResponseHeaders({ 'Content-Security-Policy': ['a'] }, [
      match(headers({ header: 'content-security-policy', operation: 'set', value: 'b' })),
      match(headers({ header: 'content-security-policy', operation: 'remove' }))
    ])
    assert.deepEqual(out, { 'content-security-policy': ['b'] })
  })

  test('no header rules leave the headers untouched', () => {
    assert.equal(modifyRequestHeaders({ A: '1' }, []), undefined)
  })
})

describe('rule validation, as updateDynamicRules reports it', () => {
  test('a well-formed rule passes', () => {
    assert.equal(ruleError(rule({ urlFilter: '||ads.example^' })), undefined)
  })

  test('common mistakes are named', () => {
    assert.match(ruleError({ id: 0, action: block, condition: {} })!, /id/)
    assert.match(ruleError(rule({ urlFilter: 'a', regexFilter: 'a' }))!, /both/)
    assert.match(ruleError(rule({ requestDomains: [] }))!, /empty "requestDomains"/)
    assert.match(ruleError(rule({ resourceTypes: ['script'] }, { type: 'allowAllRequests' }))!, /main_frame/)
    assert.match(ruleError(rule({}, { type: 'redirect' }))!, /redirect/)
  })
})
