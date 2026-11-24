// End-to-end tests against the built app (run `pnpm build` first; `pnpm test:e2e` does).
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Action } from '../../src/shared/actions'
import type { AppState, PinnedFolder } from '../../src/shared/types'

let app: ElectronApplication
let server: Server
let base = ''
let feedPosts: string[] = []
const hits: string[] = []
const userData = mkdtempSync(join(tmpdir(), 'yarc-e2e-'))
// Fresh, so the app doesn't download the real filter lists.
mkdirSync(join(userData, 'adblock'))
writeFileSync(join(userData, 'adblock', 'engine.bin'), ElectronBlocker.parse('||doubleclick.net^\n||googlesyndication.com^').serialize())

const page = (name: string) =>
  `<!doctype html><title>Page ${name}</title><h1>${name}</h1>` +
  `<a id="blank" href="/child-of-${name}" target="_blank">open child</a>` +
  `<a id="same" href="/next-${name}">same tab</a><p>findme findme findme</p>`

/** A video that plays by itself: a canvas animation, with a quiet tone where the machine has audio. */
const VIDEO_PAGE = `<!doctype html><title>Video page</title><video id="v" style="width:640px;height:360px"></video><script>
const c = document.createElement('canvas'); c.width = 640; c.height = 360; const g = c.getContext('2d')
;(function draw(t) { g.fillStyle = 'hsl(' + ((t / 20) % 360) + ' 60% 40%)'; g.fillRect(0, 0, 640, 360); requestAnimationFrame(draw) })(0)
const tracks = c.captureStream(30).getVideoTracks()
try { const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); const gain = ac.createGain(); gain.gain.value = 0.01; o.connect(gain).connect(d); o.start(); tracks.push(...d.stream.getAudioTracks()) } catch {}
const v = document.getElementById('v'); v.srcObject = new MediaStream(tracks); v.play()
</script>`

async function launch(): Promise<ElectronApplication> {
  // YARC_EXE runs the suite against a packaged app (e.g. release/win-unpacked/YARC.exe).
  const exe = process.env.YARC_EXE
  const a = await electron.launch({
    ...(exe ? { executablePath: exe, args: [] } : { args: ['out/main/index.js'] }),
    // Playwright otherwise adds --no-sandbox on Linux, and service-worker preloads (extension APIs) don't run without the sandbox.
    chromiumSandbox: true,
    env: { ...process.env, YARC_USER_DATA: userData, YARC_TEST: '1' }
  })
  await a.firstWindow()
  await expect.poll(() => a.evaluate(() => !!(globalThis as { arcBrowser?: unknown }).arcBrowser)).toBe(true)
  return a
}

const state = (): Promise<AppState> => app.evaluate(() => (globalThis as any).arcBrowser.snapshot())
const dispatch = (a: Action) => app.evaluate((_e, action) => (globalThis as any).arcBrowser.dispatch(action), a)
const space = async () => {
  const s = await state()
  return s.spaces.find((x) => x.id === s.activeSpaceId)!
}

const overlayKind = (): Promise<string> => app.evaluate(() => (globalThis as any).arcBrowser.window.overlayMode.kind)

const captureNextMenu = (name: string) =>
  app.evaluate(({ Menu }, name) => {
    const popup = Menu.prototype.popup
    Menu.prototype.popup = function (this: Electron.Menu) {
      ;(globalThis as any)[name] = this
      Menu.prototype.popup = popup
    }
  }, name)

async function pageWithUrl(fragment: string): Promise<Page> {
  let found: Page | undefined
  await expect
    .poll(() => {
      found = app.windows().find((w) => w.url().includes(fragment))
      return !!found
    }, { timeout: 15_000 })
    .toBe(true)
  return found!
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '')
    if (req.url === '/never-loads') return
    if (req.url === '/feed.xml') {
      res.setHeader('content-type', 'application/rss+xml')
      return res.end(`<rss><channel>${feedPosts.map((p) => `<item><title>Post ${p}</title><link>${base}/post-${p}</link></item>`).join('')}</channel></rss>`)
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
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  app = await launch()
})

test.afterAll(async () => {
  await app?.close()
  server?.closeAllConnections()
  server?.close()
})

test('starts with a default space and the sidebar', async () => {
  const ui = await pageWithUrl('index.html')
  await expect(ui.locator('.sidebar')).toBeVisible()
  await expect(ui.locator('.space-name')).toContainText('Personal')
})

test("clicking the current space's icon opens its menu", async () => {
  const ui = await pageWithUrl('index.html')
  await captureNextMenu('poppedMenu')
  await ui.locator('.space-dot.active').click()
  await expect.poll(() => app.evaluate(() => (globalThis as any).poppedMenu?.items.map((i: Electron.MenuItem) => i.label))).toContain('Edit Space…')
})

test("the space editor's own color picker sets a custom color, and a second color ends the sidebar's gradient", async () => {
  const s = await space()
  await dispatch({ type: 'overlay', mode: { kind: 'space-editor', spaceId: s.id } })
  const overlay = await pageWithUrl('overlay.html')
  const first = overlay.locator('.color-row').first()
  const picker = overlay.locator('.color-picker').first()
  await first.locator('.custom-sw').click()
  await expect(picker).toBeVisible()
  await picker.locator('.cp-hex').fill('#336699')
  await expect(first.locator('.hex')).toHaveText('#336699')
  await picker.locator('.cp-hue').fill('0')
  await expect(first.locator('.hex')).toHaveText('#993333')
  await overlay.locator('.space-editor header').click()
  await expect(picker).toBeHidden()
  await expect(first.locator('.custom-sw')).toHaveClass(/\bon\b/)

  await overlay.locator('.add-color').click()
  const second = overlay.locator('.color-row').nth(1)
  await second.locator('.sw[title="#3dbb8a"]').click()
  await overlay.getByRole('button', { name: 'Save' }).click()
  await expect.poll(async () => [(await space()).color, (await space()).color2]).toEqual(['#993333', '#3dbb8a'])
  const ui = await pageWithUrl('index.html')
  await expect.poll(() => ui.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--space-2'))).toBe('#3dbb8a')

  await dispatch({ type: 'updateSpace', id: s.id, color: s.color, color2: '' })
  await expect.poll(() => ui.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--space-2'))).toBe(s.color)
})

test("the space editor previews a color in the sidebar until it's saved, and puts the old one back when cancelled", async () => {
  const s = await space()
  const ui = await pageWithUrl('index.html')
  const sidebarColor = () => ui.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--space'))
  const savedColor = () => app.evaluate((_e, id) => (globalThis as any).arcBrowser.state.spaces.find((x: { id: string }) => x.id === id).color, s.id)
  const overlay = await pageWithUrl('overlay.html')
  for (const close of [() => overlay.locator('.actions').getByRole('button', { name: 'Cancel' }).click(), () => overlay.locator('.scrim').click({ position: { x: 5, y: 5 } })]) {
    await dispatch({ type: 'overlay', mode: { kind: 'space-editor', spaceId: s.id } })
    const swatch = overlay.locator(`.color-row .sw:not(.custom-sw):not([title="${s.color}"])`).first()
    const picked = (await swatch.getAttribute('title'))!
    await swatch.click()
    await expect.poll(sidebarColor).toBe(picked)
    expect(await savedColor()).toBe(s.color)
    await close()
    await expect.poll(sidebarColor).toBe(s.color)
  }
  expect(await savedColor()).toBe(s.color)
})

test('pages start below the native caption buttons on Windows and Linux', async () => {
  const ui = await pageWithUrl('index.html')
  const mac = process.platform === 'darwin'
  // CAPTION_H (window.ts) on Windows and Linux; the 8px gap on macOS, where the traffic lights sit over the sidebar.
  expect((await state()).layout.content.y).toBe(mac ? 8 : 32)
  // Window Controls Overlay: the native min/max/close buttons drawn over the UI at the top-right.
  expect(await ui.evaluate(() => (navigator as any).windowControlsOverlay?.visible ?? false)).toBe(!mac)
  if (!mac) {
    // The strip above the page drags the window, like a title bar.
    await expect(ui.locator('.caption-strip')).toHaveCSS('-webkit-app-region', 'drag')
    await expect(ui.locator('.caption-strip')).toHaveCSS('height', '32px')
    await expect(ui.locator('.win-controls')).toHaveCount(0)
  }
})

test('the traffic lights mirror to the top-right corner with a right sidebar on macOS, docked and revealed', async () => {
  if (process.platform !== 'darwin') return
  const lights = () => app.evaluate(() => (globalThis as any).arcBrowser.window.win.getWindowButtonPosition())
  const right = () => app.evaluate(() => (globalThis as any).arcBrowser.window.size().width - 13 - 54)
  await dispatch({ type: 'settings', patch: { sidebarRight: true } })
  expect(await lights()).toEqual({ x: await right(), y: 16 })
  await dispatch({ type: 'settings', patch: { sidebarVisible: false } })
  await dispatch({ type: 'overlay', mode: { kind: 'sidebar' } })
  expect(await lights()).toEqual({ x: await right(), y: 20 })
  await dispatch({ type: 'overlay', mode: { kind: 'none' } })
  await dispatch({ type: 'settings', patch: { sidebarVisible: true, sidebarRight: false } })
  expect(await lights()).toEqual({ x: 13, y: 16 })
})

test('the menu button opens Settings on Windows and Linux; macOS has the menu bar instead', async () => {
  const ui = await pageWithUrl('index.html')
  const button = ui.locator('.topbar button[title="Menu"]')
  if (process.platform === 'darwin') return expect(button).toHaveCount(0)
  await captureNextMenu('appMenu')
  await button.click()
  await expect.poll(() => app.evaluate(() => !!(globalThis as any).appMenu)).toBe(true)
  await app.evaluate(() => (globalThis as any).appMenu.items.find((i: Electron.MenuItem) => i.label === 'Settings…').click())
  await expect.poll(overlayKind).toBe('settings')
  await dispatch({ type: 'overlay', mode: { kind: 'none' } })
})

test('command bar opens a new tab at the top of Today', async () => {
  const ui = await pageWithUrl('index.html')
  await ui.locator('.newtab').click()
  const overlay = await pageWithUrl('overlay.html')
  const input = overlay.locator('.command input')
  await expect(input).toBeFocused()
  await input.fill(`${base}/one`)
  await input.press('Enter')
  await expect.poll(async () => (await space()).today[0]?.url).toBe(`${base}/one`)
  await expect.poll(async () => (await state()).live[(await space()).today[0].id]?.title).toBe('Page one')
  await expect(ui.locator('.row.active .title')).toHaveText('Page one')
})

// Playwright's synthetic keys skip Electron's before-input-event, so send real input events.
const pressInActiveTab = (keyCode: string, modifiers: string[]) =>
  app.evaluate((_e, [k, m]) => (globalThis as any).arcBrowser.activeTab().wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: m }), [
    keyCode,
    modifiers
  ] as const)
const mod = process.platform === 'darwin' ? 'meta' : 'control'

test('keyboard shortcut Ctrl/Cmd+T opens the command bar from a web page', async () => {
  await pageWithUrl('/one')
  const before = (await space()).today.map((t) => t.url)
  await pressInActiveTab('T', [mod])
  const overlay = await pageWithUrl('overlay.html')
  await expect(overlay.locator('.command input')).toBeVisible()
  await overlay.locator('.command input').fill(`${base}/two`)
  await overlay.locator('.command input').press('Enter')
  await expect.poll(async () => (await space()).today.map((t) => t.url)).toEqual([`${base}/two`, ...before])
})

