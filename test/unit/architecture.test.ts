// The layers of docs/architecture.md, checked. A failure names the file and the rule; the fix is to move the code, not to add an exception.
import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { dirname, join, normalize } from 'node:path'
import { test } from 'node:test'

const MAIN = 'src/main'
/** Folders whose code uses a privilege itself. Everything else in main asks them. */
const SENSITIVE_TIERS = ['core', 'net', 'update', 'sync', 'importers']
const ROOT_FILES = ['index.ts', 'browser.ts', 'ipc.ts', 'env.d.ts']
/** What the security gate must rate high (.github/security/policy.json) and CODEOWNERS must cover. */
const HIGH_RISK = [
  ...SENSITIVE_TIERS.map((tier) => `${MAIN}/${tier}/**`),
  `${MAIN}/index.ts`,
  `${MAIN}/ipc.ts`,
  'src/preload/**',
  'src/shared/ipc.ts',
  'src/shared/actions.ts',
  'src/shared/permissions.ts'
]

const PRIVILEGES: { what: string; pattern: RegExp; instead: string }[] = [
  { what: 'raw IPC', pattern: /\bipcMain\b|\b(handlePage|onPage)\s*\(/, instead: 'src/main/ipc.ts for the UI, core/page-ipc.ts for pages' },
  { what: 'a view or window with its own web preferences', pattern: /\bwebPreferences\b|\bnew (WebContentsView|BrowserWindow)\b/, instead: 'uiView/uiWindow (core/ui-view.ts) or createTabView (core/tab.ts)' },
  { what: 'a script or style put into a page', pattern: /executeJavaScript|\.insertCSS\s*\(/, instead: 'core/page-scripts.ts' },
  {
    what: 'a session, its cookies, permissions or request hooks',
    pattern: /\bfromPartition\b|\bdefaultSession\b|\.cookies\b|\.webRequest\b|\bprotocol\.\w|setPermission(Request|Check)Handler|setDisplayMediaRequestHandler|registerPreloadScript|\bsafeStorage\b/,
    instead: 'core/profiles.ts'
  },
  { what: 'a network request', pattern: /\bfetch\s*\(|\bnet\.(fetch|request)\b|node:(http|https|http2|net|tls|dgram|dns)\b|\bWebSocket\b|\bEventSource\b/, instead: 'net/outbound.ts' },
  { what: 'another program or a system setting', pattern: /child_process|\butilityProcess\b|shell\.(openExternal|openPath)|setAsDefaultProtocolClient|setLoginItemSettings/, instead: 'core/' },
  { what: 'screen capture or the debugger', pattern: /\bdesktopCapturer\b|\.debugger\b/, instead: 'core/share-picker.ts' },
  { what: 'code built from a string', pattern: /\beval\s*\(|\bnew Function\b/, instead: 'a fixed script in core/page-scripts.ts' }
]

const sources = (folder: string): string[] => globSync('**/*.{ts,tsx}', { cwd: folder }).map((file) => `${folder}/${file.replaceAll('\\', '/')}`)
const withoutComments = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const codeOf = (file: string): string => withoutComments(readFileSync(file, 'utf8'))
const importsOf = (file: string): string[] => [...codeOf(file).matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
const targetOf = (file: string, specifier: string): string => normalize(join(dirname(file), specifier)).replaceAll('\\', '/')
const relativeImportsOf = (file: string): string[] => importsOf(file).filter((specifier) => specifier.startsWith('.')).map((specifier) => targetOf(file, specifier))
const tierOf = (file: string): string => file.slice(MAIN.length + 1).split('/')[0]
const asksOthers = (file: string): boolean => file.startsWith(`${MAIN}/`) && !SENSITIVE_TIERS.includes(tierOf(file)) && file !== `${MAIN}/index.ts`

test('each process imports only its own code and shared', () => {
  const strays = ['main', 'preload', 'renderer'].flatMap((area) =>
    sources(`src/${area}`).flatMap((file) =>
      relativeImportsOf(file)
        .filter((target) => target.startsWith('src/') && !target.startsWith(`src/${area}/`) && !target.startsWith('src/shared/'))
        .map((target) => `${file} imports ${target}`)
    )
  )
  assert.deepEqual(strays, [])
})

test('shared runs anywhere: no Electron, no Node, nothing outside shared', () => {
  const strays = sources('src/shared').flatMap((file) =>
    importsOf(file)
      .filter((specifier) => specifier === 'electron' || isBuiltin(specifier) || (specifier.startsWith('.') && !targetOf(file, specifier).startsWith('src/shared/')))
      .map((specifier) => `${file} imports ${specifier}`)
  )
  assert.deepEqual(strays, [])
})

test('every main file is in a tier', () => {
  const tiers = [...SENSITIVE_TIERS, 'features']
  const strays = sources(MAIN).filter((file) => !tiers.includes(tierOf(file)) && !ROOT_FILES.includes(file.slice(MAIN.length + 1)))
  assert.deepEqual(strays, [])
})

test('core stands alone: it imports only core and shared', () => {
  const strays = sources(`${MAIN}/core`).flatMap((file) =>
    relativeImportsOf(file)
      .filter((target) => !target.startsWith(`${MAIN}/core/`) && !target.startsWith('src/shared/'))
      .map((target) => `${file} imports ${target}`)
  )
  assert.deepEqual(strays, [])
})

test('features and the controller use no privilege themselves', () => {
  const uses = sources(MAIN)
    .filter(asksOthers)
    .flatMap((file) => PRIVILEGES.filter((privilege) => privilege.pattern.test(codeOf(file))).map((privilege) => `${file}: ${privilege.what} (use ${privilege.instead})`))
  assert.deepEqual(uses, [])
})

test('the UI’s IPC is registered in one file', () => {
  const registers = /\b(handleUi|onUi)\s*\(/
  const elsewhere = sources(MAIN).filter((file) => registers.test(codeOf(file)) && file !== `${MAIN}/ipc.ts` && tierOf(file) !== 'core')
  assert.deepEqual(elsewhere, [])
})

test('ipcMain is only named where senders are checked', () => {
  const named = sources('src').filter((file) => /\bipcMain\b/.test(codeOf(file)))
  assert.deepEqual(named.sort(), [`${MAIN}/core/page-ipc.ts`, `${MAIN}/core/ui-origin.ts`])
})

test('IPC channels are named in shared/ipc.ts, not where they are used', () => {
  const literal = /\b(ipcRenderer|ipcMain|\.ipc)\.(on|once|handle|invoke|send|sendSync)\(\s*['"`]|\b(handleUi|onUi|handlePage|onPage)\(\s*['"`]/
  assert.deepEqual(sources('src').filter((file) => literal.test(codeOf(file))), [])
})

test('preloads are built standalone: a sandboxed preload can’t load a chunk shared with another', () => {
  assert.match(readFileSync('electron.vite.config.ts', 'utf8'), /preload: \{\s*build: \{[^}]*isolatedEntries: true/)
})

test('the security gate and CODEOWNERS know the sensitive tiers', () => {
  const policy = JSON.parse(readFileSync('.github/security/policy.json', 'utf8')) as { risk: { high: { paths: string[] } } }
  const owned = readFileSync('.github/CODEOWNERS', 'utf8')
  const asOwned = (glob: string): string => `/${glob.replace(/\*\*$/, '')} `
  assert.deepEqual(HIGH_RISK.filter((glob) => !policy.risk.high.paths.includes(glob)), [], 'missing from policy.json risk.high.paths')
  assert.deepEqual(HIGH_RISK.filter((glob) => !owned.includes(asOwned(glob))), [], 'missing from CODEOWNERS')
})

test('a sensitive path in the policy still exists', () => {
  const policy = JSON.parse(readFileSync('.github/security/policy.json', 'utf8')) as { risk: { high: { paths: string[] } } }
  const gone = policy.risk.high.paths.filter((glob) => glob.startsWith('src/') && globSync(glob).length === 0)
  assert.deepEqual(gone, [])
})
