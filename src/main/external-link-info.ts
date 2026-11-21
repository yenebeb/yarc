/** Windows handlers used to run code (Follina), Chrome's denylist, network file systems a page could mount, and our own. */
const BLOCKED = new Set([
  'ms-msdt',
  'search-ms',
  'search',
  'ms-cxh',
  'ms-cxh-full',
  'ms-officecmd',
  'ms-appinstaller',
  'afp',
  'cifs',
  'data',
  'disk',
  'disks',
  'file',
  'hcp',
  'ie.http',
  'javascript',
  'livescript',
  'mhtml',
  'mocha',
  'ms-help',
  'ms-its',
  'nfs',
  'res',
  'shell',
  'smb',
  'vbscript',
  'view-source',
  'vnd.ms.radio',
  'wysiwyg',
  'yarc'
])

const APPS: Record<string, string> = {
  mailto: 'your email app',
  tel: 'your phone app',
  sms: 'your messages app',
  msteams: 'Microsoft Teams',
  zoommtg: 'Zoom',
  zoomus: 'Zoom',
  slack: 'Slack',
  spotify: 'Spotify',
  discord: 'Discord',
  vscode: 'Visual Studio Code',
  steam: 'Steam',
  figma: 'Figma',
  notion: 'Notion',
  webex: 'Webex',
  facetime: 'FaceTime',
  'ms-settings': 'Windows Settings'
}

export interface ExternalLinkInfo {
  scheme: string
  app: string
  origin: string
  site: string
  blocked: boolean
}

export function externalLinkInfo(url: string, pageUrl: string): ExternalLinkInfo {
  const scheme = (/^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1] ?? '').toLowerCase()
  let origin = ''
  let site = ''
  try {
    const page = new URL(pageUrl)
    if (/^https?:$/.test(page.protocol)) {
      origin = page.origin
      site = page.host
    }
  } catch {}
  return { scheme, app: APPS[scheme] ?? `the ${scheme}: app`, origin, site, blocked: !scheme || BLOCKED.has(scheme) }
}
