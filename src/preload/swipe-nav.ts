// Chromium's two-finger history swipe is Chrome's code, not Electron's: report the page's sideways scrolls to main, which slides the page and decides when the fingers lift.
import { ipcRenderer } from 'electron'

/** Main says when the fingers lift; without that, a pause this long starts a new gesture. */
const LOST_END_MS = 3000
/** The leftover momentum a page loads into needs no lift to end: it stops by itself. */
const MOMENTUM_GAP_MS = 200
/** A trackpad's first events are tiny and often vertical: wait for this much travel before deciding which way it goes. */
const DECIDE_PX = 10

interface Gesture {
  id: number
  decided: boolean
  step: 'back' | 'forward' | undefined
  x: number
  y: number
  at: number
  reported: boolean
  frame: number
  over: boolean
  gap: number
}

const newGesture = (at: number, decided: boolean, gap: number): Gesture => ({
  id: performance.timeOrigin + at,
  decided,
  step: undefined,
  x: 0,
  y: 0,
  at,
  reported: false,
  frame: 0,
  over: false,
  gap
})
// A swipe's momentum keeps scrolling the page it lands on: that's the end of a gesture already used.
let gesture = newGesture(performance.now(), true, MOMENTUM_GAP_MS)

if (window === window.top) {
  addEventListener('wheel', onWheel, { passive: true })
  ipcRenderer.on('yarc:swipe-end', () => {
    gesture.over = true
  })
}

function onWheel(e: WheelEvent): void {
  if (!e.isTrusted || e.ctrlKey || e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return
  if (gesture.over || e.timeStamp - gesture.at > gesture.gap) gesture = newGesture(e.timeStamp, false, LOST_END_MS)
  const g = gesture
  g.at = e.timeStamp
  g.x += e.deltaX
  g.y += e.deltaY
  if (!g.decided && Math.abs(g.x) + Math.abs(g.y) >= DECIDE_PX) {
    g.decided = true
    const toward = Math.sign(g.x)
    if (Math.abs(g.x) > Math.abs(g.y) && !canScroll(e.target, toward)) g.step = toward < 0 ? 'back' : 'forward'
  }
  if (!g.step) return
  // Chrome's rule for scroll-wheel swipes: one that turns mostly vertical is a scroll after all.
  if (Math.abs(g.y) > 1.5 * Math.abs(g.x) && Math.abs(g.y) > 30) return cancel(g)
  // After the page's own handlers: one that cancels the scroll keeps the gesture for itself.
  setTimeout(() => {
    if (e.defaultPrevented) return cancel(g)
    g.frame ||= requestAnimationFrame(() => {
      g.frame = 0
      report(g)
    })
  })
}

function report(g: Gesture): void {
  if (!g.step) return
  const dx = g.step === 'back' ? -g.x : g.x
  if (!g.reported && dx <= 0) return
  g.reported = true
  ipcRenderer.send('yarc:swipe', { id: g.id, step: g.step, dx, cancelled: false })
}

function cancel(g: Gesture): void {
  if (g.reported && g.step) ipcRenderer.send('yarc:swipe', { id: g.id, step: g.step, dx: 0, cancelled: true })
  g.step = undefined
}

/** Whether what's under the pointer, or anything around it, can still scroll that way: then the swipe scrolls it. */
function canScroll(target: EventTarget | null, toward: number): boolean {
  const root = document.scrollingElement
  for (let el = target instanceof Element ? target : root; el; el = el.parentElement) {
    const scrollable = el === root || /auto|scroll|overlay/.test(getComputedStyle(el).overflowX)
    if (scrollable && scrollsToward(el, toward)) return true
  }
  return false
}

function scrollsToward(el: Element, toward: number): boolean {
  const max = el.scrollWidth - el.clientWidth
  if (max < 1) return false
  const left = getComputedStyle(el).direction === 'rtl' ? max + el.scrollLeft : el.scrollLeft
  return toward < 0 ? left > 0.5 : left < max - 0.5
}