test('command bar finds and switches to open tabs', async () => {
  await dispatch({ type: 'overlay', mode: { kind: 'command', target: 'tab' } })
  const overlay = await pageWithUrl('overlay.html')
  await overlay.locator('.command input').fill('page one')
  await expect(overlay.locator('.result').first()).toContainText('Page one')
  await expect(overlay.locator('.result.sel .hint')).toContainText('Switch to Tab')
  await overlay.locator('.command input').press('Enter')
  const s = await space()
  await expect.poll(async () => (await space()).activeItemId).toBe(s.today.find((t) => t.url.endsWith('/one'))!.id)
})

test('the command bar stays open while a page behind it finishes loading', async () => {
  // Windows gives the keyboard to a page whenever it commits a navigation; that blur used to close the bar.
  // As if the user were in YARC: the test window needn't be the foreground app (leaving the window still closes the bar).
  const focused = (on: boolean) =>
    app.evaluate((_e, on) => {
      const win = (globalThis as any).arcBrowser.window.win
      if (on) win.isFocused = () => true
      else delete win.isFocused
    }, on)
  await focused(true)
  const previous = (await space()).activeItemId!
  await dispatch({ type: 'open', url: `${base}/slow-focus`, where: 'tab' })
  await dispatch({ type: 'overlay', mode: { kind: 'command', target: 'tab' } })
  await expect.poll(async () => (await state()).live[(await space()).activeItemId!]?.loading).toBe(false)
  await new Promise((r) => setTimeout(r, 500))
  expect(await overlayKind()).toBe('command')
  await dispatch({ type: 'overlay', mode: { kind: 'none' } })
  await dispatch({ type: 'close', id: (await space()).activeItemId! })
  await dispatch({ type: 'activate', id: previous })
  await focused(false)
})

test('command bar completes the top URL inline, like Arc', async () => {
  await dispatch({ type: 'overlay', mode: { kind: 'command', target: 'tab' } })
  const overlay = await pageWithUrl('overlay.html')
  const input = overlay.locator('.command input')
  await input.pressSequentially('127.0.0', { delay: 30 })
  await expect(input).toHaveValue(/^127\.0\.0\.1:\d+\//)
  // The completed part is selected, so typing on replaces it.
  expect(await input.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe('127.0.0'.length)
  await input.press('Backspace')
  await expect(input).toHaveValue('127.0.0')
  await input.press('Escape')
})

const pressInOverlay = (keyCode: string) =>
  app.evaluate((_e, k) => {
    const wc = (globalThis as any).arcBrowser.window.overlay.webContents
    for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode: k })
  }, keyCode)

test('Tab to Search: a site name, Tab, then a query searches that site, like Arc', async () => {
  // Answer https locally: no network, and YouTube can't redirect to a consent page.
  const partition = `persist:profile-${(await space()).profileId}`
  await app.evaluate(({ session }, p) => {
    session.fromPartition(p).protocol.handle('https', () => new Response('<title>stub</title>', { headers: { 'content-type': 'text/html' } }))
  }, partition)
  const before = (await space()).activeItemId
  try {
    await dispatch({ type: 'overlay', mode: { kind: 'none' } })
    await dispatch({ type: 'overlay', mode: { kind: 'command', target: 'tab' } })
    const overlay = await pageWithUrl('overlay.html')
    const input = overlay.locator('.command input')
    await expect(input).toHaveValue('')
    await input.pressSequentially('you', { delay: 30 })
    await expect(overlay.locator('.command .tab-hint')).toContainText('Search YouTube')
    await pressInOverlay('Tab')
    await expect(overlay.locator('.command .site-chip')).toHaveText('YouTube')
    await expect(input).toHaveValue('')
    await expect(input).toHaveAttribute('placeholder', 'Search YouTube…')
    // Backspace on the empty query leaves the mode and puts back what was typed.
    await pressInOverlay('Backspace')
    await expect(overlay.locator('.command .site-chip')).toHaveCount(0)
    await expect(input).toHaveValue('you')
    await pressInOverlay('Tab')
    await input.pressSequentially('lofi beats', { delay: 20 })
    await expect(overlay.locator('.result.sel')).toContainText('Search YouTube')
    await input.press('Enter')
    await expect.poll(async () => (await space()).today[0]?.url).toBe('https://www.youtube.com/results?search_query=lofi%20beats')
    // Leave the tabs as the next tests expect them.
    await dispatch({ type: 'close', id: (await space()).today[0].id })
    if (before) await dispatch({ type: 'activate', id: before })
  } finally {
    await app.evaluate(({ session }, p) => session.fromPartition(p).protocol.unhandle('https'), partition)
  }
})

test('target=_blank links open as new Today tabs', async () => {
  const tab = await pageWithUrl('/one')
  await tab.locator('#blank').click()
  await expect.poll(async () => (await space()).today[0]?.url).toBe(`${base}/child-of-one`)
  await expect.poll(async () => (await space()).activeItemId).toBe((await space()).today[0].id)
})

test('Ctrl/Cmd+S toggles the sidebar and the page grows', async () => {
  const before = (await state()).layout.content
  await pressInActiveTab('S', [mod])
  await expect.poll(async () => (await state()).settings.sidebarVisible).toBe(false)
  expect((await state()).layout.content.width).toBeGreaterThan(before.width)
  await pressInActiveTab('S', [mod])
  await expect.poll(async () => (await state()).settings.sidebarVisible).toBe(true)
})

test('a shortcut changed in Settings runs its command, and its old keys reach the page instead', async () => {
  await dispatch({ type: 'overlay', mode: { kind: 'settings', section: 'shortcuts' } })
  const overlay = await pageWithUrl('overlay.html')
  const keys = overlay.locator('.set-shortcut', { hasText: 'Toggle Sidebar' }).locator('.set-shortcut-keys')
  await keys.click()
  await expect(keys).toHaveText('Press keys…')
  await app.evaluate((_e, m) => {
    const wc = (globalThis as any).arcBrowser.window.overlay.webContents
    wc.focus()
    for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode: 'Y', modifiers: m })
  }, [mod, 'shift'])
  await expect.poll(async () => (await state()).settings.shortcuts.toggleSidebar).toEqual([mod === 'meta' ? 'Cmd+Shift+Y' : 'Ctrl+Shift+Y'])
  await dispatch({ type: 'overlay', mode: { kind: 'none' } })

  const inPage = (js: string) => app.evaluate((_e, code) => (globalThis as any).arcBrowser.activeTab().wc.executeJavaScript(code), js)
  await inPage(`window.keys = []; addEventListener('keydown', (e) => keys.push(e.code))`)
  await pressInActiveTab('S', [mod])
  await expect.poll(() => inPage('keys.join()')).toBe('KeyS')
  expect((await state()).settings.sidebarVisible).toBe(true)
  await pressInActiveTab('Y', [mod, 'shift'])
  await expect.poll(async () => (await state()).settings.sidebarVisible).toBe(false)
  await pressInActiveTab('Y', [mod, 'shift'])
  await expect.poll(async () => (await state()).settings.sidebarVisible).toBe(true)
  expect(await inPage('keys.join()')).toBe('KeyS')
  await dispatch({ type: 'settings', patch: { shortcuts: {} } })
})

test('a hover-revealed sidebar hides when the window loses focus', async () => {
  await dispatch({ type: 'settings', patch: { sidebarVisible: false } })
  await dispatch({ type: 'sidebarReveal', show: true })
  expect(await overlayKind()).toBe('sidebar')
  await app.evaluate(() => (globalThis as any).arcBrowser.window.win.emit('blur'))
  await expect.poll(overlayKind).toBe('none')
  expect((await state()).sidebarReveal).toBe(false)
  await dispatch({ type: 'settings', patch: { sidebarVisible: true } })
})

test('dragging the sidebar edge resizes the sidebar and the page', async () => {
  const ui = app.windows().find((w) => w.url().endsWith('index.html'))!
  const drag = async (dx: number) => {
    const box = (await ui.locator('.sidebar-resize').boundingBox())!
    const x = box.x + box.width / 2
    const y = box.y + 200
    await ui.mouse.move(x, y)
    await ui.mouse.down()
    await ui.mouse.move(x + dx, y, { steps: 5 })
    await ui.mouse.up()
  }
  const before = (await state()).settings.sidebarWidth
  await drag(60)
  await expect.poll(async () => (await state()).settings.sidebarWidth).toBe(before + 60)
  await expect.poll(async () => (await state()).layout.content.x).toBe(before + 60)
  await expect.poll(async () => (await ui.locator('.sidebar').boundingBox())?.width).toBe(before + 60)
  // Clamped at the minimum width.
  await drag(-1000)
  await expect.poll(async () => (await state()).settings.sidebarWidth).toBe(200)
  await dispatch({ type: 'settings', patch: { sidebarWidth: before } })
})

test('pinning keeps the saved URL; closing a pinned tab resets it', async () => {
  const one = (await space()).today.find((t) => t.url.endsWith('/one'))!
  await dispatch({ type: 'activate', id: one.id })
  await dispatch({ type: 'togglePin', id: one.id })
  let s = await space()
  const pinned = s.pinned.find((n) => n.id === one.id)
  expect(pinned && pinned.kind === 'tab' ? pinned.savedUrl : undefined).toBe(`${base}/one`)
  const tab = await pageWithUrl('/one')
  await tab.locator('#same').click()
  await expect.poll(async () => (await state()).live[one.id]?.url).toBe(`${base}/next-one`)
  const ui = await pageWithUrl('index.html')
  await expect(ui.locator('.row .slash')).toHaveCount(1)
  await dispatch({ type: 'close', id: one.id })
  s = await space()
  const after = s.pinned.find((n) => n.id === one.id)
  expect(after?.kind === 'tab' ? after.url : '').toBe(`${base}/one`)
  expect((await state()).live[one.id]).toBeUndefined()
})

test("a live folder fills itself from a site's feed, follows it on refresh, and goes with its tabs", async () => {
  const folder = async () => (await space()).pinned.find((n): n is PinnedFolder => n.kind === 'folder' && !!n.live)
  const posts = async () => (await folder())?.children.map((c) => (c.kind === 'tab' ? c.savedTitle : c.kind))
  feedPosts = ['a', 'b']
  await dispatch({ type: 'saveLiveFolder', name: '', source: { kind: 'feed', url: `${base}/blog` } })
  await expect.poll(posts).toEqual(['Post a', 'Post b'])
  expect((await folder())?.name).toBe('127.0.0.1')
  const ui = await pageWithUrl('index.html')
  await expect(ui.locator('.row.folder', { hasText: '127.0.0.1' })).toBeVisible()
  await expect(ui.locator('.row', { hasText: 'Post b' })).toBeVisible()

  const a = (await folder())!.children[0]
  feedPosts = ['c', 'a']
  await dispatch({ type: 'refreshLiveFolder', id: (await folder())!.id })
  await expect.poll(posts).toEqual(['Post c', 'Post a'])
  expect((await folder())!.children[1].id).toBe(a.id)

  await dispatch({ type: 'deleteFolder', id: (await folder())!.id })
  expect(await folder()).toBeUndefined()
  expect((await space()).pinned.some((n) => n.id === a.id)).toBe(false)
})

