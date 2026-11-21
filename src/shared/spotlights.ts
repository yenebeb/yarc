// Keyed by id, not version: a spotlight ships in its feature's PR, before the version is known.
import type { CommandId } from './keymap'

export interface SpotlightAction {
  label: string
  command: CommandId
}

export interface Spotlight {
  /** Stable forever: profiles remember it as seen. Also names its picture. */
  id: string
  title: string
  text: string
  actions?: SpotlightAction[]
}

/** Newest first. */
export const SPOTLIGHTS: Spotlight[] = [
  {
    id: 'floating-player',
    title: 'Videos keep playing when you leave their tab',
    text:
      'Switch away from a playing video and it floats in a small player in front of all your apps. Drag it anywhere, resize it, ' +
      'or double-click it to go back to the tab. Music and other sound get a card at the bottom of the sidebar.',
    actions: [
      { label: 'Try It', command: 'floatingPlayerDemo' },
      { label: 'Settings', command: 'settings' }
    ]
  }
]

export const RECENT_SPOTLIGHTS = 3

export function unseenSpotlights(catalogue: Spotlight[], seen: readonly string[] | undefined): string[] {
  return catalogue.filter((s) => !seen?.includes(s.id)).map((s) => s.id)
}

export function recentSpotlights(catalogue: Spotlight[], count = RECENT_SPOTLIGHTS): string[] {
  return catalogue.slice(0, count).map((s) => s.id)
}

export function spotlight(id: string, catalogue = SPOTLIGHTS): Spotlight | undefined {
  return catalogue.find((s) => s.id === id)
}
