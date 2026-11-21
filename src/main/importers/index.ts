import { dialog, type BrowserWindow, type MessageBoxOptions, type OpenDialogOptions } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Browser } from '../browser'
import { newId, SPACE_COLORS } from '../store'
import { FAVICON_MAX } from '../tab'
import { SIDEBAR_WIDTH, type ArchivedTab, type ImportChoice, type PersistedState, type PinnedNode, type Profile, type Space, type TabItem } from '../../shared/types'
import { parseArcSidebar, readArcJson } from './arc-sidebar'
import { countTabs, findArcRoot, findChromiumBrowsers, listProfiles, readBookmarks, readHistory, readProfileNames } from './chromium'
import { findZenProfiles, findZenRoots, readZenContainers, readZenHistory, readZenPrefs, readZenSession, resolveZenProfile, type ZenProfile } from './zen'
import { parseZenSession } from './zen-session'

export type ImportSource = 'arc' | 'zen' | 'chrome'

export interface FoundChoice extends ImportChoice {
  source: 'arc' | 'zen' | 'chromium'
  path: string
  /** Arc's profile folder, or the Chromium profile's name. */
  profile: string
}

const MAX_ARCHIVE = 1000

export async function runImport(browser: Browser, source: ImportSource, path?: string): Promise<string | undefined> {
  if (source === 'arc') return importArc(browser, path)
  if (source === 'zen') return importZen(browser, path)
  return importChromium(browser, path)
}

export async function findImportChoices(): Promise<FoundChoice[]> {
  const zen = findZenProfiles()
  const zenChoices = zen.map((p): FoundChoice => ({ id: `zen:${p.path}`, browser: 'Zen', name: zen.length > 1 ? p.name : '', detail: 'Spaces, pinned tabs and history', ticked: true, source: 'zen', path: p.path, profile: p.name }))
  const chromiumChoices = findChromiumBrowsers().flatMap((b) => {
    const profiles = listProfiles(b.userDataDir)
    return profiles.map((p): FoundChoice => ({ id: `chromium:${p.path}`, browser: b.name, name: profiles.length > 1 ? p.name : '', detail: 'Bookmarks and history', ticked: false, source: 'chromium', path: p.path, profile: p.name }))
  })
  return [...(await findArcChoices()), ...zenChoices, ...chromiumChoices]
}

async function findArcChoices(): Promise<FoundChoice[]> {
  const root = findArcRoot()
  if (!root || !existsSync(join(root, 'StorableSidebar.json'))) return []
  try {
    const src = resolveArcSource(root)
    const spaces = new Map<string, number>()
    for (const s of parseArcSidebar(await readJson(src.sidebarFile)).spaces) spaces.set(s.profileKey, (spaces.get(s.profileKey) ?? 0) + 1)
    const names = src.userData ? readProfileNames(src.userData) : new Map<string, string>()
    return [...spaces].map(([key, n]) => ({
      id: `arc:${key}`,
      browser: 'Arc',
      name: spaces.size > 1 ? names.get(key) || key : '',
      detail: `${plural(n, 'space')}, pinned tabs and history`,
      ticked: true,
      source: 'arc',
      path: root,
      profile: key
    }))
  } catch (err) {
    console.warn('[import] could not read Arc', err)
    return []
  }
}

/** One summary per browser; a failed one doesn't stop the rest. */
export async function importChoices(browser: Browser, chosen: FoundChoice[]): Promise<string> {
  const arc = chosen.filter((c) => c.source === 'arc')
  const jobs = [
    ...(arc.length ? [() => importArc(browser, arc[0].path, new Set(arc.map((c) => c.profile)))] : []),
    ...chosen.filter((c) => c.source === 'zen').map((c) => () => importZen(browser, c.path)),
    ...chosen.filter((c) => c.source === 'chromium').map((c) => () => importChromiumSpace(browser, c))
  ]
  const summaries: string[] = []
  for (const job of jobs) {
    try {
      const summary = await job()
      if (summary) summaries.push(summary)
    } catch (err) {
      console.error('[import]', err)
      summaries.push(`Import failed: ${(err as Error).message}`)
    }
  }
  return summaries.join('. ')
}

function parentWindow(browser: Browser): BrowserWindow | undefined {
  const win = browser.window?.win
  return win && !win.isDestroyed() ? win : undefined
}

