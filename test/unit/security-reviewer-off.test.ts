import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { reserveReview, REVIEWER_OFF, settleReview } from '../../.github/security/ai-review.ts'
import { EMPTY_PR_LEDGER, prFile } from '../../.github/security/gate.ts'
import { budgetFile, readJson, readLedger } from '../../.github/security/ledger.ts'
import { loadPolicy } from '../../.github/security/policy.ts'
import { gate } from '../../.github/security/pull-request.ts'
import { fakeGitHub, usePolicy, type PullState } from './security-fixture.ts'

// The pipeline only runs on Linux runners, and these tests build git repositories with POSIX symlinks and paths.
if (process.platform === 'win32') process.exit(0)

const shipped = loadPolicy()
usePolicy(false)
const policy = loadPolicy()
const [maintainer] = policy.maintainers
const github = fakeGitHub()
const outputFile = join(mkdtempSync(join(tmpdir(), 'security-out-')), 'output')
process.env.GITHUB_OUTPUT = outputFile

async function event(pull: PullState, action: string, sender: string, label?: string): Promise<Record<string, string>> {
  writeFileSync(outputFile, '')
  if (label && !pull.labels.includes(label)) pull.labels.push(label)
  await gate({ action, sender: { login: sender }, label: label ? { name: label } : undefined, pull_request: { number: pull.number, head: { sha: pull.head } } })
  return Object.fromEntries(readFileSync(outputFile, 'utf8').trim().split('\n').map((line) => line.split('=')))
}
const comment = (): string => github.comments.at(-1)?.body ?? ''

describe('With the AI reviewer switched off', () => {
  const pull = github.openPull(7, 'mallory', { 'src/main/update/updater.ts': 'export const feed = "elsewhere"\n' })
  const target = { kind: 'pr' as const, pr: 7, head: pull.head, base: github.mainSha }

  test('that is how the policy ships, with the reviewer kept ready', () => {
    assert.equal(shipped.reviewer.enabled, false)
    assert.ok(shipped.reviewer.model && shipped.budget.monthlyEur > 0)
  })

  test("a contributor's change still waits, for a maintainer's check by hand", async () => {
    await event(pull, 'opened', 'mallory')
    assert.equal(github.lastStatus(pull.head), 'pending')
    assert.match(comment(), /Security gate: high risk · waiting/)
    assert.match(comment(), /checking the change by hand/)
    assert.doesNotMatch(comment(), new RegExp(policy.labels.review))
  })

  test('the review label starts nothing and spends nothing', async () => {
    const outputs = await event(pull, 'labeled', maintainer, policy.labels.review)
    assert.equal(outputs.review, 'false')
    assert.deepEqual(pull.labels, [])
    assert.match(comment(), /AI review is switched off/)
    assert.deepEqual(reserveReview(target), { proceed: false, id: '', reason: REVIEWER_OFF })
    assert.equal(await settleReview(target, '', 'none.json', REVIEWER_OFF), true)
    assert.deepEqual(readLedger(github.origin, (dir) => readJson(dir, budgetFile(new Date()), [])), [])
    assert.equal(github.lastStatus(pull.head), 'pending')
  })

  test("the contributor's own sign-off is still refused", async () => {
    await event(pull, 'labeled', 'mallory', policy.labels.approve)
    assert.deepEqual(pull.labels, [])
    assert.equal(github.lastStatus(pull.head), 'pending')
  })

  test("a maintainer's sign-off opens the gate, for that commit only", async () => {
    await event(pull, 'labeled', maintainer, policy.labels.approve)
    assert.equal(github.lastStatus(pull.head), 'success')
    assert.deepEqual(readLedger(github.origin, (dir) => readJson(dir, prFile(7), EMPTY_PR_LEDGER)).signoffs.map((signoff) => signoff.by), [maintainer])

    github.push(7, { 'src/main/update/updater.ts': 'export const feed = "somewhere else"\n' })
    await event(pull, 'synchronize', 'mallory')
    assert.equal(github.lastStatus(pull.head), 'pending')
  })
})
