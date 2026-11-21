import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Double-clicked .html files (Windows, Linux) arrive as plain paths.
export function urlArg(argv: string[], cwd: string): string | undefined {
  for (const a of argv.slice(1)) {
    if (/^(https?|file):/i.test(a)) return a
    const path = resolve(cwd, a)
    if (/\.(html?|xhtml|svg|pdf)$/i.test(a) && existsSync(path)) return pathToFileURL(path).href
  }
  return undefined
}
