// Installs per platform, from GitHub's public download counts: every install downloads each update once, from a
// file named for its platform and chip. Usage: node scripts/usage.mjs [weeks] (GITHUB_TOKEN raises the rate limit).
const API = 'https://api.github.com/repos/yenebeb/yarc/releases?per_page=100'
const UPDATES = [
  ['macOS, Apple silicon', /-arm64-mac\.zip$/],
  ['macOS, Intel', /-x64-mac\.zip$/],
  ['Windows, x64', /Setup-.*-x64\.exe$/],
  ['Windows, Arm', /Setup-.*-arm64\.exe$/]
]
const DOWNLOADS = [
  ['New Mac downloads', /\.dmg$/],
  ['Linux downloads', /\.AppImage$/]
]
// Linux checks for updates through the API, so whatever fetched latest-linux.yml is a bot that fetches every file.
const BOTS = /^latest-linux\.yml$/
const DAY = 86_400_000

const weeks = Number(process.argv[2] ?? 8)
const releases = (await allReleases()).filter((r) => !r.draft && !r.prerelease)
const byWeek = Map.groupBy(releases, (r) => isoWeek(new Date(r.published_at)))
const rows = [...byWeek].toSorted(([a], [b]) => b.localeCompare(a)).slice(0, weeks)
console.log(`| Week | ${[...UPDATES, ...DOWNLOADS].map(([title]) => title).join(' | ')} |`)
console.log(`| --- |${' ---: |'.repeat(UPDATES.length + DOWNLOADS.length)}`)
for (const [week, inWeek] of rows) {
  const updates = UPDATES.map(([, file]) => Math.max(0, ...inWeek.map((r) => downloads(r, file))))
  const fresh = DOWNLOADS.map(([, file]) => inWeek.reduce((n, r) => n + downloads(r, file), 0))
  console.log(`| ${week} | ${[...updates, ...fresh].join(' | ')} |`)
}
console.log(`
Updates: the most downloads of one release that week, which is about how many installs were online while it was the newest.
Windows also counts new installs, which download the same file. Downloads: all of that week's releases together.
A bot's downloads (the count of latest-linux.yml) are taken off every file. Linux doesn't update itself, so its installs aren't visible.`)

async function allReleases() {
  const headers = process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}
  const all = []
  for (let page = 1; ; page++) {
    const batch = await (await fetch(`${API}&page=${page}`, { headers })).json()
    if (!Array.isArray(batch)) throw new Error(`GitHub answered: ${batch.message}`)
    all.push(...batch)
    if (batch.length < 100) return all
  }
}

function downloads(release, file) {
  const bots = release.assets.find((a) => BOTS.test(a.name))?.download_count ?? 0
  return release.assets.filter((a) => file.test(a.name)).reduce((n, a) => n + Math.max(0, a.download_count - bots), 0)
}

function isoWeek(date) {
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 4 - (date.getUTCDay() || 7)))
  const year = thursday.getUTCFullYear()
  return `${year}-W${String(Math.ceil(((thursday - Date.UTC(year, 0, 1)) / DAY + 1) / 7)).padStart(2, '0')}`
}
