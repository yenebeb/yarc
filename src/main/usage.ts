// The whole payload: which of these files an install downloads. README "What we collect" promises nothing more.
import type { UsageCounted } from '../shared/types'
import { RELEASES_PAGE } from './release.ts'

export type UsageCount = 'first' | 'daily' | 'weekly' | 'monthly'
type Period = Exclude<UsageCount, 'first'>

const PLATFORMS = ['darwin', 'win32', 'linux']
const ARCHS = ['arm64', 'x64']
const COUNTS: UsageCount[] = ['first', 'daily', 'weekly', 'monthly']

export const usageFiles = (): string[] => PLATFORMS.flatMap((p) => ARCHS.flatMap((a) => COUNTS.map((c) => `${p}-${a}-${c}`)))

export function usageUrl(platform: string, arch: string, count: UsageCount): string | undefined {
  if (!PLATFORMS.includes(platform) || !ARCHS.includes(arch)) return undefined
  return `${RELEASES_PAGE}/download/usage/${platform}-${arch}-${count}`
}

export function periodsOf(now: Date): Record<Period, string> {
  const day = now.toISOString().slice(0, 10)
  return { daily: day, weekly: isoWeek(now), monthly: day.slice(0, 7) }
}

export function isoWeek(now: Date): string {
  const thursday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 4 - (now.getUTCDay() || 7)))
  const year = thursday.getUTCFullYear()
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

export function dueCounts(counted: UsageCounted | undefined, now: Date): UsageCount[] {
  const periods = periodsOf(now)
  const due = (Object.keys(periods) as Period[]).filter((p) => counted?.[p] !== periods[p])
  return counted?.first ? ['first', ...due] : due
}

export function markCounted(counted: UsageCounted | undefined, count: UsageCount, now: Date): UsageCounted {
  const next = { ...counted }
  if (count === 'first') delete next.first
  else next[count] = periodsOf(now)[count]
  return next
}
