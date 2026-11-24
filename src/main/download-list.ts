import { app, dialog, shell, type BaseWindow, type NativeImage, type Session, type WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DownloadItemInfo, ID } from '../shared/types'
import { hostOf } from '../shared/url'
import { DownloadBurst, isDangerous, markFromInternet } from './downloads'
import { newId } from './store'

export interface DownloadHost {
  toast(text: string): void
  startedByPage(page: WebContents): boolean
  changed(): void
  progressed(): void
}

export class DownloadList {
  items: DownloadItemInfo[] = []
  private burst = new DownloadBurst()
  private icons = new Map<ID, NativeImage>()

  constructor(private host: DownloadHost) {}

  watch(session: Session, profileId: ID): void {
    session.on('will-download', (e, item, wc) => {
      const site = hostOf(wc && !wc.isDestroyed() ? wc.getURL() : item.getURL())
      if (wc && this.host.startedByPage(wc) && !this.burst.allow(`${profileId}|${site}`)) {
        e.preventDefault()
        this.host.toast(`Blocked more downloads from ${site || 'this page'}`)
        return
      }
      const info: DownloadItemInfo = {
        id: newId(),
        filename: item.getFilename(),
        path: '',
        url: item.getURL(),
        state: 'progressing',
        received: 0,
        total: item.getTotalBytes(),
        startedAt: Date.now()
      }
      item.setSavePath(uniquePath(app.getPath('downloads'), item.getFilename()))
      info.path = item.getSavePath()
      this.items.unshift(info)
      this.host.toast(`Downloading ${info.filename}`)
      item.on('updated', (_ev, state) => {
        info.received = item.getReceivedBytes()
        info.total = item.getTotalBytes()
        info.state = state === 'interrupted' ? 'interrupted' : 'progressing'
        this.host.progressed()
      })
      item.once('done', (_ev, state) => {
        info.state = state
        info.received = item.getReceivedBytes()
        if (state === 'completed') {
          markFromInternet(info.path, info.url)
          this.host.toast(`Downloaded ${info.filename}`)
          void app.getFileIcon(info.path).then((icon) => this.icons.set(info.id, icon), () => undefined)
        }
        this.host.changed()
      })
      this.host.changed()
    })
  }

  async open(id: ID, reveal: boolean | undefined, win: BaseWindow): Promise<void> {
    const d = this.items.find((x) => x.id === id)
    if (!d) return
    if (reveal) return shell.showItemInFolder(d.path)
    if (d.state !== 'completed') return
    if (isDangerous(d.filename)) {
      const from = hostOf(d.url)
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        title: 'YARC',
        noLink: true,
        message: `Open “${d.filename}”?`,
        detail: `This kind of file can run programs on your computer${from ? `. It came from ${from}` : ''}. Only open it if you trust where it came from.`,
        buttons: ['Cancel', 'Open'],
        defaultId: 0,
        cancelId: 0
      })
      if (response !== 1) return
    }
    void shell.openPath(d.path)
  }

  /** Synchronous, so the drag starts while the button is still down; the icon was fetched when the download finished. */
  drag(id: ID, page: WebContents): void {
    const d = this.items.find((x) => x.id === id)
    const icon = this.icons.get(id)
    if (d?.state !== 'completed' || !icon || !existsSync(d.path)) return
    page.startDrag({ file: d.path, icon })
  }

  clearFinished(): void {
    this.items = this.items.filter((d) => d.state === 'progressing')
    this.icons = new Map([...this.icons].filter(([id]) => this.items.some((d) => d.id === id)))
    this.host.changed()
  }
}

function uniquePath(dir: string, filename: string): string {
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot) : ''
  let candidate = join(dir, filename)
  for (let i = 1; existsSync(candidate); i++) candidate = join(dir, `${base} (${i})${ext}`)
  return candidate
}
