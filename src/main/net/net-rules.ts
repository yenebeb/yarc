// chrome.declarativeNetRequest rules: matching and outcome, without Electron (unit-tested).
import { getDomain } from 'tldts-experimental'

export type ResourceType =
  | 'main_frame' | 'sub_frame' | 'stylesheet' | 'script' | 'image' | 'font' | 'object' | 'xmlhttprequest'
  | 'ping' | 'csp_report' | 'media' | 'websocket' | 'webtransport' | 'webbundle' | 'other'
export type ActionType = 'block' | 'redirect' | 'allow' | 'upgradeScheme' | 'modifyHeaders' | 'allowAllRequests'

export interface HeaderInfo {
  header: string
  operation: 'append' | 'set' | 'remove'
  value?: string
}
export interface UrlTransform {
  scheme?: string
  host?: string
  port?: string
  path?: string
  query?: string
  queryTransform?: { removeParams?: string[]; addOrReplaceParams?: { key: string; value: string; replaceOnly?: boolean }[] }
  fragment?: string
  username?: string
  password?: string
}
export interface RuleAction {
  type: ActionType
  redirect?: { url?: string; extensionPath?: string; transform?: UrlTransform; regexSubstitution?: string }
  requestHeaders?: HeaderInfo[]
  responseHeaders?: HeaderInfo[]
}
export interface RuleCondition {
  urlFilter?: string
  regexFilter?: string
  isUrlFilterCaseSensitive?: boolean
  requestDomains?: string[]
  excludedRequestDomains?: string[]
  initiatorDomains?: string[]
  excludedInitiatorDomains?: string[]
  domains?: string[]
  excludedDomains?: string[]
  resourceTypes?: ResourceType[]
  excludedResourceTypes?: ResourceType[]
  requestMethods?: string[]
  excludedRequestMethods?: string[]
  domainType?: 'firstParty' | 'thirdParty'
  tabIds?: number[]
  excludedTabIds?: number[]
  responseHeaders?: unknown[]
  excludedResponseHeaders?: unknown[]
}
export interface Rule {
  id: number
  priority?: number
  action: RuleAction
  condition: RuleCondition
}
export interface Match {
  rule: Rule
  rulesetId: string
}
export interface NetRequest {
  url: string
  type: ResourceType
  method?: string
  /** An origin or URL; none for requests the browser started itself. */
  initiator?: string
  tabId?: number
}

export const RESOURCE_TYPES: ResourceType[] = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest',
  'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'
]
const ACTION_RANK: Record<ActionType, number> = { allow: 0, allowAllRequests: 1, block: 2, upgradeScheme: 3, redirect: 4, modifyHeaders: 5 }
const NOT_SEPARATOR = 'a-zA-Z0-9_\\-.%'
const COMMON_TOKENS = new Set(['http', 'https', 'www', 'com'])

export class PreparedRequest {
  readonly url: string
  readonly lower: string
  readonly type: ResourceType
  readonly method: string
  readonly tabId: number
  readonly hosts: string[]
  readonly initiatorHosts: string[] | undefined
  private thirdParty: boolean | undefined
  private urlTokens: string[] | undefined

  constructor(r: NetRequest) {
    this.url = r.url
    this.lower = r.url.toLowerCase()
    this.type = r.type
    this.method = (r.method ?? 'get').toLowerCase()
    this.tabId = r.tabId ?? -1
    this.hosts = suffixes(hostOf(r.url))
    const initiator = r.initiator && r.initiator !== 'null' ? hostOf(r.initiator) : ''
    this.initiatorHosts = initiator ? suffixes(initiator) : undefined
  }

  get tokens(): string[] {
    return (this.urlTokens ??= this.lower.match(/[a-z0-9]+/g) ?? [])
  }

  get isThirdParty(): boolean {
    if (this.thirdParty === undefined) {
      const site = (host: string | undefined) => (host ? getDomain(host) || host : '')
      this.thirdParty = !!this.initiatorHosts && site(this.initiatorHosts[0]) !== site(this.hosts[0])
    }
    return this.thirdParty
  }
}

class CompiledRule {
  readonly rule: Rule
  readonly priority: number
  readonly rank: number
  seen = 0
  private readonly types: Set<string>
  private readonly requestDomains: Set<string> | undefined
  private readonly excludedRequestDomains: Set<string> | undefined
  private readonly initiatorDomains: Set<string> | undefined
  private readonly excludedInitiatorDomains: Set<string> | undefined
  private readonly methods: Set<string> | undefined
  private readonly excludedMethods: Set<string> | undefined
  private readonly tabIds: Set<number> | undefined
  private readonly excludedTabIds: Set<number> | undefined
  private regex: RegExp | undefined

