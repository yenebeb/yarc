import { execFile } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'

const DANGEROUS = new Set([
  'exe', 'msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'bat', 'cmd', 'com', 'scr', 'pif', 'hta', 'js', 'jse', 'vbs', 'vbe',
  'wsf', 'wsh', 'ps1', 'psm1', 'lnk', 'reg', 'cpl', 'msc', 'msp', 'jar', 'appref-ms', 'application', 'url', 'scf', 'chm', 'inf',
  'settingcontent-ms', 'library-ms', 'search-ms', 'searchconnector-ms', 'vhd', 'vhdx',
  'app', 'command', 'tool', 'pkg', 'mpkg', 'terminal', 'workflow', 'scpt', 'scptd', 'applescript', 'fileloc', 'inetloc', 'action',
  'sh', 'bash', 'zsh', 'csh', 'run', 'bin', 'appimage', 'deb', 'rpm', 'desktop', 'py', 'pl', 'rb'
])

export function isDangerous(filename: string): boolean {
  return DANGEROUS.has(extname(filename).slice(1).toLowerCase())
}

/** So Gatekeeper, SmartScreen and Office's Protected View apply. */
export function markFromInternet(path: string, url: string): void {
  if (!existsSync(path)) return
  if (process.platform === 'darwin') {
    execFile('xattr', ['-p', 'com.apple.quarantine', path], (missing) => {
      if (!missing) return
      const value = `0081;${Math.floor(Date.now() / 1000).toString(16)};YARC;`
      execFile('xattr', ['-w', 'com.apple.quarantine', value, path], (err) => err && console.warn('[downloads] quarantine failed', err.message))
    })
  } else if (process.platform === 'win32') {
    const stream = `${path}:Zone.Identifier`
    if (existsSync(stream)) return
    const host = /^https?:/i.test(url) ? `\r\nHostUrl=${url}` : ''
    try {
      writeFileSync(stream, `[ZoneTransfer]\r\nZoneId=3${host}\r\n`)
    } catch (err) {
      console.warn('[downloads] Mark of the Web failed', (err as Error).message)
    }
  }
}

const BURST_MAX = 3
const BURST_MS = 10_000

export class DownloadBurst {
  private recent = new Map<string, number[]>()
  private now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  allow(site: string): boolean {
    const now = this.now()
    const times = (this.recent.get(site) ?? []).filter((t) => now - t < BURST_MS)
    if (times.length >= BURST_MAX) {
      this.recent.set(site, times)
      return false
    }
    times.push(now)
    this.recent.set(site, times)
    return true
  }
}
