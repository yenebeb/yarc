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
    id: 'usage-count',
    title: 'YARC now counts its installs, and only that',
    text:
      'Once a day, YARC tells GitHub that an install on your platform, say macOS on Apple silicon, was open. No ID, nothing about you ' +
      'or what you browse: it only shows which platforms to spend time on. You can turn it off in Settings.',
    actions: [{ label: 'Settings', command: 'settings' }]
  },
  {
    id: 'canvases',
    title: 'Collect bits of the web on a canvas',
    text:
      'Capture part of any page with ⌘⇧2 (Ctrl+Shift+2 on Windows) and send it to a canvas in your sidebar: a board for moodboards, ' +
      'research and plans. Add text, shapes, arrows and drawings, and open any capture’s page again from its card.',
    actions: [{ label: 'New Canvas', command: 'newCanvas' }]
  },
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
