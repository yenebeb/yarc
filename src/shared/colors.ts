export const SPACE_COLORS = ['#7c6cf2', '#e0607e', '#3fa7d6', '#3dbb8a', '#f2a541', '#c06cf2', '#5b7bd6', '#8a8a8a']

/** Hue in degrees; saturation and value from 0 to 1. */
export interface Hsv {
  h: number
  s: number
  v: number
}

export function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return `#${[channel(5), channel(3), channel(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
}
