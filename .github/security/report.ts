import type { Classification } from './classify.ts'
import type { Decision, ReviewRecord } from './gate.ts'
import type { Policy } from './policy.ts'

const ASSESSMENTS = ['no_concerns_found', 'concerns', 'likely_malicious', 'incomplete'] as const
const RECOMMENDATIONS = ['approve_after_manual_checks', 'request_changes', 'reject'] as const
const FINDING_STATUSES = ['confirmed', 'suspicious', 'unverified'] as const
const CONFIDENCES = ['low', 'medium', 'high'] as const

export interface Finding {
  status: (typeof FINDING_STATUSES)[number]
  title: string
  file: string
  line: number
  evidence: string
  impact: string
  confidence: (typeof CONFIDENCES)[number]
}

export interface Report {
  assessment: (typeof ASSESSMENTS)[number]
  summary: string
  purposeMatch: string
  sensitivePaths: { file: string; why: string }[]
  findings: Finding[]
  unverified: string[]
  manualChecks: string[]
  recommendation: (typeof RECOMMENDATIONS)[number]
}

export const COMMENT_MARKER = '<!-- yarc-security-gate -->'

const text = { type: 'string' }
const list = (items: object) => ({ type: 'array', items })
const object = (properties: Record<string, object>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })

export const REPORT_SCHEMA = object({
  assessment: { type: 'string', enum: ASSESSMENTS },
  summary: text,
  purposeMatch: text,
  sensitivePaths: list(object({ file: text, why: text })),
  findings: list(
    object({
      status: { type: 'string', enum: FINDING_STATUSES },
      title: text,
      file: text,
      line: { type: 'integer' },
      evidence: text,
      impact: text,
      confidence: { type: 'string', enum: CONFIDENCES }
    })
  ),
  unverified: list(text),
  manualChecks: list(text),
  recommendation: { type: 'string', enum: RECOMMENDATIONS }
})

function check(value: unknown, schema: any, where: string): void {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} is not an object`)
    for (const key of schema.required) check((value as Record<string, unknown>)[key], schema.properties[key], `${where}.${key}`)
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${where} is not a list`)
    value.forEach((item, index) => check(item, schema.items, `${where}[${index}]`))
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value)) throw new Error(`${where} is not a whole number`)
  } else if (typeof value !== 'string' || (schema.enum && !schema.enum.includes(value))) {
    throw new Error(`${where} is not ${schema.enum ? `one of ${schema.enum.join(', ')}` : 'text'}`)
  }
}

export function validateReport(value: unknown): Report {
  check(value, REPORT_SCHEMA, 'report')
  return value as Report
}

/** The reviewer's words are shown, never run: no mentions, links, images or HTML of its making. */
export function plain(value: string, limit = 700): string {
  const flat = value.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁩﻿]+/g, ' ').trim()
  const cut = flat.length > limit ? `${flat.slice(0, limit)}…` : flat
  return cut.replace(/[<>&@[\]()!|`*_#~\\]/g, (character) => `&#${character.charCodeAt(0)};`)
}

const code = (value: string): string => `\`${value.replace(/[`\u0000-\u001f]/g, '').slice(0, 200)}\``
const words = (value: string): string => value.replaceAll('_', ' ')
const bullets = (items: string[]): string => items.map((item) => `- ${item}`).join('\n')

function renderReview(review: ReviewRecord, knownLines: (file: string) => number | undefined): string {
  const title = `### AI security review of ${code(review.headSha.slice(0, 12))}`
  if (review.outcome === 'failed' || !review.report) {
    return `${title}\n\n**The review did not complete:** ${plain(review.failure ?? 'unknown reason')}. Nothing was reviewed, so this counts as not reviewed.`
  }
  const { report } = review
  const where = (finding: Finding): string => {
    const lines = knownLines(finding.file)
    const located = lines !== undefined && finding.line >= 1 && finding.line <= lines
    return `${code(`${finding.file}:${finding.line}`)}${located ? '' : ' (no such line in this commit)'}`
  }
  const sections = [
    title,
    '> An automated investigation aid, not proof that this change is safe. It can miss an attack and it can be fooled; a maintainer decides.',
    `**Assessment:** ${words(report.assessment)} · **Recommendation:** ${words(report.recommendation)}`,
    plain(report.summary, 1200),
    `**Does it do what it says?** ${plain(report.purposeMatch)}`
  ]
  for (const status of FINDING_STATUSES) {
    const findings = report.findings.filter((finding) => finding.status === status)
    if (!findings.length) continue
    sections.push(
      `#### ${{ confirmed: 'Confirmed', suspicious: 'Suspicious', unverified: 'Could not be verified' }[status]}`,
      bullets(findings.map((finding) => `**${plain(finding.title, 160)}** at ${where(finding)} (confidence: ${finding.confidence})<br>${plain(finding.evidence)}<br>*Impact:* ${plain(finding.impact)}`))
    )
  }
  if (report.sensitivePaths.length) sections.push('#### Sensitive code paths touched', bullets(report.sensitivePaths.map((path) => `${code(path.file)}: ${plain(path.why, 300)}`)))
  if (report.unverified.length) sections.push('#### Not examined', bullets(report.unverified.map((item) => plain(item, 300))))
  if (report.manualChecks.length) sections.push('#### Check by hand before signing off', report.manualChecks.map((item) => `- [ ] ${plain(item, 400)}`).join('\n'))
  if (review.usage) {
    const { inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens } = review.usage
    sections.push(`<sub>${plain(review.model ?? '')} · ${inputTokens + cacheReadTokens + cacheWriteTokens} input and ${outputTokens} output tokens · rules ${review.policyVersion}</sub>`)
  }
  return sections.join('\n\n')
}

export interface ReportInput {
  subject: string
  headSha: string
  base: string
  classification: Classification
  decision?: Decision
  review?: ReviewRecord
  notes?: string[]
  knownLines?: (file: string) => number | undefined
}

export function renderReport(policy: Policy, input: ReportInput): string {
  const { classification, decision, review } = input
  const sections = [
    COMMENT_MARKER,
    `## Security gate: ${classification.risk} risk${decision ? ` · ${decision.state === 'success' ? 'passed' : 'waiting'}` : ''}`,
    `${input.subject} at ${code(input.headSha.slice(0, 12))}, compared with ${code(input.base.slice(0, 12))}.${decision ? ` ${plain(decision.description)}.` : ''}`,
    `**Why ${classification.risk} risk** (from the changed files; neither the author nor the AI reviewer can change it)\n${bullets(classification.reasons.slice(0, 15).map((reason) => plain(reason, 300)))}${classification.reasons.length > 15 ? `\n- and ${classification.reasons.length - 15} more` : ''}`
  ]
  if (classification.injectionHits.length) {
    sections.push(`**Text that addresses an automated reviewer** (possible attempt to steer the review)\n${bullets(classification.injectionHits.slice(0, 8).map((hit) => plain(hit, 200)))}`)
  }
  if (input.notes?.length) sections.push(bullets(input.notes))
  if (review) sections.push(renderReview(review, input.knownLines ?? (() => undefined)))
  if (decision?.state === 'pending') {
    const steps = []
    if (decision.needsAiReview) steps.push(`A maintainer adds the label ${code(policy.labels.review)} to start the AI review of this commit.`)
    steps.push(`After ${policy.reviewer.enabled ? 'reading the report' : 'checking the change by hand'}, a maintainer adds ${code(policy.labels.approve)} to sign off this exact commit. A new commit removes the label.`)
    sections.push(`**Next**\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`)
  }
  return sections.join('\n\n')
}
