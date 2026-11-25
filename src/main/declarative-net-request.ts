// chrome.declarativeNetRequest for one profile's extensions; Electron's own never loads static rulesets. The API arrives over IPC from src/preload/extension-dnr.ts.
import {
  ipcMain,
  type Extension,
  type HeadersReceivedResponse,
  type OnBeforeRequestListenerDetails,
  type OnBeforeSendHeadersListenerDetails,
  type OnHeadersReceivedListenerDetails,
  type ServiceWorkerMain,
  type Session,
  type WebFrameMain
} from 'electron'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import {
  allowAllPriority,
  decide,
  modifyRequestHeaders,
  modifyResponseHeaders,
  PreparedRequest,
  redirectTarget,
  regexError,
  ruleError,
  RuleIndex,
  type Match,
  type NetRequest,
  type ResourceType,
  type Rule
} from './net-rules'

const CHANNEL = 'yarc-dnr'
const DYNAMIC = '_dynamic'
const SESSION = '_session'
const MAX_DYNAMIC_RULES = 30_000
const MAX_SESSION_RULES = 5_000
const MAX_STATIC_RULES = 330_000
const MAX_MATCHED_KEPT = 1_000
const MATCHED_KEPT_FOR = 5 * 60_000
const TYPES: Record<OnBeforeRequestListenerDetails['resourceType'], ResourceType> = {
  mainFrame: 'main_frame',
  subFrame: 'sub_frame',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xmlhttprequest',
  ping: 'ping',
  cspReport: 'csp_report',
  media: 'media',
  webSocket: 'websocket',
  other: 'other'
}

const bySession = new WeakMap<Session, NetRules>()
let ipcListening = false

export function netRulesFor(session: Session): NetRules | undefined {
  return bySession.get(session)
}

interface Saved {
  version?: string
  enabledRulesets?: string[]
  disabledStaticRules?: Record<string, number[]>
  dynamicRules?: Rule[]
}

interface RulesetInfo {
  id: string
  path: string
  enabled: boolean
}

interface MatchedInfo {
  rule: { ruleId: number; rulesetId: string }
  tabId: number
  timeStamp: number
}

type BlockOrRedirect = { cancel: true } | { redirectURL: string }

class ExtensionRules {
  readonly ext: Extension
  readonly rulesets: RulesetInfo[]
  readonly feedback: boolean
  readonly blockNeedsHostAccess: boolean
  saved: Saved
  sessionRules: Rule[] = []
  matched: MatchedInfo[] = []
  indexes: RuleIndex[] = []
  private staticRules = new Map<string, Rule[]>()
  private staticIndexes = new Map<string, RuleIndex>()
  private dynamic: RuleIndex
  private session: RuleIndex
  private hostPatterns: string[]
  private saving: Promise<void> = Promise.resolve()

  constructor(ext: Extension, saved: Saved) {
    const m = ext.manifest as { permissions?: string[]; host_permissions?: string[]; declarative_net_request?: { rule_resources?: RulesetInfo[] } }
    const permissions = m.permissions ?? []
    this.ext = ext
    this.rulesets = (m.declarative_net_request?.rule_resources ?? []).filter((r) => r && typeof r.id === 'string' && typeof r.path === 'string')
    this.feedback = permissions.includes('declarativeNetRequestFeedback')
    this.blockNeedsHostAccess = !permissions.includes('declarativeNetRequest')
    this.hostPatterns = [...(m.host_permissions ?? []), ...permissions.filter((p) => p.includes('://') || p === '<all_urls>')]
    this.saved = saved.version === ext.version ? saved : { version: ext.version, dynamicRules: saved.dynamicRules }
    this.dynamic = new RuleIndex(DYNAMIC, this.saved.dynamicRules ?? [])
    this.session = new RuleIndex(SESSION, [])
  }

  enabledRulesets(): string[] {
    return this.saved.enabledRulesets ?? this.rulesets.filter((r) => r.enabled).map((r) => r.id)
  }

  async loadStatic(): Promise<void> {
    const enabled = new Set(this.enabledRulesets())
    for (const id of this.staticRules.keys()) if (!enabled.has(id)) this.staticRules.delete(id)
    for (const info of this.rulesets) {
      if (!enabled.has(info.id) || this.staticRules.has(info.id)) continue
      this.staticRules.set(info.id, await readRuleset(this.ext.path, info.path))
    }
    this.staticIndexes = new Map([...this.staticRules].map(([id, rules]) => [id, this.indexStatic(id, rules)]))
    this.reindex()
  }

