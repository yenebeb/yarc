import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { budgetFile, costUsd, monthlyBudgetUsd, readJson, readLedger, reserve, settle, updateLedger, worstCaseUsd, writeJson, type BudgetEntry } from '../../.github/security/ledger.ts'
import { loadPolicy, type Policy } from '../../.github/security/policy.ts'
import { fakeGitHub } from './security-fixture.ts'

const base = loadPolicy()
const policy: Policy = { ...base, budget: { ...base.budget, maxConcurrentReviews: 100, maxReviewsPerPrPerDay: 100, maxPrReviewsPerDay: 100 } }
const worstCase = worstCaseUsd(policy.reviewer)
const now = new Date('2026-11-27T12:00:00Z')
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000)
const spent = (kind: 'pr' | 'release', usd: number, pr = 1, at = minutesAgo(24 * 60 + 1)): BudgetEntry => ({ id: `${kind}-${pr}-${usd}-${at.getTime()}`, kind, pr, sha: 'a', reservedUsd: usd, spentUsd: usd, at: at.toISOString() })
const ask = (entries: BudgetEntry[], kind: 'pr' | 'release' = 'pr', pr = 9, rules = policy) => reserve(entries, { id: `new-${entries.length}`, kind, pr, sha: 'b', now }, rules)

describe('The monthly AI budget', () => {
  test('defaults to 20 euros, with part kept for release reviews', () => {
    assert.equal(base.budget.monthlyEur, 20)
    assert.ok(base.budget.releaseReservePercent > 0)
    assert.ok(worstCase < monthlyBudgetUsd(base) / 10, 'one review can never take more than a tenth of the month')
  })

  test('a review reserves its worst case before it starts', () => {
    const reservation = ask([])
    assert.ok(reservation.ok)
    assert.equal(reservation.entry.reservedUsd, worstCase)
    assert.equal(reservation.entry.spentUsd, undefined)
    const limits = policy.reviewer
    const dearest = costUsd({ inputTokens: 0, cacheWriteTokens: limits.maxInputTokens, cacheReadTokens: 0, outputTokens: limits.maxOutputTokens }, limits.usdPerMillionTokens)
    assert.ok(worstCase >= dearest, 'the reservation covers a review that uses every token it may')
  })

  test('pull request reviews stop at their share and leave the release reserve', () => {
    const prPool = monthlyBudgetUsd(policy) * (1 - policy.budget.releaseReservePercent / 100)
    const nearlyFull = [spent('pr', prPool - worstCase / 2)]
    const refused = ask(nearlyFull)
    assert.ok(!refused.ok)
    assert.match(refused.reason, /budget for pull requests is used up/)
    assert.ok(ask(nearlyFull, 'release').ok, 'the release review still runs')
  })

  test('nothing runs once the whole month is spent', () => {
    const full = [spent('pr', 5), spent('release', monthlyBudgetUsd(policy) - 5 - worstCase / 2)]
    assert.ok(!ask(full, 'release').ok)
    assert.ok(!ask(full, 'pr').ok)
  })

  test('a review that never reported back keeps its whole reservation', () => {
    const lost: BudgetEntry = { id: 'lost', kind: 'pr', pr: 1, sha: 'a', reservedUsd: monthlyBudgetUsd(policy), at: minutesAgo(600).toISOString() }
    assert.ok(!ask([lost], 'release').ok)
    const [settled] = settle([lost], 'lost', undefined, policy.reviewer.usdPerMillionTokens, now)
    assert.equal(settled.spentUsd, lost.reservedUsd)
  })

  test('settling books the real cost, once', () => {
    const reservation = ask([])
    assert.ok(reservation.ok)
    const usage = { inputTokens: 20_000, cacheWriteTokens: 30_000, cacheReadTokens: 100_000, outputTokens: 5_000 }
    const [settled] = settle([reservation.entry], reservation.entry.id, usage, policy.reviewer.usdPerMillionTokens, now)
    assert.equal(settled.spentUsd, (20_000 * 2 + 30_000 * 2.5 + 100_000 * 0.1 + 5_000 * 10) / 1_000_000)
    const [again] = settle([settled], settled.id, { ...usage, outputTokens: 0 }, policy.reviewer.usdPerMillionTokens, now)
    assert.equal(again.spentUsd, settled.spentUsd)
  })

  test('a new month starts a new budget', () => {
    assert.notEqual(budgetFile(new Date('2026-11-30T23:59:59Z')), budgetFile(new Date('2026-12-01T00:00:00Z')))
  })
})

