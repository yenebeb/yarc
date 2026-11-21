// Which tabs play media out of sight: one in the floating player, the others as cards at the
// bottom of the sidebar. Pure, so the rules (docs/arc-reference.md, "Mini Player") can be tested.
import type { ID } from '../shared/types'

export interface MediaState {
  /** Tabs with a card, oldest first; the sidebar shows the newest in front. */
  cards: ID[]
  /** The tab whose video is in the floating player. */
  floating?: ID
}

/** What a tab was doing when it went out of sight. */
export type LeftWith = 'video' | 'audio' | 'nothing'

export const emptyMedia = (): MediaState => ({ cards: [] })

const without = (cards: ID[], id: ID): ID[] => cards.filter((c) => c !== id)

/** Puts `id` in front of the cards. */
function card(s: MediaState, id: ID): MediaState {
  return { ...s, cards: [...without(s.cards, id), id] }
}

/**
 * A tab went out of sight. A playing video floats (when floating is on), other playing media gets
 * a card, and a tab that was paused gets neither. A video already floating makes room: its tab
 * becomes a card.
 */
export function left(s: MediaState, id: ID, playing: LeftWith, floatVideos: boolean): MediaState {
  if (playing === 'nothing') return s
  if (playing === 'audio' || !floatVideos) return card(s, id)
  const cards = without(s.cards, id)
  if (s.floating && s.floating !== id) cards.push(s.floating)
  return { cards, floating: id }
}

/** A tab is on screen again: its video goes back into the page and its card goes. */
export function shown(s: MediaState, id: ID): MediaState {
  if (s.floating !== id && !s.cards.includes(id)) return s
  return { cards: without(s.cards, id), floating: s.floating === id ? undefined : s.floating }
}

/** A tab closed, or its page went away: nothing of it stays. */
export const closed = shown

/** The floating player's –: the video keeps playing, as a card. */
export function minimize(s: MediaState): MediaState {
  if (!s.floating) return s
  return { cards: [...without(s.cards, s.floating), s.floating], floating: undefined }
}

/** The floating player's ✕: the video pauses and its tab keeps a (paused) card, so it can be resumed. */
export const closeFloating = minimize

/** A card's Picture in Picture button: its video floats again, and a video floating before becomes a card. */
export function float(s: MediaState, id: ID): MediaState {
  if (s.floating === id) return s
  return left({ ...s, cards: without(s.cards, id) }, id, 'video', true)
}

/** A card's ✕. */
export function dismiss(s: MediaState, id: ID): MediaState {
  return { ...s, cards: without(s.cards, id) }
}
