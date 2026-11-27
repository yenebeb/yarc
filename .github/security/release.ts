import { execFileSync } from 'node:child_process'
import { changedFiles, classify } from './classify.ts'
import { decide, EMPTY_PR_LEDGER, EMPTY_RELEASE_LEDGER, prFile, releaseFile } from './gate.ts'
import { api, remote, setOutput, summary } from './github.ts'
import { readJson, readLedger, updateLedger, writeJson } from './ledger.ts'
import { isMaintainer, loadPolicy, type Policy } from './policy.ts'

const git = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim()

export interface MergedPullRequest {
  number: number
  author: string
  headSha: string
}

export interface CommitCheck {
  sha: string
  pr?: MergedPullRequest
  risk: string
  problem?: string
}

/** Every commit must be a merged pull request that the gate, as recorded in the ledger, would let through today. */
export function checkCommits(policy: Policy, commits: { sha: string; pr?: MergedPullRequest }[], ledgerDir: string, repo = '.'): CommitCheck[] {
  return commits.map(({ sha, pr }) => {
    const { risk } = classify(policy, changedFiles(repo, `${sha}^`, sha))
    if (!pr) return { sha, risk, problem: 'not the merge of a pull request' }
    const decision = decide(policy, { ...pr, mergeBase: '', risk }, readJson(ledgerDir, prFile(pr.number), EMPTY_PR_LEDGER), undefined, false)
    return { sha, pr, risk, problem: decision.state === 'success' ? undefined : decision.description }
  })
}

async function mergedPullRequest(sha: string): Promise<MergedPullRequest | undefined> {
  const pulls = await api<any[]>('GET', `commits/${sha}/pulls`)
  const pull = pulls.find((candidate) => candidate.merged_at && candidate.merge_commit_sha === sha)
  return pull && { number: pull.number, author: pull.user.login, headSha: pull.head.sha }
}

/** The candidate is compared with what users have: the last published release, not the last tag. */
export async function verifyRelease(head: string, actor: string, exceptionReason: string): Promise<void> {
  const policy = loadPolicy()
  const published = await api('GET', 'releases/latest')
  const base = git(['rev-parse', `${published.tag_name}^{commit}`])
  setOutput('base', base)

  if (exceptionReason.trim()) {
    if (!isMaintainer(policy, actor)) throw new Error(`${actor} is not a maintainer in the security policy`)
    if (exceptionReason.trim().length < 10) throw new Error('An exception needs a reason of at least a sentence')
    updateLedger(remote(), `release ${head.slice(0, 12)}: exception by ${actor}`, (dir) => {
      const ledger = readJson(dir, releaseFile(head), EMPTY_RELEASE_LEDGER)
      writeJson(dir, releaseFile(head), { ...ledger, exception: { sha: head, by: actor, at: new Date().toISOString(), reason: exceptionReason.trim() } })
    })
  }

  const commits: { sha: string; pr?: MergedPullRequest }[] = []
  for (const sha of git(['rev-list', '--reverse', `${base}..${head}`]).split('\n').filter(Boolean)) commits.push({ sha, pr: await mergedPullRequest(sha) })
  const { checks, exception } = readLedger(remote(), (dir) => ({
    checks: checkCommits(policy, commits, dir),
    exception: readJson(dir, releaseFile(head), EMPTY_RELEASE_LEDGER).exception
  }))
  const problems = checks.filter((check) => check.problem)

  summary(
    [
      `## Release candidate \`${head.slice(0, 12)}\``,
      `${checks.length} commits since ${published.tag_name} (\`${base.slice(0, 12)}\`), the last published release.`,
      '| Commit | Pull request | Author | Risk | Gate |',
      '|---|---|---|---|---|',
      ...checks.map((check) => `| \`${check.sha.slice(0, 9)}\` | ${check.pr ? `#${check.pr.number}` : '-'} | ${check.pr?.author ?? '-'} | ${check.risk} | ${check.problem ? `**not passed:** ${check.problem}` : 'passed'} |`),
      problems.length ? `**${problems.length} of them did not pass the security gate.**${exception ? ` Released under an exception by ${exception.by}: ${exception.reason}` : ' This release cannot be signed.'}` : 'Every commit passed the security gate.'
    ].join('\n')
  )
  if (problems.length && !exception) throw new Error(`${problems.length} commits since ${published.tag_name} did not pass the security gate`)
}