test('links from a pinned tab to another site open in Peek', async () => {
  await dispatch({ type: 'open', url: `${base}/peekhome`, where: 'tab' })
  const home = (await space()).today[0]
  await dispatch({ type: 'togglePin', id: home.id })
  // localhost is another site than 127.0.0.1.
  const away = `${base.replace('127.0.0.1', 'localhost')}/elsewhere`
  const tab = await pageWithUrl('/peekhome')
  await tab.evaluate((href) => document.body.insertAdjacentHTML('beforeend', `<a id="away" href="${href}">away</a>`), away)
  // A real click: Playwright's would wait for the navigation Peek cancels, and its page handle
  // stays stuck on it afterwards.
  const clickAway = async () => {
    await app.evaluate(async (_e, id) => {
      const wc = (globalThis as any).arcBrowser.live.get(id).wc
      const r = await wc.executeJavaScript('JSON.parse(JSON.stringify(document.getElementById("away").getBoundingClientRect()))')
      const at = { x: Math.round(r.x + 4), y: Math.round(r.y + 4) }
      for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, ...at, button: 'left', clickCount: 1 })
    }, home.id)
    await expect.poll(async () => (await state()).peek?.url).toBe(away)
  }

  await clickAway()
  expect((await state()).live[home.id]?.url).toBe(`${base}/peekhome`)
  const overlay = await pageWithUrl('overlay.html')
  await expect(overlay.locator('.peek-buttons button')).toHaveCount(3)
  await pressInActiveTab('Escape', [])
  await expect.poll(async () => (await state()).peek).toBeUndefined()

  await clickAway()
  await overlay.locator('.peek-buttons button[title^="Open as a tab"]').click()
  await expect.poll(async () => (await space()).today[0]?.url).toBe(away)
  const s = await space()
  expect(s.activeItemId).toBe(s.today[0].id)
  expect((await state()).peek).toBeUndefined()
  expect((await state()).live[home.id]?.url).toBe(`${base}/peekhome`)
})

/** A real click: Playwright's waits for a navigation the app may cancel. `tabId` 'peek' is the open Peek's page. */
const clickInPage = (tabId: string, selector: string, opts: { button?: 'left' | 'right'; modifiers?: string[] } = {}) =>
  app.evaluate(
    async (_e, [id, sel, button, modifiers]) => {
      const b = (globalThis as any).arcBrowser
      const wc = id === 'peek' ? b.cur.peek.tab.wc : b.live.get(id).wc
      const r = await wc.executeJavaScript(`JSON.parse(JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect()))`)
      const at = { x: Math.round(r.x + 4), y: Math.round(r.y + 4) }
      for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, ...at, button, clickCount: 1, modifiers })
    },
    [tabId, selector, opts.button ?? 'left', opts.modifiers ?? []] as const
  )

const menuLabels = async (name: string): Promise<string[]> => {
  await expect.poll(() => app.evaluate((_e, n) => !!(globalThis as any)[n], name)).toBe(true)
  return app.evaluate((_e, n) => (globalThis as any)[n].items.map((i: Electron.MenuItem) => i.label), name)
}

test('shift-clicking any link, or choosing Open Link in Peek, opens it in Peek', async () => {
  await dispatch({ type: 'open', url: `${base}/shiftpeek`, where: 'tab' })
  const tab = (await space()).today[0]
  await pageWithUrl('/shiftpeek')
  const tabCount = (await space()).today.length
  const peekUrl = async () => (await state()).peek?.url

  await clickInPage(tab.id, '#same', { modifiers: ['shift'] })
  await expect.poll(peekUrl).toBe(`${base}/next-shiftpeek`)
  expect((await space()).today.length).toBe(tabCount)
  expect((await state()).live[tab.id]?.url).toBe(`${base}/shiftpeek`)

  await pageWithUrl('/next-shiftpeek')
  await captureNextMenu('peekLinkMenu')
  await clickInPage('peek', '#same', { button: 'right' })
  const inPeek = await menuLabels('peekLinkMenu')
  expect(inPeek).toContain('Open Link in New Tab')
  expect(inPeek).not.toContain('Open Link in Peek')
  await dispatch({ type: 'peek', op: 'close' })
  await expect.poll(peekUrl).toBeUndefined()

  await captureNextMenu('tabLinkMenu')
  await clickInPage(tab.id, '#blank', { button: 'right' })
  expect(await menuLabels('tabLinkMenu')).toContain('Open Link in Peek')
  await app.evaluate(() => (globalThis as any).tabLinkMenu.items.find((i: Electron.MenuItem) => i.label === 'Open Link in Peek').click())
  await expect.poll(peekUrl).toBe(`${base}/child-of-shiftpeek`)
  expect((await space()).today.length).toBe(tabCount)
  await dispatch({ type: 'peek', op: 'close' })
  await expect.poll(peekUrl).toBeUndefined()
  await dispatch({ type: 'close', id: tab.id })
})

test('a three-finger swipe and the mouse back and forward buttons go back and forward', async () => {
  await dispatch({ type: 'open', url: `${base}/swipe`, where: 'tab' })
  const tab = (await space()).today[0]
  await (await pageWithUrl('/swipe')).locator('#same').click()
  const url = async () => (await state()).live[tab.id]?.url
  await expect.poll(url).toBe(`${base}/next-swipe`)
  const emit = (event: string, arg: string) =>
    app.evaluate((_e, [ev, a]) => (globalThis as any).arcBrowser.window.win.emit(ev, {}, a), [event, arg] as const)

  for (const [event, back, forward] of [
    ['swipe', 'left', 'right'],
    ['app-command', 'browser-backward', 'browser-forward']
  ]) {
    await emit(event, back)
    await expect.poll(url).toBe(`${base}/swipe`)
    await emit(event, forward)
    await expect.poll(url).toBe(`${base}/next-swipe`)
  }
  await dispatch({ type: 'close', id: tab.id })
})

test('a two-finger swipe slides the page and goes back or forward when let go far enough, unless the system setting is off or the page scrolls sideways', async () => {
  await dispatch({ type: 'open', url: `${base}/twofinger`, where: 'tab' })
  const tab = (await space()).today[0]
  await (await pageWithUrl('/twofinger')).locator('#same').click()
  const url = async () => (await state()).live[tab.id]?.url
  await expect.poll(url).toBe(`${base}/next-twofinger`)
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const systemSwipe = (on: boolean) =>
    app.evaluate(({ systemPreferences }, v) => {
      systemPreferences.isSwipeTrackingFromScrollEventsEnabled = () => v
    }, on)
  // Chromium's wheel deltas point the other way from the page's: a positive one scrolls left, toward the previous page.
  const wheel = (deltaX: number, events = 8) =>
    app.evaluate(
      async (_e, [id, dx, n]) => {
        const wc = (globalThis as any).arcBrowser.live.get(id).wc
        for (let i = 0; i < n; i++) {
          wc.sendInputEvent({ type: 'mouseWheel', x: 200, y: 200, deltaX: dx, deltaY: 0, hasPreciseScrollingDeltas: true, canScroll: true })
          await new Promise((r) => setTimeout(r, 16))
        }
      },
      [tab.id, deltaX, events] as const
    )
  // sendInputEvent ends the scroll gesture after every wheel event: keep the fingers down by hiding those ends until the test lifts them.
  const fingers = (down: boolean) =>
    app.evaluate(
      (_e, [id, hold]) => {
        const wc = (globalThis as any).arcBrowser.live.get(id).wc
        if (!hold) {
          delete wc.emit
          wc.emit('input-event', { preventDefault() {} }, { type: 'gestureScrollEnd' })
          return
        }
        const emit = wc.emit
        wc.emit = (name: string, ...args: any[]) => (name === 'input-event' && args[1]?.type === 'gestureScrollEnd') || emit.call(wc, name, ...args)
      },
      [tab.id, down] as const
    )
  const pageX = () => app.evaluate((_e, id) => (globalThis as any).arcBrowser.live.get(id).view.getBounds().x, tab.id)
  const restingX = await pageX()
  /** Swipes with the fingers held until the page has slid `slid` points, then lifts them. */
  const swipe = async (deltaX: number, events: number, slid: number) => {
    await fingers(true)
    await wheel(deltaX, events)
    await expect.poll(async () => Math.abs((await pageX()) - restingX)).toBeGreaterThanOrEqual(slid)
    await fingers(false)
  }

  if (process.platform === 'darwin') {
    await systemSwipe(false)
    await wheel(30)
    await pause(500)
    expect(await url()).toBe(`${base}/next-twofinger`)
    await systemSwipe(true)
  }
  // A short swipe slides the page, then lets it back without going anywhere.
  await swipe(30, 3, 20)
  await expect.poll(pageX).toBe(restingX)
  expect(await url()).toBe(`${base}/next-twofinger`)

  // Letting go past the 70-point commit point goes.
  await pause(500)
  await swipe(30, 8, 70)
  await expect.poll(url).toBe(`${base}/twofinger`)
  // Past the momentum the page it landed on ignores.
  await pause(500)
  await swipe(-30, 8, 70)
  await expect.poll(url).toBe(`${base}/next-twofinger`)

  await pause(500)
  const inPage = (js: string) => app.evaluate((_e, [id, code]) => (globalThis as any).arcBrowser.live.get(id).wc.executeJavaScript(code), [tab.id, js] as const)
  await inPage('document.body.style.width = "5000px"; scrollTo(2000, 0)')
  await wheel(30)
  await expect.poll(() => inPage('scrollX')).toBeLessThan(2000)
  await pause(500)
  expect(await url()).toBe(`${base}/next-twofinger`)

  await app.evaluate(({ systemPreferences }) => delete (systemPreferences as any).isSwipeTrackingFromScrollEventsEnabled)
  await dispatch({ type: 'close', id: tab.id })
})

test('a finished download drags out of the Downloads panel as its file', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'yarc-e2e-downloads-'))
  await app.evaluate(({ app }, dir) => app.setPath('downloads', dir), folder)
  await app.evaluate((_e, u) => (globalThis as any).arcBrowser.activeTab().wc.downloadURL(u), `${base}/report.txt`)
  await expect.poll(async () => (await state()).downloads[0]?.state).toBe('completed')
  const file = (await state()).downloads[0].path
  expect(file).toBe(join(folder, 'report.txt'))

  await dispatch({ type: 'overlay', mode: { kind: 'library', tab: 'downloads' } })
  const overlay = await pageWithUrl('overlay.html')
  const row = overlay.locator('.list-row', { hasText: 'report.txt' })
  await expect(row).toHaveAttribute('draggable', 'true')
  // A test can't make a real OS drag, so record the one main starts.
  await app.evaluate(() => {
    ;(globalThis as any).arcBrowser.window.overlay.webContents.startDrag = (item: Electron.Item) => {
      ;(globalThis as any).dragged = { file: item.file, icon: typeof item.icon !== 'string' && !item.icon.isEmpty() }
    }
  })
  // Main ignores a drag until the file's icon, fetched when the download finished, is ready.
  await expect
    .poll(async () => {
      await row.dispatchEvent('dragstart')
      return app.evaluate(() => (globalThis as any).dragged)
    })
    .toEqual({ file, icon: true })

  await app.evaluate(() => delete (globalThis as any).arcBrowser.window.overlay.webContents.startDrag)
  await dispatch({ type: 'downloadsClear' })
  await dispatch({ type: 'overlay', mode: { kind: 'none' } })
})

