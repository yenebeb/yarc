// Shared by every e2e spec: the local web server, the built app and helpers to drive it. Run `pnpm build` first; `pnpm test:e2e` does.
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Action } from '../../src/shared/actions'
import type { AppState } from '../../src/shared/types'

export let app: ElectronApplication
export let base = ''
export let userData = ''
/** Every path the server was asked for, in order. */
export const hits: string[] = []
let server: Server
let feedPosts: string[] = []

/** The posts /feed.xml lists from now on. */
export const serveFeed = (posts: string[]) => {
  feedPosts = posts
}

const page = (name: string) =>
  `<!doctype html><title>Page ${name}</title><h1>${name}</h1>` +
  `<a id="blank" href="/child-of-${name}" target="_blank">open child</a>` +
  `<a id="same" href="/next-${name}">same tab</a><p>findme findme findme</p>`

/** A video that plays by itself: a canvas animation, with a quiet tone where the machine has audio. */
const VIDEO_PAGE = `<!doctype html><title>Video page</title><video id="v" style="width:640px;height:360px"></video><script>
const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360; const paint = canvas.getContext('2d')
;(function draw(time) { paint.fillStyle = 'hsl(' + ((time / 20) % 360) + ' 60% 40%)'; paint.fillRect(0, 0, 640, 360); requestAnimationFrame(draw) })(0)
const tracks = canvas.captureStream(30).getVideoTracks()
try { const audio = new AudioContext(); const tone = audio.createOscillator(); const stream = audio.createMediaStreamDestination(); const gain = audio.createGain(); gain.gain.value = 0.01; tone.connect(gain).connect(stream); tone.start(); tracks.push(...stream.stream.getAudioTracks()) } catch {}
const video = document.getElementById('v'); video.srcObject = new MediaStream(tracks); video.play()
</script>`

async function startServer(): Promise<void> {
  server = createServer((req, res) => {
    hits.push(req.url ?? '')
    if (req.url === '/never-loads') return
    if (req.url === '/feed.xml') {
      res.setHeader('content-type', 'application/rss+xml')
      return res.end(`<rss><channel>${feedPosts.map((post) => `<item><title>Post ${post}</title><link>${base}/post-${post}</link></item>`).join('')}</channel></rss>`)
    }
    if (req.url === '/report.txt') {
      res.setHeader('content-disposition', 'attachment; filename="report.txt"')
      return res.end('quarterly numbers')
    }
    res.setHeader('content-type', 'text/html')
    if (req.url === '/blog') return res.end('<!doctype html><title>Blog</title><link rel="alternate" type="application/rss+xml" href="/feed.xml">')
    if (req.url === '/still-loading') return res.end('<!doctype html><title>Still loading</title><script>window.seenByPage = window.scriptlets ?? 0</script><img src="/never-loads">')
    if (req.url === '/dnr-page') return res.end('<!doctype html><title>dnr</title><script src="/dnr-static.js"></script><script src="/dnr-dynamic.js"></script><script src="/dnr-redirect.js"></script><script src="/dnr-kept.js"></script>')
    res.end(req.url === '/video-page' ? VIDEO_PAGE : page((req.url ?? '/').slice(1) || 'home'))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function newUserData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yarc-e2e-'))
  // Fresh, so the app doesn't download the real filter lists.
  mkdirSync(join(dir, 'adblock'))
  writeFileSync(join(dir, 'adblock', 'engine.bin'), ElectronBlocker.parse('||doubleclick.net^\n||googlesyndication.com^').serialize())
  return dir
}

async function launch(): Promise<ElectronApplication> {
  // YARC_EXE runs the suite against a packaged app (e.g. release/win-unpacked/YARC.exe).
  const exe = process.env.YARC_EXE
  const launched = await electron.launch({
    ...(exe ? { executablePath: exe, args: [] } : { args: ['out/main/index.js'] }),
    // Playwright otherwise adds --no-sandbox on Linux, and service-worker preloads (extension APIs) don't run without the sandbox.
    chromiumSandbox: true,
    env: { ...process.env, YARC_USER_DATA: userData, YARC_TEST: '1' }
  })
  await launched.firstWindow()
  await expect.poll(() => launched.evaluate(() => !!(globalThis as { arcBrowser?: unknown }).arcBrowser)).toBe(true)
  return launched
}

/** Gives the calling spec file its own app, profile folder and web server. */
export function useApp(): void {
  test.beforeAll(async () => {
    hits.length = 0
    feedPosts = []
    userData = newUserData()
    await startServer()
    app = await launch()
  })
  test.afterAll(async () => {
    await app?.close()
    server?.closeAllConnections()
    server?.close()
  })
}

/** Quits and starts the app again on the same profile. */
export async function restart(): Promise<void> {
  await app.close()
  app = await launch()
}

export const state = (): Promise<AppState> => app.evaluate(() => (globalThis as any).arcBrowser.snapshot())
export const dispatch = (action: Action) => app.evaluate((_electron, sent) => (globalThis as any).arcBrowser.dispatch(sent), action)
export const space = async () => {
  const current = await state()
  return current.spaces.find((candidate) => candidate.id === current.activeSpaceId)!
}

export const overlayKind = (): Promise<string> => app.evaluate(() => (globalThis as any).arcBrowser.window.overlayMode.kind)

export async function openCommandBar(): Promise<Page> {
  await dispatch({ type: 'overlay', mode: { kind: 'none' } })
  await dispatch({ type: 'overlay', mode: { kind: 'command', target: 'tab' } })
  const overlay = await pageWithUrl('overlay.html')
  // Until the overlay hears the last bar closed, that bar's input stays on the page with what was typed into it.
  await expect(overlay.locator('.command input')).toHaveValue('')
  return overlay
}

export const captureNextMenu = (name: string) =>
  app.evaluate(({ Menu }, name) => {
    const popup = Menu.prototype.popup
    Menu.prototype.popup = function (this: Electron.Menu) {
      ;(globalThis as any)[name] = this
      Menu.prototype.popup = popup
    }
  }, name)

export async function pageWithUrl(fragment: string): Promise<Page> {
  let found: Page | undefined
  await expect
    .poll(() => {
      found = app.windows().find((window) => window.url().includes(fragment))
      return !!found
    }, { timeout: 15_000 })
    .toBe(true)
  return found!
}

// Playwright's synthetic keys skip Electron's before-input-event, so send real input events.
export const pressInActiveTab = (keyCode: string, modifiers: string[]) =>
  app.evaluate((_electron, [key, held]) => (globalThis as any).arcBrowser.activeTab().wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: held }), [
    keyCode,
    modifiers
  ] as const)
export const mod = process.platform === 'darwin' ? 'meta' : 'control'
