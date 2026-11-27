import type { Point, Rectangle } from 'electron'
import { FLOATING_SIDEBAR_INSET, SIDEBAR_GAP, SIDEBAR_PAD, TOP_BAR_HEIGHT, URL_FIELD_HEIGHT } from '../shared/sidebar-geometry'
import { isFloating } from '../shared/tour'
import type { CommandBarPlace, OverlayMode, Rect, Settings } from '../shared/types'
import { PROMPT_WIDTH, type PromptAnchor } from './prompt-view'
import { PAD, TRAFFIC_LIGHTS, TRAFFIC_LIGHTS_WIDTH } from './window'

export interface WindowFrame {
  size: { width: number; height: number }
  content: Rect
  contentWithDevtools: Rect
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
    case 'peek':
      return frame.contentWithDevtools
    case 'command':
    case 'split-drop':
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

const COMMAND_BAR = { maxWidth: 766, windowMargin: 32, pageMargin: 16, topShare: 0.35 }

/** Centred on the window with its top at 35% of its height, moved only as far as it takes to stay over the page. */
export function commandBarPlace(frame: WindowFrame): CommandBarPlace {
  const { size, content } = frame
  const width = Math.max(0, Math.min(COMMAND_BAR.maxWidth, size.width - 2 * COMMAND_BAR.windowMargin, content.width - 2 * COMMAND_BAR.pageMargin))
  const leftmost = content.x + COMMAND_BAR.pageMargin
  const rightmost = content.x + content.width - COMMAND_BAR.pageMargin - width
  const centred = (size.width - width) / 2
  return {
    x: Math.round(Math.min(Math.max(centred, leftmost), rightmost) - content.x),
    y: Math.round(size.height * COMMAND_BAR.topShare - content.y),
    width: Math.round(width)
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
    const fieldBottom = topBarY(frame, inset) + TOP_BAR_HEIGHT + SIDEBAR_GAP + URL_FIELD_HEIGHT
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
