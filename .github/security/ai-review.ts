import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { modelFor } from './anthropic.ts'
import { changedFiles, classify, type ChangedFile, type Classification } from './classify.ts'
import { completedReview, EMPTY_PR_LEDGER, EMPTY_RELEASE_LEDGER, prFile, releaseFile, type ReviewRecord } from './gate.ts'
import { remote, removeLabel, setOutput, summary } from './github.ts'
import { budgetFile, readJson, readLedger, reserve, settle, updateLedger, writeJson, type BudgetEntry } from './ledger.ts'
import { loadPolicy, policyVersion, reviewerPrompt, type Policy } from './policy.ts'
import { loadPullRequest, publish } from './pull-request.ts'
import { renderReport, validateReport } from './report.ts'
import { briefing, gitReader, runReview } from './reviewer.ts'

export interface ReviewTarget {
  kind: 'pr' | 'release'
  pr?: number
  head: string
  base: string
}

const git = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim()
const subject = (target: ReviewTarget): string => (target.kind === 'pr' ? `#${target.pr}` : 'release')

function alreadyReviewed(dir: string, target: ReviewTarget): boolean {
  const version = policyVersion()
  if (target.kind === 'pr') {
    const pullRequest = { number: target.pr!, author: '', headSha: target.head, mergeBase: target.base, risk: 'high' as const }
    return completedReview(readJson(dir, prFile(target.pr!), EMPTY_PR_LEDGER), pullRequest, version) !== undefined
  }
  return readJson(dir, releaseFile(target.head), EMPTY_RELEASE_LEDGER).reviews.some(
    (review) => review.outcome === 'complete' && review.base === target.base && review.policyVersion === version
  )
}

/** Takes the review's worst-case cost out of the month's budget before any of it is spent. */
export function reserveReview(target: ReviewTarget, now = new Date()): { proceed: boolean; id: string; reason: string } {
  const policy = loadPolicy()
  const id = `${target.kind}-${target.pr ?? 'candidate'}-${target.head.slice(0, 12)}-${now.getTime()}`
  return updateLedger(remote(), `${subject(target)}: reserve an AI review of ${target.head.slice(0, 12)}`, (dir) => {
    if (alreadyReviewed(dir, target)) return { proceed: false, id: '', reason: 'cached' }
    const entries = readJson<BudgetEntry[]>(dir, budgetFile(now), [])
    const reservation = reserve(entries, { id, kind: target.kind, pr: target.pr, sha: target.head, now }, policy)
    if (!reservation.ok) return { proceed: false, id: '', reason: reservation.reason }
    writeJson(dir, budgetFile(now), [...entries, reservation.entry])
    return { proceed: true, id, reason: '' }
  })
}

interface Subject {
  title: string
  description: string
  author: string
  files: ChangedFile[]
  classification: Classification
}

async function describe(policy: Policy, target: ReviewTarget): Promise<Subject> {
  if (target.kind === 'pr') {
    const pullRequest = await loadPullRequest(policy, target.pr!, target.head)
    if (pullRequest.mergeBase !== target.base) throw new Error(`#${target.pr} now has base ${pullRequest.mergeBase}, not ${target.base}`)
    return { title: pullRequest.title, description: pullRequest.body, author: pullRequest.author, files: pullRequest.files, classification: pullRequest.classification }
  }
  const files = changedFiles('.', target.base, target.head)
  return {
    title: `Release candidate ${target.head}`,
    description: git(['log', '--format=%h %an: %s', `${target.base}..${target.head}`]),
    author: 'several authors',
    files,
    classification: classify(policy, files)
  }
}