test('favorites live at the top and belong to the profile', async () => {
  const two = (await space()).today.find((t) => t.url.endsWith('/two'))!
  await dispatch({ type: 'addFavorite', id: two.id })
  const s = await state()
  const profile = s.profiles.find((p) => p.id === (s.spaces.find((x) => x.id === s.activeSpaceId)!.profileId))!
  expect(profile.favorites.map((f) => f.id)).toContain(two.id)
  const ui = await pageWithUrl('index.html')
  await expect(ui.locator('.favorite')).toHaveCount(profile.favorites.length)
})

test('switching tabs ends a rename started by a double-click, and the row stays clickable', async () => {
  // The double-click's second click used to give the keyboard to the page, which doesn't blur the
  // sidebar's field: after a tab switch the rename stayed open and swallowed clicks on its row.
  await dispatch({ type: 'open', url: `${base}/fav-target`, where: 'tab' })
  await dispatch({ type: 'addFavorite', id: (await space()).today[0].id })
  await dispatch({ type: 'open', url: `${base}/rename-me`, where: 'tab' })
  const sp = await space()
  const tab = sp.today.find((t) => t.url.endsWith('/rename-me'))!
  const favorite = (await state()).profiles.find((p) => p.id === sp.profileId)!.favorites[0]
  const ui = await pageWithUrl('index.html')
  const row = ui.locator('.row', { hasText: 'Page rename-me' })
  const box = (await row.boundingBox())!
  await app.evaluate((_e, at) => {
    const wc = (globalThis as any).arcBrowser.window.ui
    for (const clickCount of [1, 2]) for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, ...at, button: 'left', clickCount })
  }, { x: Math.round(box.x + 60), y: Math.round(box.y + box.height / 2) })
  await expect(ui.locator('input.rename')).toBeFocused()
  await expect.poll(() => app.evaluate(() => (globalThis as any).arcBrowser.window.ui.isFocused())).toBe(true)

  // Cmd/Ctrl+1, typed in the sidebar, selects the first favorite.
  await app.evaluate((_e, m) => (globalThis as any).arcBrowser.window.ui.sendInputEvent({ type: 'keyDown', keyCode: '1', modifiers: m }), [mod])
  await expect.poll(async () => (await space()).activeItemId).toBe(favorite.id)
  await expect(ui.locator('input.rename')).toHaveCount(0)
  // Left untouched, the rename saved nothing: the title still follows the page.
  expect((await space()).today.find((t) => t.id === tab.id)!.savedTitle).toBeUndefined()

  await row.click()
  await expect.poll(async () => (await space()).activeItemId).toBe(tab.id)
})

test('releasing Ctrl after several Ctrl+Tabs selects the tab the switcher shows', async () => {
  // Chromium drops a view's key-ups after a key-down the browser handled: once the overlay had
  // handled a Ctrl+Tab, releasing Ctrl never arrived and the switcher stayed open.
  await dispatch({ type: 'open', url: `${base}/switch-a`, where: 'tab' })
  await dispatch({ type: 'open', url: `${base}/switch-b`, where: 'tab' })
  await dispatch({ type: 'open', url: `${base}/switch-c`, where: 'tab' })
  // A page that finishes loading takes the keyboard, and in a window in the background that closes the switcher.
  await expect
    .poll(async () => {
      const s = await state()
      const opened = (await space()).today.filter((t) => /\/switch-[abc]$/.test(t.url))
      return opened.length === 3 && opened.every((t) => s.live[t.id]?.loading === false)
    })
    .toBe(true)
  const key = (view: 'page' | 'overlay', type: 'keyDown' | 'keyUp', keyCode: string, modifiers: string[]) =>
    app.evaluate(
      (_e, [view, type, keyCode, modifiers]) => {
        const b = (globalThis as any).arcBrowser
        const wc = view === 'page' ? b.activeTab().wc : b.window.overlay.webContents
        wc.sendInputEvent({ type, keyCode, modifiers })
      },
      [view, type, keyCode, modifiers] as const
    )
  const switcher = () => app.evaluate(() => (globalThis as any).arcBrowser.cur.switcher as { order: string[]; index: number } | undefined)

  await key('page', 'keyDown', 'Tab', ['control'])
  await expect.poll(async () => (await switcher())?.index).toBe(1)
  // The overlay has the keyboard now: the next Tab is the one it handles.
  await key('overlay', 'keyDown', 'Tab', ['control'])
  await expect.poll(async () => (await switcher())?.index).toBe(2)
  const { order, index } = (await switcher())!
  await key('overlay', 'keyUp', 'Control', [])
  await expect.poll(switcher).toBeUndefined()
  expect((await space()).activeItemId).toBe(order[index])
})

test('split view shows two pages side by side and can be closed', async () => {
  await dispatch({ type: 'open', url: `${base}/left`, where: 'tab' })
  await dispatch({ type: 'open', url: `${base}/right`, where: 'split' })
  await expect.poll(async () => (await state()).layout.views.length).toBe(2)
  const views = (await state()).layout.views
  expect(views[0].rect.x + views[0].rect.width).toBeLessThan(views[1].rect.x)
  await dispatch({ type: 'unsplit' })
  await expect.poll(async () => (await state()).layout.views.length).toBe(1)
})

/** Fires an HTML drag event on the sidebar row titled `title` (a real mouse drag can't be held from here). */
const dragRow = (p: Page, title: string, type: string, fx = 0.5, fy = 0.5) =>
  p.evaluate(
    ({ title, type, fx, fy }) => {
      // A dropped tab can already be part of another row (a split) when dragend fires; dragend reaches the sidebar either way.
      const row = [...document.querySelectorAll('.row')].find((r) => r.querySelector('.title')?.textContent === title) ?? (type === 'dragend' ? document.querySelector('.sidebar') : null)!
      const w = window as unknown as { dt?: DataTransfer }
      if (type === 'dragstart') w.dt = new DataTransfer()
      const r = row.getBoundingClientRect()
      row.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, dataTransfer: w.dt }))
    },
    { title, type, fx, fy }
  )

/** Fires a drag event over the page area's drop layer, at a fraction of its size. */
const dragOverPage = (p: Page, type: 'dragover' | 'drop', fx: number, fy: number) =>
  p.evaluate(
    ({ type, fx, fy }) => {
      const el = document.querySelector('.split-drop')!
      const r = el.getBoundingClientRect()
      el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, dataTransfer: new DataTransfer() }))
    },
    { type, fx, fy }
  )

const dropLayerShown = () =>
  app.evaluate(() => {
    const w = (globalThis as any).arcBrowser.window
    return w.win.contentView.children.includes(w.overlay)
  })

const splitTitles = async () => {
  const s = await state()
  const sp = s.spaces.find((x) => x.id === s.activeSpaceId)!
  const items = [...sp.today, ...s.profiles.flatMap((p) => p.favorites)]
  const shape = (n: any): string => (n.itemId ? items.find((t) => t.id === n.itemId)!.url.split('/').pop()! : `${n.dir}(${n.children.map(shape).join(', ')})`)
  return sp.splits.map((x) => shape(x.root))
}

test('dragging a sidebar tab onto the page or onto another tab makes a split, and leaves nothing behind', async () => {
  await dispatch({ type: 'unsplit' })
  for (const n of ['drag-a', 'drag-b', 'drag-c']) await dispatch({ type: 'open', url: `${base}/${n}`, where: 'tab' })
  const ui = await pageWithUrl('index.html')
  // A row shows the page's title once it has loaded; the drags below find rows by title.
  for (const n of ['drag-a', 'drag-b', 'drag-c']) await expect(ui.locator('.row .title', { hasText: `Page ${n}` })).toBeVisible()
  const b = (await space()).today.find((t) => t.url.endsWith('/drag-b'))!
  await dispatch({ type: 'activate', id: b.id })

  // Onto the left edge of the page: the tab takes the left half.
  await dragRow(ui, 'Page drag-a', 'dragstart')
  await expect.poll(dropLayerShown).toBe(true)
  const overlay = await pageWithUrl('overlay.html')
  await expect(async () => {
    await dragOverPage(overlay, 'dragover', 0.1, 0.5)
    await expect(overlay.locator('.split-drop-zone.left')).toBeVisible({ timeout: 200 })
  }).toPass()
  await dragOverPage(overlay, 'drop', 0.1, 0.5)
  await dragRow(ui, 'Page drag-a', 'dragend')
  await expect.poll(splitTitles).toEqual(['row(drag-a, drag-b)'])
  await expect.poll(dropLayerShown).toBe(false)
  // The sidebar draws the split as one row a moment after the main process makes it; drag onto that row, not the old one.
  await expect(ui.locator('.split-row')).toBeVisible()

  // A drag that ends without a drop (Escape, or outside the window) changes nothing.
  await dragRow(ui, 'Page drag-c', 'dragstart')
  await expect.poll(dropLayerShown).toBe(true)
  await dragRow(ui, 'Page drag-c', 'dragend')
  await expect.poll(dropLayerShown).toBe(false)
  expect(await splitTitles()).toEqual(['row(drag-a, drag-b)'])

  // The split is one sidebar row, a half per tab. Onto the middle of drag-a's half, right of its
  // center: the tab joins as the pane right of drag-a.
  await dragRow(ui, 'Page drag-c', 'dragstart')
  await expect(async () => {
    await dragRow(ui, 'Page drag-a', 'dragover', 0.4, 0.5)
    await expect(ui.locator('.split-preview')).toBeVisible({ timeout: 200 })
  }).toPass()
  await dragRow(ui, 'Page drag-a', 'drop', 0.4, 0.5)
  await dragRow(ui, 'Page drag-c', 'dragend')
  await expect.poll(splitTitles).toEqual(['row(drag-a, drag-c, drag-b)'])
  await expect.poll(dropLayerShown).toBe(false)
  await dispatch({ type: 'unsplit' })
})

test('a split is one sidebar row, and each pane has its own bar that closes just that tab', async () => {
  for (const n of ['bar-a', 'bar-b']) await dispatch({ type: 'open', url: `${base}/${n}`, where: 'tab' })
  const sp = await space()
  const [a, b] = ['bar-a', 'bar-b'].map((n) => sp.today.find((t) => t.url.endsWith(`/${n}`))!)
  await dispatch({ type: 'activate', id: a.id })
  await dispatch({ type: 'placeInSplit', id: b.id, target: a.id, side: 'right' })
  const ui = await pageWithUrl('index.html')
  await expect(ui.locator('.split-row .half .title')).toHaveText(['Page bar-a', 'Page bar-b'])
  await expect(ui.locator('.row:not(.split-row) .title', { hasText: /^Page bar-/ })).toHaveCount(0)

  // Each page sits under its pane's bar.
  const views = (await state()).layout.views
  expect(views.map((v) => v.rect.y - v.bar!.y)).toEqual([32, 32])
  await expect(ui.locator('.pane-bar')).toHaveCount(2)

  // The left half of the row focuses bar-a; the right pane's close button closes bar-b only.
  await ui.locator('.split-row .half').first().click()
  await expect.poll(async () => (await space()).activeItemId).toBe(a.id)
  await ui.locator('.pane-bar').nth(1).locator('button[title="Close tab"]').click()
  await expect.poll(async () => (await space()).today.some((t) => t.id === b.id)).toBe(false)
  expect((await space()).splits).toEqual([])
  await expect(ui.locator('.pane-bar')).toHaveCount(0)
})

