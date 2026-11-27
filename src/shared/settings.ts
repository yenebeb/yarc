import { validShortcuts } from './keymap.ts'
import { validRoutes } from './link-routes.ts'
import type { Settings } from './types.ts'
import { SEARCH_ENGINES } from './url.ts'

export const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
] as const satisfies readonly { value: Settings['theme']; label: string }[]

const ENUMS: Partial<Record<keyof Settings, readonly string[]>> = {
  theme: THEMES.map((theme) => theme.value),
  searchEngine: Object.keys(SEARCH_ENGINES)
}

export function validSettingsPatch(current: Settings, patch: unknown, mac: boolean): Partial<Settings> {
  const clean: Record<string, unknown> = {}
  if (!patch || typeof patch !== 'object') return clean
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(current, key)) continue
    const now = (current as unknown as Record<string, unknown>)[key]
    if (key === 'shortcuts') {
      const shortcuts = validShortcuts(value, mac)
      if (shortcuts) clean[key] = shortcuts
      continue
    }
    if (key === 'linkRoutes') {
      const routes = validRoutes(value)
      if (routes) clean[key] = routes
      continue
    }
    if (Array.isArray(now)) {
      if (Array.isArray(value) && value.every((v) => typeof v === 'string')) clean[key] = value
      continue
    }
    if (typeof value !== typeof now) continue
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    const allowed = ENUMS[key as keyof Settings]
    if (allowed && !allowed.includes(value as string)) continue
    clean[key] = value
  }
  return clean as Partial<Settings>
}