async function ask(browser: Browser, opts: MessageBoxOptions): Promise<number> {
  const win = parentWindow(browser)
  return (await (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts))).response
}

async function pick(browser: Browser, opts: OpenDialogOptions): Promise<string | undefined> {
  const win = parentWindow(browser)
  const res = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
  return res.canceled ? undefined : res.filePaths[0]
}

async function pickArcSource(browser: Browser, defaultPath?: string): Promise<string | undefined> {
  const title = 'Choose your Arc data'
  const filters = [{ name: 'Arc sidebar (StorableSidebar.json)', extensions: ['json'] }]
  const dialogPicksFileOrFolder = process.platform === 'darwin'
  if (dialogPicksFileOrFolder) {
    return pick(browser, { title, defaultPath, filters, properties: ['openFile', 'openDirectory', 'showHiddenFiles'] })
  }
  const choice = await ask(browser, {
    type: 'question',
    message: 'Where is your Arc data?',
    detail:
      'Choose the Arc folder (it contains StorableSidebar.json and "User Data"), for example one copied from another computer, or the StorableSidebar.json file itself.',
    buttons: ['Choose Folder…', 'Choose File…', 'Cancel'],
    defaultId: 0,
    cancelId: 2
  })
  if (choice === 2) return undefined
  return pick(browser, choice === 0 ? { title, defaultPath, properties: ['openDirectory'] } : { title, defaultPath, filters, properties: ['openFile'] })
}

interface ArcSource {
  sidebarFile: string
  root: string
  userData?: string
}

/** Also accepts a parent such as "Application Support" or the MSIX package dir. */
function resolveArcSource(p: string): ArcSource {
  let st
  try {
    st = statSync(p)
  } catch {
    throw new Error(`${p} does not exist`)
  }
  let sidebarFile: string | undefined
  if (st.isFile()) sidebarFile = p
  else {
    const candidates = [p, dirname(p), join(p, 'Arc'), join(p, 'LocalCache', 'Local', 'Arc')].map((d) => join(d, 'StorableSidebar.json'))
    sidebarFile = candidates.find((f) => existsSync(f))
  }
  if (!sidebarFile) throw new Error(`No StorableSidebar.json found in ${p}`)
  const root = dirname(sidebarFile)
  const userData = join(root, 'User Data')
  return { sidebarFile, root, userData: existsSync(userData) ? userData : undefined }
}

async function readJson(file: string): Promise<unknown> {
  try {
    return readArcJson(await readFile(file, 'utf8'))
  } catch {
    // Arc may be rewriting the file right now.
    await new Promise((r) => setTimeout(r, 250))
    return readArcJson(await readFile(file, 'utf8'))
  }
}

async function chooseArcSource(browser: Browser, path?: string): Promise<ArcSource | undefined> {
  if (path) return resolveArcSource(path)
  const root = findArcRoot()
  if (root && existsSync(join(root, 'StorableSidebar.json'))) {
    const choice = await ask(browser, {
      type: 'question',
      message: 'Import your spaces, pinned tabs, favorites and history from Arc?',
      detail: `Found Arc data in ${root}. Quitting Arc first gives the most complete result.`,
      buttons: ['Import', 'Use a Different Copy…', 'Cancel'],
      defaultId: 0,
      cancelId: 2
    })
    if (choice === 2) return undefined
    if (choice === 0) return resolveArcSource(root)
  }
  const picked = await pickArcSource(browser, root)
  return picked ? resolveArcSource(picked) : undefined
}

/** Arc caches sidebar icons as PNGs named md5(sidebar item id). */
function arcFavicons(root: string): (arcItemId: string) => string | undefined {
  const dir = join(root, 'SidebarItemsFaviconCache')
  return (id) => {
    const file = join(dir, createHash('md5').update(id).digest('hex'))
    try {
      const png = readFileSync(file)
      return png.length <= FAVICON_MAX ? `data:image/png;base64,${png.toString('base64')}` : undefined
    } catch {
      return undefined
    }
  }
}

function isUntouchedDefault(state: PersistedState): boolean {
  const [space] = state.spaces
  return (
    state.spaces.length === 1 &&
    state.profiles.length === 1 &&
    space.name === 'Personal' &&
    !space.pinned.length &&
    !space.today.length &&
    state.profiles.every((p) => !p.favorites.length) &&
    !state.archive.length
  )
}

