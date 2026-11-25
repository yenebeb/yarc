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
    id: 'canvas-notes',
    title: 'Take notes on a canvas',
    text:
      'Press N on a canvas and click for a note: a card that wraps what you write. Start a line with - for a list, [ ] for a checkbox ' +
      'you can tick, or # for a heading. Drag the side of any text to set its width, and ⌘-click (Ctrl-click on Windows) a link to peek at it.',
    actions: [{ label: 'New Canvas', command: 'newCanvas' }]
  },
  {
    id: 'live-folders',
    title: 'Folders that fill themselves',
    text:
      'A live folder in your sidebar keeps up with your open pull requests, the ones waiting for your review, a repository’s, ' +
      'or any RSS or Atom feed. YARC asks GitHub with the space’s own login, so nothing passes through anyone else.',
    actions: [{ label: 'New Live Folder', command: 'newLiveFolder' }]
  },
  {
    id: 'traffic-control',
    title: 'Links from other apps land in the right space',
    text:
      'Tell Traffic Control which space a site belongs to: github.com to Work, a shared doc to your side project. ' +
      'Links you click in Slack, Mail or any other app then open as a tab right there, not wherever you happen to be.',
    actions: [{ label: 'Set Up Rules', command: 'trafficControl' }]
  },
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