test('closing a Today tab archives it and it can be reopened', async () => {
  const s = await space()
  const left = s.today.find((t) => t.url.endsWith('/left'))!
  await dispatch({ type: 'close', id: left.id })
  expect((await space()).today.some((t) => t.id === left.id)).toBe(false)
  expect(await app.evaluate(() => (globalThis as any).arcBrowser.store.state.archive[0].url)).toBe(`${base}/left`)
  await dispatch({ type: 'reopenClosed' })
  await expect.poll(async () => (await space()).today[0]?.url).toBe(`${base}/left`)
})

test('find in page counts matches', async () => {
  await dispatch({ type: 'open', url: `${base}/findpage`, where: 'tab' })
  await pageWithUrl('/findpage')
  await expect.poll(async () => (await state()).live[(await space()).activeItemId!]?.loading).toBe(false)
  await dispatch({ type: 'overlay', mode: { kind: 'find' } })
  const overlay = await pageWithUrl('overlay.html')
  await overlay.locator('.findbar input').fill('findme')
  await expect(overlay.locator('.findbar .count')).toHaveText(/\/3$/)
  await dispatch({ type: 'stopFind' })
})

test('the tour imports the ticked browsers, each into a space of its own', async () => {
  await dispatch({ type: 'open', url: `${base}/before-import`, where: 'tab' })
  const profile = join(userData, 'fake-chrome', 'Default')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { children: [{ type: 'url', name: 'Kept', url: `${base}/bookmarked` }] } } }))
  const arc = join(userData, 'fake-arc')
  mkdirSync(arc)
  writeFileSync(join(arc, 'StorableSidebar.json'), readFileSync('docs/fixtures/StorableSidebar.sample.json'))
  const found = [
    { id: 'arc:Default', browser: 'Arc', name: 'Personal', detail: '1 space', ticked: true, source: 'arc', path: arc, profile: 'Default' },
    { id: 'arc:Profile 1', browser: 'Arc', name: 'Work', detail: '1 space', ticked: true, source: 'arc', path: arc, profile: 'Profile 1' },
    { id: 'chromium:x', browser: 'Chrome', name: '', detail: 'Bookmarks and history', ticked: false, source: 'chromium', path: profile, profile: 'Default' }
  ]
  const before = (await state()).spaces.length
  await app.evaluate((_e, found) => Object.assign((globalThis as any).arcBrowser.imports, { found, scan: Promise.resolve() }), found)
  await dispatch({ type: 'overlay', mode: { kind: 'tour', step: 'import' } })
  const overlay = await pageWithUrl('overlay.html')
  const start = overlay.locator('.import-choices + .intro-buttons .btn')
  await expect(start).toHaveText('Import 2')
  await overlay.locator('.import-choices label', { hasText: 'Chrome' }).click()
  await overlay.locator('.import-choices label', { hasText: 'Arc · Personal' }).click()
  await expect(start).toHaveText('Import 2')
  await start.click()
  await expect(overlay.locator('.intro h1')).toHaveText('Make YARC your default browser')
  const s = await state()
  const added = s.spaces.slice(before)
  expect(added.map((x) => x.name)).toEqual(['Work', 'Chrome'])
  expect(new Set(s.spaces.map((x) => x.profileId)).size).toBe(s.spaces.length)
  expect(added[1].pinned).toMatchObject([{ kind: 'folder', name: 'Bookmarks', children: [{ url: `${base}/bookmarked`, title: 'Kept' }] }])
  await dispatch({ type: 'endTour' })
  for (const x of added) await dispatch({ type: 'deleteSpace', id: x.id })
})

test('spaces with their own profile do not share storage', async () => {
  await dispatch({ type: 'open', url: `${base}/storage`, where: 'tab' })
  const a = await pageWithUrl('/storage')
  await a.evaluate(() => localStorage.setItem('who', 'space-a'))
  const first = await space()
  const spaces = (await state()).spaces.length
  await dispatch({ type: 'createSpace', name: 'Work', emoji: '💼', color: '#3fa7d6', profileId: 'new' })
  const s = await state()
  expect(s.spaces).toHaveLength(spaces + 1)
  expect(s.activeSpaceId).not.toBe(first.id)
  expect((await space()).profileId).not.toBe(first.profileId)
  const firstSpace = first.id
  await dispatch({ type: 'open', url: `${base}/storage-b`, where: 'tab' })
  const b = await pageWithUrl('/storage-b')
  expect(await b.evaluate(() => localStorage.getItem('who'))).toBeNull()
  // Same origin, different profile: cookies are separate too.
  await b.evaluate(() => (document.cookie = 'k=b'))
  expect(await a.evaluate(() => document.cookie)).not.toContain('k=b')
  await dispatch({ type: 'switchSpace', id: firstSpace })
  expect((await state()).activeSpaceId).toBe(firstSpace)
})

test('Little Window opens a mini window and can move the page into the main window', async () => {
  await dispatch({ type: 'littleArc', url: `${base}/little` })
  await pageWithUrl('little.html')
  await pageWithUrl(`${base}/little`)
  const count = (await space()).today.length
  await app.evaluate(() => {
    const b = (globalThis as any).arcBrowser
    const l = b.openLittles()[0]
    l.op('openInMain')
  })
  await expect.poll(async () => (await space()).today.length).toBe(count + 1)
  expect((await space()).today[0].url).toBe(`${base}/little`)

  // Once the Little Window has closed, the page can still be left and selected again.
  const moved = (await space()).today[0]
  await dispatch({ type: 'open', url: `${base}/after-little`, where: 'tab' })
  await expect.poll(async () => (await space()).activeItemId).not.toBe(moved.id)
  await dispatch({ type: 'activate', id: moved.id })
  expect((await state()).layout.views.map((v) => v.id)).toEqual([moved.id])
})

test('Little Window reopens a page with the profile picked on its chip, remembered per site, and keeps its size', async () => {
  const url = `${base}/little-profile`
  const littles = () =>
    app.evaluate(() => (globalThis as any).arcBrowser.openLittles().map((l: any) => ({ profile: l.profile.id as string, url: l.url as string, size: l.win.getSize() as number[] })) as { profile: string; url: string; size: number[] }[])
  await app.evaluate(() => (globalThis as any).arcBrowser.state.profiles.push({ id: 'p-little', name: 'Chip', favorites: [] }))
  await dispatch({ type: 'littleArc', url })
  await expect.poll(async () => (await littles()).find((l) => l.url === url)?.profile).toBeTruthy()
  expect((await littles()).find((l) => l.url === url)?.profile).not.toBe('p-little')

  await app.evaluate((_e, url) => {
    const b = (globalThis as any).arcBrowser
    b.openLittles().find((l: any) => l.url === url).switchProfile('p-little')
  }, url)
  await expect.poll(async () => (await littles()).filter((l) => l.url === url).map((l) => l.profile)).toEqual(['p-little'])
  const chips = () => Promise.all(app.windows().filter((w) => w.url().includes('little.html') && !w.isClosed()).map((w) => w.locator('.little-profile').textContent()))
  await expect.poll(chips).toContain('Chip')

  // The user resizes it, closes it, and opens the site again: same profile, same size.
  await app.evaluate((_e, url) => {
    const l = (globalThis as any).arcBrowser.openLittles().find((l: any) => l.url === url)
    l.win.setSize(720, 520)
    l.win.emit('resized')
    l.win.close()
  }, url)
  await expect.poll(async () => (await littles()).length).toBe(0)
  await dispatch({ type: 'littleArc', url })
  await expect.poll(async () => (await littles()).find((l) => l.url === url)).toMatchObject({ profile: 'p-little', size: [720, 520] })

  await app.evaluate(() => {
    const b = (globalThis as any).arcBrowser
    for (const l of b.openLittles()) l.win.close()
    b.state.littleArc = { profileByHost: {} }
    b.state.profiles = b.state.profiles.filter((p: any) => p.id !== 'p-little')
  })
  await expect.poll(async () => (await littles()).length).toBe(0)
})

test('camera and microphone read as askable until blocked, so sites like Meet request them', async () => {
  await dispatch({ type: 'open', url: `${base}/media`, where: 'tab' })
  await expect.poll(async () => (await state()).live[(await space()).activeItemId!]?.loading).toBe(false)
  const query = () =>
    app.evaluate(() =>
      (globalThis as any).arcBrowser
        .activeTab()
        .wc.executeJavaScript(`Promise.all(['camera', 'microphone'].map((name) => navigator.permissions.query({ name }).then((p) => p.state)))`)
    )
  expect(await query()).toEqual(['granted', 'granted'])
  // Blocking is remembered per profile, site and device (SiteDecisions): block both.
  const remember = (allowed: boolean | undefined) =>
    app.evaluate(
      (_e, [origin, allowed]) => {
        const b = (globalThis as any).arcBrowser
        const decisions = b.profiles.decisions(b.space.profileId)
        for (const key of ['media:video', 'media:audio']) allowed === null ? decisions.reset(origin, key) : decisions.set(origin, key, allowed ? 'allow' : 'block')
      },
      [base, allowed ?? null] as const
    )
  await remember(false)
  expect(await query()).toEqual(['denied', 'denied'])
  await remember(undefined)
})

const adblockReady = () => app.evaluate(() => !!(globalThis as any).arcBrowser.adblock.engine)

test('built-in ad blocking blocks ad requests and can be turned off per site', async () => {
  await expect.poll(adblockReady).toBe(true)
  await dispatch({ type: 'open', url: `${base}/ads`, where: 'tab' })
  await expect.poll(async () => (await state()).live[(await space()).activeItemId!]?.loading).toBe(false)
  const id = (await space()).activeItemId!
  // Injected from the main process: a Playwright-attached page doesn't survive the reload below in packaged builds.
  await app.evaluate(
    (_e, src) => (globalThis as any).arcBrowser.activeTab().wc.executeJavaScript(src),
    `for (const src of ['https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js']) {
      const s = document.createElement('script'); s.src = src; document.head.appendChild(s)
    }`
  )
  await expect.poll(async () => (await state()).live[id]?.blocked ?? 0).toBeGreaterThanOrEqual(2)
  expect((await state()).live[id].shielded).toBe(true)
  await dispatch({ type: 'adblockToggleSite' })
  expect((await state()).settings.adblockAllowlist).toContain('127.0.0.1')
  await expect.poll(async () => (await state()).live[id]?.shielded).toBe(false)
  await dispatch({ type: 'adblockToggleSite' })
  expect((await state()).settings.adblockAllowlist).not.toContain('127.0.0.1')
})

// Shaped like Ghostery's: helpers declared at top level, keeping state on the function, wrapping Function.prototype.toString.
const SCRIPTLET = `class Helper {}
function wrapToString() {
  if (wrapToString.native) return
  wrapToString.native = Function.prototype.toString
  Function.prototype.toString = new Proxy(wrapToString.native, { apply: (_, self) => wrapToString.native.call(self) })
}
wrapToString()
window.scriptlets = (window.scriptlets ?? 0) + 1`