interface SourceProfile {
  key: string
  name: string
  favorites: TabItem[]
}

interface SourceSpace {
  key: string
  name: string
  emoji?: string
  color: string
  appearance?: 'light' | 'dark'
  profileKey: string
  pinned: PinnedNode[]
  today: TabItem[]
}

interface AddedSpaces {
  /** By the source browser's keys. */
  profileIds: Map<string, string>
  spaceIds: Map<string, string>
  spaces: Space[]
  /** The caller picks the active space. */
  replace: boolean
  replacedActive: boolean
}

/** Not saved yet. */
function addSpaces(browser: Browser, from: string, profiles: SourceProfile[], spaces: SourceSpace[]): AddedSpaces {
  const state = browser.state
  const replace = isUntouchedDefault(state)
  const replacedActive = replace && state.spaces.some((s) => s.id === state.activeSpaceId)
  if (replace) {
    const old = new Set(state.profiles.map((p) => p.id))
    state.spaces = []
    state.profiles = []
    if (old.has(state.settings.littleArcProfileId)) state.settings.littleArcProfileId = ''
  }

  const profileIds = new Map<string, string>()
  const taken = new Set(state.profiles.map((p) => p.name))
  for (const p of profiles) {
    let name = p.name
    if (taken.has(name)) name = `${name} (${from})`
    taken.add(name)
    const profile: Profile = { id: newId(), name, favorites: p.favorites }
    state.profiles.push(profile)
    profileIds.set(p.key, profile.id)
  }

  const spaceIds = new Map<string, string>()
  const added: Space[] = spaces.map((s) => {
    const space: Space = {
      id: newId(),
      name: s.name,
      emoji: s.emoji,
      color: s.color,
      appearance: s.appearance,
      profileId: profileIds.get(s.profileKey)!,
      pinned: s.pinned,
      today: s.today,
      splits: []
    }
    spaceIds.set(s.key, space.id)
    return space
  })
  state.spaces.push(...added)
  return { profileIds, spaceIds, spaces: added, replace, replacedActive }
}

function settle(browser: Browser, added: AddedSpaces, active?: string): void {
  if (added.replace) browser.state.activeSpaceId = active || added.spaces[0].id
  browser.store.save()
  browser.emit()
  if (added.replacedActive) browser.switchSpace(browser.state.activeSpaceId)
}

/** `profiles`: only the spaces of these Arc profile folders. */
async function importArc(browser: Browser, path?: string, profiles?: Set<string>): Promise<string | undefined> {
  const src = await chooseArcSource(browser, path)
  if (!src) return undefined

  const json = await readJson(src.sidebarFile)
  const archiveFile = join(src.root, 'StorableArchiveItems.json')
  let archive: unknown
  if (existsSync(archiveFile)) {
    try {
      archive = await readJson(archiveFile)
    } catch (err) {
      console.warn('[import] could not read Arc archive', err)
    }
  }
  const parsed = parseArcSidebar(json, { archive, palette: SPACE_COLORS, favicon: arcFavicons(src.root) })
  // Only the count: the warnings name the skipped pages' URLs.
  if (parsed.warnings.length) console.warn(`[import] Arc: skipped ${parsed.warnings.length} items`)
  const spaces = profiles ? parsed.spaces.filter((s) => profiles.has(s.profileKey)) : parsed.spaces
  if (!spaces.length) throw new Error(`No spaces found in ${src.sidebarFile}`)

  const state = browser.state
  const names = src.userData ? readProfileNames(src.userData) : new Map<string, string>()
  const used = new Set(spaces.map((s) => s.profileKey))
  const added = addSpaces(
    browser,
    'Arc',
    parsed.profiles.filter((p) => used.has(p.key)).map((p) => ({ key: p.key, name: names.get(p.key) || p.key, favorites: p.favorites })),
    spaces.map((s) => ({ ...s, key: s.arcId }))
  )
  const { profileIds, spaceIds } = added

  const archived: ArchivedTab[] = (parsed.archive ?? []).filter((a) => !profiles || !a.spaceArcId || spaceIds.has(a.spaceArcId)).map((a) => ({
    id: newId(),
    url: a.url,
    title: a.title,
    spaceId: (a.spaceArcId && spaceIds.get(a.spaceArcId)) || added.spaces[0].id,
    archivedAt: a.archivedAt
  }))
  if (archived.length) {
    state.archive = [...state.archive, ...archived].sort((a, b) => b.archivedAt - a.archivedAt).slice(0, MAX_ARCHIVE)
  }

  let focused: string | undefined
  if (added.replace) {
    const windows = await readJson(join(src.root, 'StorableWindows.json')).catch(() => undefined)
    const prefs = windows as { lastFocusedSpaceID?: unknown; sidebarViewPreferences?: { sidebarWidth?: unknown } } | undefined
    focused = typeof prefs?.lastFocusedSpaceID === 'string' ? spaceIds.get(prefs.lastFocusedSpaceID) : undefined
    const width = prefs?.sidebarViewPreferences?.sidebarWidth
    if (typeof width === 'number') state.settings.sidebarWidth = Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)))
  }
  settle(browser, added, focused)

  let visits = 0
  const failed: string[] = []
  if (src.userData) {
    for (const [key, id] of profileIds) {
      const dir = join(src.userData, key)
      if (!existsSync(join(dir, 'History'))) continue
      try {
        visits += browser.profiles.get(id).history.import(await readHistory(dir))
      } catch (err) {
        console.warn(`[import] Arc history for ${key}`, err)
        failed.push(names.get(key) || key)
      }
    }
  }

  const pinned = added.spaces.reduce((n, s) => n + countTabs(s.pinned), 0)
  const favorites = parsed.profiles.filter((p) => used.has(p.key)).reduce((n, p) => n + p.favorites.length, 0)
  const parts = [plural(added.spaces.length, 'space'), plural(pinned, 'pinned tab'), plural(favorites, 'favorite')]
  if (src.userData) parts.push(plural(visits, 'history entry', 'history entries'))
  let summary = `Imported ${list(parts)} from Arc`
  if (failed.length) summary += ` (couldn't read history of ${list(failed)}; quit Arc and import again)`
  return summary
}

