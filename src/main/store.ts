// Persistence of the sidebar/spaces state as one JSON file with atomic, debounced writes.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { SPACE_COLORS } from '../shared/colors'
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
  littleArcProfileId: '',
  peekPinnedLinks: true,
  adblock: true,
  adblockAllowlist: [],
  autoUpdate: true,
  theme: 'system',
  syncHistory: false,
  syncFolder: ''
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
    littleArc: { profileByHost: {} }
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
    splits: s.splits ?? [],
    profileId: profiles.some((p) => p.id === s.profileId) ? s.profileId : profiles[0].id
  }))
  return {
    version: 1,
    profiles: profiles.map((p) => ({ ...p, favorites: p.favorites ?? [] })),
    spaces,
    activeSpaceId: spaces.some((s) => s.id === raw.activeSpaceId) ? raw.activeSpaceId! : spaces[0].id,
    settings: { ...DEFAULT_SETTINGS, ...raw.settings },
    archive: raw.archive ?? [],
    littleArc: { size: raw.littleArc?.size, profileByHost: raw.littleArc?.profileByHost ?? {} }
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
  private timer: NodeJS.Timeout | undefined

  /** Without a file (incognito), the state lives in memory only. */
  constructor(
    private file: string | undefined,
    initial?: PersistedState
  ) {
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
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state))
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
