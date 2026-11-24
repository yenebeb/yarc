import { useEffect, useState } from 'react'
import type { Action } from '../../shared/actions'
import type { ArcApi } from '../../shared/ipc'
import { bindingLabel, type CommandId, type Shortcuts } from '../../shared/keymap'
import type { AppState, OverlayMode, Space } from '../../shared/types'

declare global {
  interface Window {
    arc: ArcApi
  }
}

export const arc = window.arc
export const isMac = arc.platform === 'darwin'
document.documentElement.dataset.platform = arc.platform
export const dispatch = (a: Action) => void arc.dispatch(a)

let shortcuts: Shortcuts = {}
export const shortcutLabel = (id: CommandId): string => bindingLabel(id, isMac, shortcuts)

export function useAppState(): AppState | undefined {
  const [state, setState] = useState<AppState>()
  useEffect(() => {
    let alive = true
    const take = (s: AppState) => {
      shortcuts = s.settings.shortcuts
      setState(s)
    }
    void arc.getState().then((s) => alive && take(s))
    const off = arc.onState(take)
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

/** `opened` counts changes of kind as they arrive, so a panel closed and reopened within one render still starts fresh. */
export function useOverlayMode(): { mode: OverlayMode; opened: number } {
  const [current, setCurrent] = useState<{ mode: OverlayMode; opened: number }>({ mode: { kind: 'none' }, opened: 0 })
  useEffect(() => {
    const take = (mode: OverlayMode) => setCurrent((c) => ({ mode, opened: c.opened + Number(mode.kind !== c.mode.kind) }))
    void arc.getOverlay().then(take)
    return arc.onOverlay(take)
  }, [])
  return current
}

export function activeSpace(state: AppState): Space {
  return state.spaces.find((s) => s.id === state.activeSpaceId) ?? state.spaces[0]
}

const systemDark = matchMedia('(prefers-color-scheme: dark)')
let spaceAppearance: Space['appearance']

function applyAppearance(): void {
  document.documentElement.dataset.appearance = spaceAppearance ?? (systemDark.matches ? 'dark' : 'light')
}
applyAppearance()
systemDark.addEventListener('change', applyAppearance)

export function useSpaceTheme(space: Pick<Space, 'color' | 'color2'> | undefined, appearance: Space['appearance']): void {
  useEffect(() => {
    if (!space?.color) return
    document.documentElement.style.setProperty('--space', space.color)
    document.documentElement.style.setProperty('--space-2', space.color2 ?? space.color)
  }, [space?.color, space?.color2])
  useEffect(() => {
    spaceAppearance = appearance
    applyAppearance()
  }, [appearance])
}

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}

export function faviconFor(favicon?: string): string | undefined {
  return favicon && !favicon.startsWith('chrome://') ? favicon : undefined
}

export function displayHost(url: string): string {
  const u = URL.parse(url)
  if (!u || u.protocol === 'about:') return url
  return u.hostname.replace(/^www\./, '') || url
}