  restaticize(rulesetId: string): void {
    const rules = this.staticRules.get(rulesetId)
    if (rules) this.staticIndexes.set(rulesetId, this.indexStatic(rulesetId, rules))
    this.reindex()
  }

  staticRuleCount(): number {
    let n = 0
    for (const index of this.staticIndexes.values()) n += index.size
    return n
  }

  setDynamic(rules: Rule[]): void {
    this.saved.dynamicRules = rules
    this.dynamic = new RuleIndex(DYNAMIC, rules)
    this.reindex()
  }

  setSession(rules: Rule[]): void {
    this.sessionRules = rules
    this.session = new RuleIndex(SESSION, rules)
    this.reindex()
  }

  match(r: PreparedRequest): Match[] {
    const out: Match[] = []
    for (const index of this.indexes) index.match(r, out)
    return out
  }

  get hasAllowAll(): boolean {
    return this.indexes.some((i) => i.hasAllowAll)
  }

  get hasRequestHeaders(): boolean {
    return this.indexes.some((i) => i.hasRequestHeaders)
  }

  hostAccess(url: string): boolean {
    return this.hostPatterns.some((p) => patternAllows(p, url))
  }

  record(m: Match, tabId: number): void {
    if (!this.feedback) return
    const now = Date.now()
    this.matched.push({ rule: { ruleId: m.rule.id, rulesetId: m.rulesetId }, tabId, timeStamp: now })
    if (this.matched.length > MAX_MATCHED_KEPT || this.matched[0].timeStamp < now - MATCHED_KEPT_FOR) {
      this.matched = this.matched.filter((x) => x.timeStamp >= now - MATCHED_KEPT_FOR).slice(-MAX_MATCHED_KEPT)
    }
  }

  save(file: string): Promise<void> {
    const data = JSON.stringify(this.saved)
    this.saving = this.saving.then(() => writeAtomically(file, data)).catch((err: unknown) => console.warn('[dnr] could not save rules', err))
    return this.saving
  }

  private indexStatic(id: string, rules: Rule[]): RuleIndex {
    const disabled = new Set(this.saved.disabledStaticRules?.[id] ?? [])
    return new RuleIndex(id, disabled.size ? rules.filter((r) => !disabled.has(r.id)) : rules)
  }

  private reindex(): void {
    this.indexes = [...this.staticIndexes.values(), this.dynamic, this.session].filter((i) => i.size > 0)
  }
}

export class NetRules {
  private loaded = new Map<string, ExtensionRules>()
  private loading = new Map<string, Promise<ExtensionRules | undefined>>()
  /** Most recently installed first: its block or redirect wins. */
  private order: ExtensionRules[] = []
  private headerRules = new Map<number, Match[]>()
  private frameAllows = new Map<string, number>()
  private wantedRequestHeaders = false
  private workers = new WeakSet<ServiceWorkerMain>()

  constructor(
    session: Session,
    private dir: string,
    private onRequestHeaderRules: (wanted: boolean) => void,
    private grantedOrigins: (extensionId: string) => string[]
  ) {
    bySession.set(session, this)
    listenOnIpc()
    session.extensions.on('extension-loaded', (_e, ext) => void this.load(ext))
    session.extensions.on('extension-unloaded', (_e, ext) => this.unload(ext.id))
    session.serviceWorkers.on('running-status-changed', ({ runningStatus, versionId }) => {
      if (runningStatus !== 'starting') return
      const worker = session.serviceWorkers.getWorkerFromVersionID(versionId)
      const id = worker && extensionIdOf(worker.scope)
      if (!worker || !id || this.workers.has(worker)) return
      this.workers.add(worker)
      worker.ipc.handle(CHANNEL, (_e, method: string, arg: unknown) => this.call(id, method, arg))
    })
  }

