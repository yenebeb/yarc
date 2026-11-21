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
    id: 'nothing-collected',
    title: 'YARC collects nothing',
    text:
      'No telemetry, no usage counts, no account and no YARC server: the short-lived daily install count is gone again. ' +
      'YARC’s own requests are only update checks, ad-blocking lists, search suggestions and extension updates.'
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
