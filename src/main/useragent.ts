/** Drops only the app-name token: Google sign-in rejects a Chrome UA without Chrome's client hints (docs/electron-notes.md). */
export function browserUserAgent(fallback: string): string {
  return fallback.replace(/\(KHTML, like Gecko\) .*?Chrome\//, '(KHTML, like Gecko) Chrome/')
}

/** Teams reads "Electron/" as its own desktop app: meeting links redirect to a path only the app serves. */
export const CHROME_UA_HOSTS = ['teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft']

export function userAgentFor(url: string, ua: string): string {
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return ua
  }
  return CHROME_UA_HOSTS.includes(host) ? ua.replace(/ Electron\/\S+/, '') : ua
}
