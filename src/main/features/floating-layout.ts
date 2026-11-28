import type { Rectangle } from 'electron'

export const FLOAT_WIDTH = 320
export const FLOAT_MIN_WIDTH = 200
const INSET = 12

export function videoRatio(width: number, height: number): number {
  if (!(width > 0 && height > 0)) return 16 / 9
  return Math.min(3, Math.max(0.5, width / height))
}

export function floatingBounds(opts: { win: Rectangle; area: Rectangle; ratio: number; sidebarRight: boolean; last?: Rectangle }): Rectangle {
  const { win, area, ratio, sidebarRight, last } = opts
  let width = Math.round(Math.max(FLOAT_MIN_WIDTH, Math.min(last?.width ?? FLOAT_WIDTH, area.width)))
  let height = Math.round(width / ratio)
  if (height > area.height) {
    height = area.height
    width = Math.round(height * ratio)
  }
  let x: number
  let y: number
  if (last) {
    x = last.x
    y = last.y
  } else {
    x = sidebarRight ? win.x + win.width - INSET - width : win.x + INSET
    y = win.y + win.height - INSET - height
  }
  x = Math.min(Math.max(x, area.x), area.x + area.width - width)
  y = Math.min(Math.max(y, area.y), area.y + area.height - height)
  return { x: Math.round(x), y: Math.round(y), width, height }
}