  beforeRequest(d: OnBeforeRequestListenerDetails): BlockOrRedirect | undefined {
    if (!this.order.length || !filterable(d)) return undefined
    this.headerRules.delete(d.id)
    const req = new PreparedRequest(requestOf(d))
    let redirect: string | undefined
    const headers: Match[] = []
    for (const x of this.order) {
      const outcome = decide(x.match(req), x.hasAllowAll ? this.frameAllowance(x, d) : 0)
      const action = outcome.action
      if (action && (!x.blockNeedsHostAccess || this.hostAccess(x, d.url))) {
        if (action.rule.action.type === 'block') {
          x.record(action, req.tabId)
          return { cancel: true }
        }
        const target = !redirect && (action.rule.action.type === 'upgradeScheme' || this.hostAccess(x, d.url)) ? redirectTarget(action.rule, d.url, x.ext.id) : undefined
        if (target) {
          redirect = target
          x.record(action, req.tabId)
        }
      }
      if (outcome.headers.length && this.hostAccess(x, d.url)) headers.push(...outcome.headers)
    }
    if (redirect) return { redirectURL: redirect }
    if (headers.length) this.keepHeaderRules(d.id, headers)
    return undefined
  }

  requestHeaders(d: OnBeforeSendHeadersListenerDetails, headers: Record<string, string>): Record<string, string> | undefined {
    const rules = this.headerRules.get(d.id)
    return rules && modifyRequestHeaders(headers, rules)
  }

