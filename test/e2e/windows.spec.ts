import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { app, base, dispatch, overlayKind, pageWithUrl, restart, space, state, useApp, userData } from './app'

useApp()

test('Little Window opens a mini window and can move the page into the main window', async () => {
  await dispatch({ type: 'littleArc', url: `${base}/little` })
  await pageWithUrl('little.html')
  await pageWithUrl(`${base}/little`)
  const count = (await space()).today.length
  await app.evaluate(() => {
    const browser = (globalThis as any).arcBrowser
    const little = browser.openLittles()[0]
    little.op('openInMain')
  })
  await expect.poll(async () => (await space()).today.length).toBe(count + 1)
  expect((await space()).today[0].url).toBe(`${base}/little`)

  // Once the Little Window has closed, the page can still be left and selected again.
  const moved = (await space()).today[0]
  await dispatch({ type: 'open', url: `${base}/after-little`, where: 'tab' })
  await expect.poll(async () => (await space()).activeItemId).not.toBe(moved.id)
  await dispatch({ type: 'activate', id: moved.id })
  expect((await state()).layout.views.map((view) => view.id)).toEqual([moved.id])
})

test('Little Window reopens a page with the profile picked on its chip, remembered per site, and keeps its size', async () => {
  const url = `${base}/little-profile`
  const littles = () =>
    app.evaluate(() => (globalThis as any).arcBrowser.openLittles().map((little: any) => ({ profile: little.profile.id as string, url: little.url as string, size: little.win.getSize() as number[] })) as { profile: string; url: string; size: number[] }[])
  await app.evaluate(() => (globalThis as any).arcBrowser.state.profiles.push({ id: 'p-little', name: 'Chip', favorites: [] }))
  await dispatch({ type: 'littleArc', url })
  await expect.poll(async () => (await littles()).find((little) => little.url === url)?.profile).toBeTruthy()
  expect((await littles()).find((little) => little.url === url)?.profile).not.toBe('p-little')

  await app.evaluate((_electron, url) => {
    const browser = (globalThis as any).arcBrowser
    browser.openLittles().find((little: any) => little.url === url).switchProfile('p-little')
  }, url)
  await expect.poll(async () => (await littles()).filter((little) => little.url === url).map((little) => little.profile)).toEqual(['p-little'])
  const chips = () => Promise.all(app.windows().filter((page) => page.url().includes('little.html') && !page.isClosed()).map((page) => page.locator('.little-profile').textContent()))
  await expect.poll(chips).toContain('Chip')

  // The user resizes it, closes it, and opens the site again: same profile, same size.
  await app.evaluate((_electron, url) => {
    const little = (globalThis as any).arcBrowser.openLittles().find((candidate: any) => candidate.url === url)
    little.win.setSize(720, 520)
    little.win.emit('resized')
    little.win.close()
  }, url)
  await expect.poll(async () => (await littles()).length).toBe(0)
  await dispatch({ type: 'littleArc', url })
  await expect.poll(async () => (await littles()).find((little) => little.url === url)).toMatchObject({ profile: 'p-little', size: [720, 520] })

  await app.evaluate(() => {
    const browser = (globalThis as any).arcBrowser
    for (const little of browser.openLittles()) little.win.close()
    browser.state.littleArc = { profileByHost: {} }
    browser.state.profiles = browser.state.profiles.filter((profile: any) => profile.id !== 'p-little')
  })
  await expect.poll(async () => (await littles()).length).toBe(0)
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
    for (const little of (globalThis as any).arcBrowser.openLittles()) little.win.close()
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

test('a tab selected in two windows is live in one and mirrored, greyed, in the other; the other takes it back when it is let go', async () => {
  await dispatch({ type: 'open', url: `${base}/shared`, where: 'tab' })
  const shared = (await space()).activeItemId!
  await dispatch({ type: 'open', url: `${base}/other`, where: 'tab' })
  const other = (await space()).activeItemId!
  await dispatch({ type: 'activate', id: shared })

  // A second window selects the same tab: it takes the page; the first shows a still of it.
  await app.evaluate((_electron, id) => {
    const browser = (globalThis as any).arcBrowser
    browser.openNewWindow()
    browser.inWin(browser.wins[1], () => browser.activate(id))
  }, shared)
  const where = () =>
    app.evaluate((_electron, id) => {
      const browser = (globalThis as any).arcBrowser
      const view = browser.live.get(id).view
      return browser.wins.map((appWindow: any) => (appWindow.main.isShown(view) ? 'live' : appWindow.layout.views.some((entry: any) => entry.id === id && entry.elsewhere) ? 'still' : 'none'))
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
  await app.evaluate((_electron, { id, url }) => (globalThis as any).arcBrowser.live.get(id).wc.loadURL(url), { id: shared, url: `${base}/moved` })
  await expect.poll(() => app.evaluate(() => (globalThis as any).stills), { timeout: 10_000 }).toBeGreaterThan(0)

  // The second window moves on to another tab: the first gets the page back, live.
  await app.evaluate((_electron, id) => {
    const browser = (globalThis as any).arcBrowser
    browser.inWin(browser.wins[1], () => browser.activate(id))
  }, other)
  await expect.poll(where).toEqual(['live', 'none'])
  expect(await app.evaluate(() => (globalThis as any).arcBrowser.mirror.subs.size)).toBe(0)

  await app.evaluate(() => (globalThis as any).arcBrowser.wins[1].main.win.close())
  await expect.poll(() => app.evaluate(() => (globalThis as any).arcBrowser.wins.length)).toBe(1)
})

test('state survives a restart', async () => {
  await dispatch({ type: 'open', url: `${base}/kept-pinned`, where: 'tab' })
  await dispatch({ type: 'togglePin', id: (await space()).today[0].id })
  await dispatch({ type: 'open', url: `${base}/kept-favorite`, where: 'tab' })
  await dispatch({ type: 'addFavorite', id: (await space()).today[0].id })
  await dispatch({ type: 'createSpace', name: 'Kept', emoji: '📌', color: '#3fa7d6' })
  const before = await state()
  expect([before.spaces.length, before.spaces[0].pinned.length, before.profiles[0].favorites.length]).toEqual([2, 1, 1])
  await restart()
  const after = await state()
  expect(after.spaces.map((spaceState) => spaceState.name)).toEqual(before.spaces.map((spaceState) => spaceState.name))
  expect(after.spaces[0].pinned.length).toBe(before.spaces[0].pinned.length)
  expect(after.profiles[0].favorites.length).toBe(before.profiles[0].favorites.length)
})

test('menu bar commands reopen the closed main window (macOS)', async () => {
  test.skip(process.platform !== 'darwin', 'macOS keeps the app running without windows')
  await app.evaluate(() => (globalThis as any).arcBrowser.window.win.close())
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
  await app.evaluate(({ Menu }) => {
    const items = (menu: Electron.Menu): Electron.MenuItem[] => menu.items.flatMap((item) => [item, ...(item.submenu ? items(item.submenu) : [])])
    items(Menu.getApplicationMenu()!).find((item) => item.label === 'New Tab')!.click()
  })
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  await expect.poll(overlayKind).toBe('command')
})

test('Little Window can move its page into a closed main window (macOS)', async () => {
  test.skip(process.platform !== 'darwin', 'macOS keeps the app running without windows')
  await app.evaluate(() => (globalThis as any).arcBrowser.window.win.close())
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
  await app.evaluate((_electron, url) => (globalThis as any).arcBrowser.openLittle(url), `${base}/little-closed`)
  await pageWithUrl('/little-closed')
  await app.evaluate(() => (globalThis as any).arcBrowser.openLittles()[0].op('openInMain'))
  await expect.poll(async () => (await space()).today.some((tab) => tab.url.endsWith('/little-closed'))).toBe(true)
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
})
