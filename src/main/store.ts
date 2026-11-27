import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { SPACE_COLORS } from '../shared/colors'
import { writeFileAtomic } from './atomic-file'
import { upgradeSplit } from '../shared/split'
import type { PersistedState, Profile, Settings, Space } from '../shared/types'

export const newId = (): string => randomUUID()
export const MAX_ARCHIVE = 1000

export { SPACE_COLORS }

export const DEFAULT_SETTINGS: Settings = {
  sidebarVisible: true,
  sidebarWidth: 260,
  devtoolsWidth: 480,
  sidebarRight: false,
  archiveAfterHours: 12,
  searchEngine: 'google',
  littleArcForExternalLinks: true,
  linkRoutes: [],
  littleCloseAfterHours: 1,
  littleArcProfileId: '',
  peekPinnedLinks: true,
  adblock: true,
  adblockAllowlist: [],
  autoUpdate: true,
  floatVideos: true,
  shortcuts: {},
  theme: 'system',
  syncHistory: false,
  syncReminderHidden: false
}

export function defaultState(): PersistedState {
  const profile: Profile = { id: newId(), name: 'Default', favorites: [] }
  const space: Space = {
    id: newId(),
    name: 'Personal',
    emoji: '🌱',
    color: SPACE_COLORS[0],
    profileId: profile.id,
    pinned: [],
    today: [],
    splits: []
  }
  return {
    version: 1,
    profiles: [profile],
    spaces: [space],
    activeSpaceId: space.id,
    settings: { ...DEFAULT_SETTINGS },
    archive: [],
    littleArc: { profileByHost: {} },
    windows: []
  }
}

export function normalize(raw: Partial<PersistedState>): PersistedState {
  const base = defaultState()
  const profiles = raw.profiles?.length ? raw.profiles : base.profiles
  const spaces = (raw.spaces?.length ? raw.spaces : base.spaces).map((s) => ({
    ...s,
    pinned: s.pinned ?? [],
    today: s.today ?? [],
    splits: (s.splits ?? []).flatMap((sp) => upgradeSplit(sp) ?? []),
    profileId: profiles.some((p) => p.id === s.profileId) ? s.profileId : profiles[0].id
  }))
  return {
    version: 1,
    profiles: profiles.map((p) => ({ ...p, favorites: p.favorites ?? [] })),
    spaces,
    activeSpaceId: spaces.some((s) => s.id === raw.activeSpaceId) ? raw.activeSpaceId! : spaces[0].id,
    settings: { ...DEFAULT_SETTINGS, ...raw.settings },
    archive: raw.archive ?? [],
    littleArc: { size: raw.littleArc?.size, profileByHost: raw.littleArc?.profileByHost ?? {} },
    lastSeenVersion: raw.lastSeenVersion,
    seenSpotlights: Array.isArray(raw.seenSpotlights) ? raw.seenSpotlights.filter((id) => typeof id === 'string') : undefined,
    whatsNewSeenVersion: raw.whatsNewSeenVersion,
    waitingUpdate: raw.waitingUpdate,
    windows: (raw.windows ?? []).filter((w) => w && typeof w.id === 'string').map((w) => ({ ...w, selected: w.selected ?? {}, splits: w.splits ?? {} }))
  }
}

export function incognitoState(settings: Settings): PersistedState {
  const state = defaultState()
  state.profiles[0].name = 'Incognito'
  Object.assign(state.spaces[0], { name: 'Incognito', emoji: '🥷', color: '#161616', appearance: 'dark' })
  state.settings = structuredClone(settings)
  return state
}

export class Store {
  state: PersistedState
  readonly firstRun: boolean
  private timer: NodeJS.Timeout | undefined
  beforeWrite: (() => void) | undefined

  /** Without a file (incognito), it lives in memory only. */
  constructor(
    private file: string | undefined,
    initial?: PersistedState
  ) {
    this.firstRun = !!file && !existsSync(file)
    this.state = initial ?? this.load()
  }

  private load(): PersistedState {
    if (!this.file) return defaultState()
    try {
      if (existsSync(this.file)) return normalize(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch (err) {
      console.error('[store] could not read state, keeping a backup and starting fresh', err)
      try {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
        pruneBackups(this.file)
      } catch {}
    }
    return defaultState()
  }

  save(): void {
    this.timer ??= setTimeout(() => this.flush(), 2000)
  }

  flush(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.file) return
    this.beforeWrite?.()
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileAtomic(this.file, JSON.stringify(this.state))
  }

  replace(next: PersistedState): void {
    this.state = normalize(next)
    this.save()
  }

  get activeSpace(): Space {
    return this.state.spaces.find((s) => s.id === this.state.activeSpaceId) ?? this.state.spaces[0]
  }

  space(id: string): Space | undefined {
    return this.state.spaces.find((s) => s.id === id)
  }

  profile(id: string): Profile | undefined {
    return this.state.profiles.find((p) => p.id === id)
  }
}

/** Each holds every tab's URL. */
function pruneBackups(file: string): void {
  const dir = dirname(file)
  const prefix = `${basename(file)}.corrupt-`
  const backups = readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)))
  for (const old of backups.slice(3)) rmSync(join(dir, old), { force: true })
}