  constructor(rule: Rule) {
    const c = rule.condition
    this.rule = rule
    this.priority = rule.priority ?? 1
    this.rank = ACTION_RANK[rule.action.type]
    this.types = new Set(c.resourceTypes ?? RESOURCE_TYPES.filter((t) => (c.excludedResourceTypes ? !c.excludedResourceTypes.includes(t) : t !== 'main_frame')))
    this.requestDomains = setOf(c.requestDomains)
    this.excludedRequestDomains = setOf(c.excludedRequestDomains)
    this.initiatorDomains = setOf(c.initiatorDomains ?? c.domains)
    this.excludedInitiatorDomains = setOf(c.excludedInitiatorDomains ?? c.excludedDomains)
    this.methods = setOf(c.requestMethods)
    this.excludedMethods = setOf(c.excludedRequestMethods)
    this.tabIds = c.tabIds && new Set(c.tabIds)
    this.excludedTabIds = c.excludedTabIds && new Set(c.excludedTabIds)
  }

  /** Where the index files it: a rare key makes few candidates per request. */
  key(): { map: 'token' | 'request' | 'initiator'; keys: string[] } | undefined {
    const c = this.rule.condition
    if (c.requestDomains?.length) return { map: 'request', keys: c.requestDomains.map((d) => d.toLowerCase()) }
    const token = c.urlFilter ? bestToken(c.urlFilter) : undefined
    if (token && !COMMON_TOKENS.has(token)) return { map: 'token', keys: [token] }
    const initiators = c.initiatorDomains ?? c.domains
    if (initiators?.length) return { map: 'initiator', keys: initiators.map((d) => d.toLowerCase()) }
    return token ? { map: 'token', keys: [token] } : undefined
  }

  matches(r: PreparedRequest): boolean {
    const c = this.rule.condition
    if (!this.types.has(r.type)) return false
    if (this.methods && !this.methods.has(r.method)) return false
    if (this.excludedMethods?.has(r.method)) return false
    if (this.tabIds && !this.tabIds.has(r.tabId)) return false
    if (this.excludedTabIds?.has(r.tabId)) return false
    if (this.requestDomains && !anyIn(this.requestDomains, r.hosts)) return false
    if (this.excludedRequestDomains && anyIn(this.excludedRequestDomains, r.hosts)) return false
    if (this.initiatorDomains && !(r.initiatorHosts && anyIn(this.initiatorDomains, r.initiatorHosts))) return false
    if (this.excludedInitiatorDomains && r.initiatorHosts && anyIn(this.excludedInitiatorDomains, r.initiatorHosts)) return false
    if (c.domainType && (c.domainType === 'thirdParty') !== r.isThirdParty) return false
    if (c.urlFilter === undefined && c.regexFilter === undefined) return true
    this.regex ??= ruleRegex(c)
    return this.regex.test(r.url)
  }
}

/** One ruleset (a static one, or an extension's dynamic or session rules), indexed by domain or URL token. */
export class RuleIndex {
  readonly id: string
  readonly size: number
  readonly hasAllowAll: boolean
  readonly hasRequestHeaders: boolean
  private byToken = new Map<string, CompiledRule[]>()
  private byRequestDomain = new Map<string, CompiledRule[]>()
  private byInitiator = new Map<string, CompiledRule[]>()
  private generic: CompiledRule[] = []
  private stamp = 0

  constructor(id: string, rules: Iterable<Rule>) {
    this.id = id
    let size = 0
    let allowAll = false
    let requestHeaders = false
    const maps = { token: this.byToken, request: this.byRequestDomain, initiator: this.byInitiator }
    for (const rule of rules) {
      if (ruleError(rule)) continue
      const c = rule.condition
      if (c.responseHeaders || c.excludedResponseHeaders) continue
      const compiled = new CompiledRule(rule)
      const key = compiled.key()
      if (!key) this.generic.push(compiled)
      else for (const k of key.keys) push(maps[key.map], k, compiled)
      size++
      allowAll ||= rule.action.type === 'allowAllRequests'
      requestHeaders ||= !!rule.action.requestHeaders?.length
    }
    this.size = size
    this.hasAllowAll = allowAll
    this.hasRequestHeaders = requestHeaders
  }

