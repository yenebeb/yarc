import type { NativeImage, WebContents } from 'electron'

/** How often a mirrored page's still is refreshed at most: 5 a second, enough to follow a video call. */
const INTERVAL = 200

/** A page image as a data URL small enough to send to a window's UI often. */
export function stillOf(image: NativeImage): string {
  const still = image.getSize().width > 1600 ? image.resize({ width: 1600 }) : image
  return `data:image/jpeg;base64,${still.toJPEG(75).toString('base64')}`
}

interface Subscription {
  /** The newest frame not sent yet. */
  latest?: NativeImage
  /** Set while a send is due. */
  timer?: NodeJS.Timeout
  gone: () => void
}

/**
 * Keeps the stills of pages that one window shows live and another shows elsewhere up to date, so
 * a navigation, a scroll or a call's video shows in every window, like Arc. Frames come from
 * Chromium only when the page paints, and are sent at most every INTERVAL ms.
 */
export class Mirror {
  private subs = new Map<WebContents, Subscription>()
  private readonly send: (wc: WebContents, still: string) => void

  constructor(send: (wc: WebContents, still: string) => void) {
    this.send = send
  }

  /** Mirrors exactly these pages, starting and stopping frame subscriptions as needed. */
  watch(pages: Set<WebContents>): void {
    for (const wc of [...this.subs.keys()]) if (!pages.has(wc)) this.stop(wc)
    for (const wc of pages) if (!this.subs.has(wc) && !wc.isDestroyed()) this.start(wc)
  }

  private start(wc: WebContents): void {
    const sub: Subscription = { gone: () => this.stop(wc) }
    this.subs.set(wc, sub)
    wc.once('destroyed', sub.gone)
    wc.beginFrameSubscription(false, (image) => {
      sub.latest = image
      sub.timer ??= setTimeout(() => {
        sub.timer = undefined
        const frame = sub.latest
        sub.latest = undefined
        if (frame && !frame.isEmpty() && this.subs.get(wc) === sub) this.send(wc, stillOf(frame))
      }, INTERVAL)
    })
  }

  private stop(wc: WebContents): void {
    const sub = this.subs.get(wc)
    if (!sub) return
    this.subs.delete(wc)
    clearTimeout(sub.timer)
    if (wc.isDestroyed()) return
    wc.off('destroyed', sub.gone)
    wc.endFrameSubscription()
  }
}
