import type { Risk } from './classify.ts'
import type { Usage } from './ledger.ts'
import { isMaintainer, type Policy } from './policy.ts'
import type { Report } from './report.ts'

export const STATUS_CONTEXT = 'security-gate'

export interface PullRequest {
  number: number
  author: string
  headSha: string
  mergeBase: string
  risk: Risk
}

export interface ReviewRecord {
  kind: 'pr' | 'release'
  pr?: number
  headSha: string
  base: string
  policyVersion: string
  outcome: 'complete' | 'failed'
  failure?: string
  report?: Report
  usage?: Usage
  model?: string
  at: string
}

export interface Signature {
  sha: string
  by: string
  at: string
  reason?: string
}

export interface PullRequestLedger {
  signoffs: Signature[]
  exceptions: Signature[]
  reviews: ReviewRecord[]
}

export interface Decision {
  state: 'success' | 'pending'
  description: string
  missing: string[]
  needsAiReview: boolean
  approvalsNeeded: number
}

export const prFile = (number: number): string => `prs/${number}.json`
export const releaseFile = (sha: string): string => `releases/${sha}.json`
export const EMPTY_PR_LEDGER: PullRequestLedger = { signoffs: [], exceptions: [], reviews: [] }

export interface ReleaseLedger {
  reviews: ReviewRecord[]
  exception?: Signature
}

export const EMPTY_RELEASE_LEDGER: ReleaseLedger = { reviews: [] }

/** `exactBase` is off at release time: the PR was reviewed against the base it had then. */
export function completedReview(ledger: PullRequestLedger, pullRequest: PullRequest, version: string | undefined, exactBase = true): ReviewRecord | undefined {
  return ledger.reviews.find(
    (review) =>
      review.outcome === 'complete' &&
      review.headSha === pullRequest.headSha &&
      (!exactBase || (review.base === pullRequest.mergeBase && review.policyVersion === version))
  )
}

const validSignatures = (policy: Policy, signatures: Signature[], pullRequest: PullRequest): string[] => [
  ...new Set(
    signatures.filter((signature) => signature.sha === pullRequest.headSha && isMaintainer(policy, signature.by) && signature.by !== pullRequest.author).map((signature) => signature.by)
  )
]

export function decide(policy: Policy, pullRequest: PullRequest, ledger: PullRequestLedger, version: string | undefined, exactBase = true): Decision {
  const done = (description: string): Decision => ({ state: 'success', description, missing: [], needsAiReview: false, approvalsNeeded: 0 })
  const { risk, author } = pullRequest

  if (risk === 'low') return done('Low risk: documentation only')
  if (isMaintainer(policy, author)) return done(`${risk} risk, by a maintainer: reviewed with the release`)
  if (policy.trustedBots.includes(author)) return done(`${risk} risk, by ${author}: reviewed with the release`)

  const exempted = validSignatures(policy, ledger.exceptions, pullRequest)
  const approvers = new Set([...validSignatures(policy, ledger.signoffs, pullRequest), ...exempted])
  const approvalsNeeded = Math.min(policy.approvals[risk], policy.maintainers.filter((login) => login !== author).length)
  const reviewed = !policy.reviewer.enabled || exempted.length > 0 || completedReview(ledger, pullRequest, version, exactBase) !== undefined

  const missing: string[] = []
  if (!reviewed) missing.push('AI security review')
  if (approvalsNeeded === 0) missing.push('a maintainer who is not the author')
  else if (approvers.size < approvalsNeeded) missing.push(`${approvalsNeeded - approvers.size} maintainer sign-off${approvalsNeeded - approvers.size === 1 ? '' : 's'}`)

  if (missing.length === 0) return done(`${risk} risk: reviewed and signed off by ${[...approvers].join(', ')}${exempted.length ? ' (exception)' : ''}`)
  return { state: 'pending', description: `${risk} risk: waiting for ${missing.join(' and ')}`, missing, needsAiReview: !reviewed, approvalsNeeded }
}