describe('Pull request spam cannot drain it', () => {
  test('one pull request gets a few reviews a day', () => {
    const entries = Array.from({ length: base.budget.maxReviewsPerPrPerDay }, (_unused, index) => spent('pr', 0.1, 9, minutesAgo(index + 1)))
    const refused = ask(entries, 'pr', 9, base)
    assert.ok(!refused.ok)
    assert.match(refused.reason, /already had/)
    assert.ok(ask(entries, 'pr', 10, base).ok, 'another pull request is not held back')
  })

  test('all pull requests together get a fixed number a day', () => {
    const entries = Array.from({ length: base.budget.maxPrReviewsPerDay }, (_unused, index) => spent('pr', 0.01, 100 + index, minutesAgo(index + 1)))
    assert.ok(!ask(entries, 'pr', 9, base).ok)
    assert.ok(ask(entries, 'release', 9, base).ok)
  })

  test('only so many reviews run at once', () => {
    const running = Array.from({ length: base.budget.maxConcurrentReviews }, (_unused, index): BudgetEntry => ({ id: `run-${index}`, kind: 'pr', pr: 50 + index, sha: 'a', reservedUsd: worstCase, at: minutesAgo(2).toISOString() }))
    const refused = ask(running, 'pr', 9, base)
    assert.ok(!refused.ok)
    assert.match(refused.reason, /already running/)
  })
})

describe('Two reviews reserving at the same moment', () => {
  test('only one gets the last of the budget', () => {
    const { origin } = fakeGitHub()
    const file = budgetFile(now)
    const room = monthlyBudgetUsd(policy) - worstCase * 1.5
    updateLedger(origin, 'earlier spending', (dir) => writeJson(dir, file, [spent('release', room)]))

    const reserveFor = (pr: number, meanwhile: () => void = () => {}) =>
      updateLedger(origin, `reserve for #${pr}`, (dir) => {
        const entries = readJson<BudgetEntry[]>(dir, file, [])
        const reservation = reserve(entries, { id: `pr-${pr}`, kind: 'release', pr, sha: 'c', now }, policy)
        if (reservation.ok) writeJson(dir, file, [...entries, reservation.entry])
        meanwhile()
        return reservation.ok
      })

    let rival: boolean | undefined
    const first = reserveFor(1, () => (rival ??= reserveFor(2)))
    assert.equal(rival, true, 'the review that pushed first holds the reservation')
    assert.equal(first, false, 'the other one read a stale ledger, was sent back, and found the budget taken')

    const entries = readLedger(origin, (dir) => readJson<BudgetEntry[]>(dir, file, []))
    assert.deepEqual(entries.map((entry) => entry.id).slice(1), ['pr-2'])
    assert.ok(entries.reduce((total, entry) => total + (entry.spentUsd ?? entry.reservedUsd), 0) <= monthlyBudgetUsd(policy))
  })

  test('thirty in a row stop at the budget', () => {
    const { origin } = fakeGitHub()
    const file = budgetFile(now)
    const granted = Array.from({ length: 30 }, (_unused, index) =>
      updateLedger(origin, `reserve ${index}`, (dir) => {
        const entries = readJson<BudgetEntry[]>(dir, file, [])
        const reservation = reserve(entries, { id: `release-${index}`, kind: 'release', sha: 'c', now }, policy)
        if (reservation.ok) writeJson(dir, file, [...entries, reservation.entry])
        return reservation.ok
      })
    ).filter(Boolean).length
    assert.equal(granted, Math.floor(monthlyBudgetUsd(policy) / worstCase))
  })
})
