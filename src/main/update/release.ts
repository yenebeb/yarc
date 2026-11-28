export const LATEST_RELEASE_API = 'https://api.github.com/repos/yenebeb/yarc/releases/latest'
export const RELEASES_PAGE = 'https://github.com/yenebeb/yarc/releases'

export interface GithubRelease {
  tag_name: string
  html_url: string
  assets: { name: string; browser_download_url: string }[]
}

interface Version {
  parts: number[]
  preRelease: string
}

function parseVersion(text: string): Version {
  const v = text.trim().replace(/^v/i, '').split('+')[0]
  const dash = v.indexOf('-')
  const core = dash < 0 ? v : v.slice(0, dash)
  const preRelease = dash < 0 ? '' : v.slice(dash + 1)
  return { parts: core.split('.').map((n) => Number.parseInt(n, 10) || 0), preRelease }
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  if (x.preRelease === y.preRelease) return 0
  if (!x.preRelease) return 1
  if (!y.preRelease) return -1
  return Math.sign(x.preRelease.localeCompare(y.preRelease, 'en', { numeric: true }))
}

export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0
}

export function isReleaseUrl(url: string): boolean {
  return typeof url === 'string' && url.startsWith(`${RELEASES_PAGE}/`)
}

export function releasePage(release: GithubRelease): string {
  return isReleaseUrl(release.html_url) ? release.html_url : RELEASES_PAGE
}

const INSTALLER_EXT: Record<string, string> = { darwin: 'dmg', linux: 'AppImage' }

export function pickDownload(release: GithubRelease, platform: string, arch: string): string {
  const ext = INSTALLER_EXT[platform]
  const asset = ext ? release.assets.find((a) => a.name.endsWith(`-${arch}.${ext}`) && isReleaseUrl(a.browser_download_url)) : undefined
  return asset ? asset.browser_download_url : releasePage(release)
}

export interface MacUpdate {
  name: string
  url: string
  signatureUrl: string
}

export function pickMacUpdate(release: GithubRelease, arch: string): MacUpdate | undefined {
  const zip = release.assets.find((a) => a.name.endsWith(`-${arch}-mac.zip`) && isReleaseUrl(a.browser_download_url))
  const signature = zip && release.assets.find((a) => a.name === `${zip.name}.sig` && isReleaseUrl(a.browser_download_url))
  if (!zip || !signature) return undefined
  return { name: zip.name, url: zip.browser_download_url, signatureUrl: signature.browser_download_url }
}

export function windowsInstallerName(version: string, arch: string): string {
  return `YARC-Setup-${version}-${arch}.exe`
}

export function releaseAssetUrl(version: string, name: string): string {
  return `${RELEASES_PAGE}/download/v${version}/${name}`
}

export async function download(url: string, timeoutMs: number): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`Downloading ${url} failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}
