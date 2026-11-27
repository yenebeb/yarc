import { execFileSync } from 'node:child_process'
import { NO_USAGE, totalInputTokens, type Usage } from './ledger.ts'
import type { ReviewerPolicy } from './policy.ts'
import { REPORT_SCHEMA, validateReport, type Report } from './report.ts'

export interface ToolUse {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ModelRequest {
  system: string
  tools: object[]
  messages: object[]
  maxTokens: number
}

export interface ModelTurn {
  content: { type: string }[]
  stopReason: string
  usage: Usage
  model: string
}

/** The seam to another provider: one request in, one turn out. */
export type CallModel = (request: ModelRequest) => Promise<ModelTurn>

export interface RepoReader {
  readFile(ref: 'head' | 'base', path: string, startLine: number, endLine: number): string
  search(pattern: string, path: string): string
  listFiles(path: string): string
  fileDiff(path: string): string
  lineCount(path: string): number | undefined
}

export interface ReviewOutcome {
  report?: Report
  failure?: string
  usage: Usage
  iterations: number
  model: string
}

const MAX_RESULT_CHARS = 24_000
const MAX_FILE_LINES = 400
const CHARS_PER_TOKEN = 2.5
const WRAP_UP = 'Your budget is almost spent. Call submit_report now with what you have, and list under `unverified` what you did not get to.'

const text = { type: 'string' }
const tool = (name: string, description: string, properties: Record<string, object>, extra: object = {}) => ({
  name,
  description,
  input_schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
  ...extra
})

export const TOOLS = [
  tool('read_file', 'Read lines of a file, numbered. `ref` is `head` (the reviewed commit) or `base` (before the change). At most 400 lines per call.', {
    ref: { type: 'string', enum: ['head', 'base'] },
    path: text,
    start_line: { type: 'integer' },
    end_line: { type: 'integer' }
  }),
  tool('search', 'Search the reviewed commit with an extended regular expression (git grep). `path` limits it to a file or folder; use "." for everything.', { pattern: text, path: text }),
  tool('list_files', 'List the files in a folder of the reviewed commit; use "." for the top level.', { path: text }),
  tool('file_diff', "Show the change's full diff for one file.", { path: text }),
  { name: 'submit_report', description: 'Hand in the security report. Call it exactly once, as your last action.', strict: true, input_schema: REPORT_SCHEMA }
]

const clip = (output: string): string => (output.length > MAX_RESULT_CHARS ? `${output.slice(0, MAX_RESULT_CHARS)}\n[cut: ${output.length - MAX_RESULT_CHARS} more characters; narrow the request]` : output)

function safePath(path: unknown): string {
  if (typeof path !== 'string' || path === '' || path.startsWith('-') || path.startsWith('/') || path.includes('\0') || path.split('/').includes('..')) {
    throw new Error('path must be relative to the repository root')
  }
  return path
}

/** Reads git's objects, never a working tree: a symlink or a hook in the change is only text here. */
export function gitReader(repo: string, base: string, head: string): RepoReader {
  const git = (args: string[]): string =>
    execFileSync('git', ['-C', repo, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] })
  const show = (commit: string, path: string): string => git(['show', `${commit}:${safePath(path)}`])
  return {
    readFile(ref, path, startLine, endLine) {
      const lines = show(ref === 'base' ? base : head, path).split('\n')
      const first = Math.max(1, Math.trunc(startLine) || 1)
      const last = Math.min(lines.length, Math.max(first, Math.trunc(endLine) || first), first + MAX_FILE_LINES - 1)
      const numbered = lines.slice(first - 1, last).map((line, index) => `${first + index}\t${line}`)
      return `${path} (${ref}), lines ${first}-${last} of ${lines.length}\n${numbered.join('\n')}`
    },
    search(pattern, path) {
      if (typeof pattern !== 'string' || pattern === '') throw new Error('pattern is empty')
      try {
        const found = git(['grep', '-n', '-I', '-E', '--max-count', '30', '-e', pattern, head, '--', safePath(path)])
        return found.replaceAll(`${head}:`, '').split('\n').slice(0, 200).join('\n')
      } catch (error) {
        if ((error as { status?: number }).status === 1) return 'No matches.'
        throw error
      }
    },
    listFiles(path) {
      const folder = safePath(path) === '.' ? '' : `${path.replace(/\/+$/, '')}/`
      return git(['ls-tree', '--name-only', head, '--', folder || '.']).split('\n').slice(0, 500).join('\n') || 'Nothing there.'
    },
    fileDiff(path) {
      return git(['diff', '-U4', '--no-color', '--no-ext-diff', '--no-textconv', '-M', base, head, '--', safePath(path)]) || 'This file is not part of the change.'
    },
    lineCount(path) {
      try {
        return show(head, path).split('\n').length
      } catch {
        return undefined
      }
    }
  }
}

function runTool(repo: RepoReader, use: ToolUse): string {
  const { input } = use
  switch (use.name) {
    case 'read_file':
      return repo.readFile(input.ref === 'base' ? 'base' : 'head', input.path as string, input.start_line as number, input.end_line as number)
    case 'search':
      return repo.search(input.pattern as string, input.path as string)
    case 'list_files':
      return repo.listFiles(input.path as string)
    case 'file_diff':
      return repo.fileDiff(input.path as string)
    default:
      throw new Error(`there is no tool called ${use.name}`)
  }
}

