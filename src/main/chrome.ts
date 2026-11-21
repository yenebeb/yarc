import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

function chromePath(): string | undefined {
  if (process.platform === 'darwin') {
    const app = '/Applications/Google Chrome.app'
    return existsSync(app) ? app : undefined
  }
  if (process.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
    for (const root of roots) {
      if (!root) continue
      const exe = join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')
      if (existsSync(exe)) return exe
    }
    return undefined
  }
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']) if (existsSync(p)) return p
  return undefined
}

export async function openInChrome(url: string): Promise<boolean> {
  const path = chromePath()
  if (!path) return false
  const child =
    process.platform === 'darwin'
      ? spawn('open', ['-a', path, url], { detached: true, stdio: 'ignore' })
      : spawn(path, [url], { detached: true, stdio: 'ignore' })
  child.unref()
  return true
}
