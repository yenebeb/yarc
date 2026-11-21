import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dueCounts, isoWeek, markCounted, usageFiles, usageUrl } from '../../src/main/usage.ts'
import type { UsageCounted } from '../../src/shared/types.ts'

const monday = new Date('2026-11-16T09:00:00Z')
const tuesday = new Date('2026-11-17T09:00:00Z')

test('the count sends nothing but platform, chip and which count: changing that means changing README "What we collect"', () => {
  assert.equal(usageFiles().length, 24)
  for (const file of usageFiles()) assert.match(file, /^(darwin|win32|linux)-(arm64|x64)-(first|daily|weekly|monthly)$/)
  assert.equal(usageUrl('darwin', 'arm64', 'daily'), 'https://github.com/yenebeb/yarc/releases/download/usage/darwin-arm64-daily')
})

test('platforms and chips outside the list are not counted', () => {
  assert.equal(usageUrl('freebsd', 'x64', 'daily'), undefined)
  assert.equal(usageUrl('win32', 'ia32', 'daily'), undefined)
})

test('an install that was never counted is due for today, this week and this month', () => {
  assert.deepEqual(dueCounts(undefined, monday), ['daily', 'weekly', 'monthly'])
})

test('a fresh install is also counted as new, once', () => {
  assert.deepEqual(dueCounts({ first: true }, monday), ['first', 'daily', 'weekly', 'monthly'])
  assert.equal(markCounted({ first: true }, 'first', monday).first, undefined)
})

test('once counted, the next day only the day is due again', () => {
  let counted: UsageCounted | undefined
  for (const count of dueCounts(counted, monday)) counted = markCounted(counted, count, monday)
  assert.deepEqual(dueCounts(counted, monday), [])
  assert.deepEqual(dueCounts(counted, tuesday), ['daily'])
})

test('weeks are ISO weeks, so a week across New Year belongs to one year', () => {
  assert.equal(isoWeek(new Date('2026-01-01T12:00:00Z')), '2026-W01')
  assert.equal(isoWeek(new Date('2027-01-01T12:00:00Z')), '2026-W53')
  assert.equal(isoWeek(new Date('2024-12-30T12:00:00Z')), '2025-W01')
})
