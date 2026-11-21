import type { NativeImage, WebContents } from 'electron'

/** 5 a second: enough to follow a video call. */
const STILL_INTERVAL_MS = 200
const MAX_STILL_WIDTH = 1600

export function stillOf(image: NativeImage): string {
  const still = image.getSize().width > MAX_STILL_WIDTH ? image.resize({ width: MAX_STILL_WIDTH }) : image
  return `data:image/jpeg;base64,${still.toJPEG(75).toString('base64')}`
}

interface Subscription {
  unsentFrame?: NativeImage
  pendingSend?: NodeJS.Timeout
  gone: () => void
}

/** Keeps the stills of pages one window shows live and another shows elsewhere up to date. */
export class Mirror {
  private subs = new Map<WebContents, Subscription>()
  private readonly send: (wc: WebContents, still: string) => void

  constructor(send: (wc: WebContents, still: string) => void) {
    this.send = send
  }

  watch(pages: Set<WebContents>): void {
    for (const wc of [...this.subs.keys()]) if (!pages.has(wc)) this.stop(wc)
    for (const wc of pages) if (!this.subs.has(wc) && !wc.isDestroyed()) this.start(wc)
  }

  private start(wc: WebContents): void {
    const sub: Subscription = { gone: () => this.stop(wc) }
    this.subs.set(wc, sub)
    wc.once('destroyed', sub.gone)
    wc.beginFrameSubscription(false, (image) => {
      sub.unsentFrame = image
      sub.pendingSend ??= setTimeout(() => {
        sub.pendingSend = undefined
        const frame = sub.unsentFrame
        sub.unsentFrame = undefined
        if (frame && !frame.isEmpty() && this.subs.get(wc) === sub) this.send(wc, stillOf(frame))
      }, STILL_INTERVAL_MS)
    })
  }

  private stop(wc: WebContents): void {
    const sub = this.subs.get(wc)
    if (!sub) return
    this.subs.delete(wc)
    clearTimeout(sub.pendingSend)
    if (wc.isDestroyed()) return
    wc.off('destroyed', sub.gone)
    wc.endFrameSubscription()
  }
}
