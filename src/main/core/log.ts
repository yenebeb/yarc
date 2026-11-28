import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { format } from 'node:util'

const MAX_BYTES = 1_000_000

export type Level = 'error' | 'warn' | 'info'

export class LogFile {
  readonly file: string
  private readonly now: () => Date

  constructor(file: string, now: () => Date = () => new Date()) {
    this.file = file
    this.now = now
  }

  write(level: Level, text: string): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      if (sizeOf(this.file) > MAX_BYTES) renameSync(this.file, `${this.file}.old`)
      appendFileSync(this.file, `${this.now().toISOString()} ${level.toUpperCase()} ${text}\n`, { mode: 0o600 })
    } catch {}
  }
}

let log: LogFile | undefined
let describeContext: (() => string) | undefined

export function startLog(file: string): LogFile {
  log = new LogFile(file)
  const printError = console.error.bind(console)
  for (const level of ['error', 'warn'] as const) {
    const print = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      const text = format(...args)
      // handleUi logs these itself, with the action and the windows.
      if (!text.startsWith('Error occurred in handler for ')) log?.write(level, text)
      print(...args)
    }
  }
  // A monitor only watches: Electron still shows its dialog for an uncaught exception.
  process.on('uncaughtExceptionMonitor', (err) => logError('uncaught exception', err))
  // Listening stops Node's own warning, so print it as before.
  process.on('unhandledRejection', (reason) => {
    logError('unhandled promise rejection', reason)
    printError('Unhandled promise rejection:', reason)
  })
  log.write('info', `started, pid ${process.pid}`)
  return log
}

export function setLogContext(describe: () => string): void {
  describeContext = describe
}

/** Doesn't print it. */
export function logError(what: string, err: unknown): void {
  log?.write('error', `${what}: ${describeError(err)}${contextLine()}`)
}

export function logProblem(what: string): void {
  const stack = new Error().stack?.split('\n').slice(2).join('\n') ?? ''
  log?.write('warn', `${what}${contextLine()}\n${stack}`)
}

export function logInfo(text: string): void {
  log?.write('info', text)
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`
  return format(err)
}

function contextLine(): string {
  if (!describeContext) return ''
  try {
    return `\n  context: ${describeContext()}`
  } catch (err) {
    return `\n  context unavailable: ${describeError(err)}`
  }
}

function sizeOf(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}
