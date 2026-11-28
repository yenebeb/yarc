import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync } from 'node:fs'
import { extname, join } from 'node:path'
import { FILE_ID, IMAGE_TYPES, type CanvasImage, type CanvasScene, type InboxItem, type QueuedInboxItem } from '../../shared/canvas.ts'
import { writeFileAtomic } from '../core/atomic-file.ts'

const TRASH_DAYS = 30
const EXT_TYPES: Record<string, string> = Object.fromEntries(Object.entries(IMAGE_TYPES).map(([type, ext]) => [ext, type]))

export function referencedFiles(scene: CanvasScene): Set<string> {
  const ids = new Set<string>()
  for (const item of scene.items) {
    const fileId = item && typeof item === 'object' && 'fileId' in item ? item.fileId : undefined
    if (typeof fileId === 'string') ids.add(fileId)
  }
  return ids
}

export class CanvasFiles {
  readonly id: string
  readonly dir: string
  private readonly root: string
  private readonly images: string

  constructor(root: string, id: string) {
    if (!FILE_ID.test(id)) throw new Error('bad canvas id')
    this.root = root
    this.id = id
    this.dir = join(root, id)
    this.images = join(this.dir, 'images')
  }

  private ensure(): void {
    mkdirSync(this.images, { recursive: true, mode: 0o700 })
  }

  readScene(): CanvasScene | undefined {
    try {
      const scene = JSON.parse(readFileSync(join(this.dir, 'canvas.json'), 'utf8'))
      return scene && Array.isArray(scene.items) ? scene : undefined
    } catch {
      return undefined
    }
  }

  /** Saves the board, then deletes images no item shows any more (unless they wait in the inbox). */
  writeScene(scene: CanvasScene): void {
    this.ensure()
    writeFileAtomic(join(this.dir, 'canvas.json'), JSON.stringify(scene))
    const used = referencedFiles(scene)
    for (const item of this.readInbox()) if ('fileId' in item) used.add(item.fileId)
    for (const name of this.imageNames()) {
      if (!used.has(name.slice(0, -extname(name).length))) rmSync(join(this.images, name), { force: true })
    }
  }

  private imageNames(): string[] {
    try {
      return readdirSync(this.images).filter((n) => !n.endsWith('.tmp'))
    } catch {
      return []
    }
  }

  readImages(only?: Set<string>): Record<string, CanvasImage> {
    const out: Record<string, CanvasImage> = {}
    for (const name of this.imageNames()) {
      const ext = extname(name).slice(1)
      const mimeType = EXT_TYPES[ext]
      if (!mimeType || (only && !only.has(name.slice(0, -ext.length - 1)))) continue
      const data = readFileSync(join(this.images, name))
      out[name.slice(0, -ext.length - 1)] = { mimeType, dataURL: `data:${mimeType};base64,${data.toString('base64')}` }
    }
    return out
  }

  hasImage(fileId: string): boolean {
    return this.imageNames().some((n) => n.startsWith(`${fileId}.`))
  }

  addImage(bytes: Buffer, mimeType: string): string {
    const fileId = createHash('sha256').update(bytes).digest('hex')
    this.writeImage(fileId, bytes, mimeType)
    return fileId
  }

  writeImage(fileId: string, bytes: Buffer, mimeType: string): void {
    const ext = IMAGE_TYPES[mimeType]
    if (!ext || !FILE_ID.test(fileId)) throw new Error(`unsupported image ${mimeType}`)
    this.ensure()
    const file = join(this.images, `${fileId}.${ext}`)
    if (!existsSync(file)) writeFileAtomic(file, bytes)
  }

  pushInbox(item: QueuedInboxItem): void {
    this.ensure()
    const inbox = this.readInbox()
    inbox.push(item)
    writeFileAtomic(join(this.dir, 'inbox.json'), JSON.stringify(inbox))
  }

  private readInbox(): QueuedInboxItem[] {
    try {
      const list = JSON.parse(readFileSync(join(this.dir, 'inbox.json'), 'utf8'))
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }

  takeInbox(): InboxItem[] {
    const queued = this.readInbox()
    if (!queued.length) return []
    rmSync(join(this.dir, 'inbox.json'), { force: true })
    const images = this.readImages(new Set(queued.flatMap((item) => ('fileId' in item ? [item.fileId] : []))))
    return queued.flatMap((item): InboxItem[] => {
      if (!('fileId' in item)) return [item]
      const image = images[item.fileId]
      return image ? [{ ...item, dataURL: image.dataURL }] : []
    })
  }

  trash(): void {
    if (!existsSync(this.dir)) return
    const trash = join(this.root, '.trash')
    mkdirSync(trash, { recursive: true, mode: 0o700 })
    rmSync(join(trash, this.id), { recursive: true, force: true })
    renameSync(this.dir, join(trash, this.id))
    // The trash's age is the folder's modification time: when it was deleted, not last edited.
    const now = new Date()
    utimesSync(join(trash, this.id), now, now)
  }

  remove(): void {
    rmSync(this.dir, { recursive: true, force: true })
  }

  restore(): void {
    const from = join(this.root, '.trash', this.id)
    if (existsSync(from) && !existsSync(this.dir)) renameSync(from, this.dir)
  }
}

export function emptyOldTrash(root: string, now = Date.now()): void {
  const trash = join(root, '.trash')
  let names: string[]
  try {
    names = readdirSync(trash)
  } catch {
    return
  }
  for (const name of names) {
    const dir = join(trash, name)
    try {
      if (now - statSync(dir).mtimeMs > TRASH_DAYS * 86_400_000) rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
}
