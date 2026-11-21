// See docs/arc-data-format.md.
import { randomUUID } from 'node:crypto'
import type { PinnedFolder, PinnedNode, PinnedTab, TabItem } from '../../shared/types'
import { isImportableUrl, isObj, num, str, type Obj } from './loose-json.ts'

export interface ParsedArcProfile {
  /** 'Default', 'Profile 1', … */
  key: string
  favorites: TabItem[]
}

export interface ParsedArcSpace {
  arcId: string
  name: string
  emoji?: string
  color: string
  appearance?: 'light' | 'dark'
  profileKey: string
  pinned: PinnedNode[]
  today: TabItem[]
}

export interface ParsedArcArchived {
  url: string
  title: string
  archivedAt: number
  spaceArcId?: string
}

export interface ParsedArc {
  profiles: ParsedArcProfile[]
  spaces: ParsedArcSpace[]
  archive?: ParsedArcArchived[]
  warnings: string[]
}

export interface ParseArcOptions {
  now?: number
  /** Parsed StorableArchiveItems.json. */
  archive?: unknown
  /** For spaces without a theme, picked by space index. */
  palette?: string[]
  favicon?: (arcItemId: string) => string | undefined
}

const COCOA_EPOCH_MS = 978_307_200_000
const DEFAULT_SPACE_ID = 'thebrowser.company.defaultPersonalSpaceID'
const MAX_DEPTH = 32
const DEFAULT_PALETTE = ['#7c6cf2', '#e0607e', '#3fa7d6', '#3dbb8a', '#f2a541', '#c06cf2', '#5b7bd6', '#8a8a8a']

const unwrap = (v: unknown): unknown => (isObj(v) && 'value' in v && isObj(v.value) ? v.value : v)
const firstKey = (v: unknown): string => (isObj(v) ? (Object.keys(v)[0] ?? 'empty') : typeof v)

/** Arc timestamps are seconds since 2001-01-01; values that look like Unix ms are passed through. */
export function arcTime(v: unknown): number | undefined {
  const s = num(v)
  if (s === undefined || s <= 0) return undefined
  return s > 1e11 ? Math.round(s) : Math.round(COCOA_EPOCH_MS + s * 1000)
}

/** JSON.parse with the repair for Windows files that contain raw backslashes (`C:\…` in file: URLs). */
export function readArcJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (err) {
    try {
      return JSON.parse(text.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\'))
    } catch {
      throw err
    }
  }
}

/** Objects from a Swift flat dictionary (`[id, obj, id, obj]`) or a plain array, keyed by `obj.id`, else the preceding string, else ''. */
function entries(arr: unknown): [string, Obj][] {
  if (!Array.isArray(arr)) return []
  const out: [string, Obj][] = []
  let lastKey: string | undefined
  for (const raw of arr) {
    if (typeof raw === 'string') {
      lastKey = raw
      continue
    }
    const v = unwrap(raw)
    if (isObj(v)) out.push([str(v.id) ?? lastKey ?? '', v])
    lastKey = undefined
  }
  return out
}

/** The value after the first key that is `role` itself or a `{ [role]: … }` enum marker. */
function lookupRole(arr: unknown, role: string): string | undefined {
  if (!Array.isArray(arr)) return undefined
  for (let i = 0; i + 1 < arr.length; i++) {
    const k = arr[i]
    if ((k === role || (isObj(k) && role in k)) && typeof arr[i + 1] === 'string') return arr[i + 1] as string
  }
  return undefined
}

export function profileKey(desc: unknown): string {
  if (!isObj(desc) || 'default' in desc) return 'Default'
  const custom = desc.custom
  if (isObj(custom)) {
    for (const v of Object.values(custom)) {
      const dir = isObj(v) ? str(v.directoryBasename) : undefined
      // A folder name inside Arc's User Data, never a path out of it.
      if (dir && /^[^/\\]+$/.test(dir) && dir !== '.' && dir !== '..') return dir
    }
  }
  return 'Default'
}

/** `iconType.icon` names (Ionicons glyphs). */
const ARC_ICONS: Record<string, string> = {
  star: '⭐', bookmark: '🔖', heart: '❤️', flag: '🚩', flash: '⚡', triangle: '🔺', medical: '⚕️',
  notifications: '🔔', bulb: '💡', shapes: '🔷', grid: '🔲', apps: '🧩', layers: '🗂️', server: '🗄️',
  albums: '🖼️', copy: '📋', folder: '📁', fileTrayFull: '🗃️', calendar: '📅', mail: '✉️', checkbox: '✅',
  document: '📄', book: '📖', chatBubbleEllipses: '💬', people: '👥', terminal: '⌨️', construction: '🚧',
  square: '🟦', egg: '🥚', ellipse: '🔵', moon: '🌙', sunny: '☀️', planet: '🪐', leaf: '🍃', cloud: '☁️',
  paw: '🐾', bag: '🛍️', gift: '🎁', bed: '🛏️', restaurant: '🍴', barbell: '🏋️', airplane: '✈️',
  musicalNote: '🎵', colorPallete: '🎨', video: '🎬', bandage: '🩹', code: '💻', baseball: '⚾',
  cloudOutline: '🌥️', map: '🗺️', bonfire: '🔥', pizza: '🍕', skull: '💀', receipt: '🧾', thumbsUp: '👍',
  train: '🚆', rss: '📡', github: '🐙', linear: '📐', figma: '🖌️', search: '🔍'
}

