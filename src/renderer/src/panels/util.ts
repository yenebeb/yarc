import type { PinnedNode } from '../../../shared/types'

export { SPACE_COLORS } from '../../../shared/colors'

const startOfDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function dayLabel(t: number): string {
  const today = startOfDay(Date.now())
  const day = startOfDay(t)
  if (day === today) return 'Today'
  if (day === startOfDay(today - 864e5 / 2)) return 'Yesterday'
  const sameYear = new Date(t).getFullYear() === new Date().getFullYear()
  return new Date(t).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric'
  })
}

export const timeLabel = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** `items` must be sorted newest first. */
export function groupByDay<T>(items: T[], time: (x: T) => number): { label: string; key: number; items: T[] }[] {
  const groups: { label: string; key: number; items: T[] }[] = []
  for (const it of items) {
    const key = startOfDay(time(it))
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(it)
    else groups.push({ key, label: dayLabel(key), items: [it] })
  }
  return groups
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

export function countPinned(nodes: PinnedNode[]): number {
  let n = 0
  for (const node of nodes) n += node.kind === 'folder' ? countPinned(node.children) : 1
  return n
}

export function firstGrapheme(s: string): string {
  const t = s.trim()
  if (!t) return ''
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (const { segment } of seg.segment(t)) return segment
  return ''
}
