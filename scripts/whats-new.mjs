// The "## What's New" section of a PR description: what YARC users see of the PR, one line per
// change, in What's New and on the update card (scripts/changelog.mjs). The PR title stays for
// GitHub. "none" keeps a PR out of the app (CI, tests, docs, refactors nobody notices).
//
//   PR_BODY=… node scripts/whats-new.mjs --check     (CI: fails without a filled-in section)

/**
 * The section's lines, or `undefined` without a section. HTML comments (the template's hints) and
 * bullet markers are dropped; each remaining line is one change.
 * @param {string | null | undefined} body
 */
function section(body) {
  const lines = (body ?? '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)
  const start = lines.findIndex((line) => /^#{2,3}\s+what['’]s\s+new\s*$/i.test(line.trim()))
  if (start < 0) return undefined
  const changes = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break
    const text = line.trim().replace(/^[-*+]\s+/, '').trim()
    if (text) changes.push(text)
  }
  return changes
}

const isNone = (/** @type {string[]} */ changes) => changes.length === 1 && /^none\.?$/i.test(changes[0])

/**
 * What the app shows of a PR: the section's lines, `[]` for "none" (or an empty section), and
 * `undefined` when the description has no section (PRs from before it existed show their title).
 * @param {string | null | undefined} body
 * @returns {string[] | undefined}
 */
export function whatsNewLines(body) {
  const changes = section(body)
  return changes && isNone(changes) ? [] : changes
}

/**
 * Why a PR description isn't ready to merge, or `undefined` when it is: it needs the section,
 * filled in with changes or "none".
 * @param {string | null | undefined} body
 * @returns {string | undefined}
 */
export function whatsNewProblem(body) {
  const changes = section(body)
  if (!changes) return `The PR description needs a "## What's New" section (.github/pull_request_template.md).`
  if (!changes.length) return `The "What's New" section is empty: one line per change, in words for YARC users, or "none" for changes they won't notice.`
  return undefined
}

if (process.argv[2] === '--check') {
  const body = process.env.PR_BODY
  const problem = whatsNewProblem(body)
  if (problem) {
    console.log(`::error::${problem}`)
    process.exit(1)
  }
  const changes = whatsNewLines(body) ?? []
  console.log(changes.length ? `What's New:\n${changes.map((c) => `  - ${c}`).join('\n')}` : "Not in What's New (none).")
}
