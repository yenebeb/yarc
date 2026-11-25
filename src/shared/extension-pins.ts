import type { ExtensionInfo, Profile } from './types.ts'

export function pinnedOf(profile: Profile, installed: ExtensionInfo[]): ExtensionInfo[] {
  return (profile.pinnedExtensions ?? []).flatMap((id) => installed.filter((e) => e.id === id))
}

export function withPin(pins: string[], id: string, pinned: boolean): string[] {
  if (!pinned) return pins.filter((p) => p !== id)
  return pins.includes(id) ? pins : [...pins, id]
}
