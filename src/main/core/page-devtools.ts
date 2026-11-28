// What YARC asks of a page through the DevTools protocol; nothing else attaches a debugger.
import type { WebContents } from 'electron'
import { logError } from './log'

/** Past this many CSS pixels a screenshot outgrows the GPU's largest texture. */
const MAX_PAGE_HEIGHT = 12000

/** `capturePage` only sees what's on screen; DevTools' protocol lays the whole page out for one shot. */
export async function wholePage(wc: WebContents): Promise<{ png: Buffer; width: number; height: number } | undefined> {
  const attached = wc.debugger.isAttached()
  try {
    if (!attached) wc.debugger.attach('1.3')
    const { cssContentSize: content } = await wc.debugger.sendCommand('Page.getLayoutMetrics')
    const width = Math.ceil(content.width)
    const height = Math.min(Math.ceil(content.height), MAX_PAGE_HEIGHT)
    const clip = { x: 0, y: 0, width, height, scale: 1 }
    const { data } = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip })
    const zoom = wc.getZoomFactor()
    return { png: Buffer.from(data, 'base64'), width: Math.round(width * zoom), height: Math.round(height * zoom) }
  } catch (err) {
    logError('canvas: whole page', err)
    return undefined
  } finally {
    if (!attached && wc.debugger.isAttached()) wc.debugger.detach()
  }
}

/** `metrics`: the parameters of Emulation.setDeviceMetricsOverride. False when the debugger couldn't attach. */
export function emulateDeviceMetrics(wc: WebContents, metrics: object): boolean {
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
  } catch {
    return false
  }
  wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', metrics).catch(() => {})
  return true
}
