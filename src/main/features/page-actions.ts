import { clipboard, type WebContents } from 'electron'
import type { Action } from '../../shared/actions'
import { withoutTracking } from '../../shared/url'

export type PageAction = Extract<Action, { type: 'back' | 'forward' | 'reload' | 'stop' | 'zoom' | 'copyUrl' | 'devtools' | 'find' }>

export function runPageAction(wc: WebContents, a: PageAction): string | undefined {
  switch (a.type) {
    case 'back':
      return void (wc.navigationHistory.canGoBack() && wc.navigationHistory.goBack())
    case 'forward':
      return void (wc.navigationHistory.canGoForward() && wc.navigationHistory.goForward())
    case 'reload':
      return void (a.hard ? wc.reloadIgnoringCache() : wc.reload())
    case 'stop':
      return void wc.stop()
    case 'zoom': {
      const level = a.delta === 0 ? 0 : Math.max(-6, Math.min(9, wc.getZoomLevel() + a.delta * 0.5))
      wc.setZoomLevel(level)
      return `Zoom ${Math.round(Math.pow(1.2, level) * 100)}%`
    }
    case 'copyUrl': {
      const url = withoutTracking(wc.getURL())
      clipboard.writeText(a.markdown ? `[${wc.getTitle()}](${url})` : url)
      return a.markdown ? 'Copied URL as Markdown' : 'Copied URL'
    }
    case 'devtools':
      return void (wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' }))
    case 'find':
      if (!a.query) return void wc.stopFindInPage('clearSelection')
      return void wc.findInPage(a.query, { forward: a.forward ?? true, findNext: a.findNext ?? false })
  }
}
