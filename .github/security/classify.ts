import { execFileSync } from 'node:child_process'
import type { Policy } from './policy.ts'

export type Risk = 'low' | 'medium' | 'high'

export interface ChangedFile {
  path: string
  previousPath?: string
  status: string
  mode: string
  binary: boolean
  addedLines: string[]
}

export interface FileRisk {
  path: string
  risk: Risk
  reasons: string[]
}

export interface Classification {
  risk: Risk
  reasons: string[]
  files: FileRisk[]
  injectionHits: string[]
}

const RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2 }
const REGULAR_FILE_MODES = ['100644', '000000']

export function globToRegExp(glob: string): RegExp {
  const source = glob
    .replace(/[.+^$()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/?|\*|\?/g, (wildcard) => (wildcard === '**/' ? '(?:.*/)?' : wildcard === '**' ? '.*' : wildcard === '*' ? '[^/]*' : '[^/]'))
    .replace(/\{([^}]+)\}/g, (_match, alternatives: string) => `(?:${alternatives.split(',').join('|')})`)
  return new RegExp(`^${source}$`)
}

const matchesAny = (globs: string[], path: string): string | undefined => globs.find((glob) => globToRegExp(glob).test(path))

export function injectionHits(policy: Policy, lines: string[]): string[] {
  const patterns = policy.risk.injection.map((pattern) => new RegExp(pattern, 'i'))
  return lines.filter((line) => patterns.some((pattern) => pattern.test(line))).map((line) => line.trim().slice(0, 200))
}

function classifyFile(policy: Policy, file: ChangedFile): FileRisk & { injectionHits: string[] } {
  const { low, high } = policy.risk
  const paths = [file.path, ...(file.previousPath ? [file.previousPath] : [])]
  const reasons: string[] = []

  if (!REGULAR_FILE_MODES.includes(file.mode)) reasons.push(`file mode ${file.mode} (symlink, submodule or executable)`)
  if (!['A', 'M', 'D', 'R'].includes(file.status)) reasons.push(`change type ${file.status}`)
  for (const path of paths) {
    const glob = matchesAny(high.paths, path)
    if (glob) reasons.push(`sensitive path ${glob}`)
  }

  const allLow = paths.every((path) => matchesAny(low.paths, path))
  if (!allLow) {
    if (file.binary) reasons.push('binary file outside the documentation allowlist')
    for (const rule of high.content) {
      const pattern = new RegExp(rule.pattern, rule.flags ?? '')
      const hits = file.addedLines.filter((line) => pattern.test(line)).length
      if (hits) reasons.push(`${rule.name} (${hits} added ${hits === 1 ? 'line' : 'lines'})`)
    }
  }

  const hits = injectionHits(policy, file.addedLines)
  if (hits.length) reasons.push('text addressed to an automated reviewer or agent')

  const risk: Risk = reasons.length ? 'high' : allLow ? 'low' : 'medium'
  return { path: file.path, risk, reasons, injectionHits: hits }
}

/** Decided from the changed files alone: never from what the PR or a reviewer says about itself. */
export function classify(policy: Policy, files: ChangedFile[]): Classification {
  if (files.length === 0) return { risk: 'high', reasons: ['no changed files could be determined'], files: [], injectionHits: [] }
  const perFile = files.map((file) => classifyFile(policy, file))
  let risk = perFile.reduce<Risk>((highest, file) => (RANK[file.risk] > RANK[highest] ? file.risk : highest), 'low')
  const reasons = [...new Set(perFile.flatMap((file) => file.reasons.map((reason) => `${file.path}: ${reason}`)))]

  const addedLines = files.reduce((total, file) => total + file.addedLines.length, 0)
  if (risk === 'low' && addedLines > policy.risk.low.maxAddedLines) {
    risk = 'medium'
    reasons.push(`${addedLines} added lines is more than a documentation fix (${policy.risk.low.maxAddedLines})`)
  }
  if (risk === 'medium' && reasons.length === 0) reasons.push('changes outside the documentation allowlist')
  return {
    risk,
    reasons,
    files: perFile.map(({ path, risk: fileRisk, reasons: fileReasons }) => ({ path, risk: fileRisk, reasons: fileReasons })),
    injectionHits: perFile.flatMap((file) => file.injectionHits)
  }
}

const git = (repo: string, args: string[]): string =>
  execFileSync('git', ['-C', repo, '-c', 'core.quotePath=false', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

export function changedFiles(repo: string, base: string, head: string): ChangedFile[] {
  const fields = git(repo, ['diff', '--raw', '-z', '--no-abbrev', '-M', base, head]).split('\0')
  const files: ChangedFile[] = []
  for (let index = 0; index < fields.length - 1; ) {
    const [, mode, , , statusField] = fields[index++].slice(1).split(' ')
    const status = statusField[0]
    const renamed = status === 'R' || status === 'C'
    const previousPath = renamed ? fields[index++] : undefined
    const path = fields[index++]
    const diff = git(repo, ['diff', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', base, head, '--', path, ...(previousPath ? [previousPath] : [])])
    files.push({
      path,
      previousPath,
      status,
      mode,
      binary: /^Binary files .* differ$/m.test(diff) || /^GIT binary patch$/m.test(diff),
      addedLines: diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).map((line) => line.slice(1))
    })
  }
  return files
}
