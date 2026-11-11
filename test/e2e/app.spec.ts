// End-to-end tests against the built app (run `pnpm build` first; `pnpm test:e2e` does).
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Action } from '../../src/shared/actions'
import type { AppState } from '../../src/shared/types'

let app: ElectronApplication
let server: Server
let base = ''
const userData = mkdtempSync(join(tmpdir(), 'yarc-e2e-'))

const page = (name: string) =>
  `<!doctype html><title>Page ${name}</title><h1>${name}</h1>` +
  `<a id="blank" href="/child-of-${name}" target="_blank">open child</a>` +
  `<a id="same" href="/next-${name}">same tab</a><p>findme findme findme</p>`

async function launch(): Promise<ElectronApplication> {
  // YARC_EXE runs the suite against a packaged app (e.g. release/win-unpacked/YARC.exe).
  const exe = process.env.YARC_EXE
  const a = await electron.launch({
    ...(exe ? { executablePath: exe, args: [] } : { args: ['out/main/index.js'] }),
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
    res.setHeader('content-type', 'text/html')
    res.end(page((req.url ?? '/').slice(1) || 'home'))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  app = await launch()
})

test.afterAll(async () => {
  await app?.close()
  server?.close()
})

test('starts with a default space and the sidebar', async () => {
  const ui = await pageWithUrl('index.html')
  await expect(ui.locator('.sidebar')).toBeVisible()
  await expect(ui.locator('.space-name')).toContainText('Personal')
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
  await pressInActiveTab('T', [mod])
  const overlay = await pageWithUrl('overlay.html')
  await expect(overlay.locator('.command input')).toBeVisible()
  await overlay.locator('.command input').fill(`${base}/two`)
  await overlay.locator('.command input').press('Enter')
  await expect.poll(async () => (await space()).today.map((t) => t.url)).toEqual([`${base}/two`, `${base}/one`])
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
  expect(await app.evaluate(() => (globalThis as any).arcBrowser.window.overlayMode.kind)).toBe('command')
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

test('favorites live at the top and belong to the profile', async () => {
  const two = (await space()).today.find((t) => t.url.endsWith('/two'))!
  await dispatch({ type: 'addFavorite', id: two.id })
  const s = await state()
  const profile = s.profiles.find((p) => p.id === (s.spaces.find((x) => x.id === s.activeSpaceId)!.profileId))!
  expect(profile.favorites.map((f) => f.id)).toContain(two.id)
  const ui = await pageWithUrl('index.html')
  await expect(ui.locator('.favorite')).toHaveCount(1)
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
      const row = [...document.querySelectorAll('.row')].find((r) => r.querySelector('.title')?.textContent === title)!
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
  await expect(ui.locator('.row .title', { hasText: 'Page drag-c' })).toBeVisible()
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

  // A drag that ends without a drop (Escape, or outside the window) changes nothing.
  await dragRow(ui, 'Page drag-c', 'dragstart')
  await expect.poll(dropLayerShown).toBe(true)
  await dragRow(ui, 'Page drag-c', 'dragend')
  await expect.poll(dropLayerShown).toBe(false)
  expect(await splitTitles()).toEqual(['row(drag-a, drag-b)'])

  // Onto the middle-right of a sidebar row: the tab joins as the pane right of that tab.
  await dragRow(ui, 'Page drag-c', 'dragstart')
  await expect(async () => {
    await dragRow(ui, 'Page drag-a', 'dragover', 0.75, 0.5)
    await expect(ui.locator('.split-preview')).toBeVisible({ timeout: 200 })
  }).toPass()
  await dragRow(ui, 'Page drag-a', 'drop', 0.75, 0.5)
  await dragRow(ui, 'Page drag-c', 'dragend')
  await expect.poll(splitTitles).toEqual(['row(drag-a, drag-c, drag-b)'])
  await expect.poll(dropLayerShown).toBe(false)
  await dispatch({ type: 'unsplit' })
})

test('closing a Today tab archives it and it can be reopened', async () => {
  const s = await space()
  const left = s.today.find((t) => t.url.endsWith('/left'))!
  await dispatch({ type: 'close', id: left.id })
  expect((await space()).today.some((t) => t.id === left.id)).toBe(false)
  expect((await state()).archive[0].url).toBe(`${base}/left`)
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

test('spaces with their own profile do not share storage', async () => {
  await dispatch({ type: 'open', url: `${base}/storage`, where: 'tab' })
  const a = await pageWithUrl('/storage')
  await a.evaluate(() => localStorage.setItem('who', 'space-a'))
  const firstSpace = (await state()).activeSpaceId
  await dispatch({ type: 'createSpace', name: 'Work', emoji: '💼', color: '#3fa7d6', profileId: 'new' })
  const s = await state()
  expect(s.spaces).toHaveLength(2)
  expect(s.activeSpaceId).not.toBe(firstSpace)
  expect(s.spaces[0].profileId).not.toBe(s.spaces[1].profileId)
  await dispatch({ type: 'open', url: `${base}/storage-b`, where: 'tab' })
  const b = await pageWithUrl('/storage-b')
  expect(await b.evaluate(() => localStorage.getItem('who'))).toBeNull()
  // Same origin, different profile: cookies are separate too.
  await b.evaluate(() => (document.cookie = 'k=b'))
  expect(await a.evaluate(() => document.cookie)).not.toContain('k=b')
  await dispatch({ type: 'switchSpace', id: firstSpace })
  expect((await state()).activeSpaceId).toBe(firstSpace)
})

test('Little Arc opens a mini window and can move the page into the main window', async () => {
  await dispatch({ type: 'littleArc', url: `${base}/little` })
  await pageWithUrl('little.html')
  await pageWithUrl('/little')
  const count = (await space()).today.length
  await app.evaluate(() => {
    const b = (globalThis as any).arcBrowser
    const l = [...b.littles][0]
    l.op('openInMain')
  })
  await expect.poll(async () => (await space()).today.length).toBe(count + 1)
  expect((await space()).today[0].url).toBe(`${base}/little`)
})

test('Little Arc reopens a page with the profile picked on its chip, remembered per site, and keeps its size', async () => {
  const url = `${base}/little-profile`
  const littles = () =>
    app.evaluate(() => [...(globalThis as any).arcBrowser.littles].map((l: any) => ({ profile: l.profile.id, url: l.url, size: l.win.getSize() })))
  await app.evaluate(() => (globalThis as any).arcBrowser.state.profiles.push({ id: 'p-little', name: 'Chip', favorites: [] }))
  await dispatch({ type: 'littleArc', url })
  await expect.poll(async () => (await littles()).find((l) => l.url === url)?.profile).toBeTruthy()
  expect((await littles()).find((l) => l.url === url)?.profile).not.toBe('p-little')

  await app.evaluate((_e, url) => {
    const b = (globalThis as any).arcBrowser
    b.switchLittleProfile([...b.littles].find((l: any) => l.url === url), 'p-little')
  }, url)
  await expect.poll(async () => (await littles()).filter((l) => l.url === url).map((l) => l.profile)).toEqual(['p-little'])
  const chips = () => Promise.all(app.windows().filter((w) => w.url().includes('little.html') && !w.isClosed()).map((w) => w.locator('.little-profile').textContent()))
  await expect.poll(chips).toContain('Chip')

  // The user resizes it, closes it, and opens the site again: same profile, same size.
  await app.evaluate((_e, url) => {
    const l = [...(globalThis as any).arcBrowser.littles].find((l: any) => l.url === url)
    l.win.setSize(1010, 710)
    l.win.emit('resized')
    l.win.close()
  }, url)
  await expect.poll(async () => (await littles()).length).toBe(0)
  await dispatch({ type: 'littleArc', url })
  await expect.poll(async () => (await littles()).find((l) => l.url === url)).toMatchObject({ profile: 'p-little', size: [1010, 710] })

  await app.evaluate(() => {
    const b = (globalThis as any).arcBrowser
    for (const l of b.littles) l.win.close()
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
  // Blocking is remembered per origin and per device (see PermissionQueue): block both.
  const remember = (allowed: boolean | undefined) =>
    app.evaluate(
      (_e, [origin, allowed]) => {
        const decisions = (globalThis as any).arcBrowser.profiles.permissionQueue.decisions as Map<string, boolean>
        for (const key of [`${origin}|media:video`, `${origin}|media:audio`]) allowed === null ? decisions.delete(key) : decisions.set(key, allowed as boolean)
      },
      [base, allowed ?? null] as const
    )
  await remember(false)
  expect(await query()).toEqual(['denied', 'denied'])
  await remember(undefined)
})

test('built-in ad blocking blocks ad requests and can be turned off per site', async () => {
  test.setTimeout(90_000)
  // The filter lists download on first start; wait for the engine.
  await expect.poll(() => app.evaluate(() => !!(globalThis as any).arcBrowser.adblock.engine), { timeout: 60_000 }).toBe(true)
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

// What Windows/macOS do when YARC is the default browser: start a second instance with the URL.
function launchSecondInstance(arg: string): void {
  const exe = process.env.YARC_EXE
  const env = { ...process.env, YARC_USER_DATA: userData, YARC_TEST: '1' }
  const child = exe
    ? spawn(exe, ['--', arg], { env, stdio: 'ignore' })
    : spawn(require('electron') as unknown as string, ['out/main/index.js', arg], { env, stdio: 'ignore' })
  child.unref()
}

test('links and .html files from other apps open in Little Arc', async () => {
  const littles = () => app.evaluate(() => (globalThis as any).arcBrowser.littles.size as number)
  const before = await littles()
  launchSecondInstance(`${base}/from-slack`)
  await expect.poll(littles, { timeout: 15_000 }).toBe(before + 1)
  await pageWithUrl('/from-slack')
  const file = join(userData, 'local page.html')
  writeFileSync(file, '<title>Local file</title><h1>local</h1>')
  launchSecondInstance(file)
  await expect.poll(littles, { timeout: 15_000 }).toBe(before + 2)
  await pageWithUrl('local%20page.html')
  await app.evaluate(() => {
    for (const l of (globalThis as any).arcBrowser.littles) l.win.close()
  })
  await expect.poll(littles).toBe(0)
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
  const kind = () => app.evaluate(() => (globalThis as any).arcBrowser.window.overlayMode.kind)
  await app.evaluate((_e, since) => {
    const b = (globalThis as any).arcBrowser
    b.updater.status = { state: 'ready', version: '9.0.2', notes: [{ version: '9.0.2', changes: ['Second'] }, { version: '9.0.1', changes: ['First'] }] }
    b.state.waitingUpdate = { from: '0.0.0', since }
  }, since)
  // Six days after the download: only the sidebar pill.
  await offer(new Date(since + 6 * DAY).toISOString())
  expect(await kind()).toBe('none')
  const ui = await pageWithUrl('index.html')
  await expect(ui.locator('.update-pill')).toContainText('Restart to Update')
  // A week: the card.
  await offer('2026-11-09T09:00:00')
  expect(await kind()).toBe('update')
  const overlay = await pageWithUrl('overlay.html')
  await expect(overlay.locator('.update-ready h1')).toHaveText('2 updates are ready')
  await expect(overlay.locator('.update-ready li')).toHaveText(['Second', 'First'])
  await overlay.locator('.update-ready button', { hasText: 'Later' }).click()
  expect(await kind()).toBe('none')
  // "Later" holds for the rest of the day; a day later it asks again.
  await offer('2026-11-09T21:00:00')
  expect(await kind()).toBe('none')
  await offer('2026-11-10T09:00:00')
  expect(await kind()).toBe('update')
  await dispatch({ type: 'overlay', mode: { kind: 'none' } })
  await app.evaluate(() => {
    const b = (globalThis as any).arcBrowser
    b.state.waitingUpdate = undefined
    b.updater.set({ state: 'none' })
  })
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
  await expect.poll(() => app.evaluate(() => (globalThis as any).arcBrowser.window.overlayMode.kind)).toBe('command')
})

test('Little Arc can move its page into a closed main window (macOS)', async () => {
  test.skip(process.platform !== 'darwin', 'macOS keeps the app running without windows')
  await app.evaluate(() => (globalThis as any).arcBrowser.window.win.close())
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
  await app.evaluate((_e, url) => (globalThis as any).arcBrowser.openLittle(url), `${base}/little-closed`)
  await pageWithUrl('/little-closed')
  await app.evaluate(() => [...(globalThis as any).arcBrowser.littles][0].op('openInMain'))
  await expect.poll(async () => (await space()).today.some((t) => t.url.endsWith('/little-closed'))).toBe(true)
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
})

// electron-chrome-extensions only fills `chrome`; extensions written against `browser.*` (1Password
// reads browser.windows when its background starts) need the same APIs there.
test('extensions get the chrome.* APIs on browser.* too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yarc-ext-'))
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'browser namespace', version: '1.0', background: { service_worker: 'bg.js', type: 'module' } }))
  writeFileSync(join(dir, 'bg.js'), 'console.log(`browser.windows: ${typeof browser.windows}, browser.tabs.query: ${typeof browser.tabs.query}`)')
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
