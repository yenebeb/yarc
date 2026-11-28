// Electron's own chrome.declarativeNetRequest never loads an extension's static rulesets (most of a blocker's rules),
// so this one replaces it and asks the main process (src/main/net/declarative-net-request.ts).
// It must run before electron-chrome-extensions' preload, which freezes `chrome`.
import { contextBridge, ipcRenderer } from 'electron'
import { PAGE_IPC } from '../shared/ipc'

type Invoke = (method: string, arg: unknown) => Promise<{ value?: unknown; error?: string }>

// Serialized into the page's world: it can't use anything from this module.
function install(invoke: Invoke): void {
  type Native = { getDynamicRules?: () => Promise<{ id: number }[]>; updateDynamicRules?: (o: { removeRuleIds: number[] }) => Promise<void> }
  const chrome = (globalThis as { chrome?: { runtime?: { id?: string }; declarativeNetRequest?: Native } }).chrome
  if (!chrome?.runtime?.id) return
  const native = chrome.declarativeNetRequest
  const call =
    (method: string) =>
    (...args: unknown[]) => {
      const callback = typeof args.at(-1) === 'function' ? (args.pop() as (value?: unknown) => void) : undefined
      const result = invoke(method, args[0]).then((r) => {
        if (r.error !== undefined) throw new Error(r.error)
        return r.value
      })
      if (!callback) return result
      result.then(callback, (err: unknown) => {
        console.error(err)
        callback()
      })
    }
  const methods = [
    'getAvailableStaticRuleCount', 'getDisabledRuleIds', 'getDynamicRules', 'getEnabledRulesets', 'getMatchedRules', 'getSessionRules',
    'isRegexSupported', 'setExtensionActionOptions', 'testMatchOutcome', 'updateDynamicRules', 'updateEnabledRulesets', 'updateSessionRules', 'updateStaticRules'
  ]
  const enumOf = (values: string[]) => Object.fromEntries(values.map((v) => [v.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase(), v]))
  const event = { addListener() {}, removeListener() {}, hasListener: () => false, hasListeners: () => false }
  const api = {
    ...Object.fromEntries(methods.map((m) => [m, call(m)])),
    onRuleMatchedDebug: event,
    DYNAMIC_RULESET_ID: '_dynamic',
    SESSION_RULESET_ID: '_session',
    GUARANTEED_MINIMUM_STATIC_RULES: 30000,
    MAX_NUMBER_OF_DYNAMIC_RULES: 30000,
    MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES: 5000,
    MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES: 30000,
    MAX_NUMBER_OF_SESSION_RULES: 5000,
    MAX_NUMBER_OF_UNSAFE_SESSION_RULES: 5000,
    MAX_NUMBER_OF_REGEX_RULES: 1000,
    MAX_NUMBER_OF_STATIC_RULESETS: 100,
    MAX_NUMBER_OF_ENABLED_STATIC_RULESETS: 50,
    MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL: 20,
    GETMATCHEDRULES_QUOTA_INTERVAL: 10,
    RuleActionType: enumOf(['block', 'redirect', 'allow', 'upgradeScheme', 'modifyHeaders', 'allowAllRequests']),
    ResourceType: enumOf(['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other']),
    DomainType: enumOf(['firstParty', 'thirdParty']),
    HeaderOperation: enumOf(['append', 'set', 'remove']),
    RequestMethod: enumOf(['connect', 'delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'other']),
    UnsupportedRegexReason: enumOf(['syntaxError', 'memoryLimitExceeded'])
  }
  Object.defineProperty(chrome, 'declarativeNetRequest', { value: api, enumerable: true, configurable: true })
  // Rules an extension kept in Electron's store would still apply there, out of its reach: move them over once.
  native
    ?.getDynamicRules?.()
    .then(async (rules) => {
      if (!rules.length) return
      await invoke('adoptDynamicRules', rules)
      await native.updateDynamicRules?.({ removeRuleIds: rules.map((r) => r.id) })
    })
    .catch(() => {})
}

if (process.type === 'service-worker' || location.href.startsWith('chrome-extension://')) {
  const invoke: Invoke = (method, arg) => ipcRenderer.invoke(PAGE_IPC.netRules, method, arg)
  contextBridge.executeInMainWorld({ func: install, args: [invoke] })
}
