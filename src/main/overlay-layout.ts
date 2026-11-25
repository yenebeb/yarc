import type { Point, Rectangle } from 'electron'
import { isFloating } from '../shared/tour'
import type { OverlayMode, Rect, Settings } from '../shared/types'
import { PROMPT_WIDTH, type PromptAnchor } from './prompt-view'
import { PAD, TRAFFIC_LIGHTS, TRAFFIC_LIGHTS_WIDTH } from './window'

// Sidebar geometry, kept in step with styles.css.
const SIDEBAR_PAD = 8
const FLOATING_SIDEBAR_INSET = 4
const TOP_BAR_HEIGHT = 32
const URL_FIELD_GAP = 6
const URL_FIELD_HEIGHT = 36

export interface WindowFrame {
  size: { width: number; height: number }
  content: Rect
  settings: Pick<Settings, 'sidebarVisible' | 'sidebarWidth' | 'sidebarRight'>
  sidebarRevealed: boolean
  captionHeight: number
}

export function overlayRect(mode: OverlayMode, frame: WindowFrame, tabDrag: boolean): Rectangle | undefined {
  const { width, height } = frame.size
  const whole = { x: 0, y: 0, width, height }
  const { content, settings } = frame
  const centeredX = (cardWidth: number) => Math.round(content.x + (content.width - cardWidth) / 2)
  switch (mode.kind) {
    case 'none':
      return undefined
    case 'sidebar': {
      if (tabDrag) return whole
      const sidebarWidth = settings.sidebarWidth + PAD
      return { x: settings.sidebarRight ? width - sidebarWidth : 0, y: 0, width: sidebarWidth, height }
    }
    case 'extensions':
      return whole
    case 'split-drop':
    case 'peek':
    case 'capture':
      return content
    case 'notice': {
      const cardWidth = Math.min(440, content.width - 24)
      return { x: centeredX(cardWidth), y: content.y + 16, width: cardWidth, height: 44 }
    }
    case 'find': {
      const cardWidth = Math.min(380, content.width - 16)
      return { x: content.x + content.width - cardWidth - 12, y: content.y + 12, width: cardWidth, height: 60 }
    }
    case 'tour': {
      if (!isFloating(mode.step)) return whole
      const cardWidth = Math.min(460, content.width - 24)
      const cardHeight = 176
      return { x: centeredX(cardWidth), y: content.y + content.height - cardHeight - 16, width: cardWidth, height: cardHeight }
    }
    default:
      return whole
  }
}

/** In the sidebar's top bar at the window's outer corner, and as much lower as the revealed sidebar is inset. */
export function trafficLightsAt(frame: WindowFrame): Point {
  return {
    x: frame.settings.sidebarRight ? frame.size.width - TRAFFIC_LIGHTS.x - TRAFFIC_LIGHTS_WIDTH : TRAFFIC_LIGHTS.x,
    y: TRAFFIC_LIGHTS.y + (frame.sidebarRevealed ? FLOATING_SIDEBAR_INSET : 0)
  }
}

export function promptAnchor(frame: WindowFrame, fullscreenPage: boolean): PromptAnchor {
  const { settings, content, sidebarRevealed } = frame
  if ((settings.sidebarVisible || sidebarRevealed) && !fullscreenPage) {
    const inset = sidebarRevealed ? FLOATING_SIDEBAR_INSET : 0
    const fieldRight = settings.sidebarRight ? frame.size.width - 10 : inset + settings.sidebarWidth - 6
    const fieldBottom = topBarY(frame, inset) + TOP_BAR_HEIGHT + URL_FIELD_GAP + URL_FIELD_HEIGHT
    return { arrow: true, x: fieldRight - 22, y: fieldBottom + 2 }
  }
  const x = settings.sidebarRight ? content.x + content.width - PROMPT_WIDTH - 12 : content.x + 12
  return { arrow: false, x, y: content.y + 12 }
}

function topBarY(frame: WindowFrame, inset: number): number {
  const caption = frame.captionHeight
  const revealed = frame.sidebarRevealed
  const right = frame.settings.sidebarRight
  // Windows' caption buttons sit top right: a left sidebar's top bar shares their strip, a right one's goes below.
  if (!caption || (revealed && !right)) return inset + SIDEBAR_PAD
  if (right) return caption + (revealed ? SIDEBAR_PAD : 0)
  return 0
}

export function peekRects(content: Rect): { card: Rectangle; local: Rect } {
  const margin = Math.round(Math.max(56, content.width * 0.08))
  const local = { x: margin, y: 4, width: Math.max(100, content.width - 2 * margin), height: Math.max(100, content.height - 8) }
  return { card: { ...local, x: content.x + local.x, y: content.y + local.y }, local }
}
