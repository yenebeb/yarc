import type { Rectangle, WebContents } from 'electron'
import { IPC } from '../shared/ipc'
import type { SwipeStep } from './swipe-nav'
import type { LiveTab } from './tab'
import type { MainWindow } from './window'

const SETTLE_MS = 200

export interface SwipeTarget {
  tab: LiveTab
  window: { readonly open: boolean; readonly main: MainWindow }
  relayout(): void
}

interface Swipe extends SwipeTarget {
  base: Rectangle
  step: SwipeStep
  offset: number
  progress: number
  timer?: ReturnType<typeof setTimeout>
}

export class PageSwipe {
  private current: Swipe | undefined
  private readonly targetOf: (page: WebContents) => SwipeTarget | undefined

  constructor(targetOf: (page: WebContents) => SwipeTarget | undefined) {
    this.targetOf = targetOf
  }

  /** Slides a tab's page `offset` toward where the swipe goes, uncovering the arrow behind it; false if this browser doesn't show it. */
  show(page: WebContents, step: SwipeStep, offset: number, progress: number): boolean {
    const swipe = this.current?.tab.wc === page ? this.current : this.start(page)
    if (!swipe) return false
    clearTimeout(swipe.timer)
    swipe.step = step
    this.slide(swipe, offset, progress)
    return true
  }

  hide(page: WebContents): void {
    const swipe = this.current
    if (swipe?.tab.wc !== page) return
    clearTimeout(swipe.timer)
    const { offset, progress } = swipe
    const started = Date.now()
    const settle = () => {
      const remaining = (1 - Math.min(1, (Date.now() - started) / SETTLE_MS)) ** 2
      if (remaining === 0 || swipe.tab.destroyed || !swipe.window.open) return this.end()
      this.slide(swipe, offset * remaining, progress * remaining)
      swipe.timer = setTimeout(settle, 16)
    }
    settle()
  }

  private start(page: WebContents): Swipe | undefined {
    const target = this.targetOf(page)
    if (!target) return undefined
    this.end()
    this.current = { ...target, base: target.tab.view.getBounds(), step: 'back', offset: 0, progress: 0 }
    return this.current
  }

  private slide(swipe: Swipe, offset: number, progress: number): void {
    swipe.offset = offset
    swipe.progress = progress
    const { base } = swipe
    const back = swipe.step === 'back'
    swipe.tab.view.setBounds({ ...base, x: base.x + Math.round(back ? offset : -offset) })
    swipe.window.main.ui.send(IPC.swipe, { rect: base, offset, step: swipe.step, progress })
  }

  private end(): void {
    const swipe = this.current
    if (!swipe) return
    clearTimeout(swipe.timer)
    this.current = undefined
    if (!swipe.window.open) return
    swipe.window.main.ui.send(IPC.swipe, null)
    swipe.relayout()
  }
}
