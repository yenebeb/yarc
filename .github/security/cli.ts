import { readFileSync } from 'node:fs'
import { reserveReview, review, settleReview, type ReviewTarget } from './ai-review.ts'
import { setOutput } from './github.ts'
import { exception, gate } from './pull-request.ts'
import { verifyRelease } from './release.ts'

const [command, ...rest] = process.argv.slice(2)
const options: Record<string, string> = {}
for (let index = 0; index < rest.length; index += 2) options[rest[index].replace(/^--/, '')] = rest[index + 1] ?? ''

const required = (name: string): string => {
  if (!options[name]) throw new Error(`--${name} is missing`)
  return options[name]
}
const target = (): ReviewTarget => {
  const kind = required('kind') === 'release' ? 'release' : 'pr'
  return { kind, pr: kind === 'pr' ? Number(required('pr')) : undefined, head: required('head'), base: required('base') }
}
const actor = (): string => process.env.GITHUB_TRIGGERING_ACTOR || process.env.GITHUB_ACTOR || ''

const commands: Record<string, () => Promise<void> | void> = {
  gate: () => gate(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'))),
  exception: () => exception(Number(required('pr')), actor(), required('reason')),
  reserve: () => {
    const reservation = reserveReview(target())
    setOutput('proceed', reservation.proceed)
    setOutput('id', reservation.id)
    setOutput('reason', reservation.reason)
  },
  review: () => review(target(), required('out')),
  settle: async () => {
    if (!(await settleReview(target(), options.id ?? '', required('result'), options.reason ?? ''))) {
      throw new Error('This commit has no completed AI security review, so it counts as not reviewed')
    }
  },
  'release-verify': () => verifyRelease(required('head'), actor(), options.exception ?? '')
}

if (!commands[command]) throw new Error(`Unknown command "${command}": ${Object.keys(commands).join(', ')}`)
try {
  await commands[command]()
} catch (error) {
  console.error(`::error::${(error as Error).message}`)
  process.exitCode = 1
}
