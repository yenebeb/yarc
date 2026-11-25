// OneDrive as a sync store, through Microsoft Graph: the files sit in YARC's app folder
// (Apps/YARC in the user's OneDrive), the only folder YARC can open (scope Files.ReadWrite.AppFolder).
// No Electron imports, and value imports carry .ts, so unit tests can load it in plain Node.
import type { OAuthSession } from './oauth.ts'
import { requestBody, type RemoteStore } from './remote.ts'

const ROOT = 'https://graph.microsoft.com/v1.0/me/drive/special/approot'
/** Bigger files need an upload session. */
const SIMPLE_UPLOAD = 4 * 1024 * 1024
/** Upload session pieces must be multiples of 320 KiB. */
const UPLOAD_PIECE = 32 * 320 * 1024
const MAX_DEPTH = 3

interface DriveItem {
  name: string
  cTag?: string
  eTag?: string
  folder?: unknown
}

export class OneDriveStore implements RemoteStore {
  private readonly session: OAuthSession

  constructor(session: OAuthSession) {
    this.session = session
  }

  async list(): Promise<Map<string, string>> {
    const files = new Map<string, string>()
    await this.listFolder('', 0, files)
    return files
  }

  async read(path: string): Promise<Buffer> {
    const response = await this.session.fetch(`${item(path)}/content`)
    if (!response.ok) throw await graphError(response, `download ${path}`)
    return Buffer.from(await response.arrayBuffer())
  }

  async write(path: string, data: Buffer): Promise<void> {
    if (data.length <= SIMPLE_UPLOAD) {
      const response = await this.session.fetch(`${item(path)}/content`, { method: 'PUT', body: requestBody(data), headers: { 'Content-Type': 'application/octet-stream' } })
      if (!response.ok) throw await graphError(response, `upload ${path}`)
      return
    }
    const session = await this.session.fetch(`${item(path)}/createUploadSession`, {
      method: 'POST',
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
      headers: { 'Content-Type': 'application/json' }
    })
    if (!session.ok) throw await graphError(session, `upload ${path}`)
    const { uploadUrl } = (await session.json()) as { uploadUrl: string }
    for (let start = 0; start < data.length; start += UPLOAD_PIECE) {
      const piece = data.subarray(start, start + UPLOAD_PIECE)
      // The upload URL carries its own authorization; Graph refuses a bearer token on it.
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        body: requestBody(piece),
        headers: { 'Content-Range': `bytes ${start}-${start + piece.length - 1}/${data.length}` },
        signal: AbortSignal.timeout(120_000)
      })
      if (!response.ok) throw await graphError(response, `upload ${path}`)
    }
  }

  async remove(path: string): Promise<void> {
    const response = await this.session.fetch(item(path), { method: 'DELETE' })
    if (!response.ok && response.status !== 404) throw await graphError(response, `remove ${path}`)
  }

  private async listFolder(folder: string, depth: number, files: Map<string, string>): Promise<void> {
    let url: string | undefined = `${folder ? item(folder) : ROOT}/children?$select=name,cTag,eTag,folder&$top=1000`
    while (url) {
      const response = await this.session.fetch(url)
      if (response.status === 404) return
      if (!response.ok) throw await graphError(response, 'list the sync files')
      const page = (await response.json()) as { value: DriveItem[]; '@odata.nextLink'?: string }
      for (const child of page.value) {
        const path = folder ? `${folder}/${child.name}` : child.name
        if (!child.folder) files.set(path, child.cTag ?? child.eTag ?? '')
        else if (depth < MAX_DEPTH) await this.listFolder(path, depth + 1, files)
      }
      url = page['@odata.nextLink']
    }
  }
}

function item(path: string): string {
  return `${ROOT}:/${path.split('/').map(encodeURIComponent).join('/')}:`
}

async function graphError(response: Response, doing: string): Promise<Error> {
  const body = (await response.json().catch(() => undefined)) as { error?: { message?: string } } | undefined
  return new Error(`OneDrive couldn’t ${doing}: ${body?.error?.message ?? response.status}`)
}
