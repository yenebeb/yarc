import { execFileSync } from 'node:child_process'
import { changedFiles, classify, injectionHits, type ChangedFile, type Classification } from './classify.ts'
import { completedReview, decide, EMPTY_PR_LEDGER, prFile, STATUS_CONTEXT, type Decision, type PullRequest, type PullRequestLedger, type Signature } from './gate.ts'
import { api, remote, removeLabel, runUrl, setOutput, upsertComment } from './github.ts'
import { readJson, readLedger, updateLedger, writeJson } from './ledger.ts'
import { isMaintainer, loadPolicy, policyVersion, type Policy } from './policy.ts'
import { COMMENT_MARKER, renderReport } from './report.ts'
import { gitReader } from './reviewer.ts'

export interface LoadedPullRequest extends PullRequest {
  title: string
  body: string
  labels: string[]
  files: ChangedFile[]
  classification: Classification
}

const git = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** Fetches the pull request's commits as objects to read. Nothing of it is checked out or run. */
export async function loadPullRequest(policy: Policy, number: number, expectedHead?: string): Promise<LoadedPullRequest> {
  const pull = await api('GET', `pulls/${number}`)
  const headSha: string = pull.head.sha
  if (expectedHead && expectedHead !== headSha) throw new Error(`#${number} moved from ${expectedHead} to ${headSha}: the run for the newer commit takes over`)
  git(['fetch', '--quiet', '--no-tags', remote(), `refs/pull/${number}/head`, pull.base.sha])
  if (git(['rev-parse', 'FETCH_HEAD']) !== headSha) throw new Error(`#${number} changed while it was fetched`)
  const mergeBase = git(['merge-base', pull.base.sha, headSha])
  const files = changedFiles('.', mergeBase, headSha)
  const classification = classify(policy, files)
  classification.injectionHits.push(...injectionHits(policy, `${pull.title}\n${pull.body ?? ''}`.split('\n')))
  return {
    number,
    author: pull.user.login,
    headSha,
    mergeBase,
    risk: classification.risk,
    title: pull.title,
    body: pull.body ?? '',
    labels: pull.labels.map((label: { name: string }) => label.name),
    files,
    classification
  }
}

export const readPrLedger = (number: number): PullRequestLedger => readLedger(remote(), (dir) => readJson(dir, prFile(number), EMPTY_PR_LEDGER))

export function sign(number: number, list: 'signoffs' | 'exceptions', signature: Signature): void {
  updateLedger(remote(), `#${number}: ${list === 'signoffs' ? 'sign-off' : 'exception'} by ${signature.by} for ${signature.sha.slice(0, 12)}`, (dir) => {
    const ledger = readJson(dir, prFile(number), EMPTY_PR_LEDGER)
    writeJson(dir, prFile(number), { ...ledger, [list]: [...ledger[list], signature] })
  })
}

/** Reads the ledger last, so the status reflects everything recorded up to now. */
export async function publish(policy: Policy, pullRequest: LoadedPullRequest, notes: string[] = []): Promise<Decision> {
  const ledger = readPrLedger(pullRequest.number)
  const decision = decide(policy, pullRequest, ledger, policyVersion())
  await api('POST', `statuses/${pullRequest.headSha}`, { state: decision.state, context: STATUS_CONTEXT, description: decision.description.slice(0, 140), target_url: runUrl() })

  const review = [...ledger.reviews].reverse().find((record) => record.headSha === pullRequest.headSha)
  if (decision.state === 'pending' || review || notes.length) {
    const body = renderReport(policy, {
      subject: `Pull request #${pullRequest.number} by ${pullRequest.author}`,
      headSha: pullRequest.headSha,
      base: pullRequest.mergeBase,
      classification: pullRequest.classification,
      decision,
      review,
      notes,
      knownLines: gitReader('.', pullRequest.mergeBase, pullRequest.headSha).lineCount
    })
    await upsertComment(pullRequest.number, COMMENT_MARKER, body.slice(0, 60_000))
  }
  console.log(`#${pullRequest.number} ${pullRequest.headSha}: ${decision.state}, ${decision.description}`)
  return decision
}

interface Event {
  action: string
  label?: { name: string }
  sender: { login: string }
  pull_request: { number: number; head: { sha: string } }
}

/** A label counts for the commit it was put on, and only from a maintainer: both come from the event, not from the PR. */
export async function gate(event: Event): Promise<void> {
  const policy = loadPolicy()
  const { review: reviewLabel, approve: approveLabel } = policy.labels
  const pullRequest = await loadPullRequest(policy, event.pull_request.number, event.pull_request.head.sha)
  const { number, headSha } = pullRequest
  const label = event.action === 'labeled' ? event.label?.name : undefined
  const byMaintainer = isMaintainer(policy, event.sender.login)
  const notes: string[] = []
  let startReview = false

  if (event.action === 'synchronize') {
    for (const stale of [reviewLabel, approveLabel]) if (pullRequest.labels.includes(stale)) await removeLabel(number, stale)
  }
  if ((label === reviewLabel || label === approveLabel) && !byMaintainer) {
    await removeLabel(number, label)
    notes.push(`\`${label}\` was removed: only a maintainer listed in the security policy can add it.`)
  } else if (label === reviewLabel) {
    if (completedReview(readPrLedger(number), pullRequest, policyVersion())) {
      await removeLabel(number, reviewLabel)
      notes.push('This exact commit was already reviewed with the current rules: the report below still stands, and no new review was paid for.')
    } else startReview = true
  } else if (label === approveLabel) {
    const before = decide(policy, pullRequest, readPrLedger(number), policyVersion())
    if (before.needsAiReview) {
      await removeLabel(number, approveLabel)
      notes.push(`\`${approveLabel}\` was removed: this commit has no completed AI review yet. Add \`${reviewLabel}\` first, or record an exception.`)
    } else sign(number, 'signoffs', { sha: headSha, by: event.sender.login, at: new Date().toISOString() })
  }

  await publish(policy, pullRequest, notes)
  setOutput('review', startReview)
  setOutput('head', headSha)
  setOutput('base', pullRequest.mergeBase)
}

export async function exception(number: number, actor: string, reason: string): Promise<void> {
  const policy = loadPolicy()
  if (!isMaintainer(policy, actor)) throw new Error(`${actor} is not a maintainer in the security policy`)
  if (reason.trim().length < 10) throw new Error('An exception needs a reason of at least a sentence')
  const pullRequest = await loadPullRequest(policy, number)
  sign(number, 'exceptions', { sha: pullRequest.headSha, by: actor, at: new Date().toISOString(), reason: reason.trim() })
  await publish(policy, pullRequest, [`**Exception** recorded by ${actor} for this commit, in place of the AI review and the sign-off. Reason: ${reason.trim().replace(/[<>@[\]`]/g, ' ')}`])
}
