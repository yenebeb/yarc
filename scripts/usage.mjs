// GitHub keeps only running download totals, so the daily workflow (usage.yml) records them and turns the
// differences into counts. Usage: node scripts/usage.mjs <counts.csv> <assets.json>; prints a Markdown summary.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { isoWeek, usageFiles } from '../src/main/usage.ts'

const LABELS = {
  'darwin-arm64': 'macOS, Apple silicon',
  'darwin-x64': 'macOS, Intel',
  'win32-x64': 'Windows, x64',
  'win32-arm64': 'Windows, Arm',
  'linux-x64': 'Linux, x64',
  'linux-arm64': 'Linux, Arm'
}
const DAY = 86_400_000

const [csvPath, assetsPath] = process.argv.slice(2)
const today = new Date().toISOString().slice(0, 10)
const recorded = existsSync(csvPath) ? readFileSync(csvPath, 'utf8').trim().split('\n').slice(1).map(parseRow) : []
const totals = JSON.parse(readFileSync(assetsPath, 'utf8'))
  .filter((a) => usageFiles().includes(a.name))
  .map((a) => ({ date: today, file: a.name, total: a.download_count }))
const rows = [...recorded.filter((r) => r.date !== today), ...totals]
writeFileSync(csvPath, ['date,file,total', ...rows.map((r) => `${r.date},${r.file},${r.total}`)].join('\n') + '\n')
console.log(summary(rows))

function parseRow(line) {
  const [date, file, total] = line.split(',')
  return { date, file, total: Number(total) }
}

/** A snapshot taken just after midnight UTC holds the counts of the day before. */
function countsByDay(rows) {
  const previous = new Map()
  return rows
    .toSorted((a, b) => a.date.localeCompare(b.date))
    .map((r) => {
      const added = r.total - (previous.get(r.file) ?? 0)
      previous.set(r.file, r.total)
      return { day: new Date(Date.parse(r.date) - DAY), file: r.file, added }
    })
}

function summary(rows) {
  const counts = countsByDay(rows)
  const now = Date.parse(today)
  const yesterday = new Date(now - DAY).toISOString().slice(0, 10)
  const lastWeek = isoWeek(new Date(now - 7 * DAY))
  const lastMonth = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 0)).toISOString().slice(0, 7)
  const sum = (platform, count, inPeriod) =>
    counts.filter((c) => c.file === `${platform}-${count}` && inPeriod(c.day)).reduce((n, c) => n + c.added, 0)
  const columns = [
    ['Yesterday', 'daily', (d) => d.toISOString().slice(0, 10) === yesterday],
    [`Last week (${lastWeek})`, 'weekly', (d) => isoWeek(d) === lastWeek],
    [`Last month (${lastMonth})`, 'monthly', (d) => d.toISOString().slice(0, 7) === lastMonth],
    ['New, last 7 days', 'first', (d) => d.getTime() >= now - 7 * DAY]
  ]
  const table = Object.entries(LABELS).map(([platform, label]) => [label, ...columns.map(([, count, inPeriod]) => sum(platform, count, inPeriod))])
  const total = ['**Total**', ...columns.map((_, i) => table.reduce((n, row) => n + row[i + 1], 0))]
  const since = rows.map((r) => r.date).toSorted()[0]
  return [
    `Installs that were open, as counted once a day by YARC itself (README: "What we collect"). Recorded since ${since}; updated ${today}.`,
    '',
    `| | ${columns.map(([title]) => title).join(' | ')} |`,
    `| --- |${columns.map(() => ' ---: |').join('')}`,
    ...[...table, total].map((row) => `| ${row.join(' | ')} |`)
  ].join('\n')
}