  match(r: PreparedRequest, out: Match[] = []): Match[] {
    const stamp = ++this.stamp
    const check = (list: CompiledRule[] | undefined) => {
      if (!list) return
      for (const c of list) {
        if (c.seen === stamp) continue
        c.seen = stamp
        if (c.matches(r)) out.push({ rule: c.rule, rulesetId: this.id })
      }
    }
    if (this.byToken.size) for (const token of r.tokens) check(this.byToken.get(token))
    for (const host of r.hosts) check(this.byRequestDomain.get(host))
    if (r.initiatorHosts) for (const host of r.initiatorHosts) check(this.byInitiator.get(host))
    check(this.generic)
    return out
  }
}

export interface Outcome {
  /** The block, redirect or upgradeScheme rule that wins, if any. */
  action?: Match
  /** modifyHeaders rules to apply, highest priority first. */
  headers: Match[]
}

/** One extension's verdict: `allowedUpTo` is the highest allowAllRequests priority matched by the request's frames. */
export function decide(matches: Match[], allowedUpTo = 0): Outcome {
  let best: Match | undefined
  for (const m of matches) if (m.rule.action.type !== 'modifyHeaders' && (!best || beats(m.rule, best.rule))) best = m
  const allows = (m: Match) => m.rule.action.type === 'allow' || m.rule.action.type === 'allowAllRequests'
  if (best && !allows(best) && priority(best.rule) > allowedUpTo) return { action: best, headers: [] }
  const floor = Math.max(allowedUpTo, best && allows(best) ? priority(best.rule) : 0)
  const headers = matches.filter((m) => m.rule.action.type === 'modifyHeaders' && priority(m.rule) > floor)
  return { headers: headers.sort((a, b) => priority(b.rule) - priority(a.rule)) }
}

/** The highest priority of the allowAllRequests rules among these matches, 0 if none. */
export function allowAllPriority(matches: Match[]): number {
  let best = 0
  for (const m of matches) if (m.rule.action.type === 'allowAllRequests') best = Math.max(best, priority(m.rule))
  return best
}

function beats(a: Rule, b: Rule): boolean {
  return priority(a) !== priority(b) ? priority(a) > priority(b) : ACTION_RANK[a.action.type] < ACTION_RANK[b.action.type]
}

function priority(rule: Rule): number {
  return rule.priority ?? 1
}

/** Where a redirect or upgradeScheme rule sends the request; undefined when it would stay put. */
export function redirectTarget(rule: Rule, url: string, extensionId: string): string | undefined {
  const target = targetOf(rule, url, extensionId)
  return target && target !== url ? target : undefined
}

function targetOf(rule: Rule, url: string, extensionId: string): string | undefined {
  if (rule.action.type === 'upgradeScheme') {
    if (url.startsWith('http:')) return `https:${url.slice(5)}`
    if (url.startsWith('ws:')) return `wss:${url.slice(3)}`
    return undefined
  }
  const r = rule.action.redirect
  if (!r) return undefined
  if (r.url) return r.url
  if (r.extensionPath) return `chrome-extension://${extensionId}${r.extensionPath}`
  if (r.transform) return transformUrl(url, r.transform)
  if (r.regexSubstitution !== undefined && rule.condition.regexFilter) {
    const substitution = r.regexSubstitution.replace(/\$/g, '$$$$').replace(/\\(\d|\\)/g, (_m, d: string) => (d === '\\' ? '\\' : d === '0' ? '$&' : `$${d}`))
    return url.replace(ruleRegex(rule.condition), substitution)
  }
  return undefined
}

function transformUrl(url: string, t: UrlTransform): string | undefined {
  const u = URL.parse(url)
  if (!u) return undefined
  if (t.scheme !== undefined) u.protocol = `${t.scheme}:`
  if (t.host !== undefined) u.hostname = t.host
  if (t.port !== undefined) u.port = t.port
  if (t.path !== undefined) u.pathname = t.path
  if (t.query !== undefined) u.search = t.query
  else if (t.queryTransform) u.search = transformQuery(u.search.slice(1), t.queryTransform)
  if (t.fragment !== undefined) u.hash = t.fragment
  if (t.username !== undefined) u.username = t.username
  if (t.password !== undefined) u.password = t.password
  return u.href
}

