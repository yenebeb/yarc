import type { BoardItem } from './canvas'

/** What ⌘F, ⌘G and ⇧⌘G ask of the canvas page. */
export type CanvasFindOp = 'open' | 'next' | 'previous'

/** The texts that hold `query`, ignoring case, in reading order: top to bottom, then left to right. Each text is one match, however often it holds the query. */
export function textsHolding(items: BoardItem[], query: string): string[] {
  if (!query.trim()) return []
  const wanted = query.toLowerCase()
  return items
    .filter((item) => item.kind === 'text' && item.text.toLowerCase().includes(wanted))
    .sort((first, second) => first.y - second.y || first.x - second.x)
    .map((item) => item.id)
}

/** The match `step` away from `current`, going round at either end. */
export const matchAfter = (count: number, current: number, step: 1 | -1) => (count ? (current + step + count) % count : 0)
