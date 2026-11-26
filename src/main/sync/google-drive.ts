import type { OAuthSession } from './oauth.ts'
import { requestBody, type RemoteStore } from './remote.ts'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

export class GoogleDriveStore implements RemoteStore {
  private readonly session: OAuthSession
  private readonly ids = new Map<string, string>()

  constructor(session: OAuthSession) {
    this.session = session
  }

  async list(): Promise<Map<string, string>> {
    const files = new Map<string, string>()
    this.ids.clear()
    let pageToken = ''
    do {
      const query = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name,md5Checksum)', pageSize: '1000', orderBy: 'modifiedTime desc' })
      if (pageToken) query.set('pageToken', pageToken)
      const page = (await this.json(`${API}/files?${query}`)) as { nextPageToken?: string; files: { id: string; name: string; md5Checksum?: string }[] }
      for (const file of page.files) {
        // Two computers creating the same file at once leaves two; the newest wins.
        if (this.ids.has(file.name)) continue
        this.ids.set(file.name, file.id)
        files.set(file.name, file.md5Checksum ?? file.id)
      }
      pageToken = page.nextPageToken ?? ''
    } while (pageToken)
    return files
  }

  async read(path: string): Promise<Buffer> {
    const response = await this.session.fetch(`${API}/files/${await this.idOf(path)}?alt=media`)
    if (!response.ok) throw await driveError(response, `download ${path}`)
    return Buffer.from(await response.arrayBuffer())
  }

  async write(path: string, data: Buffer): Promise<void> {
    const id = this.ids.get(path)
    if (id) {
      const response = await this.session.fetch(`${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', body: requestBody(data), headers: { 'Content-Type': 'application/octet-stream' } })
      if (response.ok) return
      if (response.status !== 404) throw await driveError(response, `upload ${path}`)
      this.ids.delete(path)
    }
    const boundary = `yarc${Date.now().toString(16)}`
    const metadata = JSON.stringify({ name: path, parents: ['appDataFolder'] })
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--`)
    ])
    const response = await this.session.fetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      body: requestBody(body),
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }
    })
    if (!response.ok) throw await driveError(response, `upload ${path}`)
    this.ids.set(path, ((await response.json()) as { id: string }).id)
  }

  async remove(path: string): Promise<void> {
    const id = this.ids.get(path)
    if (!id) return
    const response = await this.session.fetch(`${API}/files/${id}`, { method: 'DELETE' })
    if (!response.ok && response.status !== 404) throw await driveError(response, `remove ${path}`)
    this.ids.delete(path)
  }

  private async idOf(path: string): Promise<string> {
    if (!this.ids.has(path)) await this.list()
    const id = this.ids.get(path)
    if (!id) throw new Error(`${path} is no longer in Google Drive.`)
    return id
  }

  private async json(url: string): Promise<unknown> {
    const response = await this.session.fetch(url)
    if (!response.ok) throw await driveError(response, 'list the sync files')
    return response.json()
  }
}

async function driveError(response: Response, doing: string): Promise<Error> {
  const body = (await response.json().catch(() => undefined)) as { error?: { message?: string } } | undefined
  return new Error(`Google Drive couldn’t ${doing}: ${body?.error?.message ?? response.status}`)
}
