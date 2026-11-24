import { expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PinnedFolder } from '../../src/shared/types'
import { app, base, dispatch, pageWithUrl, serveFeed, space, state, useApp } from './app'

useApp()

test('target=_blank links open as new Today tabs', async () => {
  await dispatch({ type: 'open', url: `${base}/one`, where: 'tab' })
  const tab = await pageWithUrl('/one')
  await tab.locator('#blank').click()
  await expect.poll(async () => (await space()).today[0]?.url).toBe(`${base}/child-of-one`)
  await expect.poll(async () => (await space()).activeItemId).toBe((await space()).today[0].id)
})

test('pinning keeps the saved URL; closing a pinned tab resets it', async () => {
  const one = (await space()).today.find((tab) => tab.url.endsWith('/one'))!
  await dispatch({ type: 'activate', id: one.id })
  await dispatch({ type: 'togglePin', id: one.id })
  let current = await space()
  const pinned = current.pinned.find((node) => node.id === one.id)
  expect(pinned && pinned.kind === 'tab' ? pinned.savedUrl : undefined).toBe(`${base}/one`)
  const tab = await pageWithUrl('/one')
  await tab.locator('#same').click()
  await expect.poll(async () => (await state()).live[one.id]?.url).toBe(`${base}/next-one`)
  const ui = await pageWithUrl('index.html')
  await expect(ui.locator('.row .slash')).toHaveCount(1)
  await dispatch({ type: 'close', id: one.id })
  current = await space()
  const after = current.pinned.find((node) => node.id === one.id)
  expect(after?.kind === 'tab' ? after.url : '').toBe(`${base}/one`)
  expect((await state()).live[one.id]).toBeUndefined()
})

test("a live folder fills itself from a site's feed, follows it on refresh, and goes with its tabs", async () => {
  const folder = async () => (await space()).pinned.find((n): n is PinnedFolder => n.kind === 'folder' && !!n.live)
  const posts = async () => (await folder())?.children.map((child) => (child.kind === 'tab' ? child.savedTitle : child.kind))
  serveFeed(['a', 'b'])
  await dispatch({ type: 'saveLiveFolder', name: '', source: { kind: 'feed', url: `${base}/blog` } })
  await expect.poll(posts).toEqual(['Post a', 'Post b'])
  expect((await folder())?.name).toBe('127.0.0.1')
  const ui = await pageWithUrl('index.html')
  await expect(ui.locator('.row.folder', { hasText: '127.0.0.1' })).toBeVisible()
  await expect(ui.locator('.row', { hasText: 'Post b' })).toBeVisible()

  const firstPost = (await folder())!.children[0]
  serveFeed(['c', 'a'])
  await dispatch({ type: 'refreshLiveFolder', id: (await folder())!.id })
  await expect.poll(posts).toEqual(['Post c', 'Post a'])
  expect((await folder())!.children[1].id).toBe(firstPost.id)

  await dispatch({ type: 'deleteFolder', id: (await folder())!.id })
  expect(await folder()).toBeUndefined()
  expect((await space()).pinned.some((node) => node.id === firstPost.id)).toBe(false)
})

test('closing a Today tab archives it and it can be reopened', async () => {
  await dispatch({ type: 'open', url: `${base}/left`, where: 'tab' })
  const left = (await space()).today[0]
  await dispatch({ type: 'close', id: left.id })
  expect((await space()).today.some((tab) => tab.id === left.id)).toBe(false)
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

test('releasing Ctrl after several Ctrl+Tabs selects the tab the switcher shows', async () => {
  // Chromium drops a view's key-ups after a key-down the browser handled: once the overlay had
  // handled a Ctrl+Tab, releasing Ctrl never arrived and the switcher stayed open.
  await dispatch({ type: 'open', url: `${base}/switch-a`, where: 'tab' })
  await dispatch({ type: 'open', url: `${base}/switch-b`, where: 'tab' })
  await dispatch({ type: 'open', url: `${base}/switch-c`, where: 'tab' })
  // A page that finishes loading takes the keyboard, and in a window in the background that closes the switcher.
  await expect
    .poll(async () => {
      const snapshot = await state()
      const opened = (await space()).today.filter((tab) => /\/switch-[abc]$/.test(tab.url))
      return opened.length === 3 && opened.every((tab) => snapshot.live[tab.id]?.loading === false)
    })
    .toBe(true)
  const key = (view: 'page' | 'overlay', type: 'keyDown' | 'keyUp', keyCode: string, modifiers: string[]) =>
    app.evaluate(
      (_electron, [view, type, keyCode, modifiers]) => {
        const browser = (globalThis as any).arcBrowser
        const wc = view === 'page' ? browser.activeTab().wc : browser.window.overlay.webContents
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

test('a finished download drags out of the Downloads panel as its file', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'yarc-e2e-downloads-'))
  await app.evaluate(({ app }, dir) => app.setPath('downloads', dir), folder)
  await app.evaluate((_electron, url) => (globalThis as any).arcBrowser.activeTab().wc.downloadURL(url), `${base}/report.txt`)
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

test('Whole Page captures the full length of a page, past what is on screen', async () => {
  const long = `data:text/html,${encodeURIComponent('<!doctype html><title>Long page</title><body style="margin:0"><div style="height:3000px;background:linear-gradient(red,blue)"></div>')}`
  await dispatch({ type: 'open', url: long, where: 'tab' })
  await expect.poll(async () => (await state()).spaces.flatMap((spaceState) => spaceState.today).find((tab) => tab.title === 'Long page')?.id).toBeTruthy()
  const size = await app.evaluate(async ({ clipboard, nativeImage }) => {
    const browser = (globalThis as any).arcBrowser
    const tab = browser.activeTab()
    clipboard.clear()
    await browser.canvases.capture(tab, { x: 0, y: 0, width: 10, height: 10 }, 'copy', true)
    const png = await (await clipboard.read())[0].getType('image/png')
    return { image: nativeImage.createFromBuffer(Buffer.from(await png.arrayBuffer())).getSize(), view: tab.view.getBounds(), attached: tab.wc.debugger.isAttached() }
  })
  expect(size.image.height).toBeGreaterThan(size.view.height)
  expect(size.image.height / size.image.width).toBeGreaterThan(2)
  expect(size.attached).toBe(false)
  await dispatch({ type: 'close', id: (await space()).activeItemId! })
})