test('ad block scriptlets run before the page’s own scripts, each in its own scope, and one that throws is caught', async () => {
  await expect.poll(adblockReady).toBe(true)
  await app.evaluate((_e, scriptlet) => {
    const engine = (globalThis as any).arcBrowser.adblock.engine
    const original = engine.getCosmeticsFilters
    engine.restoreForTest = () => (engine.getCosmeticsFilters = original)
    engine.getCosmeticsFilters = function (request: { url: string; getInjectionRules: boolean }) {
      const result = original.call(this, request)
      if (!request.url.includes('/still-loading') || !request.getInjectionRules) return result
      return { ...result, scripts: [...Array(12).fill(scriptlet), 'throw new Error("scriptlet")'] }
    }
  }, SCRIPTLET)
  try {
    await dispatch({ type: 'open', url: `${base}/still-loading`, where: 'tab' })
    const ran = () =>
      app.evaluate(async () => {
        const wc = (globalThis as any).arcBrowser.activeTab().wc
        return { loading: wc.isLoading(), count: await wc.mainFrame.executeJavaScript('window.scriptlets ?? 0'), seenByPage: await wc.mainFrame.executeJavaScript('window.seenByPage') }
      })
    await expect.poll(async () => (await ran()).count).toBe(12)
    expect(await ran()).toMatchObject({ loading: true, seenByPage: 12 })
    expect(await app.evaluate(() => (globalThis as any).arcBrowser.activeTab().wc.mainFrame.executeJavaScript('Function.prototype.toString.call(alert)'))).toContain('[native code]')
    const log = readFileSync(join(userData, 'logs', 'main.log'), 'utf8')
    expect(log).not.toContain('Script failed to execute')
    expect(log).not.toContain('MaxListenersExceededWarning')
  } finally {
    await app.evaluate(() => (globalThis as any).arcBrowser.adblock.engine.restoreForTest())
    await dispatch({ type: 'close', id: (await space()).activeItemId! })
  }
})

// What Windows/macOS do when YARC is the default browser: start a second instance with the URL.
function launchSecondInstance(arg: string, cwd = process.cwd()): void {
  const exe = process.env.YARC_EXE
  const env = { ...process.env, YARC_USER_DATA: userData, YARC_TEST: '1' }
  const child = exe
    ? spawn(exe, ['--', arg], { cwd, env, stdio: 'ignore' })
    : spawn(require('electron') as unknown as string, [join(process.cwd(), 'out/main/index.js'), arg], { cwd, env, stdio: 'ignore' })
  child.unref()
}

test('links and .html files from other apps open in a Little Window', async () => {
  const littles = () => app.evaluate(() => (globalThis as any).arcBrowser.openLittles().length as number)
  const before = await littles()
  launchSecondInstance(`${base}/from-slack`)
  await expect.poll(littles, { timeout: 15_000 }).toBe(before + 1)
  await pageWithUrl('/from-slack')
  const file = join(userData, 'local page.html')
  writeFileSync(file, '<title>Local file</title><h1>local</h1>')
  launchSecondInstance(file)
  await expect.poll(littles, { timeout: 15_000 }).toBe(before + 2)
  await pageWithUrl('local%20page.html')
  const site = join(userData, 'site')
  mkdirSync(site)
  writeFileSync(join(site, 'Résumé.html'), '<title>Résumé</title>')
  launchSecondInstance('Résumé.html', site)
  await expect.poll(littles, { timeout: 15_000 }).toBe(before + 3)
  await pageWithUrl('site/R%C3%A9sum%C3%A9.html')
  await app.evaluate(() => {
    for (const l of (globalThis as any).arcBrowser.openLittles()) l.win.close()
  })
  await expect.poll(littles).toBe(0)
})

test('Traffic Control opens matching links from other apps in their space instead of a Little Window', async () => {
  const home = (await state()).activeSpaceId
  await dispatch({ type: 'createSpace', name: 'Routed', emoji: '🚦', color: '#3fa7d6' })
  const other = await space()
  await dispatch({ type: 'switchSpace', id: home })
  await dispatch({ type: 'settings', patch: { linkRoutes: [{ match: `${base}/routed/`, spaceId: other.id }] } })
  expect((await state()).settings.linkRoutes).toEqual([{ match: `${new URL(base).host}/routed`, spaceId: other.id }])
  launchSecondInstance(`${base}/routed/page`)
  await expect.poll(async () => (await state()).activeSpaceId, { timeout: 15_000 }).toBe(other.id)
  await expect.poll(async () => (await space()).today[0]?.url).toBe(`${base}/routed/page`)
  expect(await app.evaluate(() => (globalThis as any).arcBrowser.openLittles().length)).toBe(0)
  await dispatch({ type: 'settings', patch: { linkRoutes: [] } })
  await dispatch({ type: 'deleteSpace', id: other.id })
  await dispatch({ type: 'switchSpace', id: home })
})

test('updates: command bar check, then a sidebar pill and menu item once one is found', async () => {
  await dispatch({ type: 'overlay', mode: { kind: 'command', target: 'tab' } })
  const overlay = await pageWithUrl('overlay.html')
  await overlay.locator('.command input').fill('updates')
  await expect(overlay.locator('.result', { hasText: 'Check for Updates' })).toHaveCount(1)
  await expect(overlay.locator('.result', { hasText: 'Download YARC' })).toHaveCount(0)
  await dispatch({ type: 'overlay', mode: { kind: 'none' } })

  // The real check needs the installed app; pretend it found a release.
  await app.evaluate(() => (globalThis as any).arcBrowser.updater.set({ state: 'available', version: '99.0.0' }))
  const ui = await pageWithUrl('index.html')
  await expect(ui.locator('.update-pill')).toContainText('Update Available')
  if (process.platform === 'darwin') {
    const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items[0].submenu!.items.map((i) => i.label))
    expect(labels).toContain('Update Available…')
  }
  await dispatch({ type: 'overlay', mode: { kind: 'command', target: 'tab' } })
  await overlay.locator('.command input').fill('download yarc')
  await expect(overlay.locator('.result', { hasText: 'Download YARC 99.0.0…' })).toHaveCount(1)
  await dispatch({ type: 'overlay', mode: { kind: 'none' } })

  await ui.locator('.update-pill').hover()
  await ui.locator('.update-pill-close').click()
  await expect(ui.locator('.update-pill')).toHaveCount(0)
  await app.evaluate(() => (globalThis as any).arcBrowser.updater.set({ state: 'none' }))
})

test('pages cannot turn themselves into window-drag areas', async () => {
  // Like Linear's web app: a page-sized `-webkit-app-region: drag` would otherwise swallow
  // every click over the page, including on the overlay panels above it.
  const html = '<div id="d" style="-webkit-app-region: drag !important; position: fixed; inset: 0">drag me</div>'
  await dispatch({ type: 'open', url: `data:text/html,${encodeURIComponent(html)}`, where: 'tab' })
  const page = await pageWithUrl('data:text/html')
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.getElementById('d')!).getPropertyValue('-webkit-app-region')))
    .toBe('no-drag')
})

test('a downloaded update opens the relaunch card only after a week, then at most once a day', async () => {
  const DAY = 24 * 60 * 60_000
  const since = Date.parse('2026-11-02T09:00:00')
  const offer = (iso: string) => app.evaluate((_e, iso) => (globalThis as any).arcBrowser.updater.offerRelaunch(Date.parse(iso)), iso)
  await app.evaluate((_e, since) => {
    const b = (globalThis as any).arcBrowser
    // set() also redraws the UI, so the sidebar pill appears.
    b.updater.set({ state: 'ready', version: '9.0.2', notes: [{ version: '9.0.2', changes: ['Second'] }, { version: '9.0.1', changes: ['First'] }] })
    b.state.waitingUpdate = { from: '0.0.0', since }
  }, since)
  // The card waits for a visible window; right after launch it can still be hidden.
  await expect.poll(() => app.evaluate(() => (globalThis as any).arcBrowser.window.win.isVisible())).toBe(true)
  // Six days after the download: only the sidebar pill.
  await offer(new Date(since + 6 * DAY).toISOString())
  expect(await overlayKind()).toBe('none')
  const ui = await pageWithUrl('index.html')
  // An earlier test dismissed the pill, which lasts until YARC restarts: reload the UI to start clean.
  await ui.reload()
  await expect(ui.locator('.update-pill')).toContainText('Restart to Update')
  // A week: the card.
  await offer('2026-11-09T09:00:00')
  expect(await overlayKind()).toBe('update')
  const overlay = await pageWithUrl('overlay.html')
  await expect(overlay.locator('.update-ready h1')).toHaveText('2 updates are ready')
  await expect(overlay.locator('.update-ready li')).toHaveText(['Second', 'First'])
  await overlay.locator('.update-ready button', { hasText: 'Later' }).click()
  await expect.poll(overlayKind).toBe('none')
  // "Later" holds for the rest of the day; a day later it asks again.
  await offer('2026-11-09T21:00:00')
  expect(await overlayKind()).toBe('none')
  await offer('2026-11-10T09:00:00')
  expect(await overlayKind()).toBe('update')
  await dispatch({ type: 'overlay', mode: { kind: 'none' } })
  await app.evaluate(() => {
    const b = (globalThis as any).arcBrowser
    b.state.waitingUpdate = undefined
    b.updater.set({ state: 'none' })
  })
})

test('the peeking sidebar stays out while the pointer is near it and slides back once it moves over the page', async () => {
  await dispatch({ type: 'open', url: `${base}/peek-away`, where: 'tab' })
  // Chromium sends mouse moves at the real cursor when views change: keep the window above or below it (a corner of 1024×768 can still be under it).
  const bounds = await app.evaluate(({ screen }) => {
    const win = (globalThis as any).arcBrowser.window.win
    const before = win.getBounds()
    const c = screen.getCursorScreenPoint()
    const a = screen.getDisplayNearestPoint(c).workArea
    const [above, below] = [c.y - a.y, a.y + a.height - c.y - 1]
    const height = Math.min(520, Math.max(above, below))
    win.setBounds({ x: a.x, y: above > below ? c.y - height : c.y + 1, width: 800, height })
    return before
  })
  await dispatch({ type: 'toggleSidebar' })
  await dispatch({ type: 'sidebarReveal', show: true })
  const moveIn = (target: 'overlay' | 'page', x: number) =>
    app.evaluate(
      (_e, [t, px]) => {
        const b = (globalThis as any).arcBrowser
        const wc = t === 'overlay' ? b.window.overlay.webContents : b.activeTab().wc
        wc.sendInputEvent({ type: 'mouseMove', x: px, y: 200 })
      },
      [target, x] as const
    )
  await moveIn('overlay', 40)
  // Just past the sidebar's edge, over the page, is still near it: no timer to hide it.
  await app.evaluate(() => {
    const w = (globalThis as any).arcBrowser.window
    const watch = w.pointerWatch
    w.pointerWatch = (p: unknown) => {
      watch(p)
      ;(globalThis as any).pointerSeen = true
    }
  })
  await moveIn('page', 10)
  await expect.poll(() => app.evaluate(() => (globalThis as any).pointerSeen)).toBe(true)
  expect(await app.evaluate(() => (globalThis as any).arcBrowser.cur.sidebarRevealHide)).toBeUndefined()
  expect(await overlayKind()).toBe('sidebar')
  await moveIn('page', 600)
  await expect.poll(overlayKind).toBe('none')
  await dispatch({ type: 'toggleSidebar' })
  await app.evaluate((_e, b) => (globalThis as any).arcBrowser.window.win.setBounds(b), bounds)
})

