import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** The shipped policy with the AI reviewer on or off, as a file the scripts load instead of their own. */
export function usePolicy(reviewerEnabled: boolean): void {
  const shipped = JSON.parse(readFileSync(new URL('../../.github/security/policy.json', import.meta.url), 'utf8'))
  const file = join(mkdtempSync(join(tmpdir(), 'security-policy-')), 'policy.json')
  writeFileSync(file, JSON.stringify({ ...shipped, reviewer: { ...shipped.reviewer, enabled: reviewerEnabled } }))
  process.env.SECURITY_POLICY_FILE = file
}

export const git = (dir: string, ...args: string[]): string => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

export interface PullState {
  number: number
  author: string
  title: string
  body: string
  head: string
  labels: string[]
}

export interface FakeGitHub {
  origin: string
  work: string
  mainSha: string
  pulls: Map<number, PullState>
  statuses: { sha: string; state: string; description: string }[]
  comments: { id: number; body: string; user: { login: string } }[]
  /** `null` deletes a file; `{ symlink }` makes one. */
  commit(branch: string, files: Record<string, string | null | { symlink: string }>, message?: string): string
  openPull(number: number, author: string, files: Record<string, string | null | { symlink: string }>, text?: { title?: string; body?: string }): PullState
  push(number: number, files: Record<string, string | null>): PullState
  merge(number: number): string
  lastStatus(sha: string): string | undefined
}

/** A bare repository with pull request refs, and a fetch() that answers like the GitHub API for it. */
export function fakeGitHub(): FakeGitHub {
  const root = mkdtempSync(join(tmpdir(), 'security-test-'))
  process.on('exit', () => rmSync(root, { recursive: true, force: true }))
  const origin = join(root, 'origin.git')
  const work = join(root, 'work')
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch', 'main', origin])
  git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
  execFileSync('git', ['clone', '--quiet', origin, work], { stdio: 'ignore' })
  for (const [key, value] of [['user.name', 'Test'], ['user.email', 'test@example.com'], ['commit.gpgsign', 'false']]) git(work, 'config', key, value)

  const commit: FakeGitHub['commit'] = (branch, files, message = 'change') => {
    git(work, 'checkout', '--quiet', '-B', branch)
    for (const [path, content] of Object.entries(files)) {
      const file = join(work, path)
      rmSync(file, { force: true })
      if (content === null) continue
      mkdirSync(dirname(file), { recursive: true })
      if (typeof content === 'string') writeFileSync(file, content)
      else symlinkSync(content.symlink, file)
    }
    git(work, 'add', '--all')
    git(work, 'commit', '--quiet', '--allow-empty', '-m', message)
    return git(work, 'rev-parse', 'HEAD')
  }

  git(work, 'checkout', '--quiet', '-b', 'main')
  const mainSha = commit('main', {
    'README.md': '# App\n',
    'docs/guide.md': 'How it works.\n',
    'src/renderer/src/Sidebar.tsx': 'export const width = 240\n',
    'src/main/update/updater.ts': 'export const feed = "releases"\n',
    '.github/workflows/ci.yml': 'name: ci\n'
  })
  git(work, 'push', '--quiet', 'origin', 'main')

  const github: FakeGitHub = {
    origin,
    work,
    mainSha,
    pulls: new Map(),
    statuses: [],
    comments: [],
    commit,
    openPull(number, author, files, text = {}) {
      git(work, 'checkout', '--quiet', 'main')
      const head = commit(`pr-${number}`, files)
      git(work, 'push', '--quiet', '--force', 'origin', `HEAD:refs/pull/${number}/head`)
      git(work, 'checkout', '--quiet', 'main')
      const pull = { number, author, title: text.title ?? `Change ${number}`, body: text.body ?? '', head, labels: [] }
      github.pulls.set(number, pull)
      return pull
    },
    push(number, files) {
      const pull = github.pulls.get(number)!
      git(work, 'checkout', '--quiet', `pr-${number}`)
      pull.head = commit(`pr-${number}`, files)
      git(work, 'push', '--quiet', '--force', 'origin', `HEAD:refs/pull/${number}/head`)
      git(work, 'checkout', '--quiet', 'main')
      return pull
    },
    merge(number) {
      git(work, 'checkout', '--quiet', 'main')
      git(work, 'merge', '--quiet', '--squash', `pr-${number}`)
      git(work, 'commit', '--quiet', '-m', `Change ${number} (#${number})`)
      git(work, 'push', '--quiet', 'origin', 'main')
      return git(work, 'rev-parse', 'HEAD')
    },
    lastStatus: (sha) => github.statuses.findLast((status) => status.sha === sha)?.state
  }

  const json = (value: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), { status })
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const path = String(input).replace(/^.*\/repos\/o\/r\//, '').replace(/\?.*$/, '')
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    const [resource, id, sub, name] = path.split('/')
    const pull = github.pulls.get(Number(id))
    if (resource === 'pulls' && pull) {
      return json({ number: pull.number, title: pull.title, body: pull.body, user: { login: pull.author }, head: { sha: pull.head }, base: { sha: mainSha }, labels: pull.labels.map((label) => ({ name: label })) })
    }
    if (resource === 'statuses') return json(github.statuses.push({ sha: id, state: body.state, description: body.description }))
    if (resource === 'issues' && sub === 'comments' && method === 'GET') return json(github.comments)
    if (resource === 'issues' && sub === 'comments') return json(github.comments.push({ id: github.comments.length + 1, body: body.body, user: { login: 'github-actions[bot]' } }))
    if (resource === 'issues' && id === 'comments') {
      github.comments.find((comment) => comment.id === Number(sub))!.body = body.body
      return json({})
    }
    if (resource === 'issues' && sub === 'labels' && pull) {
      pull.labels = pull.labels.filter((label) => label !== decodeURIComponent(name))
      return json(null, 204)
    }
    return json({ message: `no fake for ${method} ${path}` }, 404)
  }) as typeof fetch

  process.env.GITHUB_REPOSITORY = 'o/r'
  process.env.SECURITY_REMOTE = origin
  delete process.env.GITHUB_OUTPUT
  delete process.env.GITHUB_STEP_SUMMARY
  process.chdir(work)
  return github
}