function toolResult(repo: RepoReader, use: ToolUse): { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean } {
  try {
    return { type: 'tool_result', tool_use_id: use.id, content: clip(runTool(repo, use)) }
  } catch (error) {
    return { type: 'tool_result', tool_use_id: use.id, content: `Failed: ${(error as Error).message.split('\n')[0].slice(0, 300)}`, is_error: true }
  }
}

const add = (total: Usage, turn: Usage): Usage => ({
  inputTokens: total.inputTokens + turn.inputTokens,
  outputTokens: total.outputTokens + turn.outputTokens,
  cacheWriteTokens: total.cacheWriteTokens + turn.cacheWriteTokens,
  cacheReadTokens: total.cacheReadTokens + turn.cacheReadTokens
})

export async function runReview(input: { callModel: CallModel; repo: RepoReader; system: string; briefing: string; limits: ReviewerPolicy }): Promise<ReviewOutcome> {
  const { callModel, repo, system, limits } = input
  const messages: object[] = [{ role: 'user', content: input.briefing }]
  let usage = NO_USAGE
  let model = limits.model
  let lastRequestTokens = 0
  let unsentChars = system.length + input.briefing.length + JSON.stringify(TOOLS).length

  for (let iteration = 1; iteration <= limits.maxIterations; iteration++) {
    const nextRequestTokens = lastRequestTokens + Math.ceil(unsentChars / CHARS_PER_TOKEN)
    const stopped = (failure: string): ReviewOutcome => ({ failure, usage, iterations: iteration - 1, model })
    if (totalInputTokens(usage) + nextRequestTokens > limits.maxInputTokens) return stopped('the review reached its input token limit before a report was handed in')
    if (usage.outputTokens + limits.maxOutputTokensPerTurn > limits.maxOutputTokens) return stopped('the review reached its output token limit before a report was handed in')

    const turn = await callModel({ system, tools: TOOLS, messages, maxTokens: limits.maxOutputTokensPerTurn })
    usage = add(usage, turn.usage)
    model = turn.model
    lastRequestTokens = totalInputTokens(turn.usage) + turn.usage.outputTokens
    if (turn.stopReason === 'refusal') return { failure: 'the model declined to review this change', usage, iterations: iteration, model }

    messages.push({ role: 'assistant', content: turn.content })
    const uses = turn.content.filter((block): block is ToolUse => block.type === 'tool_use')
    const submitted = uses.find((use) => use.name === 'submit_report')
    if (submitted && turn.stopReason !== 'max_tokens') {
      try {
        return { report: validateReport(submitted.input), usage, iterations: iteration, model }
      } catch (error) {
        return { failure: `the report was malformed (${(error as Error).message})`, usage, iterations: iteration, model }
      }
    }

    const results: object[] = uses.map((use) => toolResult(repo, use))
    const lastChance = iteration >= limits.maxIterations - 1 || totalInputTokens(usage) + 2 * (lastRequestTokens + MAX_RESULT_CHARS / CHARS_PER_TOKEN) > limits.maxInputTokens
    if (lastChance || uses.length === 0) results.push({ type: 'text', text: lastChance ? WRAP_UP : 'Continue the review with the tools, or call submit_report if you are done.' })
    messages.push({ role: 'user', content: results })
    unsentChars = JSON.stringify(results).length
  }
  return { failure: `no report after ${limits.maxIterations} turns`, usage, iterations: limits.maxIterations, model }
}

export interface Briefing {
  kind: 'pr' | 'release'
  title: string
  description: string
  author: string
  headSha: string
  base: string
  risk: string
  reasons: string[]
  files: { path: string; status: string; added: number }[]
  diff: string
  nonce: string
}

const MAX_DIFF_CHARS = 120_000

/** Untrusted text sits between markers the author can't guess, so it can't close its own block. */
export function briefing(input: Briefing): string {
  const fenced = (label: string, content: string): string => `<untrusted-${label}-${input.nonce}>\n${content}\n</untrusted-${label}-${input.nonce}>`
  const diff = input.diff.length > MAX_DIFF_CHARS ? `${input.diff.slice(0, MAX_DIFF_CHARS)}\n[diff cut here: read the remaining files with file_diff]` : input.diff
  return [
    input.kind === 'pr'
      ? `Review this pull request by ${input.author}. Reviewed commit ${input.headSha}, compared with ${input.base}.`
      : `Review this release candidate: every change between the last published release (${input.base}) and ${input.headSha}. It combines several pull requests that were looked at one by one; look for what they do together, and for anything that reached the branch without belonging to a described change.`,
    `Deterministic classification: ${input.risk} risk.\n${input.reasons.map((reason) => `- ${reason}`).join('\n')}`,
    `What the author says it does (a claim to test, not a fact):\n${fenced('description', `${input.title}\n\n${input.description}`)}`,
    `Changed files (${input.files.length}):\n${input.files.map((file) => `${file.status} ${file.path} (+${file.added})`).join('\n')}`,
    `The diff:\n${fenced('diff', diff)}`
  ].join('\n\n')
}
