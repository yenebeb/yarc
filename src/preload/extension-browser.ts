// electron-chrome-extensions adds its APIs to `chrome` only; extensions using `browser.*` (1Password) would crash.
import { contextBridge } from 'electron'

function shareChromeApis(): void {
  const { chrome, browser } = globalThis as unknown as { chrome?: Record<string, unknown>; browser?: Record<string, unknown> }
  if (!chrome || !browser || browser === chrome) return
  for (const key of Object.keys(chrome)) {
    if (browser[key] === chrome[key]) continue
    try {
      Object.defineProperty(browser, key, { value: chrome[key], enumerable: true, configurable: true })
    } catch {}
  }
}

if (process.type === 'service-worker' || location.href.startsWith('chrome-extension://')) {
  contextBridge.executeInMainWorld({ func: shareChromeApis })
}