/** Arc syncs profiles across Macs; `custom._0.machineID` tells which Mac a profile descriptor belongs to. */
function machineIdOf(desc: unknown): string | undefined {
  const custom = isObj(desc) ? desc.custom : undefined
  if (!isObj(custom)) return undefined
  for (const v of Object.values(custom)) if (isObj(v) && str(v.machineID)) return str(v.machineID)
  return undefined
}

function emojiOf(icon: unknown): string | undefined {
  if (!isObj(icon)) return undefined
  if (str(icon.emoji_v2)) return str(icon.emoji_v2)
  if (str(icon.emoji)) return str(icon.emoji)
  const named = str(icon.icon)
  if (named && Object.hasOwn(ARC_ICONS, named)) return ARC_ICONS[named]
  const cp = num(icon.emoji)
  if (cp !== undefined) {
    try {
      return String.fromCodePoint(cp)
    } catch {}
  }
  return undefined
}

export function colorToHex(c: unknown): string | undefined {
  if (!isObj(c)) return undefined
  const rgb = [num(c.red), num(c.green), num(c.blue)]
  if (rgb.some((v) => v === undefined)) return undefined
  const alpha = num(c.alpha)
  if (alpha !== undefined && alpha <= 0) return undefined
  return '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v!)) * 255).toString(16).padStart(2, '0')).join('')
}

function backgroundColor(theme: Obj): string | undefined {
  const bg = theme.background
  const style = isObj(bg) ? dig(bg, 'single', '_0', 'style', 'color', '_0') : undefined
  if (isObj(style)) {
    const single = colorToHex(dig(style, 'blendedSingleColor', '_0', 'color'))
    if (single) return single
    const base = dig(style, 'blendedGradient', '_0', 'baseColors')
    if (Array.isArray(base)) for (const c of base) if (colorToHex(c)) return colorToHex(c)
  }
  const stack: unknown[] = [bg]
  let budget = 500
  while (stack.length && budget-- > 0) {
    const v = stack.shift()
    if (Array.isArray(v)) stack.push(...v)
    else if (isObj(v)) {
      if ('red' in v && colorToHex(v)) return colorToHex(v)
      stack.push(...Object.values(v))
    }
  }
  return undefined
}

function dig(v: unknown, ...path: string[]): unknown {
  for (const k of path) {
    if (!isObj(v)) return undefined
    v = v[k]
  }
  return v
}

interface Ctx {
  items: Map<string, Obj>
  /** For items whose parent has no usable childrenIds. */
  byParent: Map<string, string[]>
  now: number
  warnings: string[]
  favicon?: (arcItemId: string) => string | undefined
}

function childrenOf(ctx: Ctx, id: string): [string, Obj][] {
  const parent = ctx.items.get(id)
  const listed = parent && Array.isArray(parent.childrenIds) ? parent.childrenIds.filter((c): c is string => typeof c === 'string') : []
  const ids = listed.length ? listed : (ctx.byParent.get(id) ?? [])
  const out: [string, Obj][] = []
  for (const cid of ids) {
    const item = ctx.items.get(cid)
    if (item) out.push([cid, item])
    else ctx.warnings.push(`Missing item ${cid} (child of ${id})`)
  }
  return out
}

function toTab(ctx: Ctx, itemId: string, item: Obj, saved: boolean): PinnedTab | undefined {
  const tab = dig(item, 'data', 'tab')
  if (!isObj(tab)) return undefined
  const url = str(tab.savedURL)
  if (!isImportableUrl(url)) {
    ctx.warnings.push(`Skipped tab with unsupported URL ${JSON.stringify(url ?? '')}`)
    return undefined
  }
  const custom = str(item.title)
  const page = str(tab.savedTitle)
  const out: PinnedTab = {
    kind: 'tab',
    id: randomUUID(),
    url,
    title: custom ?? page ?? url,
    lastActive: arcTime(tab.timeLastActiveAt) ?? arcTime(item.createdAt) ?? ctx.now
  }
  const favicon = ctx.favicon?.(itemId)
  if (favicon) out.favicon = favicon
  if (saved) {
    out.savedUrl = url
    if (custom) out.savedTitle = custom
  }
  return out
}

