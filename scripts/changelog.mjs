// Writes the changelog that What's New and the update card show: for every release tag, newest first,
// the changes of the PRs merged since the tag before it. A PR's changes are the lines of the
// "What's New" section in its description (scripts/whats-new.mjs; "none" for none), or its title
// for PRs from before the section existed. Dependabot PRs and PRs labeled `release:skip` are left
// out. A change from someone outside the project (not the repo owner, not a bot) ends in
// "(thanks @login)". Every tag gets an entry, also one without changes, so the update card counts every update.
// The release workflow runs it before the build (electron.vite.config.ts bakes it into the app) and
// uploads it with the release (src/main/updater.ts reads the newest one); without the file, the app
// has an empty changelog.
//
//   node scripts/changelog.mjs [out-file]      (default build/changelog.json; needs git tags and `gh`)
//
// Output: { "0.1.28": ["Add a welcome screen…", …], "0.1.27": [], … }
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { whatsNewLines } from './whats-new.mjs'

const out = process.argv[2] ?? 'build/changelog.json'
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const lines = (text) => text.split('\n').filter(Boolean)

const prs = JSON.parse(run('gh', ['pr', 'list', '--state', 'merged', '--base', 'main', '--limit', '5000', '--json', 'number,title,body,labels,author,mergeCommit']))
const owner = run('gh', ['repo', 'view', '--json', 'owner', '--jq', '.owner.login'])
const thanked = (author) => author && !author.is_bot && author.login !== owner && !/\[bot\]$|^app\/|claude/i.test(author.login)
const credit = (pr, change) => (thanked(pr.author) ? `${change} (thanks @${pr.author.login})` : change)

const byCommit = new Map()
for (const pr of prs) {
  if (!pr.mergeCommit?.oid) continue
  if (pr.author?.login?.includes('dependabot')) continue
  if (pr.labels.some((l) => l.name === 'release:skip')) continue
  if (/^release v?\d+\.\d+/i.test(pr.title)) continue // the old manual "Release 0.1.2" PRs
  byCommit.set(pr.mergeCommit.oid, pr)
}

const tags = lines(run('git', ['tag', '-l', 'v[0-9]*.[0-9]*.[0-9]*', '--sort=v:refname']))
const changelog = {}
let previous
for (const tag of tags) {
  const range = previous ? `${previous}..${tag}` : tag
  changelog[tag.slice(1)] = lines(run('git', ['log', '--format=%H', range]))
    .map((sha) => byCommit.get(sha))
    .filter(Boolean)
    .flatMap((pr) => (whatsNewLines(pr.body) ?? [pr.title.trim()]).map((change) => credit(pr, change)))
  previous = tag
}

// Newest version first, so the file reads like release notes.
const ordered = Object.fromEntries(Object.entries(changelog).reverse())
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${JSON.stringify(ordered, null, 2)}\n`)
console.log(`${out}: ${Object.keys(ordered).length} versions, ${Object.values(ordered).flat().length} changes`)
