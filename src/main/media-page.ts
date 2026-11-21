// The scripts run in an isolated world: the page's scripts can't see or replace them, though they share the DOM.
import type { WebContents } from 'electron'

const ISOLATED_WORLD = 1099
const MEDIA = 'data-yarc-media'
const FLOAT = 'data-yarc-float'
/** So YARC removes only a popover attribute it added. */
const OWN_POPOVER = 'data-yarc-popover'

/** A popover sits in the top layer, outside every ancestor's transform and overflow, whatever the site's player looks like. */
export const FLOAT_CSS = `
video[${FLOAT}]:popover-open {
  position: fixed !important; inset: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important;
  width: 100vw !important; height: 100vh !important; max-width: none !important; max-height: none !important;
  min-width: 0 !important; min-height: 0 !important; transform: none !important; translate: none !important; scale: none !important;
  object-fit: contain !important; background: #000 !important; opacity: 1 !important; visibility: visible !important;
  clip-path: none !important; filter: none !important; overflow: hidden !important;
}
video[${FLOAT}]::backdrop { background: #000 !important; }
html:has(video[${FLOAT}]) { overflow: hidden !important; }
`

const PLAYING_VIDEO = `
const playingVideo = () => {
  const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height }
  return [...document.querySelectorAll('video')]
    .filter((v) => !v.paused && !v.ended && v.readyState >= 2 && v.videoWidth > 0 && !v.disablePictureInPicture)
    .sort((a, b) => area(b) - area(a))[0]
}
const playingMedia = () => playingVideo() || [...document.querySelectorAll('video, audio')].find((m) => !m.paused && !m.ended)
const marked = () => document.querySelector('[${MEDIA}]')
`

export interface VideoSize {
  width: number
  height: number
}

const PROBE = `(() => {${PLAYING_VIDEO}
  const media = playingMedia()
  if (!media) return null
  for (const m of document.querySelectorAll('[${MEDIA}]')) if (m !== media) m.removeAttribute('${MEDIA}')
  media.setAttribute('${MEDIA}', '')
  return media instanceof HTMLVideoElement && media === playingVideo() ? { width: media.videoWidth, height: media.videoHeight } : 'audio'
})()`

/** Pages close the popover now and then (YouTube moves its video in the DOM), so it opens again at once. */
const LIFT = `(() => {${PLAYING_VIDEO}
  const old = marked()
  const v = old instanceof HTMLVideoElement && old.isConnected ? old : playingVideo()
  if (!v) return null
  if (v !== old) { old?.removeAttribute('${MEDIA}'); v.setAttribute('${MEDIA}', '') }
  v.setAttribute('${FLOAT}', '')
  if (!v.hasAttribute('popover')) { v.setAttribute('popover', 'manual'); v.setAttribute('${OWN_POPOVER}', '') }
  if (!v.yarcKeepsOpen) {
    v.yarcKeepsOpen = true
    v.addEventListener('toggle', (e) => {
      if (e.newState !== 'closed') return
      requestAnimationFrame(() => {
        try { if (v.isConnected && v.hasAttribute('${FLOAT}') && !v.matches(':popover-open')) v.showPopover() } catch {}
      })
    })
  }
  try { if (!v.matches(':popover-open')) v.showPopover() } catch { return null }
  return { width: v.videoWidth, height: v.videoHeight }
})()`

const LOWER = `(() => {
  for (const v of document.querySelectorAll('[${FLOAT}]')) {
    try { if (v.matches(':popover-open')) v.hidePopover() } catch {}
    if (v.hasAttribute('${OWN_POPOVER}')) { v.removeAttribute('popover'); v.removeAttribute('${OWN_POPOVER}') }
    v.removeAttribute('${FLOAT}')
  }
})()`

const control = (body: string): string => `(() => {${PLAYING_VIDEO}
  const m = marked() || playingMedia()
  if (!m) return null
  ${body}
  return !m.paused
})()`

const run = <T>(wc: WebContents, code: string): Promise<T | null> => {
  if (wc.isDestroyed()) return Promise.resolve(null)
  // A user gesture, so play() is allowed after the page lost its own activation.
  return wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code }], true).then(
    (r) => (r ?? null) as T | null,
    () => null
  )
}

export const probeMedia = (wc: WebContents) => run<VideoSize | 'audio'>(wc, PROBE)
export const liftVideo = (wc: WebContents) => run<VideoSize>(wc, LIFT)
export const lowerVideo = (wc: WebContents) => run<void>(wc, LOWER)
/** Resolve to whether the media now plays (null: no media). */
export const toggleMedia = (wc: WebContents) => run<boolean>(wc, control('if (m.paused) void m.play().catch(() => {}); else m.pause()'))
export const pauseMedia = (wc: WebContents) => run<boolean>(wc, control('m.pause()'))
export const skipMedia = (wc: WebContents, seconds: number) =>
  run<boolean>(wc, control(`m.currentTime = Math.max(0, Math.min(m.duration || Infinity, m.currentTime + (${Number(seconds) || 0})))`))