/** Split views are flattened in place. */
function walk(ctx: Ctx, id: string, saved: boolean, depth = 0, seen = new Set<string>()): PinnedNode[] {
  if (depth > MAX_DEPTH) {
    ctx.warnings.push(`Stopped at ${id}: nesting too deep`)
    return []
  }
  seen.add(id)
  const out: PinnedNode[] = []
  for (const [itemId, item] of childrenOf(ctx, id)) {
    const data = item.data
    if (seen.has(itemId)) {
      ctx.warnings.push(`Skipped ${itemId}: already in the tree (cycle)`)
      continue
    }
    seen.add(itemId)
    if (isObj(data) && 'tab' in data) {
      const tab = toTab(ctx, itemId, item, saved)
      if (tab) out.push(tab)
    } else if (isObj(data) && 'list' in data) {
      const folder: PinnedFolder = {
        kind: 'folder',
        id: randomUUID(),
        name: str(item.title) ?? 'Untitled folder',
        open: false,
        children: walk(ctx, itemId, saved, depth + 1, seen)
      }
      out.push(folder)
    } else if (isObj(data) && 'splitView' in data) {
      out.push(...walk(ctx, itemId, saved, depth + 1, seen))
    } else {
      ctx.warnings.push(`Skipped item of kind ${firstKey(data)}`)
    }
  }
  return out
}

function flatTabs(nodes: PinnedNode[]): PinnedTab[] {
  return nodes.flatMap((n) => (n.kind === 'folder' ? flatTabs(n.children) : [n]))
}

const stripKind = ({ kind: _kind, ...rest }: PinnedTab): TabItem => rest

interface DataContainer {
  spaces: [string, Obj][]
  items: [string, Obj][]
  topApps: [profileDescriptor: unknown, containerId: string][]
  order?: string[]
}

function topAppsPairs(arr: unknown): [unknown, string][] {
  if (!Array.isArray(arr)) return []
  const out: [unknown, string][] = []
  for (let i = 0; i + 1 < arr.length; i++) {
    if (isObj(arr[i]) && typeof arr[i + 1] === 'string') out.push([arr[i], arr[++i] as string])
  }
  return out
}

function dataContainer(json: Obj, warnings: string[]): DataContainer {
  const raw = dig(json, 'sidebar', 'containers')
  const containers = (Array.isArray(raw) ? raw : []).filter((c): c is Obj => isObj(c) && (Array.isArray(c.items) || Array.isArray(c.spaces)))
  containers.sort((a, b) => (Array.isArray(b.items) ? b.items.length : 0) - (Array.isArray(a.items) ? a.items.length : 0))
  if (containers.length > 1) warnings.push(`Found ${containers.length} data containers, merged them`)
  const out: DataContainer = { spaces: [], items: [], topApps: [] }
  for (const c of containers) {
    out.spaces.push(...entries(c.spaces))
    out.items.push(...entries(c.items))
    out.topApps.push(...topAppsPairs(c.topAppsContainerIDs))
  }
  if (out.spaces.length || out.items.length) return out

  for (const legacy of [dig(json, 'sidebarSyncState'), dig(json, 'firebaseSyncState', 'syncData')]) {
    if (!isObj(legacy)) continue
    const spaces = entries(legacy.spaceModels)
    const items = entries(legacy.items)
    if (!spaces.length && !items.length) continue
    warnings.push('Used the legacy sidebar sync layout')
    const container = unwrap(legacy.container)
    const topId = isObj(container) ? str(container.topAppsContainerID) : undefined
    const order = isObj(container) && Array.isArray(container.orderedSpaceIDs) ? container.orderedSpaceIDs.filter((s): s is string => typeof s === 'string') : undefined
    return { spaces, items, topApps: topId ? [[{ default: true }, topId]] : [], order }
  }
  return out
}