function transformQuery(query: string, t: NonNullable<UrlTransform['queryTransform']>): string {
  const remove = new Set(t.removeParams ?? [])
  const params = query
    .split('&')
    .filter((p) => p !== '')
    .map((p) => ({ key: decodeKey(p.split('=', 1)[0]), raw: p }))
    .filter((p) => !remove.has(p.key))
  for (const { key, value, replaceOnly } of t.addOrReplaceParams ?? []) {
    const raw = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    const existing = params.find((p) => p.key === key)
    if (existing) existing.raw = raw
    else if (!replaceOnly) params.push({ key, raw })
  }
  return params.map((p) => p.raw).join('&')
}

function decodeKey(key: string): string {
  try {
    return decodeURIComponent(key.replace(/\+/g, ' '))
  } catch {
    return key
  }
}

/** Request headers after these modifyHeaders rules (highest priority first); undefined when unchanged. */
export function modifyRequestHeaders(headers: Record<string, string>, rules: Match[]): Record<string, string> | undefined {
  return modifyHeaders(headers, rules, 'requestHeaders', (old, value) => (old === undefined ? value : `${old}, ${value}`), (v) => v)
}

export function modifyResponseHeaders(headers: Record<string, string[]>, rules: Match[]): Record<string, string[]> | undefined {
  return modifyHeaders(headers, rules, 'responseHeaders', (old, value) => [...(old ?? []), value], (v) => [v])
}

// A header set or removed by a higher-priority rule is final; one appended to only takes more appends.
function modifyHeaders<V>(
  headers: Record<string, V>,
  rules: Match[],
  which: 'requestHeaders' | 'responseHeaders',
  append: (old: V | undefined, value: string) => V,
  set: (value: string) => V
): Record<string, V> | undefined {
  const ops = rules.flatMap((m) => m.rule.action[which] ?? [])
  if (!ops.length) return undefined
  const out = { ...headers }
  const state = new Map<string, 'final' | 'appended'>()
  for (const op of ops) {
    const name = op.header.toLowerCase()
    const was = state.get(name)
    if (was === 'final' || (was === 'appended' && op.operation !== 'append')) continue
    const key = Object.keys(out).find((k) => k.toLowerCase() === name)
    if (op.operation === 'remove') {
      if (key !== undefined) delete out[key]
    } else if (op.operation === 'set') {
      if (key !== undefined) delete out[key]
      out[op.header] = set(op.value ?? '')
    } else {
      out[key ?? op.header] = append(key === undefined ? undefined : out[key], op.value ?? '')
    }
    state.set(name, op.operation === 'append' ? 'appended' : 'final')
  }
  return out
}

/** Why the API would refuse this rule, or undefined when it's valid. */
export function ruleError(rule: Rule): string | undefined {
  if (!rule || typeof rule !== 'object') return 'Rule must be an object.'
  const at = `Rule with id ${rule.id}`
  if (!Number.isInteger(rule.id) || rule.id < 1) return 'Rule id must be a positive integer.'
  if (rule.priority !== undefined && (!Number.isInteger(rule.priority) || rule.priority < 1)) return `${at} must have a positive priority.`
  const { action, condition: c } = rule
  if (!action || !(action.type in ACTION_RANK)) return `${at} has an invalid action type.`
  if (!c || typeof c !== 'object') return `${at} has no condition.`
  if (c.urlFilter !== undefined && c.regexFilter !== undefined) return `${at} specifies both "urlFilter" and "regexFilter".`
  if (c.urlFilter !== undefined) {
    if (c.urlFilter === '') return `${at} has an empty "urlFilter".`
    if (!/^[\x20-\x7e]*$/.test(c.urlFilter)) return `${at} has a non-ascii "urlFilter".`
    if (c.urlFilter.startsWith('||*')) return `${at} has a "urlFilter" starting with "||*".`
  }
  if (c.regexFilter !== undefined && regexError(c.regexFilter)) return `${at} has an invalid "regexFilter".`
  for (const list of ['requestDomains', 'initiatorDomains', 'domains', 'resourceTypes', 'requestMethods', 'tabIds'] as const) {
    if (c[list] !== undefined && (!Array.isArray(c[list]) || c[list].length === 0)) return `${at} has an empty "${list}" list.`
  }
  if (c.resourceTypes?.some((t) => !RESOURCE_TYPES.includes(t))) return `${at} has an invalid resource type.`
  if (action.type === 'redirect') {
    const r = action.redirect
    if (!r || (r.url === undefined && r.extensionPath === undefined && r.transform === undefined && r.regexSubstitution === undefined)) return `${at} does not specify a redirect.`
    if (r.extensionPath !== undefined && !r.extensionPath.startsWith('/')) return `${at} has an "extensionPath" not starting with "/".`
    if (r.regexSubstitution !== undefined && c.regexFilter === undefined) return `${at} has "regexSubstitution" without a "regexFilter".`
  }
  if (action.type === 'allowAllRequests' && !(c.resourceTypes?.length && c.resourceTypes.every((t) => t === 'main_frame' || t === 'sub_frame'))) {
    return `${at} with action "allowAllRequests" may only match "main_frame" and "sub_frame".`
  }
  if (action.type === 'modifyHeaders') {
    const all = [...(action.requestHeaders ?? []), ...(action.responseHeaders ?? [])]
    if (!all.length) return `${at} with action "modifyHeaders" lists no headers.`
    for (const h of all) {
      if (!h.header) return `${at} has an empty header name.`
      if ((h.operation === 'remove') !== (h.value === undefined)) return `${at} has a header "value" that doesn't suit its operation.`
    }
  }
  return undefined
}