/** The only step that holds the model's API key. It reads the change as git objects and writes one file. */
export async function review(target: ReviewTarget, out: string): Promise<void> {
  const policy = loadPolicy()
  const record: ReviewRecord = { kind: target.kind, pr: target.pr, headSha: target.head, base: target.base, policyVersion: policyVersion(), outcome: 'failed', at: new Date().toISOString() }
  try {
    const { title, description, author, files, classification } = await describe(policy, target)
    const outcome = await runReview({
      callModel: await modelFor(policy.reviewer),
      repo: gitReader('.', target.base, target.head),
      system: reviewerPrompt(),
      limits: policy.reviewer,
      briefing: briefing({
        kind: target.kind,
        title,
        description,
        author,
        headSha: target.head,
        base: target.base,
        risk: classification.risk,
        reasons: classification.reasons,
        files: files.map((file) => ({ path: file.path, status: file.status, added: file.addedLines.length })),
        diff: git(['diff', '-U3', '--no-color', '--no-ext-diff', '--no-textconv', '-M', target.base, target.head]),
        nonce: randomBytes(8).toString('hex')
      })
    })
    Object.assign(record, { usage: outcome.usage, model: outcome.model, report: outcome.report, failure: outcome.failure, outcome: outcome.report ? 'complete' : 'failed' })
    console.log(`${outcome.iterations} turns, ${JSON.stringify(outcome.usage)}: ${outcome.report ? outcome.report.assessment : outcome.failure}`)
  } catch (error) {
    record.failure = `the reviewer failed: ${(error as Error).message.split('\n')[0].slice(0, 300)}`
    console.error(error)
  }
  writeFileSync(out, JSON.stringify(record))
}

function readResult(target: ReviewTarget, file: string, fallback: string): ReviewRecord {
  const failed: ReviewRecord = { kind: target.kind, pr: target.pr, headSha: target.head, base: target.base, policyVersion: policyVersion(), outcome: 'failed', failure: fallback, at: new Date().toISOString() }
  if (!existsSync(file)) return failed
  try {
    const record: ReviewRecord = JSON.parse(readFileSync(file, 'utf8'))
    if (record.headSha !== target.head || record.base !== target.base || record.policyVersion !== failed.policyVersion) return { ...failed, failure: 'the result is for another commit or other rules' }
    if (record.outcome !== 'complete') return { ...failed, failure: String(record.failure ?? fallback), usage: record.usage, model: record.model }
    return { ...failed, outcome: 'complete', failure: undefined, report: validateReport(record.report), usage: record.usage, model: String(record.model ?? '') }
  } catch (error) {
    return { ...failed, failure: `the result could not be read (${(error as Error).message.slice(0, 200)})` }
  }
}

/** Books what the review cost and files its result. Returns whether this commit now has a completed review. */
export async function settleReview(target: ReviewTarget, id: string, resultFile: string, refusal: string, now = new Date()): Promise<boolean> {
  const policy = loadPolicy()
  const cached = refusal === 'cached'
  const record = cached ? undefined : readResult(target, resultFile, refusal || 'the review job produced no result')
  if (record) {
    updateLedger(remote(), `${subject(target)}: AI review of ${target.head.slice(0, 12)} ${record.outcome}`, (dir) => {
      if (id) writeJson(dir, budgetFile(now), settle(readJson<BudgetEntry[]>(dir, budgetFile(now), []), id, record.usage, policy.reviewer.usdPerMillionTokens, now))
      const file = target.kind === 'pr' ? prFile(target.pr!) : releaseFile(target.head)
      const ledger = readJson<{ reviews: ReviewRecord[] }>(dir, file, target.kind === 'pr' ? EMPTY_PR_LEDGER : EMPTY_RELEASE_LEDGER)
      writeJson(dir, file, { ...ledger, reviews: [...ledger.reviews, record] })
    })
  }
  const complete = cached || record?.outcome === 'complete'

  if (target.kind === 'pr') {
    const pullRequest = await loadPullRequest(policy, target.pr!)
    await removeLabel(target.pr!, policy.labels.review)
    const notes = complete ? [] : [`**The AI review did not run to completion:** ${record?.failure}. The gate stays closed; a maintainer can add \`${policy.labels.review}\` again or record an exception.`]
    if (pullRequest.headSha === target.head) await publish(policy, pullRequest, notes)
    return complete
  }

  const ledger = readLedger(remote(), (dir) => readJson(dir, releaseFile(target.head), EMPTY_RELEASE_LEDGER))
  const latest = [...ledger.reviews].reverse().find((entry) => entry.base === target.base)
  summary(
    renderReport(policy, {
      subject: 'Release candidate',
      headSha: target.head,
      base: target.base,
      classification: classify(policy, changedFiles('.', target.base, target.head)),
      review: latest,
      notes: ledger.exception ? [`**Exception** by ${ledger.exception.by}: ${ledger.exception.reason}`] : [],
      knownLines: gitReader('.', target.base, target.head).lineCount
    })
  )
  setOutput('assessment', latest?.report?.assessment ?? 'none')
  return complete || ledger.exception !== undefined
}