async function chooseZenProfile(browser: Browser, path?: string): Promise<ZenProfile | undefined> {
  if (path) return resolveZenProfile(path)
  const found = findZenProfiles()
  if (found.length) {
    const several = found.length > 1
    const buttons = [...(several ? found.map((p) => p.name) : ['Import']), 'Use a Different Copy…', 'Cancel']
    const choice = await ask(browser, {
      type: 'question',
      message: several ? 'Which Zen profile do you want to import?' : 'Import your spaces, pinned tabs, essentials and history from Zen?',
      detail: `${several ? 'Its spaces, pinned tabs, essentials and history are added.' : `Found Zen data in ${found[0].path}.`} Quitting Zen first gives the most complete result.`,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1
    })
    if (choice < 0 || choice === buttons.length - 1) return undefined
    if (choice < found.length) return found[choice]
  }
  const picked = await pick(browser, { title: 'Choose a Zen profile folder', defaultPath: findZenRoots()[0], properties: ['openDirectory', 'showHiddenFiles'] })
  return picked ? resolveZenProfile(picked) : undefined
}

async function importZen(browser: Browser, path?: string): Promise<string | undefined> {
  const profile = await chooseZenProfile(browser, path)
  if (!profile) return undefined

  const prefs = readZenPrefs(profile.path)
  const active = prefs.get('zen.workspaces.active')
  const parsed = parseZenSession(await readZenSession(profile.path), {
    palette: SPACE_COLORS,
    containers: readZenContainers(profile.path),
    containerEssentials: prefs.get('zen.workspaces.container-specific-essentials-enabled') === true,
    activeSpace: typeof active === 'string' ? active : undefined
  })
  if (!parsed.spaces.length) throw new Error(`No Zen spaces found in ${profile.path}`)

  const added = addSpaces(
    browser,
    'Zen',
    parsed.profiles,
    parsed.spaces.map((s) => ({ ...s, key: s.zenId }))
  )
  settle(browser, added, parsed.activeSpaceId && added.spaceIds.get(parsed.activeSpaceId))

  // Zen keeps one history for all its spaces.
  let visits = 0
  let historyFailed = false
  try {
    const history = await readZenHistory(profile.path)
    for (const id of added.profileIds.values()) visits = Math.max(visits, browser.profiles.get(id).history.import(history))
  } catch (err) {
    console.warn('[import] Zen history', err)
    historyFailed = true
  }

  const pinned = added.spaces.reduce((n, s) => n + countTabs(s.pinned), 0)
  const parts = [plural(added.spaces.length, 'space'), plural(pinned, 'pinned tab'), plural(parsed.essentials, 'favorite')]
  if (!historyFailed) parts.push(plural(visits, 'history entry', 'history entries'))
  let summary = `Imported ${list(parts)} from Zen`
  if (historyFailed) summary += " (couldn't read its history; quit Zen and import again)"
  return summary
}

