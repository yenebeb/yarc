import { ipcMain, systemPreferences, type IpcMainEvent, type Session, type WebContents } from 'electron'
import { join } from 'node:path'

const PRELOAD = join(__dirname, '../preload/swipe-nav.js')
/** Letting go past this goes back or forward: Chrome's threshold for scroll-wheel swipes. */
const COMMIT_PX = 200
/** Swiping this far goes without waiting for the fingers to let go. */
const FORCE_PX = 400
/** At the commit point the page has uncovered half of the 140-point shield behind it, as far as Chrome's comes in. */
const SLIDE = 70 / COMMIT_PX

export type SwipeStep = 'back' | 'forward'

/** Draws a swipe in progress; a page it doesn't show (Peek, a Little Window) still goes, just without the slide. */
export interface SwipeStage {
  /** `progress` reaches 1 where letting go goes. */
  show(page: WebContents, step: SwipeStep, offset: number, progress: number): void
  hide(page: WebContents): void
}

interface SwipeReport {
  id: number
  step: SwipeStep
  dx: number
  /** The page saw the swipe turn into a scroll after all. */
  cancelled: boolean
}

let stage: SwipeStage | undefined
const swiping = new WeakMap<WebContents, SwipeReport>()
const ended = new WeakMap<WebContents, number>()
const watched = new WeakSet<WebContents>()
let listening = false

export function setSwipeStage(s: SwipeStage): void {
  stage = s
}

/** Two-finger page swipes go back and forward where the system says so: macOS's "Swipe between pages", always elsewhere. */
export function swipeToNavigate(ses: Session): void {
  ses.registerPreloadScript({ type: 'frame', filePath: PRELOAD })
  if (listening) return
  listening = true
  ipcMain.on('yarc:swipe', (e: IpcMainEvent, r: unknown) => {
    const page = e.sender
    if (e.senderFrame !== page.mainFrame || !isReport(r) || ended.get(page) === r.id) return
    watchLift(page)
    if (r.cancelled || !canStep(page, r.step)) return release(page, { ...r, dx: 0 })
    swiping.set(page, r)
    if (r.dx >= FORCE_PX) return release(page, r)
    stage?.show(page, r.step, Math.max(0, r.dx) * SLIDE, r.dx / COMMIT_PX)
  })
}

/** Fingers held still keep the swipe where it is: only lifting them, after any momentum, decides. */
function watchLift(page: WebContents): void {
  if (watched.has(page)) return
  watched.add(page)
  // The page can't tell when the fingers leave the trackpad; Chromium ends the scroll gesture then.
  page.on('input-event', (_e, input) => {
    if (input.type !== 'gestureScrollEnd') return
    page.send('yarc:swipe-end')
    const r = swiping.get(page)
    if (r) release(page, r)
  })
}

function release(page: WebContents, r: SwipeReport): void {
  swiping.delete(page)
  ended.set(page, r.id)
  stage?.hide(page)
  if (r.dx < COMMIT_PX || !canStep(page, r.step)) return
  if (r.step === 'back') page.navigationHistory.goBack()
  else page.navigationHistory.goForward()
}

function canStep(page: WebContents, step: SwipeStep): boolean {
  const history = page.navigationHistory
  return twoFingerSwipeOn() && (step === 'back' ? history.canGoBack() : history.canGoForward())
}

function isReport(r: unknown): r is SwipeReport {
  const o = r as Partial<SwipeReport> | null
  return typeof o?.id === 'number' && (o.step === 'back' || o.step === 'forward') && Number.isFinite(o.dx) && typeof o.cancelled === 'boolean'
}

function twoFingerSwipeOn(): boolean {
  return process.platform !== 'darwin' || systemPreferences.isSwipeTrackingFromScrollEventsEnabled()
}
