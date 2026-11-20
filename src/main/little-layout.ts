// Little Window geometry and toolbar color, kept free of Electron so unit tests can import them.
import type { Rectangle } from 'electron'

/** The toolbar's color: the space color mixed into near-black: a dark bar that still shows which space it belongs to. */
export function littleBarColor(spaceColor: string): string {
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const space = /^#[0-9a-f]{6}$/i.test(spaceColor) ? parse(spaceColor) : parse('#7c6cf2')
  const base = parse('#0d0b18')
  return '#' + base.map((b, i) => Math.round(b + (space[i] - b) * 0.12).toString(16).padStart(2, '0')).join('')
}

/** Where a new Little Window goes: the remembered size (or one that suits the screen), centered on the display under the cursor. */
export function littleBounds(area: Rectangle, remembered?: { width: number; height: number }): Rectangle {
  const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(value, min), max))
  const wanted = remembered ?? { width: clamp(area.width * 0.6, 900, 1280), height: clamp(area.height * 0.75, 680, 960) }
  const width = Math.min(wanted.width, area.width - 40)
  const height = Math.min(wanted.height, area.height - 40)
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 3),
    width,
    height
  }
}