test('dragging a tab inside the peeking sidebar drops in the sidebar, not on the split zones', async () => {
  for (const n of ['peek-fav', 'peek-tube']) await dispatch({ type: 'open', url: `${base}/${n}`, where: 'tab' })
  const fav = (await space()).today.find((t) => t.url.endsWith('/peek-fav'))!
  const tube = (await space()).today.find((t) => t.url.endsWith('/peek-tube'))!
  await dispatch({ type: 'addFavorite', id: fav.id })
  // The hidden sidebar slides out on hover; keep it out although the real pointer is elsewhere.
  await app.evaluate(() => {
    const b = (globalThis as any).arcBrowser
    b.realWatchSidebarReveal = b.watchSidebarReveal
    b.watchSidebarReveal = () => {}
  })
  await dispatch({ type: 'toggleSidebar' })
  await dispatch({ type: 'sidebarReveal', show: true })
  const overlay = await pageWithUrl('overlay.html')
  await expect(overlay.locator('.sidebar.floating .row .title', { hasText: 'Page peek-tube' })).toBeVisible()
  // Start dragging the tab: the overlay grows over the whole window for the split zones.
  await overlay.evaluate(() => {
    const w = window as any
    w.src = [...document.querySelectorAll('.row')].find((r) => r.querySelector('.title')?.textContent === 'Page peek-tube')
    w.dt = new DataTransfer()
    w.src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: w.dt }))
  })
  await expect(overlay.locator('.split-drop')).toBeVisible()
  // Drop on the favorites, at whatever is on top there, as a real drag would hit it.
  const hit = await overlay.evaluate(() => {
    const w = window as any
    const r = document.querySelector('.favorites')!.getBoundingClientRect()
    const x = r.right - 6
    const y = r.top + r.height / 2
    const el = document.elementFromPoint(x, y)!
    for (const type of ['dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: w.dt }))
    w.src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: w.dt }))
    return !!el.closest('.sidebar')
  })
  expect(hit).toBe(true)
  await expect.poll(async () => (await state()).profiles[0].favorites.map((f) => f.id)).toContain(tube.id)
  expect((await space()).splits).toHaveLength(0)
  await dispatch({ type: 'sidebarReveal', show: false })
  await dispatch({ type: 'toggleSidebar' })
  await app.evaluate(() => {
    const b = (globalThis as any).arcBrowser
    b.watchSidebarReveal = b.realWatchSidebarReveal
  })
})

test('a tab selected in two windows is live in one and mirrored, greyed, in the other; the other takes it back when it is let go', async () => {
  await dispatch({ type: 'open', url: `${base}/shared`, where: 'tab' })
  const shared = (await space()).activeItemId!
  await dispatch({ type: 'open', url: `${base}/other`, where: 'tab' })
  const other = (await space()).activeItemId!
  await dispatch({ type: 'activate', id: shared })

  // A second window selects the same tab: it takes the page; the first shows a still of it.
  await app.evaluate((_e, id) => {
    const b = (globalThis as any).arcBrowser
    b.openNewWindow()
    b.inWin(b.wins[1], () => b.activate(id))
  }, shared)
  const where = () =>
    app.evaluate((_e, id) => {
      const b = (globalThis as any).arcBrowser
      const view = b.live.get(id).view
      return b.wins.map((w: any) => (w.main.isShown(view) ? 'live' : w.layout.views.some((v: any) => v.id === id && v.elsewhere) ? 'still' : 'none'))
    }, shared)
  await expect.poll(where).toEqual(['still', 'live'])

  // What happens in the live window shows in the other one: its still keeps coming.
  await app.evaluate(() => {
    const ui = (globalThis as any).arcBrowser.wins[0].main.ui
    const send = ui.send.bind(ui)
    ;(globalThis as any).stills = 0
    ui.send = (channel: string, ...args: unknown[]) => {
      if (channel === 'arc:still') (globalThis as any).stills++
      return send(channel, ...args)
    }
  })
  await expect.poll(async () => (await state()).live[shared]?.loading).toBe(false)
  await app.evaluate((_e, { id, url }) => (globalThis as any).arcBrowser.live.get(id).wc.loadURL(url), { id: shared, url: `${base}/moved` })
  await expect.poll(() => app.evaluate(() => (globalThis as any).stills), { timeout: 10_000 }).toBeGreaterThan(0)

  // The second window moves on to another tab: the first gets the page back, live.
  await app.evaluate((_e, id) => {
    const b = (globalThis as any).arcBrowser
    b.inWin(b.wins[1], () => b.activate(id))
  }, other)
  await expect.poll(where).toEqual(['live', 'none'])
  expect(await app.evaluate(() => (globalThis as any).arcBrowser.mirror.subs.size)).toBe(0)

  await app.evaluate(() => (globalThis as any).arcBrowser.wins[1].main.win.close())
  await expect.poll(() => app.evaluate(() => (globalThis as any).arcBrowser.wins.length)).toBe(1)
})

test('state survives a restart', async () => {
  const before = await state()
  await app.close()
  app = await launch()
  const after = await state()
  expect(after.spaces.map((s) => s.name)).toEqual(before.spaces.map((s) => s.name))
  expect(after.spaces[0].pinned.length).toBe(before.spaces[0].pinned.length)
  expect(after.profiles[0].favorites.length).toBe(before.profiles[0].favorites.length)
})

test('menu bar commands reopen the closed main window (macOS)', async () => {
  test.skip(process.platform !== 'darwin', 'macOS keeps the app running without windows')
  await app.evaluate(() => (globalThis as any).arcBrowser.window.win.close())
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
  await app.evaluate(({ Menu }) => {
    const items = (m: Electron.Menu): Electron.MenuItem[] => m.items.flatMap((i) => [i, ...(i.submenu ? items(i.submenu) : [])])
    items(Menu.getApplicationMenu()!).find((i) => i.label === 'New Tab')!.click()
  })
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  await expect.poll(overlayKind).toBe('command')
})

const isPlaying = (id: string) => app.evaluate((_e, tabId) => (globalThis as any).arcBrowser.live.get(tabId).playing as boolean, id)
/** Playing and painted: a hidden tab paints no canvas, so a stream left before its first frame never gets one, and a video without a frame doesn't float. */
const untilShowing = async (id: string) => {
  await expect.poll(() => isPlaying(id), { timeout: 10_000 }).toBe(true)
  const painted = '(v => v.readyState >= 2 && v.videoWidth > 0)(document.getElementById("v"))'
  await expect.poll(() => app.evaluate((_e, [tabId, code]) => (globalThis as any).arcBrowser.live.get(tabId).wc.executeJavaScript(code), [id, painted] as const)).toBe(true)
}
/** What the app and the page know about the video, for a failure message: CI keeps no logs of the app. */
const mediaReport = (id: string) =>
  app.evaluate(async (_e, tabId) => {
    const b = (globalThis as any).arcBrowser
    const t = b.live.get(tabId)
    const video = '(v => v && { paused: v.paused, readyState: v.readyState, videoWidth: v.videoWidth, popover: v.matches(":popover-open"), hidden: document.hidden })(document.getElementById("v"))'
    const page = t && !t.destroyed ? await t.wc.executeJavaScript(video).catch((e: Error) => e.message) : 'no live tab'
    return JSON.stringify({ media: b.media, floatVideos: b.state.settings.floatVideos, onScreen: b.onScreen.has(tabId), playerTab: b.floating.tabId, playing: t?.playing, audible: t?.wc.isCurrentlyAudible(), page })
  }, id)
const untilFloating = async (id: string) => {
  try {
    await expect.poll(async () => (await state()).media.floating, { timeout: 10_000 }).toBe(id)
  } catch (e) {
    throw new Error(`${(e as Error).message}\n${await mediaReport(id)}`)
  }
}
const floatingPlayer = () =>
  app.evaluate(({ BaseWindow }) => {
    const w = BaseWindow.getAllWindows().find((x) => x.getTitle() === 'Floating Player')
    return w ? { onTop: w.isAlwaysOnTop(), resizable: w.isResizable() } : null
  })

test('a playing video floats when you leave its tab, and goes back into the page when you return', async () => {
  await dispatch({ type: 'open', url: `${base}/video-page` })
  const video = (await space()).activeItemId!
  await untilShowing(video)

  await dispatch({ type: 'open', url: `${base}/after-video` })
  await untilFloating(video)
  expect(await floatingPlayer()).toEqual({ onTop: true, resizable: true })

  await dispatch({ type: 'activate', id: video })
  await expect.poll(async () => (await state()).media.floating).toBeUndefined()
  expect(await floatingPlayer()).toBeNull()
  expect(await isPlaying(video)).toBe(true)
  await dispatch({ type: 'close', id: video })
})

test("the floating player's – keeps the video playing as a sidebar card, whose button floats it again", async () => {
  await dispatch({ type: 'open', url: `${base}/video-page` })
  const video = (await space()).activeItemId!
  await untilShowing(video)
  await dispatch({ type: 'open', url: `${base}/after-video-card` })
  await untilFloating(video)

  await app.evaluate(() => (globalThis as any).arcBrowser.minimizeFloating())
  expect((await state()).media).toEqual({ cards: [video], floating: undefined, videos: [video] })
  expect(await isPlaying(video)).toBe(true)
  const ui = await pageWithUrl('index.html')
  await expect(ui.locator('.media-card')).toHaveCount(1)

  await dispatch({ type: 'media', id: video, op: 'float' })
  await untilFloating(video)
  await expect(ui.locator('.media-card')).toHaveCount(0)

  await dispatch({ type: 'close', id: video })
  await expect.poll(async () => (await state()).media.floating).toBeUndefined()
  expect(await floatingPlayer()).toBeNull()
})

test('a video paused before you leave its tab gets no player and no card', async () => {
  await dispatch({ type: 'open', url: `${base}/video-page` })
  const video = (await space()).activeItemId!
  await expect.poll(() => isPlaying(video), { timeout: 10_000 }).toBe(true)
  await app.evaluate((_e, id) => (globalThis as any).arcBrowser.live.get(id).wc.executeJavaScript('document.getElementById("v").pause()'), video)
  await expect.poll(() => isPlaying(video)).toBe(false)
  // Chromium reports the tab audible for a moment after the pause, and an audible tab gets a card.
  await expect.poll(() => app.evaluate((_e, id) => (globalThis as any).arcBrowser.live.get(id).wc.isCurrentlyAudible(), video)).toBe(false)

  await app.evaluate((_e, id) => {
    const b = (globalThis as any).arcBrowser
    const tabLeft = b.tabLeft
    b.tabLeft = (left: string) => {
      const done = tabLeft.call(b, left)
      if (left === id) (globalThis as any).videoLeft = done
      return done
    }
  }, video)
  await dispatch({ type: 'open', url: `${base}/after-paused-video` })
  await expect.poll(() => app.evaluate(() => !!(globalThis as any).videoLeft)).toBe(true)
  await app.evaluate(() => (globalThis as any).videoLeft)
  const tab = await app.evaluate((_e, id) => {
    const t = (globalThis as any).arcBrowser.live.get(id)
    return `video ${id}: playing ${t.playing}, audible ${t.wc.isCurrentlyAudible()}`
  }, video)
  expect((await state()).media, tab).toEqual({ cards: [], floating: undefined, videos: [] })
  await dispatch({ type: 'close', id: video })
})

