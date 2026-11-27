import { appendFileSync } from 'node:fs'

const API = process.env.GITHUB_API_URL ?? 'https://api.github.com'
export const repository = (): string => process.env.GITHUB_REPOSITORY ?? ''
export const runUrl = (): string => `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repository()}/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`

/** Where git reads pull requests from and keeps the ledger. Tests point it at a local repository. */
export function remote(): string {
  if (process.env.SECURITY_REMOTE) return process.env.SECURITY_REMOTE
  const token = process.env.GITHUB_TOKEN
  return `https://${token ? `x-access-token:${token}@` : ''}github.com/${repository()}.git`
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}/repos/${repository()}/${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!response.ok) throw Object.assign(new Error(`${method} ${path}: ${response.status} ${(await response.text()).slice(0, 300)}`), { status: response.status })
  return (response.status === 204 ? undefined : await response.json()) as T
}

export async function removeLabel(issue: number, label: string): Promise<void> {
  await api('DELETE', `issues/${issue}/labels/${encodeURIComponent(label)}`).catch((error) => {
    if (error.status !== 404) throw error
  })
}

export async function upsertComment(issue: number, marker: string, body: string): Promise<void> {
  const comments = await api<{ id: number; body: string; user: { login: string } }[]>('GET', `issues/${issue}/comments?per_page=100`)
  const existing = comments.find((comment) => comment.user.login === 'github-actions[bot]' && comment.body.startsWith(marker))
  if (existing) await api('PATCH', `issues/comments/${existing.id}`, { body })
  else await api('POST', `issues/${issue}/comments`, { body })
}

export function setOutput(name: string, value: string | number | boolean): void {
  console.log(`${name}=${value}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

export function summary(markdown: string): void {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n\n`)
  else console.log(markdown)
}
