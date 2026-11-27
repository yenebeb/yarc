import { PANE_BAR, SPLIT_GAP } from './split.ts'
import type { Rect } from './types.ts'

export const DEVTOOLS_WIDTH = { min: 280, max: 1200 }
const PAGE_MIN_WIDTH = 320

export function devtoolsWidthWithin(contentWidth: number, wanted: number): number {
  const roomy = Math.max(DEVTOOLS_WIDTH.min, Math.min(wanted, DEVTOOLS_WIDTH.max, contentWidth - PAGE_MIN_WIDTH - SPLIT_GAP))
  return Math.round(Math.max(0, Math.min(roomy, contentWidth - SPLIT_GAP)))
}

export function dockedDevtoolsLayout(content: Rect, wantedWidth: number): { page: Rect; bar: Rect; devtools: Rect } {
  const width = devtoolsWidthWithin(content.width, wantedWidth)
  const pageWidth = Math.max(0, content.width - width - SPLIT_GAP)
  const x = content.x + pageWidth + SPLIT_GAP
  return {
    page: { ...content, width: pageWidth },
    bar: { x, y: content.y, width, height: PANE_BAR },
    devtools: { x, y: content.y + PANE_BAR, width, height: Math.max(0, content.height - PANE_BAR) }
  }
}
