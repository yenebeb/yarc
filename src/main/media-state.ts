import type { ID } from '../shared/types'

export interface MediaState {
  /** Oldest first; the sidebar shows the newest in front. */
  cards: ID[]
  floating?: ID
}

export type LeftWith = 'video' | 'audio' | 'nothing'

export const emptyMedia = (): MediaState => ({ cards: [] })

const without = (cards: ID[], id: ID): ID[] => cards.filter((c) => c !== id)

function withCardInFront(s: MediaState, id: ID): MediaState {
  return { ...s, cards: [...without(s.cards, id), id] }
}

export function left(s: MediaState, id: ID, playing: LeftWith, floatVideos: boolean): MediaState {
  if (playing === 'nothing') return s
  if (playing === 'audio' || !floatVideos) return withCardInFront(s, id)
  const cards = without(s.cards, id)
  if (s.floating && s.floating !== id) cards.push(s.floating)
  return { cards, floating: id }
}

export function shown(s: MediaState, id: ID): MediaState {
  if (s.floating !== id && !s.cards.includes(id)) return s
  return { cards: without(s.cards, id), floating: s.floating === id ? undefined : s.floating }
}

export const closed = shown

export function minimize(s: MediaState): MediaState {
  if (!s.floating) return s
  return { cards: [...without(s.cards, s.floating), s.floating], floating: undefined }
}

/** The video pauses; its tab keeps a card so it can be resumed. */
export const closeFloating = minimize

export function float(s: MediaState, id: ID): MediaState {
  if (s.floating === id) return s
  return left({ ...s, cards: without(s.cards, id) }, id, 'video', true)
}

export function dismiss(s: MediaState, id: ID): MediaState {
  return { ...s, cards: without(s.cards, id) }
}