test('Little Window can move its page into a closed main window (macOS)', async () => {
  test.skip(process.platform !== 'darwin', 'macOS keeps the app running without windows')
  await app.evaluate(() => (globalThis as any).arcBrowser.window.win.close())
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
  await app.evaluate((_e, url) => (globalThis as any).arcBrowser.openLittle(url), `${base}/little-closed`)
  await pageWithUrl('/little-closed')
  await app.evaluate(() => (globalThis as any).arcBrowser.openLittles()[0].op('openInMain'))
  await expect.poll(async () => (await space()).today.some((t) => t.url.endsWith('/little-closed'))).toBe(true)
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
})

function extensionDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'yarc-ext-'))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content))
  return dir
}

const removeExtension = (id: string) =>
  app.evaluate((_e, id) => {
    const b = (globalThis as any).arcBrowser
    b.profiles.get(b.store.activeSpace.profileId).session.extensions.removeExtension(id)
  }, id)

// electron-chrome-extensions only fills `chrome`; extensions written against `browser.*` (1Password
// reads browser.windows when its background starts) need the same APIs there.
test('extensions get the chrome.* APIs on browser.* too', async () => {
  const dir = extensionDir({
    'manifest.json': { manifest_version: 3, name: 'browser namespace', version: '1.0', background: { service_worker: 'bg.js', type: 'module' } },
    'bg.js': 'console.log(`browser.windows: ${typeof browser.windows}, browser.tabs.query: ${typeof browser.tabs.query}`)'
  })
  const logged = await app.evaluate(async (_e, extDir) => {
    const b = (globalThis as any).arcBrowser
    const ses = b.profiles.get(b.store.activeSpace.profileId).session
    const message = new Promise<string>((resolve) =>
      ses.serviceWorkers.on('console-message', (_ev: unknown, d: { message: string }) => d.message.startsWith('browser.') && resolve(d.message))
    )
    const ext = await ses.extensions.loadExtension(extDir)
    const result = await message
    ses.extensions.removeExtension(ext.id)
    return result
  }, dir)
  expect(logged).toBe('browser.windows: object, browser.tabs.query: function')
})

// Electron has no declarativeNetRequest: YARC's own one makes MV3 blockers (uBlock Origin Lite) block.
test('an extension’s declarativeNetRequest rules block requests, from its manifest and from its code, and redirect once granted the site', async () => {
  const blockScript = (id: number, urlFilter: string) => ({ id, action: { type: 'block' }, condition: { urlFilter, resourceTypes: ['script'] } })
  // Redirects need the site's permission, which this extension only asks for at runtime.
  const redirectScript = { id: 2, action: { type: 'redirect', redirect: { url: `${base}/dnr-redirected.js` } }, condition: { urlFilter: '/dnr-redirect.js', resourceTypes: ['script'] } }
  const dir = extensionDir({
    'manifest.json': {
      manifest_version: 3,
      name: 'dnr blocker',
      version: '1.0',
      permissions: ['declarativeNetRequest'],
      optional_host_permissions: ['<all_urls>'],
      background: { service_worker: 'bg.js' },
      declarative_net_request: { rule_resources: [{ id: 'on', enabled: true, path: 'on.json' }, { id: 'off', enabled: false, path: 'off.json' }] }
    },
    'on.json': [blockScript(1, '/dnr-static.js')],
    'off.json': [blockScript(1, '/dnr-kept.js')],
    'bg.js': `chrome.permissions.request({ origins: ['<all_urls>'] })
      .then(() => chrome.declarativeNetRequest.updateDynamicRules({ addRules: ${JSON.stringify([blockScript(1, '||127.0.0.1^*/dnr-dynamic.js'), redirectScript])} }))
      .then(() => chrome.declarativeNetRequest.getEnabledRulesets())
      .then((ids) => console.log('dnr ready: ' + ids.join(',')))`
  })
  const extId = await app.evaluate(async (_e, extDir) => {
    const b = (globalThis as any).arcBrowser
    const ses = b.profiles.get(b.store.activeSpace.profileId).session
    const ready = new Promise<string>((resolve) =>
      ses.serviceWorkers.on('console-message', (_ev: unknown, d: { message: string }) => d.message.startsWith('dnr ready') && resolve(d.message))
    )
    const ext = await ses.extensions.loadExtension(extDir)
    if ((await ready) !== 'dnr ready: on') throw new Error('unexpected rulesets')
    return ext.id
  }, dir)
  const scripts = ['/dnr-static.js', '/dnr-dynamic.js', '/dnr-redirect.js', '/dnr-redirected.js', '/dnr-kept.js']
  await dispatch({ type: 'open', url: `${base}/dnr-page`, where: 'tab' })
  const tabId = (await space()).activeItemId!
  try {
    // The redirect is an extra hop, so its script can come after the last one in the page.
    await expect.poll(() => hits.includes('/dnr-kept.js') && hits.includes('/dnr-redirected.js'), { timeout: 15_000 }).toBe(true)
    expect(scripts.filter((s) => hits.includes(s))).toEqual(['/dnr-redirected.js', '/dnr-kept.js'])
  } finally {
    await dispatch({ type: 'close', id: tabId })
    await removeExtension(extId)
  }
})

test('an extension popup opens toward the page, whichever side the sidebar is on', async () => {
  const dir = extensionDir({
    'manifest.json': { manifest_version: 3, name: 'popup side', version: '1.0', action: { default_popup: 'popup.html' } },
    'popup.html': 'popup'
  })
  const extId = await app.evaluate(async (_e, extDir) => {
    const b = (globalThis as any).arcBrowser
    return (await b.profiles.get(b.store.activeSpace.profileId).session.extensions.loadExtension(extDir)).id
  }, dir)
  await dispatch({ type: 'open', url: `${base}/popup-anchor`, where: 'tab' })
  const tabId = (await space()).activeItemId!
  const ui = app.windows().find((w) => w.url().endsWith('index.html'))!
  const popupInsideWindow = async () => {
    await app.evaluate(() => {
      const b = (globalThis as any).arcBrowser
      b.extensions.byProfile.get(b.store.activeSpace.profileId).once('browser-action-popup-created', (popup: unknown) => ((globalThis as any).popup = popup))
    })
    await ui.locator(`browser-action-list button[id="${extId}"]`).click()
    await expect.poll(() => app.evaluate(() => !!(globalThis as any).popup)).toBe(true)
    const inside = await app.evaluate(() => {
      const g = globalThis as any
      const popup = g.popup
      g.popup = undefined
      // A hidden window doesn't render under test, so the popup never reports a size: size and place it as the library then would.
      popup.setSize({ width: 300, height: 200 })
      popup.updatePosition()
      const p = popup.browserWindow.getBounds()
      const m = g.arcBrowser.window.win.getBounds()
      popup.destroy()
      return p.x >= m.x && p.x + p.width <= m.x + m.width
    })
    expect(inside).toBe(true)
  }
  try {
    await popupInsideWindow()
    await dispatch({ type: 'settings', patch: { sidebarRight: true } })
    await popupInsideWindow()
  } finally {
    await dispatch({ type: 'settings', patch: { sidebarRight: false } })
    await dispatch({ type: 'close', id: tabId })
    await removeExtension(extId)
  }
})

// electron-chrome-extensions wrote to a host's closed stdin with no error listener: an uncaught EPIPE crashed the app (#122).
test('an extension whose native messaging host stops reading gets a disconnect, and the app keeps running', async () => {
  test.skip(process.platform === 'win32', 'Windows finds hosts in the registry')
  const host = join(userData, 'closed-host.sh')
  writeFileSync(host, '#!/bin/sh\nexec 0<&-\nsleep 30\n')
  chmodSync(host, 0o755)
  // The host must list the extension's ID before it loads: a manifest key fixes it, as Chrome derives it.
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' })
  const id = [...createHash('sha256').update(key).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')
  const dir = extensionDir({
    'manifest.json': { manifest_version: 3, name: 'closed host', version: '1.0', key: key.toString('base64'), permissions: ['nativeMessaging'], background: { service_worker: 'bg.js' } },
    'bg.js': `const port = chrome.runtime.connectNative('org.yarc.closed_host')
      const ping = setInterval(() => port.postMessage({ ping: true }), 100)
      port.onDisconnect.addListener(() => { clearInterval(ping); console.log('native host disconnected') })`
  })
  mkdirSync(join(userData, 'NativeMessagingHosts'), { recursive: true })
  writeFileSync(
    join(userData, 'NativeMessagingHosts', 'org.yarc.closed_host.json'),
    JSON.stringify({ name: 'org.yarc.closed_host', description: 'e2e', path: host, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] })
  )
  const extId = await app.evaluate(async (_e, extDir) => {
    const b = (globalThis as any).arcBrowser
    const ses = b.profiles.get(b.store.activeSpace.profileId).session
    const disconnected = new Promise<void>((resolve) =>
      ses.serviceWorkers.on('console-message', (_ev: unknown, d: { message: string }) => d.message === 'native host disconnected' && resolve())
    )
    const ext = await ses.extensions.loadExtension(extDir)
    ;(globalThis as any).nativeHostDisconnected = disconnected
    return ext.id
  }, dir)
  try {
    expect(extId).toBe(id)
    await app.evaluate(() => (globalThis as any).nativeHostDisconnected)
    expect(readFileSync(join(userData, 'logs', 'main.log'), 'utf8')).not.toContain('EPIPE')
  } finally {
    await removeExtension(extId)
  }
})

test('Whole Page captures the full length of a page, past what is on screen', async () => {
  const long = `data:text/html,${encodeURIComponent('<!doctype html><title>Long page</title><body style="margin:0"><div style="height:3000px;background:linear-gradient(red,blue)"></div>')}`
  await dispatch({ type: 'open', url: long, where: 'tab' })
  await expect.poll(async () => (await state()).spaces.flatMap((s) => s.today).find((t) => t.title === 'Long page')?.id).toBeTruthy()
  const size = await app.evaluate(async ({ clipboard, nativeImage }) => {
    const b = (globalThis as any).arcBrowser
    const tab = b.activeTab()
    clipboard.clear()
    await b.canvases.capture(tab, { x: 0, y: 0, width: 10, height: 10 }, 'copy', true)
    const png = await (await clipboard.read())[0].getType('image/png')
    return { image: nativeImage.createFromBuffer(Buffer.from(await png.arrayBuffer())).getSize(), view: tab.view.getBounds(), attached: tab.wc.debugger.isAttached() }
  })
  expect(size.image.height).toBeGreaterThan(size.view.height)
  expect(size.image.height / size.image.width).toBeGreaterThan(2)
  expect(size.attached).toBe(false)
  await dispatch({ type: 'close', id: (await space()).activeItemId! })
})
