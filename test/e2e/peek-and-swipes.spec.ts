import { expect, test } from '@playwright/test'
import { app, base, captureNextMenu, dispatch, pageWithUrl, pressInActiveTab, space, state, useApp } from './app'

useApp()

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
    await app.evaluate(async (_electron, id) => {
      const wc = (globalThis as any).arcBrowser.live.get(id).wc
      const rect = await wc.executeJavaScript('JSON.parse(JSON.stringify(document.getElementById("away").getBoundingClientRect()))')
      const at = { x: Math.round(rect.x + 4), y: Math.round(rect.y + 4) }
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
  const current = await space()
  expect(current.activeItemId).toBe(current.today[0].id)
  expect((await state()).peek).toBeUndefined()
  expect((await state()).live[home.id]?.url).toBe(`${base}/peekhome`)
})

/** A real click: Playwright's waits for a navigation the app may cancel. `tabId` 'peek' is the open Peek's page. */
const clickInPage = (tabId: string, selector: string, opts: { button?: 'left' | 'right'; modifiers?: string[] } = {}) =>
  app.evaluate(
    async (_electron, [id, selector, button, modifiers]) => {
      const browser = (globalThis as any).arcBrowser
      const wc = id === 'peek' ? browser.cur.peek.tab.wc : browser.live.get(id).wc
      const rect = await wc.executeJavaScript(`JSON.parse(JSON.stringify(document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()))`)
      const at = { x: Math.round(rect.x + 4), y: Math.round(rect.y + 4) }
      for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, ...at, button, clickCount: 1, modifiers })
    },
    [tabId, selector, opts.button ?? 'left', opts.modifiers ?? []] as const
  )

