// A WebDAV server as a sync store: Nextcloud, ownCloud, a Synology or QNAP NAS, a Hetzner Storage
// Box, `rclone serve webdav`… The files go in a "YARC Sync" folder inside the folder the user names.
// No Electron imports, and value imports carry .ts, so unit tests can load it in plain Node.
import { requestBody, SignedOutError, type RemoteStore } from './remote.ts'

export interface ServerOptions {
  url: string
  username: string
  password: string
  fetch?: typeof fetch
}

const FOLDER = 'YARC Sync'
/** sync.json, then the folders the sync writes, three levels deep at most (history/<profile>/<device>/). */
const MAX_DEPTH = 3
const TIMEOUT = 60_000

export class WebDavStore implements RemoteStore {
  /** The folder the user named, normalized; the files go in its YARC Sync folder. */
  readonly folderUrl: string
  private readonly base: URL
  private readonly authorization: string
  private readonly fetch: typeof fetch
  private readonly folders = new Set<string>()

  constructor(options: ServerOptions) {
    this.folderUrl = serverFolder(options.url).href
    this.base = new URL(`${FOLDER}/`, this.folderUrl)
    this.authorization = `Basic ${Buffer.from(`${options.username}:${options.password}`).toString('base64')}`
    this.fetch = options.fetch ?? fetch
  }

  /** Checks the address and password, and creates the YARC Sync folder. */
  async connect(): Promise<void> {
    const response = await this.request('PROPFIND', new URL('..', this.base), { headers: { Depth: '0' } })
    if (response.status === 404) throw new Error('The server has no folder at that address.')
    if (!response.ok && response.status !== 207) throw new Error(`The server answered ${response.status} ${response.statusText}. Is this a WebDAV address?`)
    await this.makeFolder('')
  }

  async list(): Promise<Map<string, string>> {
    const files = new Map<string, string>()
    await this.listFolder('', 0, files)
    return files
  }

  async read(path: string): Promise<Buffer> {
    const response = await this.request('GET', this.url(path))
    if (!response.ok) throw new Error(`Couldn’t download ${path} from the server (${response.status}).`)
    return Buffer.from(await response.arrayBuffer())
  }

  async write(path: string, data: Buffer): Promise<void> {
    let response = await this.request('PUT', this.url(path), { body: requestBody(data), headers: { 'Content-Type': 'application/octet-stream' } })
    if (response.status === 409 || response.status === 404) {
      await this.makeParents(path)
      response = await this.request('PUT', this.url(path), { body: requestBody(data), headers: { 'Content-Type': 'application/octet-stream' } })
    }
    if (!response.ok) throw new Error(`Couldn’t upload ${path} to the server (${response.status}).`)
  }

  async remove(path: string): Promise<void> {
    const response = await this.request('DELETE', this.url(path))
    if (!response.ok && response.status !== 404) throw new Error(`Couldn’t remove ${path} from the server (${response.status}).`)
  }

  private async listFolder(folder: string, depth: number, files: Map<string, string>): Promise<void> {
    const response = await this.request('PROPFIND', this.url(folder), {
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>'
    })
    if (response.status === 404) return
    if (response.status !== 207) throw new Error(`The server couldn’t list the sync folder (${response.status}).`)
    for (const entry of parseMultistatus(await response.text())) {
      const path = this.pathOf(entry.href)
      if (path === undefined || path === folder.replace(/\/$/, '')) continue
      if (!entry.folder) files.set(path, entry.version)
      else if (depth < MAX_DEPTH) {
        this.folders.add(path)
        await this.listFolder(`${path}/`, depth + 1, files)
      }
    }
  }

  private async makeParents(path: string): Promise<void> {
    const parts = path.split('/').slice(0, -1)
    for (let index = 1; index <= parts.length; index++) await this.makeFolder(parts.slice(0, index).join('/'))
  }

  private async makeFolder(folder: string): Promise<void> {
    if (this.folders.has(folder)) return
    const response = await this.request('MKCOL', this.url(folder ? `${folder}/` : ''))
    // 405: it's already there.
    if (!response.ok && response.status !== 405) throw new Error(`Couldn’t create a folder on the server (${response.status}).`)
    this.folders.add(folder)
  }

  private url(path: string): URL {
    return new URL(path, this.base)
  }

  /** A path in the sync folder from an href in the server's answer; undefined outside it. */
  private pathOf(href: string): string | undefined {
    const pathname = decodeURIComponent(new URL(href, this.base).pathname)
    const base = decodeURIComponent(this.base.pathname)
    if (!pathname.startsWith(base)) return undefined
    return pathname.slice(base.length).replace(/\/$/, '')
  }

  private async request(method: string, url: URL, init: { headers?: Record<string, string>; body?: string | Uint8Array<ArrayBuffer> } = {}): Promise<Response> {
    const response = await this.fetch(url, {
      method,
      headers: { Authorization: this.authorization, ...init.headers },
      body: init.body,
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT)
    })
    if (response.status === 401 || response.status === 403) throw new SignedOutError('The server refused the user name or password.')
    return response
  }
}

/**
 * The folder URL the user typed, ending in a slash. Plain http only on this computer or the local
 * network: anywhere else it would send the server password in the clear.
 */
export function serverFolder(typed: string): URL {
  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(typed.trim()) ? typed.trim() : `https://${typed.trim()}`)
  } catch {
    throw new Error('That isn’t a web address.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The address must start with https://.')
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) throw new Error('Use an https:// address: over plain http, the server password would cross the internet unencrypted.')
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  url.search = ''
  url.hash = ''
  return url
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '')
  return (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/i.test(host)
  )
}

interface DavEntry {
  href: string
  folder: boolean
  version: string
}

/** The entries of a PROPFIND answer. Servers differ in namespace prefixes, so tags match with any prefix. */
export function parseMultistatus(xml: string): DavEntry[] {
  const tag = (name: string) => new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([^<]*)<`, 'i')
  return xml
    .split(/<(?:[\w-]+:)?response\b[^>]*>/i)
    .slice(1)
    .map((response) => {
      const field = (name: string) => decodeEntities(tag(name).exec(response)?.[1]?.trim() ?? '')
      return {
        href: field('href'),
        folder: /<(?:[\w-]+:)?collection\b/i.test(response),
        version: field('getetag') || `${field('getlastmodified')}|${field('getcontentlength')}`
      }
    })
    .filter((entry) => entry.href)
}

function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_entity, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name]!)
}
