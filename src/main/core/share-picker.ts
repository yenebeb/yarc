import { desktopCapturer, webContents, type DesktopCapturerSource, type DisplayMediaRequestHandlerHandlerRequest, type Session, type Streams, type WebContents } from 'electron'
import { siteName } from '../../shared/permissions'
import type { OverlayMode } from '../../shared/types'
import { newId } from './store'

const hasSystemAudioCapture = process.platform === 'win32'

type Reply = (streams: Streams | null) => void
type PickerMode = Extract<OverlayMode, { kind: 'share-picker' }>

export class SharePicker {
  private pending: { id: string; sources: Map<string, DesktopCapturerSource>; audio: boolean; reply: Reply } | undefined

  constructor(private show: (mode: PickerMode, page: WebContents | undefined) => void) {}

  answerFor(session: Session): void {
    session.setDisplayMediaRequestHandler((request, reply) => void this.pick(request, reply), { useSystemPicker: true })
  }

  private async pick(req: DisplayMediaRequestHandlerHandlerRequest, reply: Reply): Promise<void> {
    // macOS shows its own picker (useSystemPicker); YARC has none there.
    if (!req.videoRequested || process.platform === 'darwin') return reply(null)
    let sources: DesktopCapturerSource[]
    try {
      sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 } })
    } catch (err) {
      console.warn('[share] no screens or windows to offer', err)
      return reply(null)
    }
    if (!sources.length) return reply(null)
    if (this.pending) this.answer(this.pending.id)
    const id = newId()
    this.pending = { id, sources: new Map(sources.map((s) => [s.id, s])), audio: req.audioRequested, reply }
    this.show(
      {
        kind: 'share-picker',
        id,
        site: siteName(req.securityOrigin),
        systemAudio: req.audioRequested && hasSystemAudioCapture,
        sources: sources.map((s) => ({
          id: s.id,
          name: s.name,
          screen: s.id.startsWith('screen:'),
          thumbnail: s.thumbnail.isEmpty() ? '' : `data:image/jpeg;base64,${s.thumbnail.toJPEG(70).toString('base64')}`
        }))
      },
      req.frame ? webContents.fromFrame(req.frame) : undefined
    )
  }

  /** False when `id` isn't the picker waiting for an answer. */
  answer(id: string, sourceId?: string, systemAudio = false): boolean {
    const pick = this.pending
    if (!pick || pick.id !== id) return false
    this.pending = undefined
    const source = sourceId ? pick.sources.get(sourceId) : undefined
    let streams: Streams | null = null
    if (source) {
      streams = { video: source }
      if (systemAudio && pick.audio && hasSystemAudioCapture) streams.audio = 'loopback'
    }
    try {
      pick.reply(streams)
    } catch (err) {
      console.warn('[share] the page is gone', err)
    }
    return true
  }
}
