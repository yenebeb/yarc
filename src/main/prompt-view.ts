// The site permission prompt: a small popover pointing at the URL field, over the
// page. Its own little view (not the overlay), so the page stays usable around it and the command
// bar can open without losing the question.
import { WebContentsView, type BrowserWindow, type Event, type Input, type Rectangle } from 'electron'
import { IPC } from '../shared/ipc'
import type { PermissionPrompt, PromptOp } from '../shared/permissions'
import type { PermissionRequest, PromptAnswer } from './permission-queue'
import { handleUi } from './ui-origin'
import { loadRenderer, uiWebPreferences } from './window'

/** The popover's width, plus room around it for the shadow and the arrow. */
export const PROMPT_WIDTH = 236
const MARGIN = 16
const VIEW_WIDTH = PROMPT_WIDTH + 2 * MARGIN
/** How far below the view's top the arrow's tip is drawn (prompt.css). */
const ARROW_TIP = 10
/**
 * Clicks on Allow this soon after the prompt appears don't count, like Chrome's: a page can't
 * get the second click of a double-click it asked for to land on Allow.
 */
const ALLOW_DELAY_MS = 500

/** Where the prompt goes, in window coordinates. */
export type PromptAnchor =
  /** The arrow's tip: the popover hangs below it, centered on it where the window allows. */
  | { arrow: true; x: number; y: number }
  /** The popover's top-left corner, without an arrow (no URL field on screen). */
  | { arrow: false; x: number; y: number }

const views = new Map<number, PromptView>()

export class PromptView {
  private view: WebContentsView | undefined
  private current: PermissionRequest | undefined
  private anchor: PromptAnchor | undefined
  private height = 0
  private attached = false
  private ready = false
  /** When the current question went on screen. */
  private shownAt = 0

  constructor(
    private win: BrowserWindow,
    private onAnswer: (id: string, answer: PromptAnswer) => void,
    private onShortcut: (e: Event, input: Input) => void,
    /** Called after the view (re)joins the window, so the owner can keep its z-order. */
    private onAttach: () => void = () => {}
  ) {
    PromptView.registerIpc()
  }

  private createView(): WebContentsView {
    const view = new WebContentsView({ webPreferences: uiWebPreferences() })
    view.setBackgroundColor('#00000000')
    const wc = view.webContents
    const id = wc.id
    views.set(id, this)
    wc.once('destroyed', () => views.delete(id))
    wc.on('before-input-event', (e, input) => input.key !== 'Escape' && this.onShortcut(e, input))
    this.win.once('closed', () => {
      if (!wc.isDestroyed()) wc.close()
    })
    loadRenderer(wc, 'prompt')
    return view
  }

  get visible(): boolean {
    return this.attached
  }

  /** Shows `req` at `anchor`, or hides the prompt when there's nothing to ask. */
  show(req: PermissionRequest | undefined, anchor?: PromptAnchor): void {
    if (this.win.isDestroyed()) return
    if (!req || !anchor) return this.hide()
    this.view ??= this.createView()
    const changed = req.id !== this.current?.id
    const moved = JSON.stringify(anchor) !== JSON.stringify(this.anchor)
    this.current = req
    this.anchor = anchor
    if (changed) {
      // Wait for the new text's height before showing it.
      this.height = 0
      this.detach()
    }
    if (changed || moved) this.send()
    if (this.height) this.place()
  }

  hide(): void {
    this.current = undefined
    this.anchor = undefined
    this.height = 0
    this.detach()
    this.sendToView(null)
  }

  /** Puts the view back on top of the window's other views. */
  raise(): void {
    if (this.attached && this.view) this.win.contentView.addChildView(this.view)
  }

  private detach(): void {
    if (!this.attached || !this.view) return
    this.attached = false
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(this.view)
  }

  /** The view's left edge: centered on the arrow, kept inside the window. */
  private left(a: PromptAnchor): number {
    const [winWidth] = this.win.getContentSize()
    const wanted = a.arrow ? a.x - VIEW_WIDTH / 2 : a.x - MARGIN
    return Math.round(Math.max(0, Math.min(wanted, winWidth - VIEW_WIDTH)))
  }

  private rect(): Rectangle | undefined {
    const a = this.anchor
    if (!a || !this.height) return undefined
    // With an arrow, its tip (10px below the view's top, in the margin) sits at the anchor.
    return { x: this.left(a), y: Math.round(a.arrow ? a.y - ARROW_TIP : a.y - MARGIN), width: VIEW_WIDTH, height: Math.ceil(this.height) }
  }

  private info(): PermissionPrompt | null {
    const req = this.current
    if (!req) return null
    const a = this.anchor
    // Near the window's edge the popover can't center on the arrow, so the arrow moves instead.
    const arrowX = a?.arrow ? Math.max(MARGIN + 18, Math.min(a.x - this.left(a), VIEW_WIDTH - MARGIN - 18)) : undefined
    return { id: req.id, origin: req.origin, permission: req.permission, mediaTypes: req.mediaTypes, arrowX }
  }

  private send(): void {
    this.sendToView(this.info())
  }

  private sendToView(prompt: PermissionPrompt | null): void {
    const wc = this.view?.webContents
    if (this.ready && wc && !wc.isDestroyed()) wc.send(IPC.prompt, prompt)
  }

  private place(): void {
    const rect = this.rect()
    if (!rect || !this.view || this.win.isDestroyed()) return
    this.view.setBounds(rect)
    const first = !this.attached
    if (first) this.shownAt = Date.now()
    this.attached = true
    this.win.contentView.addChildView(this.view)
    this.onAttach()
    // Like Arc's popover, it takes the keyboard: Escape dismisses it, Tab reaches the buttons.
    if (first) this.view.webContents.focus()
  }

  private op(op: PromptOp): void {
    switch (op.kind) {
      case 'sync':
        this.ready = true
        return this.send()
      case 'size':
        if (op.id !== this.current?.id) return
        this.height = op.height
        return this.place()
      case 'answer':
        if (op.id !== this.current?.id) return
        if (op.answer === 'allow' && (!this.attached || Date.now() - this.shownAt < ALLOW_DELAY_MS)) return
        this.hide()
        return this.onAnswer(op.id, op.answer)
    }
  }

  private static ipcReady = false

  private static registerIpc(): void {
    if (PromptView.ipcReady) return
    PromptView.ipcReady = true
    handleUi(IPC.promptOp, (e, op: PromptOp) => views.get(e.sender.id)?.op(op))
  }
}