/** For isRegexSupported: undefined when the regex is fine. */
export function regexError(regex: string): 'syntaxError' | undefined {
  try {
    new RegExp(jsRegex(regex))
    return undefined
  } catch {
    return 'syntaxError'
  }
}

function ruleRegex(c: RuleCondition): RegExp {
  const flags = c.isUrlFilterCaseSensitive ? '' : 'i'
  return c.regexFilter !== undefined ? new RegExp(jsRegex(c.regexFilter), flags) : urlFilterRegex(c.urlFilter ?? '', flags)
}

// Extensions write RE2; the one construct JavaScript spells differently is a named group.
function jsRegex(re2: string): string {
  return re2.replace(/\(\?P</g, '(?<')
}

/** urlFilter: `*` any text, `^` a separator or the end, `|` an anchor at either end, `||` the start of a (sub)domain. */
export function urlFilterRegex(filter: string, flags = 'i'): RegExp {
  let body = filter
  let start = ''
  let end = ''
  if (body.startsWith('||')) {
    start = '^[a-z][a-z0-9+.-]*:(?://)?(?:[^/?#@]*@)?(?:[^/?#:@]*\\.)?'
    body = body.slice(2)
  } else if (body.startsWith('|')) {
    start = '^'
    body = body.slice(1)
  }
  if (body.endsWith('|')) {
    end = '$'
    body = body.slice(0, -1)
  }
  const source = [...body].map((ch) => (ch === '*' ? '.*' : ch === '^' ? `(?:[^${NOT_SEPARATOR}]|$)` : ch.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&'))).join('')
  return new RegExp(start + source + end, flags)
}

/** The longest run of letters and digits that a matching URL must contain as a whole token. */
export function bestToken(filter: string): string | undefined {
  let f = filter.toLowerCase()
  const anchoredStart = f.startsWith('|')
  f = f.replace(/^\|\|?/, '')
  const anchoredEnd = f.endsWith('|')
  if (anchoredEnd) f = f.slice(0, -1)
  let best = ''
  let fallback = ''
  for (const m of f.matchAll(/[a-z0-9]+/g)) {
    const end = m.index + m[0].length
    const before = m.index === 0 ? (anchoredStart ? '' : '*') : f[m.index - 1]
    const after = end === f.length ? (anchoredEnd ? '' : '*') : f[end]
    if (before === '*' || after === '*') continue
    if (COMMON_TOKENS.has(m[0])) fallback ||= m[0]
    else if (m[0].length > best.length) best = m[0]
  }
  return best || fallback || undefined
}

function hostOf(url: string): string {
  return URL.parse(url)?.hostname.toLowerCase().replace(/\.$/, '') ?? ''
}

function suffixes(host: string): string[] {
  if (!host) return []
  const out = [host]
  for (let i = host.indexOf('.'); i !== -1; i = host.indexOf('.', i + 1)) out.push(host.slice(i + 1))
  return out
}

function setOf(list: string[] | undefined): Set<string> | undefined {
  return list && new Set(list.map((s) => s.toLowerCase()))
}

function anyIn(set: Set<string>, hosts: string[]): boolean {
  return hosts.some((h) => set.has(h))
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
