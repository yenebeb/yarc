// Ghostery's preload asks for scriptlets asynchronously, so they ran after a page's first scripts (YouTube's player config, then a restarting video): ask synchronously, before any.
import { ipcRenderer, webFrame } from 'electron'
import { PAGE_IPC } from '../shared/ipc'

if (window === window.top && !location.href.startsWith('devtools://')) {
  const scriptlets: string[] = ipcRenderer.sendSync(PAGE_IPC.adblockScriptlets, location.href) ?? []
  for (const code of scriptlets) webFrame.executeJavaScript(code).catch(() => {})
}
