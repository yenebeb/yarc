// Persistence of the sidebar/spaces state as one JSON file with atomic, debounced writes.
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { SPACE_COLORS } from '../shared/colors'
import { upgradeSplit } from '../shared/split'
import type { PersistedState, Profile, Settings, Space } from '../shared/types'

export const newId = (): string => randomUUID()

export { SPACE_COLORS }

export const DEFAULT_SETTINGS: Settings = {
  sidebarVisible: true,
  sidebarWidth: 260,
  sidebarRight: false,
  archiveAfterHours: 12,
  searchEngine: 'google',
  littleArcForExternalLinks: true,
  littleCloseAfterHours: 1,
  littleArcProfileId: '',
  peekPinnedLinks: true,
  adblock: true,
  adblockAllowlist: [],
  autoUpdate: true,
  theme: 'system'
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

/** Fill in fields that older or imported state files may lack. */
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
    waitingUpdate: raw.waitingUpdate,
    windows: (raw.windows ?? []).filter((w) => w && typeof w.id === 'string').map((w) => ({ ...w, selected: w.selected ?? {}, splits: w.splits ?? {} }))
  }
}

/** An incognito window's state: one black space on a temporary profile, with the main window's settings. */
export function incognitoState(settings: Settings): PersistedState {
  const state = defaultState()
  state.profiles[0].name = 'Incognito'
  Object.assign(state.spaces[0], { name: 'Incognito', emoji: '🥷', color: '#161616', appearance: 'dark' })
  state.settings = structuredClone(settings)
  return state
}

export class Store {
  state: PersistedState
  /** No state file existed before this launch: YARC's first run on this profile (the welcome screen). */
  readonly firstRun: boolean
  private timer: NodeJS.Timeout | undefined
  /** Runs before each write, to bring per-window state into `state.windows`. */
  beforeWrite: (() => void) | undefined

  /** Without a file (incognito), the state lives in memory only. */
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
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 400)
  }

  flush(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.file) return
    this.beforeWrite?.()
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    // Only this user can read it (it lists every tab), and it's on disk before it replaces the old
    // one: a power cut can't leave a truncated state.json, which would start YARC from scratch.
    const fd = openSync(tmp, 'w', 0o600)
    try {
      writeSync(fd, JSON.stringify(this.state))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, this.file)
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

/** Keeps the three newest state.json.corrupt-<time> backups: each holds every tab's URL. */
function pruneBackups(file: string): void {
  const dir = dirname(file)
  const prefix = `${basename(file)}.corrupt-`
  const backups = readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .sort((a, b) => Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)))
  for (const old of backups.slice(3)) rmSync(join(dir, old), { force: true })
}
