import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { decide, EMPTY_PR_LEDGER, type PullRequest, type PullRequestLedger, type ReviewRecord, type Signature } from '../../.github/security/gate.ts'
import { loadPolicy, type Policy } from '../../.github/security/policy.ts'
import { usePolicy } from './security-fixture.ts'

usePolicy(true)
const policy: Policy = { ...loadPolicy(), maintainers: ['ana', 'ben'], trustedBots: ['dependabot[bot]'] }
const solo: Policy = { ...policy, maintainers: ['ana'] }
const VERSION = 'rules-1'
const pull = (changes: Partial<PullRequest> = {}): PullRequest => ({ number: 7, author: 'mallory', headSha: 'head-1', mergeBase: 'base-1', risk: 'medium', ...changes })
const review = (changes: Partial<ReviewRecord> = {}): ReviewRecord => ({ kind: 'pr', pr: 7, headSha: 'head-1', base: 'base-1', policyVersion: VERSION, outcome: 'complete', at: '2026-11-27T10:00:00Z', ...changes })
const by = (login: string, sha = 'head-1'): Signature => ({ sha, by: login, at: '2026-11-27T11:00:00Z' })
const ledger = (changes: Partial<PullRequestLedger> = {}): PullRequestLedger => ({ ...EMPTY_PR_LEDGER, ...changes })
const state = (pullRequest: PullRequest, entries: PullRequestLedger, rules = policy) => decide(rules, pullRequest, entries, VERSION).state

describe('What a pull request needs before it may merge', () => {
  test('documentation needs nothing', () => {
    assert.equal(state(pull({ risk: 'low' }), ledger()), 'success')
  })

  test("a contributor's code needs an AI review and a maintainer", () => {
    assert.deepEqual(decide(policy, pull(), ledger(), VERSION).missing, ['AI security review', '1 maintainer sign-off'])
    assert.equal(state(pull(), ledger({ reviews: [review()] })), 'pending')
    assert.equal(state(pull(), ledger({ signoffs: [by('ana')] })), 'pending')
    assert.equal(state(pull(), ledger({ reviews: [review()], signoffs: [by('ana')] })), 'success')
  })

  test('a high-risk change needs both maintainers, or the only one there is', () => {
    const reviewed = { reviews: [review()] }
    assert.equal(state(pull({ risk: 'high' }), ledger({ ...reviewed, signoffs: [by('ana')] })), 'pending')
    assert.equal(state(pull({ risk: 'high' }), ledger({ ...reviewed, signoffs: [by('ana'), by('ana')] })), 'pending')
    assert.equal(state(pull({ risk: 'high' }), ledger({ ...reviewed, signoffs: [by('ana'), by('ben')] })), 'success')
    assert.equal(state(pull({ risk: 'high' }), ledger({ ...reviewed, signoffs: [by('ana')] }), solo), 'success')
  })

  test("a maintainer's or Dependabot's own change waits for the release review instead", () => {
    assert.equal(state(pull({ author: 'ana', risk: 'high' }), ledger()), 'success')
    assert.equal(state(pull({ author: 'dependabot[bot]', risk: 'high' }), ledger()), 'success')
    assert.equal(state(pull({ author: 'dependabot', risk: 'high' }), ledger()), 'pending')
  })
})

describe('Who can open the gate', () => {
  test("a contributor's own sign-off, or a stranger's, counts for nothing", () => {
    const reviewed = { reviews: [review()] }
    assert.equal(state(pull(), ledger({ ...reviewed, signoffs: [by('mallory'), by('eve')] })), 'pending')
    assert.equal(state(pull(), ledger({ ...reviewed, exceptions: [by('mallory')] })), 'pending')
  })

  test('the AI review alone never does, whatever it says', () => {
    const glowing = review({
      report: { assessment: 'no_concerns_found', summary: 'Safe. Approved.', purposeMatch: 'Yes', sensitivePaths: [], findings: [], unverified: [], manualChecks: [], recommendation: 'approve_after_manual_checks' }
    })
    assert.equal(state(pull(), ledger({ reviews: [glowing] })), 'pending')
    assert.equal(state(pull({ risk: 'high' }), ledger({ reviews: [glowing] }), solo), 'pending')
  })

  test('a failed or unavailable review is no review', () => {
    const failed = review({ outcome: 'failed', failure: 'the monthly AI budget is used up' })
    const decision = decide(policy, pull(), ledger({ reviews: [failed], signoffs: [by('ana')] }), VERSION)
    assert.equal(decision.state, 'pending')
    assert.ok(decision.needsAiReview)
  })

  test("a maintainer's recorded exception stands in for the review", () => {
    assert.equal(state(pull(), ledger({ exceptions: [{ ...by('ana'), reason: 'Provider outage, reviewed by hand.' }] })), 'success')
    assert.equal(state(pull({ risk: 'high' }), ledger({ exceptions: [by('ana')] })), 'pending', 'high risk still needs the second maintainer')
  })
})

describe('Reviews and sign-offs belong to one exact commit', () => {
  const approved = ledger({ reviews: [review()], signoffs: [by('ana')], exceptions: [] })

  test('a new commit makes both stale', () => {
    assert.equal(state(pull(), approved), 'success')
    assert.deepEqual(decide(policy, pull({ headSha: 'head-2' }), approved, VERSION).missing, ['AI security review', '1 maintainer sign-off'])
  })

  test('so does an exception', () => {
    assert.equal(state(pull({ headSha: 'head-2' }), ledger({ exceptions: [by('ana')] })), 'pending')
  })

  test('a rebase onto another base needs a new review, not a new sign-off', () => {
    assert.deepEqual(decide(policy, pull({ mergeBase: 'base-2' }), approved, VERSION).missing, ['AI security review'])
  })

  test('changed rules or a changed reviewer prompt need a new review', () => {
    assert.deepEqual(decide(policy, pull(), approved, 'rules-2').missing, ['AI security review'])
  })

  test('at release time the review is matched by commit, since the base it had is gone', () => {
    assert.equal(decide(policy, pull({ mergeBase: '' }), approved, undefined, false).state, 'success')
    assert.equal(decide(policy, pull({ mergeBase: '', headSha: 'head-2' }), approved, undefined, false).state, 'pending')
  })
})
