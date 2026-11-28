import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function profileDir(appData: string, name: string): string {
  const current = join(appData, name)
  const legacy = join(appData, name.replace('YARC', 'Arc Shell'))
  return !existsSync(current) && existsSync(legacy) ? legacy : current
}
