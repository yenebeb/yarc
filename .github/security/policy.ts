import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ContentRule {
  name: string
  pattern: string
  flags?: string
}

export interface Prices {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

export interface ReviewerPolicy {
  /** Off: a maintainer's sign-off alone opens the gate, and nothing is spent. */
  enabled: boolean
  provider: string
  model: string
  fallbackModel: string
  effort: string
  maxIterations: number
  maxInputTokens: number
  maxOutputTokens: number
  maxOutputTokensPerTurn: number
  usdPerMillionTokens: Prices
}

export interface Policy {
  maintainers: string[]
  trustedBots: string[]
  labels: { review: string; approve: string }
  approvals: { medium: number; high: number }
  budget: {
    monthlyEur: number
    usdPerEur: number
    releaseReservePercent: number
    maxConcurrentReviews: number
    maxReviewsPerPrPerDay: number
    maxPrReviewsPerDay: number
  }
  reviewer: ReviewerPolicy
  risk: {
    low: { maxAddedLines: number; paths: string[] }
    high: { paths: string[]; content: ContentRule[] }
    injection: string[]
  }
}

const here = dirname(fileURLToPath(import.meta.url))
/** SECURITY_POLICY_FILE is for the tests; the workflows never set it. */
const policyText = (): string => readFileSync(process.env.SECURITY_POLICY_FILE ?? join(here, 'policy.json'), 'utf8')

export const loadPolicy = (): Policy => JSON.parse(policyText())
export const reviewerPrompt = (): string => readFileSync(join(here, 'reviewer-prompt.md'), 'utf8')

/** A review is only valid for the rules and the prompt it was made with. */
export const policyVersion = (): string => createHash('sha256').update(policyText()).update(reviewerPrompt()).digest('hex').slice(0, 16)

export const isMaintainer = (policy: Policy, login: string): boolean => policy.maintainers.includes(login)
