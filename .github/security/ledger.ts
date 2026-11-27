import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Policy, Prices, ReviewerPolicy } from './policy.ts'

export const LEDGER_BRANCH = 'security-ledger'
const HOUR = 3_600_000
const STUCK_RESERVATION = HOUR

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
}

export interface BudgetEntry {
  id: string
  kind: 'pr' | 'release'
  pr?: number
  sha: string
  reservedUsd: number
  spentUsd?: number
  at: string
  settledAt?: string
  usage?: Usage
}

export interface ReservationRequest {
  id: string
  kind: 'pr' | 'release'
  pr?: number
  sha: string
  now: Date
}

export type Reservation = { ok: true; entry: BudgetEntry } | { ok: false; reason: string }

export const NO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 }
export const totalInputTokens = (usage: Usage): number => usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens

export function costUsd(usage: Usage, prices: Prices): number {
  const cost = usage.inputTokens * prices.input + usage.outputTokens * prices.output + usage.cacheWriteTokens * prices.cacheWrite + usage.cacheReadTokens * prices.cacheRead
  return cost / 1_000_000
}

/** Every input token billed at the dearest input price, plus a margin for the estimate of the last request's size. */
export function worstCaseUsd(reviewer: ReviewerPolicy): number {
  const prices = reviewer.usdPerMillionTokens
  const dearestInput = Math.max(prices.input, prices.cacheWrite, prices.cacheRead)
  return ((reviewer.maxInputTokens * dearestInput + reviewer.maxOutputTokens * prices.output) / 1_000_000) * 1.1
}

export const monthlyBudgetUsd = (policy: Policy): number => policy.budget.monthlyEur * policy.budget.usdPerEur
export const budgetFile = (now: Date): string => `budget/${now.toISOString().slice(0, 7)}.json`

/** An unsettled reservation counts in full: a review that crashed may have spent it. */
const committedUsd = (entries: BudgetEntry[]): number => entries.reduce((total, entry) => total + (entry.spentUsd ?? entry.reservedUsd), 0)

export function reserve(entries: BudgetEntry[], request: ReservationRequest, policy: Policy): Reservation {
  const { budget } = policy
  const total = monthlyBudgetUsd(policy)
  const worstCase = worstCaseUsd(policy.reviewer)
  const month = request.now.toISOString().slice(0, 7)
  const nextMonth = `the budget resets after ${month}`
  const prEntries = entries.filter((entry) => entry.kind === 'pr')
  const within = (entry: BudgetEntry, milliseconds: number) => request.now.getTime() - Date.parse(entry.at) < milliseconds

  if (committedUsd(entries) + worstCase > total) {
    return { ok: false, reason: `the monthly AI budget is used up ($${committedUsd(entries).toFixed(2)} of $${total.toFixed(2)}); ${nextMonth}` }
  }
  if (request.kind === 'pr') {
    const prPool = total * (1 - budget.releaseReservePercent / 100)
    if (committedUsd(prEntries) + worstCase > prPool) {
      return { ok: false, reason: `the AI budget for pull requests is used up ($${committedUsd(prEntries).toFixed(2)} of $${prPool.toFixed(2)}; the rest is kept for release reviews); ${nextMonth}` }
    }
    if (prEntries.filter((entry) => entry.pr === request.pr && within(entry, 24 * HOUR)).length >= budget.maxReviewsPerPrPerDay) {
      return { ok: false, reason: `this pull request already had ${budget.maxReviewsPerPrPerDay} AI reviews in the last 24 hours` }
    }
    if (prEntries.filter((entry) => within(entry, 24 * HOUR)).length >= budget.maxPrReviewsPerDay) {
      return { ok: false, reason: `${budget.maxPrReviewsPerDay} pull request AI reviews already ran in the last 24 hours` }
    }
  }
  const running = entries.filter((entry) => entry.spentUsd === undefined && within(entry, STUCK_RESERVATION))
  if (running.length >= budget.maxConcurrentReviews) return { ok: false, reason: `${running.length} AI reviews are already running; try again when one finishes` }

  return { ok: true, entry: { id: request.id, kind: request.kind, pr: request.pr, sha: request.sha, reservedUsd: worstCase, at: request.now.toISOString() } }
}

/** Without a usage report the whole reservation is charged. */
export function settle(entries: BudgetEntry[], id: string, usage: Usage | undefined, prices: Prices, now: Date): BudgetEntry[] {
  return entries.map((entry) =>
    entry.id !== id || entry.spentUsd !== undefined
      ? entry
      : { ...entry, spentUsd: usage ? costUsd(usage, prices) : entry.reservedUsd, usage, settledAt: now.toISOString() }
  )
}

export function readJson<T>(dir: string, file: string, fallback: T): T {
  const path = join(dir, file)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback
}

export function writeJson(dir: string, file: string, value: unknown): void {
  const path = join(dir, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

const git = (dir: string, args: string[]): string => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function checkOutLedger(remote: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
  git(dir, ['init', '--quiet', '--initial-branch', LEDGER_BRANCH])
  git(dir, ['config', 'user.name', 'github-actions[bot]'])
  git(dir, ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
  git(dir, ['config', 'commit.gpgsign', 'false'])
  const exists = git(dir, ['ls-remote', '--heads', remote, LEDGER_BRANCH]).trim() !== ''
  if (exists) {
    git(dir, ['fetch', '--quiet', '--depth', '1', remote, LEDGER_BRANCH])
    git(dir, ['reset', '--quiet', '--hard', 'FETCH_HEAD'])
  }
  return dir
}

export function readLedger<T>(remote: string, read: (dir: string) => T): T {
  const dir = checkOutLedger(remote)
  try {
    return read(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The push only succeeds on top of the ledger that was read, so two reviews can't both take the last of the budget. */
export function updateLedger<T>(remote: string, message: string, change: (dir: string) => T, attempts = 8): T {
  for (let attempt = 1; ; attempt++) {
    const dir = checkOutLedger(remote)
    try {
      const result = change(dir)
      git(dir, ['add', '--all'])
      if (git(dir, ['status', '--porcelain']).trim() === '') return result
      git(dir, ['commit', '--quiet', '-m', message])
      try {
        git(dir, ['push', '--quiet', remote, `HEAD:refs/heads/${LEDGER_BRANCH}`])
        return result
      } catch (error) {
        if (attempt >= attempts) throw new Error(`The security ledger could not be updated after ${attempts} attempts`, { cause: error })
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
