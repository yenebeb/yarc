import type { ExtensionInfo, Profile } from './types.ts'

export function pinnedOf(profile: Profile, installed: ExtensionInfo[]): ExtensionInfo[] {
  return (profile.pinnedExtensions ?? []).flatMap((id) => installed.filter((extension) => extension.id === id))
}

export function everyInstalledPinned(pinnedWhileLoading: string[] | undefined, installed: ExtensionInfo[]): string[] {
  return [...new Set([...(pinnedWhileLoading ?? []), ...installed.map((extension) => extension.id)])]
}

export function withPin(pins: string[], id: string, pinned: boolean): string[] {
  if (!pinned) return pins.filter((pinnedId) => pinnedId !== id)
  return pins.includes(id) ? pins : [...pins, id]
}