const menuLabels = async (name: string): Promise<string[]> => {
  await expect.poll(() => app.evaluate((_electron, menuName) => !!(globalThis as any)[menuName], name)).toBe(true)
  return app.evaluate((_electron, menuName) => (globalThis as any)[menuName].items.map((item: Electron.MenuItem) => item.label), name)
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
  await app.evaluate(() => (globalThis as any).tabLinkMenu.items.find((item: Electron.MenuItem) => item.label === 'Open Link in Peek').click())
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
    app.evaluate((_electron, [eventName, argument]) => (globalThis as any).arcBrowser.window.win.emit(eventName, {}, argument), [event, arg] as const)

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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A tab that went from /`name` on to /next-`name`, so it can go back, with ways to swipe in it. */
async function twoFingerTab(name: string) {
  await dispatch({ type: 'open', url: `${base}/${name}`, where: 'tab' })
  const tab = (await space()).today[0]
  await (await pageWithUrl(`/${name}`)).locator('#same').click()
  const url = async () => (await state()).live[tab.id]?.url
  await expect.poll(url).toBe(`${base}/next-${name}`)
  const inPage = (script: string) =>
    app.evaluate((_electron, [tabId, code]) => (globalThis as any).arcBrowser.live.get(tabId).wc.executeJavaScript(code), [tab.id, script] as const)
  // Chromium's wheel deltas point the other way from the page's: a positive one scrolls left, toward the previous page.
  const wheel = (deltaX: number, events = 8) =>
    app.evaluate(
      async (_electron, [tabId, delta, count]) => {
        const contents = (globalThis as any).arcBrowser.live.get(tabId).wc
        for (let sent = 0; sent < count; sent++) {
          contents.sendInputEvent({ type: 'mouseWheel', x: 200, y: 200, deltaX: delta, deltaY: 0, hasPreciseScrollingDeltas: true, canScroll: true })
          await new Promise((resolve) => setTimeout(resolve, 16))
        }
      },
      [tab.id, deltaX, events] as const
    )
  // sendInputEvent ends the scroll gesture after every wheel event: keep the fingers down by hiding those ends until the test lifts them.
  const holdFingers = (down: boolean) =>
    app.evaluate(
      (_electron, [tabId, hold]) => {
        const contents = (globalThis as any).arcBrowser.live.get(tabId).wc
        if (!hold) {
          delete contents.emit
          contents.emit('input-event', { preventDefault() {} }, { type: 'gestureScrollEnd' })
          return
        }
        const emit = contents.emit
        contents.emit = (event: string, ...args: any[]) => (event === 'input-event' && args[1]?.type === 'gestureScrollEnd') || emit.call(contents, event, ...args)
      },
      [tab.id, down] as const
    )
  const pageX = () => app.evaluate((_electron, tabId) => (globalThis as any).arcBrowser.live.get(tabId).view.getBounds().x, tab.id)
  const restingX = await pageX()
  return {
    url,
    inPage,
    wheel,
    pageX,
    restingX,
    swipeUntilSlid: async (deltaX: number, events: number, slidPoints: number) => {
      await holdFingers(true)
      await wheel(deltaX, events)
      await expect.poll(async () => Math.abs((await pageX()) - restingX)).toBeGreaterThanOrEqual(slidPoints)
      await holdFingers(false)
    },
    /** Wheel events right after a page loads look like a swipe's leftover momentum, which the page ignores. */
    waitPastMomentum: () => pause(500),
    close: () => dispatch({ type: 'close', id: tab.id })
  }
}

/** Stands in for macOS's "Swipe between pages" setting; the real one is put back, since deleting the stand-in would delete it too. */
const pretendSystemSwipe = (enabled: boolean) =>
  app.evaluate(({ systemPreferences }, on) => {
    const preferences = systemPreferences as any
    preferences.realSwipeSetting ??= preferences.isSwipeTrackingFromScrollEventsEnabled
    preferences.isSwipeTrackingFromScrollEventsEnabled = () => on
  }, enabled)
const restoreSystemSwipe = () =>
  app.evaluate(({ systemPreferences }) => {
    const preferences = systemPreferences as any
    preferences.isSwipeTrackingFromScrollEventsEnabled = preferences.realSwipeSetting
  })

test('a two-finger swipe does nothing while the macOS setting for it is off', async () => {
  test.skip(process.platform !== 'darwin', 'only macOS has the setting')
  const swipeTab = await twoFingerTab('swipe-setting')
  await pretendSystemSwipe(false)
  try {
    await swipeTab.waitPastMomentum()
    await swipeTab.wheel(30)
    await pause(500)
    expect(await swipeTab.url()).toBe(`${base}/next-swipe-setting`)
  } finally {
    await restoreSystemSwipe()
    await swipeTab.close()
  }
})

test('a short two-finger swipe slides the page, then lets it back without going anywhere', async () => {
  const swipeTab = await twoFingerTab('swipe-short')
  await swipeTab.waitPastMomentum()
  await swipeTab.swipeUntilSlid(30, 3, 20)
  await expect.poll(swipeTab.pageX).toBe(swipeTab.restingX)
  expect(await swipeTab.url()).toBe(`${base}/next-swipe-short`)
  await swipeTab.close()
})

test('a two-finger swipe let go past 70 points goes back, and one the other way goes forward', async () => {
  const swipeTab = await twoFingerTab('swipe-far')
  await swipeTab.waitPastMomentum()
  await swipeTab.swipeUntilSlid(30, 8, 70)
  await expect.poll(swipeTab.url).toBe(`${base}/swipe-far`)
  await swipeTab.waitPastMomentum()
  await swipeTab.swipeUntilSlid(-30, 8, 70)
  await expect.poll(swipeTab.url).toBe(`${base}/next-swipe-far`)
  await swipeTab.close()
})

test('a two-finger swipe on a page that scrolls sideways scrolls the page instead of going back', async () => {
  const swipeTab = await twoFingerTab('swipe-scroller')
  await swipeTab.waitPastMomentum()
  await swipeTab.inPage('document.body.style.width = "5000px"; scrollTo(2000, 0)')
  await swipeTab.wheel(30)
  await expect.poll(() => swipeTab.inPage('scrollX')).toBeLessThan(2000)
  await pause(500)
  expect(await swipeTab.url()).toBe(`${base}/next-swipe-scroller`)
  await swipeTab.close()
})
