import type { BrowserWindowConstructorOptions, ContextMenuParams, Event, Input, Result } from 'electron'
import { getDomain } from 'tldts-experimental'
import { matches } from '../../shared/keymap'
import type { Browser } from '../browser'
import { buildContextMenu } from './menus'
import type { ProfileRuntime } from '../core/profiles'
import { LiveTab, type OpenDisposition, type TabHost } from '../core/tab'

export class Peek implements TabHost {
  readonly tab: LiveTab
  private done = false

  constructor(
    private browser: Browser,
    profile: ProfileRuntime,
    url: string
  ) {
    this.tab = new LiveTab(this, 'peek', profile.id, profile.session, url)
    browser.extensions.addTab(this.tab, browser.window.win)
  }

  release(): LiveTab {
    this.done = true
    this.tab.host = this.browser
    return this.tab
  }

  destroy(): void {
    this.done = true
    this.tab.destroy()
  }

  onTabChanged = (tab: LiveTab, change: { url?: string; navigated?: boolean }) => this.browser.onPeekChanged(tab, change)
  onFoundInPage = (tab: LiveTab, result: Result) => this.browser.onFoundInPage(tab, result)
  adoptOpenedPage = (opener: LiveTab, options: BrowserWindowConstructorOptions | undefined, disposition: OpenDisposition, url: string) =>
    this.browser.adoptOpenedPage(opener, options, disposition, url)
  onTabFocus(): void {}

  onTabInput(_tab: LiveTab, e: Event, input: Input): void {
    if (input.type === 'keyDown' && matches(input, process.platform === 'darwin' ? 'Cmd+O' : 'Ctrl+O')) {
      e.preventDefault()
      return this.browser.expandPeek()
    }
    this.browser.handleInput(e, input)
  }

  onTabDestroyed(): void {
    const pageClosedItself = !this.done
    if (pageClosedItself) this.browser.closePeek()
  }

  onTabFullscreen(tab: LiveTab, on: boolean): void {
    // A real tab owns the full-screen layout.
    if (!on) return
    this.browser.expandPeek()
    this.browser.onTabFullscreen(tab, on)
  }

  showContextMenu(tab: LiveTab, params: ContextMenuParams): void {
    buildContextMenu(this.browser, tab, params).popup({ window: this.browser.window.win })
  }
}

/** mail.google.com and calendar.google.com are one site. */
export function sameSite(a: string, b: string): boolean {
  const site = (url: string) => {
    return getDomain(url) ?? URL.parse(url)?.hostname ?? url
  }
  return site(a) === site(b)
}