  headersReceived(d: OnHeadersReceivedListenerDetails, response: HeadersReceivedResponse): HeadersReceivedResponse {
    const rules = this.headerRules.get(d.id)
    if (!rules) return response
    this.headerRules.delete(d.id)
    const current = Object.entries(response.responseHeaders ?? d.responseHeaders ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])
    const headers = modifyResponseHeaders(Object.fromEntries(current), rules)
    return headers ? { ...response, responseHeaders: headers } : response
  }

  /** Redirect and header rules need access to the site: from the manifest, or granted at runtime. */
  private hostAccess(x: ExtensionRules, url: string): boolean {
    return x.hostAccess(url) || this.grantedOrigins(x.ext.id).some((p) => patternAllows(p, url))
  }

  private keepHeaderRules(id: number, rules: Match[]): void {
    this.headerRules.set(id, rules)
    // Requests that fail or are blocked later never reach onHeadersReceived to clear theirs.
    if (this.headerRules.size > 1000) this.headerRules.delete(this.headerRules.keys().next().value!)
  }

  /** The highest allowAllRequests priority among the frames the request was made from. */
  private frameAllowance(x: ExtensionRules, d: OnBeforeRequestListenerDetails): number {
    let best = 0
    for (const frame of framesAbove(d)) {
      const key = `${x.ext.id} ${frame.type} ${frame.initiator ?? ''} ${frame.url}`
      let p = this.frameAllows.get(key)
      if (p === undefined) {
        p = allowAllPriority(x.match(new PreparedRequest(frame)))
        if (this.frameAllows.size > 500) this.frameAllows.clear()
        this.frameAllows.set(key, p)
      }
      best = Math.max(best, p)
    }
    return best
  }

  private load(ext: Extension): Promise<ExtensionRules | undefined> {
    const permissions = (ext.manifest as { permissions?: string[] }).permissions ?? []
    if (!permissions.includes('declarativeNetRequest') && !permissions.includes('declarativeNetRequestWithHostAccess')) return Promise.resolve(undefined)
    const loading = readSaved(this.file(ext.id)).then(async (saved) => {
      const x = new ExtensionRules(ext, saved)
      await x.loadStatic()
      if (this.loading.get(ext.id) !== loading) return undefined
      this.loaded.delete(ext.id)
      this.loaded.set(ext.id, x)
      this.changed()
      return x
    })
    this.loading.set(ext.id, loading)
    return loading
  }

  private unload(id: string): void {
    this.loading.delete(id)
    if (this.loaded.delete(id)) this.changed()
  }

  async forget(id: string): Promise<void> {
    this.unload(id)
    await rm(this.file(id), { force: true })
  }

  private changed(): void {
    this.order = [...this.loaded.values()].reverse()
    this.frameAllows.clear()
    const wanted = this.order.some((x) => x.hasRequestHeaders)
    if (wanted !== this.wantedRequestHeaders) this.onRequestHeaderRules((this.wantedRequestHeaders = wanted))
  }

  private file(id: string): string {
    return join(this.dir, `${id}.json`)
  }

  async call(extensionId: string, method: string, arg: unknown): Promise<{ value?: unknown; error?: string }> {
    try {
      const x = this.loaded.get(extensionId) ?? (await this.loading.get(extensionId))
      if (!x) throw new Error('The extension needs the "declarativeNetRequest" permission.')
      return { value: await this.api(x, method, arg ?? {}) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }

  private async api(x: ExtensionRules, method: string, arg: any): Promise<unknown> {
    switch (method) {
      case 'getEnabledRulesets':
        return x.enabledRulesets()
      case 'updateEnabledRulesets': {
        const known = new Set(x.rulesets.map((r) => r.id))
        const ids: string[] = [...(arg.disableRulesetIds ?? []), ...(arg.enableRulesetIds ?? [])]
        const unknown = ids.find((id) => !known.has(id))
        if (unknown !== undefined) throw new Error(`Invalid ruleset id: ${unknown}.`)
        const enabled = new Set(x.enabledRulesets())
        for (const id of arg.disableRulesetIds ?? []) enabled.delete(id)
        for (const id of arg.enableRulesetIds ?? []) enabled.add(id)
        x.saved.enabledRulesets = x.rulesets.map((r) => r.id).filter((id) => enabled.has(id))
        await x.loadStatic()
        if (x.staticRuleCount() > MAX_STATIC_RULES) throw new Error('The number of enabled static rules exceeds the limit.')
        this.changed()
        return x.save(this.file(x.ext.id))
      }
      case 'getAvailableStaticRuleCount':
        return Math.max(0, MAX_STATIC_RULES - x.staticRuleCount())
      case 'getDisabledRuleIds':
        return x.saved.disabledStaticRules?.[arg.rulesetId] ?? []
      case 'updateStaticRules': {
        if (!x.rulesets.some((r) => r.id === arg.rulesetId)) throw new Error(`Invalid ruleset id: ${arg.rulesetId}.`)
        const disabled = new Set<number>(x.saved.disabledStaticRules?.[arg.rulesetId] ?? [])
        for (const id of arg.enableRuleIds ?? []) disabled.delete(id)
        for (const id of arg.disableRuleIds ?? []) disabled.add(id)
        x.saved.disabledStaticRules = { ...x.saved.disabledStaticRules, [arg.rulesetId]: [...disabled] }
        x.restaticize(arg.rulesetId)
        this.changed()
        return x.save(this.file(x.ext.id))
      }
      case 'getDynamicRules':
        return filterRules(x.saved.dynamicRules ?? [], arg.ruleIds)
      case 'updateDynamicRules':
        x.setDynamic(updatedRules(x.saved.dynamicRules ?? [], arg, MAX_DYNAMIC_RULES))
        this.changed()
        return x.save(this.file(x.ext.id))
      case 'adoptDynamicRules':
        if (x.saved.dynamicRules?.length || !Array.isArray(arg)) return undefined
        x.setDynamic((arg as Rule[]).filter((r) => !ruleError(r)))
        this.changed()
        return x.save(this.file(x.ext.id))
      case 'getSessionRules':
        return filterRules(x.sessionRules, arg.ruleIds)
      case 'updateSessionRules':
        x.setSession(updatedRules(x.sessionRules, arg, MAX_SESSION_RULES))
        this.changed()
        return undefined
      case 'isRegexSupported': {
        const reason = regexError(String(arg.regex ?? ''))
        return reason ? { isSupported: false, reason } : { isSupported: true }
      }
      case 'getMatchedRules': {
        if (!x.feedback) throw new Error('The extension needs the "declarativeNetRequestFeedback" permission.')
        const since = arg.minTimeStamp ?? 0
        return { rulesMatchedInfo: x.matched.filter((m) => m.timeStamp >= since && (arg.tabId === undefined || m.tabId === arg.tabId)) }
      }
      case 'testMatchOutcome': {
        const r = arg as NetRequest
        return { matchedRules: x.match(new PreparedRequest(r)).map((m) => ({ ruleId: m.rule.id, rulesetId: m.rulesetId })) }
      }
      case 'setExtensionActionOptions':
        return undefined
      default:
        throw new Error(`declarativeNetRequest.${method} is not supported.`)
    }
  }
}

function listenOnIpc(): void {
  if (ipcListening) return
  ipcListening = true
  ipcMain.handle(CHANNEL, (e, method: string, arg: unknown) => {
    const id = extensionIdOf(e.senderFrame?.origin)
    const rules = bySession.get(e.sender.session)
    return id && rules ? rules.call(id, method, arg) : { error: 'declarativeNetRequest is only available to extensions.' }
  })
}

function updatedRules(current: Rule[], arg: { removeRuleIds?: number[]; addRules?: Rule[] }, max: number): Rule[] {
  const remove = new Set(arg.removeRuleIds ?? [])
  const rules = current.filter((r) => !remove.has(r.id))
  const ids = new Set(rules.map((r) => r.id))
  for (const rule of arg.addRules ?? []) {
    const error = ruleError(rule)
    if (error) throw new Error(error)
    if (ids.has(rule.id)) throw new Error(`Rule with id ${rule.id} does not have a unique ID.`)
    ids.add(rule.id)
    rules.push(rule)
  }
  if (rules.length > max) throw new Error('The rule count exceeds the rule count limit.')
  return rules
}

function filterRules(rules: Rule[], ids: number[] | undefined): Rule[] {
  if (!ids) return rules
  const wanted = new Set(ids)
  return rules.filter((r) => wanted.has(r.id))
}

/** dNR leaves alone what isn't web traffic, and requests from extensions. */
function filterable(d: OnBeforeRequestListenerDetails): boolean {
  return /^(https?|wss?):/.test(d.url) && !d.initiatorOrigin?.startsWith('chrome-extension:')
}

function requestOf(d: OnBeforeRequestListenerDetails): NetRequest {
  return { url: d.url, type: TYPES[d.resourceType] ?? 'other', method: d.method, initiator: d.initiatorOrigin, tabId: d.webContentsId }
}

/** The documents a request comes from, as the frame requests allowAllRequests rules matched. */
function framesAbove(d: OnBeforeRequestListenerDetails): NetRequest[] {
  const out: NetRequest[] = []
  try {
    let frame: WebFrameMain | null | undefined = d.frame
    // A navigation's frame is the one being navigated: only its parents hold the request.
    if (d.resourceType === 'mainFrame') frame = null
    else if (d.resourceType === 'subFrame') frame = frame?.parent
    else if (!frame) {
      const page = d.webContents?.getURL()
      return page ? [{ url: page, type: 'main_frame' }] : []
    }
    for (; frame; frame = frame.parent) {
      out.push({ url: frame.url, type: frame.parent ? 'sub_frame' : 'main_frame', initiator: frame.parent?.origin })
    }
  } catch {}
  return out
}

function extensionIdOf(url: string | undefined): string | undefined {
  return /^chrome-extension:\/\/([a-p]{32})(?:\/|$)/.exec(url ?? '')?.[1]
}

/** Host permission patterns: `<all_urls>`, `*://*.example.com/*`, `https://example.com/*` (the path doesn't matter). */
function patternAllows(pattern: string, url: string): boolean {
  if (pattern === '<all_urls>') return true
  const m = /^(\*|https?|wss?):\/\/([^/]+)\//.exec(pattern)
  if (!m) return false
  const u = URL.parse(url)
  if (!u) return false
  const scheme = u.protocol.slice(0, -1)
  if (m[1] === '*' ? !['http', 'https', 'ws', 'wss'].includes(scheme) : m[1] !== scheme) return false
  const host = m[2].replace(/:(\d+|\*)$/, '')
  if (host === '*') return true
  if (host.startsWith('*.')) return u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1))
  return u.hostname === host
}

async function readRuleset(root: string, path: string): Promise<Rule[]> {
  const file = resolve(root, path.replace(/^\/+/, ''))
  if (!file.startsWith(resolve(root) + sep)) return []
  try {
    const rules = JSON.parse(await readFile(file, 'utf8'))
    return Array.isArray(rules) ? rules : []
  } catch (err) {
    console.warn('[dnr] could not read ruleset', file, err)
    return []
  }
}

async function readSaved(file: string): Promise<Saved> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Saved
  } catch {
    return {}
  }
}

async function writeAtomically(file: string, data: string): Promise<void> {
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(`${file}.tmp`, data)
  await rename(`${file}.tmp`, file)
}
