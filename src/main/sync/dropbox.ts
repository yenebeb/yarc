// Dropbox as a sync store: the files sit in YARC's app folder (Apps/YARC in the user's Dropbox),
// the only folder an app-folder app can open.
// No Electron imports, and value imports carry .ts, so unit tests can load it in plain Node.
import type { OAuthSession } from './oauth.ts'
import { requestBody, type RemoteStore } from './remote.ts'

const API = 'https://api.dropboxapi.com/2'
const CONTENT = 'https://content.dropboxapi.com/2'

interface ListResult {
  entries: { '.tag': string; path_display: string; content_hash?: string; rev?: string }[]
  cursor: string
  has_more: boolean
}

export class DropboxStore implements RemoteStore {
  private readonly session: OAuthSession

  constructor(session: OAuthSession) {
    this.session = session
  }

  async list(): Promise<Map<string, string>> {
    const files = new Map<string, string>()
    let page = await this.call<ListResult>('files/list_folder', { path: '', recursive: true }, 'list the sync files')
    for (;;) {
      for (const entry of page.entries) if (entry['.tag'] === 'file') files.set(entry.path_display.replace(/^\//, ''), entry.content_hash ?? entry.rev ?? '')
      if (!page.has_more) return files
      page = await this.call<ListResult>('files/list_folder/continue', { cursor: page.cursor }, 'list the sync files')
    }
  }

  async read(path: string): Promise<Buffer> {
    const response = await this.session.fetch(`${CONTENT}/files/download`, { method: 'POST', headers: { 'Dropbox-API-Arg': JSON.stringify({ path: `/${path}` }) } })
    if (!response.ok) throw await dropboxError(response, `download ${path}`)
    return Buffer.from(await response.arrayBuffer())
  }

  async write(path: string, data: Buffer): Promise<void> {
    const response = await this.session.fetch(`${CONTENT}/files/upload`, {
      method: 'POST',
      body: requestBody(data),
      headers: { 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({ path: `/${path}`, mode: 'overwrite', mute: true }) }
    })
    if (!response.ok) throw await dropboxError(response, `upload ${path}`)
  }

  async remove(path: string): Promise<void> {
    const response = await this.session.fetch(`${API}/files/delete_v2`, { method: 'POST', body: JSON.stringify({ path: `/${path}` }), headers: { 'Content-Type': 'application/json' } })
    if (!response.ok && !(await isNotFound(response))) throw await dropboxError(response, `remove ${path}`)
  }

  /** The signed-in account's email, to show in Settings. */
  async email(): Promise<string | undefined> {
    const account = await this.call<{ email?: string }>('users/get_current_account', null, 'read the account').catch(() => undefined)
    return account?.email
  }

  private async call<T>(endpoint: string, argument: unknown, doing: string): Promise<T> {
    const response = await this.session.fetch(`${API}/${endpoint}`, {
      method: 'POST',
      body: argument === null ? undefined : JSON.stringify(argument),
      headers: argument === null ? {} : { 'Content-Type': 'application/json' }
    })
    // An empty app folder: Dropbox creates it with the first upload.
    if (endpoint === 'files/list_folder' && (await isNotFound(response.clone()))) return { entries: [], cursor: '', has_more: false } as T
    if (!response.ok) throw await dropboxError(response, doing)
    return (await response.json()) as T
  }
}

async function isNotFound(response: Response): Promise<boolean> {
  if (response.status !== 409) return false
  const body = (await response.json().catch(() => ({}))) as { error_summary?: string }
  return body.error_summary?.includes('not_found') ?? false
}

async function dropboxError(response: Response, doing: string): Promise<Error> {
  const body = await response.text().catch(() => '')
  let summary = body
  try {
    summary = JSON.parse(body).error_summary ?? body
  } catch {}
  return new Error(`Dropbox couldn’t ${doing}: ${summary || response.status}`)
}