export function parseArcSidebar(json: unknown, opts: ParseArcOptions = {}): ParsedArc {
  const now = opts.now ?? Date.now()
  const palette = opts.palette?.length ? opts.palette : DEFAULT_PALETTE
  const warnings: string[] = []
  const result: ParsedArc = { profiles: [], spaces: [], warnings }
  if (opts.archive !== undefined) result.archive = parseArcArchive(opts.archive, { now })
  if (!isObj(json)) {
    warnings.push('Not a StorableSidebar.json object')
    return result
  }

  const data = dataContainer(json, warnings)
  const ctx: Ctx = { items: new Map(), byParent: new Map(), now, warnings, favicon: opts.favicon }
  for (const [key, item] of data.items) if (key && !ctx.items.has(key)) ctx.items.set(key, item)
  for (const [key, item] of ctx.items) {
    const parent = str(item.parentID)
    if (!parent) continue
    const list = ctx.byParent.get(parent) ?? []
    list.push(key)
    ctx.byParent.set(parent, list)
  }

  const profiles = new Map<string, ParsedArcProfile>()
  const profile = (key: string): ParsedArcProfile => {
    let p = profiles.get(key)
    if (!p) profiles.set(key, (p = { key, favorites: [] }))
    return p
  }

  let spaces = data.spaces.filter(([key], i, all) => !key || all.findIndex(([k]) => k === key) === i)
  if (data.order?.length) {
    const rank = (id: string): number => {
      const i = data.order!.indexOf(id)
      return i < 0 ? Infinity : i
    }
    spaces = [...spaces].sort((a, b) => rank(a[0]) - rank(b[0]))
  }
  const spaceMachinesByProfileDir = new Map<string, Set<string>>()
  for (const [, s] of spaces) {
    const machine = machineIdOf(s.profile)
    if (!machine) continue
    const dir = profileKey(s.profile)
    spaceMachinesByProfileDir.set(dir, (spaceMachinesByProfileDir.get(dir) ?? new Set()).add(machine))
  }

  spaces.forEach(([key, s], index) => {
    const arcId = str(s.id) ?? (key || `space-${index + 1}`)
    const roots = [s.containerIDs, s.newContainerIDs]
    const pinnedRoot = lookupRole(roots[0], 'pinned') ?? lookupRole(roots[1], 'pinned')
    const todayRoot = lookupRole(roots[0], 'unpinned') ?? lookupRole(roots[1], 'unpinned')
    const info = isObj(s.customInfo) ? s.customInfo : {}
    const theme = isObj(info.windowTheme) ? info.windowTheme : undefined
    const profileKeyOf = profileKey(s.profile)
    profile(profileKeyOf)
    const space: ParsedArcSpace = {
      arcId,
      name: str(s.title) ?? (arcId === DEFAULT_SPACE_ID ? 'Personal' : `Space ${index + 1}`),
      color:
        (theme && (colorToHex(dig(theme, 'primaryColorPalette', 'midTone')) ?? backgroundColor(theme))) ??
        palette[index % palette.length],
      profileKey: profileKeyOf,
      pinned: pinnedRoot ? walk(ctx, pinnedRoot, true) : [],
      today: todayRoot ? flatTabs(walk(ctx, todayRoot, false)).map((t) => ({ ...stripKind(t), lastActive: now })) : []
    }
    const emoji = emojiOf(info.iconType)
    if (emoji) space.emoji = emoji
    const appearance = theme && dig(theme, 'background', 'single', '_0', 'contentOverBackgroundAppearance')
    if (appearance === 'light' || appearance === 'dark') space.appearance = appearance
    result.spaces.push(space)
  })

  let topApps = data.topApps
  if (!topApps.length) {
    for (const [key, item] of ctx.items) {
      const topAppsType = dig(item, 'data', 'itemContainer', 'containerType', 'topApps')
      if (isObj(topAppsType)) topApps.push([topAppsType._0, key])
    }
  }
  topApps = topApps.filter(([, id], i, all) => all.findIndex(([, other]) => other === id) === i)
  for (const [desc, id] of topApps) {
    const machine = machineIdOf(desc)
    const machines = spaceMachinesByProfileDir.get(profileKey(desc))
    if (machine && machines && !machines.has(machine)) {
      warnings.push(`Skipped favorites of ${profileKey(desc)} from another Mac (${machine})`)
      continue
    }
    const p = profile(profileKey(desc))
    const seen = new Set(p.favorites.map((f) => f.url))
    for (const tab of flatTabs(walk(ctx, id, true))) {
      if (seen.has(tab.url)) continue
      seen.add(tab.url)
      p.favorites.push(stripKind(tab))
    }
  }

  result.profiles = [...profiles.values()]
  return result
}

export function parseArcArchive(json: unknown, opts: { now?: number } = {}): ParsedArcArchived[] {
  const now = opts.now ?? Date.now()
  const list = isObj(json) ? json.items : json
  const out: ParsedArcArchived[] = []
  for (const [, entry] of entries(list)) {
    const item = isObj(entry.sidebarItem) ? entry.sidebarItem : undefined
    const tab = dig(item, 'data', 'tab')
    if (!item || !isObj(tab)) continue
    const url = str(tab.savedURL)
    if (!url || !/^https?:/i.test(url)) continue
    const archived: ParsedArcArchived = {
      url,
      title: str(item.title) ?? str(tab.savedTitle) ?? url,
      archivedAt: arcTime(entry.archivedAt) ?? arcTime(tab.timeLastActiveAt) ?? now
    }
    const spaceArcId = str(dig(entry, 'source', 'space', '_0'))
    if (spaceArcId) archived.spaceArcId = spaceArcId
    out.push(archived)
  }
  return out.sort((a, b) => b.archivedAt - a.archivedAt)
}