interface ChromiumCandidate {
  browserName: string
  profileName: string
  dir: string
}

function chromiumCandidates(path?: string): ChromiumCandidate[] {
  if (path) {
    const isProfileDir = existsSync(join(path, 'History')) || existsSync(join(path, 'Bookmarks'))
    if (isProfileDir) {
      return [{ browserName: 'Chrome', profileName: basename(path), dir: path }]
    }
    return listProfiles(path).map((p) => ({ browserName: 'Chrome', profileName: p.name, dir: p.path }))
  }
  return findChromiumBrowsers().flatMap((b) => listProfiles(b.userDataDir).map((p) => ({ browserName: b.name, profileName: p.name, dir: p.path })))
}

async function importChromium(browser: Browser, path?: string): Promise<string | undefined> {
  const candidates = chromiumCandidates(path)
  if (!candidates.length) throw new Error(path ? `No browser profile found in ${path}` : 'No Chrome, Edge or Brave profile found')
  let chosen = candidates[0]
  if (candidates.length > 1) {
    const choice = await ask(browser, {
      type: 'question',
      message: 'Which browser profile do you want to import?',
      detail: 'History and bookmarks are added to the profile of the current space.',
      buttons: [...candidates.map((c) => `${c.browserName} — ${c.profileName}`), 'Cancel'],
      defaultId: 0,
      cancelId: candidates.length
    })
    if (choice < 0 || choice >= candidates.length) return undefined
    chosen = candidates[choice]
  }

  const space = browser.store.activeSpace
  const bookmarks = readBookmarks(chosen.dir)
  const bookmarkCount = countTabs(bookmarks)
  if (bookmarks.length) {
    space.pinned.push({ kind: 'folder', id: newId(), name: `Bookmarks from ${chosen.browserName}`, open: false, children: bookmarks })
    browser.store.save()
    browser.emit()
  }

  let visits = 0
  try {
    visits = browser.profiles.get(space.profileId).history.import(await readHistory(chosen.dir))
  } catch (err) {
    if (!bookmarkCount) throw err
    console.warn('[import] history', err)
    return `Imported ${plural(bookmarkCount, 'bookmark')} from ${chosen.browserName}; couldn't read its history (quit ${chosen.browserName} and import again)`
  }
  if (!visits && !bookmarkCount) return `Nothing to import from ${chosen.browserName} — ${chosen.profileName}`
  return `Imported ${list([plural(visits, 'history entry', 'history entries'), plural(bookmarkCount, 'bookmark')])} from ${chosen.browserName}`
}

async function importChromiumSpace(browser: Browser, c: FoundChoice): Promise<string> {
  const name = c.name || c.browser
  const label = c.name ? `${c.browser} · ${c.name}` : c.browser
  const bookmarks = readBookmarks(c.path)
  const bookmarkCount = countTabs(bookmarks)
  const pinned: PinnedNode[] = bookmarks.length ? [{ kind: 'folder', id: newId(), name: 'Bookmarks', open: false, children: bookmarks }] : []
  const color = SPACE_COLORS[browser.state.spaces.length % SPACE_COLORS.length]
  const added = addSpaces(browser, c.browser, [{ key: c.profile, name, favorites: [] }], [{ key: c.path, name, color, profileKey: c.profile, pinned, today: [] }])
  settle(browser, added)

  let visits = 0
  try {
    visits = browser.profiles.get(added.spaces[0].profileId).history.import(await readHistory(c.path))
  } catch (err) {
    console.warn(`[import] ${c.browser} history`, err)
    return `Imported ${plural(bookmarkCount, 'bookmark')} from ${label}; couldn't read its history (quit ${c.browser} and import again)`
  }
  return `Imported ${list([plural(visits, 'history entry', 'history entries'), plural(bookmarkCount, 'bookmark')])} from ${label}`
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

function list(parts: string[]): string {
  return parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
