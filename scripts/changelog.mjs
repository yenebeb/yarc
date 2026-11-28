// Writes the changelog that What's New and the update card show: for every release tag, newest first,
// the changes of the PRs merged since the tag before it. A PR's changes are the lines of the
// "What's New" section in its description (scripts/whats-new.mjs; "none" for none), or its title
// for PRs from before the section existed. Dependabot PRs and PRs labeled `release:skip` are left
// out. Every tag gets an entry, also one without changes, so the update card counts every update.
// `thanks` lists, per version that has any, the people outside the project (not the repo owner, not
// a bot) who authored one of its PRs, `release:skip` ones included; the release workflow also
// thanks them on the GitHub release.
// The release workflow runs it before the build (electron.vite.config.ts bakes it into the app) and
// uploads it with the release (src/main/update/updater.ts reads the newest one); without the file, the app
// has an empty changelog.
//
//   node scripts/changelog.mjs [out-file]      (default build/changelog.json; needs git tags and `gh`)
//
// Output: { "0.1.28": ["Add a welcome screen…", …], "0.1.27": [], …, "thanks": { "0.1.28": ["login"] } }
// `thanks` isn't a list of changes, so apps from before it skip it (parseChangelog).
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { whatsNewLines } from './whats-new.mjs'

const out = process.argv[2] ?? 'build/changelog.json'
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const lines = (text) => text.split('\n').filter(Boolean)

const prs = JSON.parse(run('gh', ['pr', 'list', '--state', 'merged', '--base', 'main', '--limit', '5000', '--json', 'number,title,body,labels,author,mergeCommit']))
const owner = run('gh', ['repo', 'view', '--json', 'owner', '--jq', '.owner.login'])
const isContributor = (author) => author && !author.is_bot && author.login !== owner && !/\[bot\]$|^app\/|dependabot|claude/i.test(author.login)

const prByCommit = new Map(prs.filter((pr) => pr.mergeCommit?.oid).map((pr) => [pr.mergeCommit.oid, pr]))
const inWhatsNew = (pr) =>
  !pr.author?.login?.includes('dependabot') &&
  !pr.labels.some((l) => l.name === 'release:skip') &&
  !/^release v?\d+\.\d+/i.test(pr.title) // the old manual "Release 0.1.2" PRs

const tags = lines(run('git', ['tag', '-l', 'v[0-9]*.[0-9]*.[0-9]*', '--sort=v:refname']))
const changelog = {}
const thanks = {}
let previous
for (const tag of tags) {
  const version = tag.slice(1)
  const range = previous ? `${previous}..${tag}` : tag
  const released = lines(run('git', ['log', '--format=%H', range]))
    .map((sha) => prByCommit.get(sha))
    .filter(Boolean)
  changelog[version] = released.filter(inWhatsNew).flatMap((pr) => whatsNewLines(pr.body) ?? [pr.title.trim()])
  const contributors = [...new Set(released.filter((pr) => isContributor(pr.author)).map((pr) => pr.author.login))]
  if (contributors.length) thanks[version] = contributors
  previous = tag
}

// Newest version first, so the file reads like release notes.
const newestFirst = (record) => Object.fromEntries(Object.entries(record).reverse())
const ordered = newestFirst(changelog)
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify({ ...ordered, thanks: newestFirst(thanks) }, null, 2)}\n`)
console.log(`${out}: ${Object.keys(ordered).length} versions, ${Object.values(ordered).flat().length} changes, ${Object.keys(thanks).length} with thanks`)
