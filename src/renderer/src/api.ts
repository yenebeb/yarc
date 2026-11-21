import { useEffect, useState } from 'react'
import type { Action } from '../../shared/actions'
import type { ArcApi } from '../../shared/ipc'
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

export function useAppState(): AppState | undefined {
  const [state, setState] = useState<AppState>()
  useEffect(() => {
    let alive = true
    void arc.getState().then((s) => alive && setState(s))
    const off = arc.onState(setState)
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

export function useOverlayMode(): OverlayMode {
  const [mode, setMode] = useState<OverlayMode>({ kind: 'none' })
  useEffect(() => {
    void arc.getOverlay().then(setMode)
    return arc.onOverlay(setMode)
  }, [])
  return mode
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

export function setSpaceColors(color: string, color2 = color): void {
  document.documentElement.style.setProperty('--space', color)
  document.documentElement.style.setProperty('--space-2', color2)
}

export function useSpaceTheme(space: Pick<Space, 'color' | 'color2'> | undefined, appearance: Space['appearance']): void {
  useEffect(() => {
    if (space?.color) setSpaceColors(space.color, space.color2)
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
  try {
    const u = new URL(url)
    if (u.protocol === 'about:') return url
    return u.hostname.replace(/^www\./, '') || url
  } catch {
    return url
  }
}
