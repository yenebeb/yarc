import { WebContentsView } from 'electron'
import type { LiveTab } from './tab'

interface Docked {
  view: WebContentsView
  forgetOnTabDestroyed: () => void
}

export class DockedDevtools {
  private docked = new Map<LiveTab, Docked>()

  constructor(private onChange: (tab: LiveTab) => void) {}

  viewOf(tab: LiveTab | undefined): WebContentsView | undefined {
    return tab ? this.docked.get(tab)?.view : undefined
  }

  toggle(tab: LiveTab): void {
    if (this.docked.has(tab)) return this.close(tab)
    if (tab.wc.isDevToolsOpened()) return tab.wc.closeDevTools()
    void this.open(tab)
  }

  open(tab: LiveTab): Promise<void> {
    const view = new WebContentsView()
    view.setBorderRadius(8)
    const forgetOnTabDestroyed = () => this.forget(tab, view)
    this.docked.set(tab, { view, forgetOnTabDestroyed })
    tab.wc.setDevToolsWebContents(view.webContents)
    const opened = new Promise<void>((resolve) => tab.wc.once('devtools-opened', () => resolve()))
    tab.wc.once('devtools-closed', () => this.forget(tab, view))
    tab.wc.once('destroyed', forgetOnTabDestroyed)
    tab.wc.openDevTools({ mode: 'detach' })
    this.onChange(tab)
    return opened
  }

  close(tab: LiveTab): void {
    const docked = this.docked.get(tab)
    if (!docked) return
    if (!tab.destroyed) tab.wc.closeDevTools()
    this.forget(tab, docked.view)
  }

  popOut(tab: LiveTab): void {
    const openDetached = (): void => {
      setImmediate(() => !tab.destroyed && tab.wc.openDevTools({ mode: 'detach' }))
    }
    if (!this.docked.has(tab)) return openDetached()
    tab.wc.once('devtools-closed', openDetached)
    this.close(tab)
  }

  async inspect(tab: LiveTab, x: number, y: number): Promise<void> {
    if (!this.docked.has(tab) && !tab.wc.isDevToolsOpened()) await this.open(tab)
    tab.wc.inspectElement(x, y)
  }

  private forget(tab: LiveTab, view: WebContentsView): void {
    const docked = this.docked.get(tab)
    if (docked?.view !== view) return
    this.docked.delete(tab)
    if (!tab.destroyed) tab.wc.off('destroyed', docked.forgetOnTabDestroyed)
    if (!view.webContents.isDestroyed()) view.webContents.close()
    this.onChange(tab)
  }
}
