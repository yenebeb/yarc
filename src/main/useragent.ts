/** Drops only the app-name token: Google sign-in rejects a Chrome UA without Chrome's client hints (docs/electron-notes.md). */
export function browserUserAgent(fallback: string): string {
  return fallback.replace(/\(KHTML, like Gecko\) .*?Chrome\//, '(KHTML, like Gecko) Chrome/')
}

/** Teams reads "Electron/" as its own desktop app: meeting links redirect to a path only the app serves. */
const TEAMS_HOSTS = ['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft']
/** eBay's bot check refuses search to a browser whose UA says Electron or that sends no client hints. */
const EBAY_DOMAINS = ['ebay.com', 'ebay.ca', 'ebay.co.uk', 'ebay.com.au', 'ebay.de', 'ebay.fr', 'ebay.it', 'ebay.es', 'ebay.nl', 'ebay.be', 'ebay.at', 'ebay.ch', 'ebay.ie', 'ebay.pl']

export const CHROME_IDENTITY_URLS = [...TEAMS_HOSTS.map((host) => `*://${host}/*`), ...EBAY_DOMAINS.flatMap((domain) => [`*://${domain}/*`, `*://*.${domain}/*`])]

function wantsChromeIdentity(url: string): boolean {
  const host = URL.parse(url)?.hostname
  if (!host) return false
  return TEAMS_HOSTS.includes(host) || EBAY_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

export function userAgentFor(url: string, ua: string): string {
  return wantsChromeIdentity(url) ? ua.replace(/ Electron\/\S+/, '') : ua
}

const GREASE_CHARACTERS = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_']
const GREASE_VERSIONS = ['8', '99', '24']
const PLATFORM_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

/** Chromium's brand list for a major version: a made-up "GREASE" brand, first for even versions and last for odd ones (checked against Chrome 156, 157 and 158). */
export function chromeBrands(major: number): string {
  const grease = `"Not${GREASE_CHARACTERS[major % 11]}A${GREASE_CHARACTERS[(major + 1) % 11]}Brand";v="${GREASE_VERSIONS[major % 3]}"`
  const chromium = `"Chromium";v="${major}"`
  return major % 2 === 0 ? `${grease}, ${chromium}` : `${chromium}, ${grease}`
}

/** Electron sends none of Chrome's client hints; the sites that want Chrome's identity get them, as Chrome sends them. */
export function clientHintsFor(url: string, chromeVersion: string, platform: string): Record<string, string> {
  if (!wantsChromeIdentity(url)) return {}
  return { 'sec-ch-ua': chromeBrands(Number.parseInt(chromeVersion, 10)), 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': `"${PLATFORM_NAMES[platform] ?? platform}"` }
}
