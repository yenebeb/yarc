// Feature spotlights: big features introduced with a large card in What's New, once, on the first
// launch that has them (src/main/changelog.ts). Smaller changes are only a line in the list under it
// (a PR's "What's New" section). A spotlight ships in its feature's own PR, so it is keyed by id,
// not by version: the version isn't known until the merge is released. state.json remembers the
// ids a profile has seen; a first run marks them all seen, since the tour covers the basics.
//
// Adding one: an entry here (newest first) and its picture in src/renderer/src/panels/spotlight-pictures.tsx,
// a small CSS/SVG animation in YARC's style that works in light and dark spaces (no image files).
import type { CommandId } from './keymap'

/** A button on the card: runs a command (closing What's New), like the command bar would. */
export interface SpotlightAction {
  label: string
  command: CommandId
}

export interface Spotlight {
  /** Stable forever: profiles remember it as seen. Also names its picture. */
  id: string
  title: string
  /** Two or three sentences: what it is and how to use it. */
  text: string
  /** "Try it" first, then, say, the settings that turn it off. */
  actions?: SpotlightAction[]
}

/** Newest first. */
export const SPOTLIGHTS: Spotlight[] = []

/** How many spotlights What's New shows when opened from the menu or the command bar. */
export const RECENT_SPOTLIGHTS = 3

/** The spotlights a profile hasn't seen yet, newest first. */
export function unseenSpotlights(catalogue: Spotlight[], seen: readonly string[] | undefined): string[] {
  return catalogue.filter((s) => !seen?.includes(s.id)).map((s) => s.id)
}

/** The ids of the newest spotlights, for What's New opened by hand. */
export function recentSpotlights(catalogue: Spotlight[], count = RECENT_SPOTLIGHTS): string[] {
  return catalogue.slice(0, count).map((s) => s.id)
}

export function spotlight(id: string, catalogue = SPOTLIGHTS): Spotlight | undefined {
  return catalogue.find((s) => s.id === id)
}
