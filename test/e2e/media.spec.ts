import { expect, test } from '@playwright/test'
import { app, base, dispatch, pageWithUrl, space, state, useApp } from './app'

useApp()

test('camera and microphone read as askable until blocked, so sites like Meet request them', async () => {
  await dispatch({ type: 'open', url: `${base}/media`, where: 'tab' })
  await expect.poll(async () => (await state()).live[(await space()).activeItemId!]?.loading).toBe(false)
  const query = () =>
    app.evaluate(() =>
      (globalThis as any).arcBrowser
        .activeTab()
        .wc.executeJavaScript(`Promise.all(['camera', 'microphone'].map((name) => navigator.permissions.query({ name }).then((permission) => permission.state)))`)
    )
  expect(await query()).toEqual(['granted', 'granted'])
  // Blocking is remembered per profile, site and device (SiteDecisions): block both.
  const remember = (allowed: boolean | undefined) =>
    app.evaluate(
      (_electron, [origin, allowed]) => {
        const browser = (globalThis as any).arcBrowser
        const decisions = browser.profiles.decisions(browser.space.profileId)
        for (const key of ['media:video', 'media:audio']) allowed === null ? decisions.reset(origin, key) : decisions.set(origin, key, allowed ? 'allow' : 'block')
      },
      [base, allowed ?? null] as const
    )
  await remember(false)
  expect(await query()).toEqual(['denied', 'denied'])
  await remember(undefined)
})

const isPlaying = (id: string) => app.evaluate((_electron, tabId) => (globalThis as any).arcBrowser.live.get(tabId).playing as boolean, id)
/** Playing and painted: a hidden tab paints no canvas, so a stream left before its first frame never gets one, and a video without a frame doesn't float. */
const untilShowing = async (id: string) => {
  await expect.poll(() => isPlaying(id), { timeout: 10_000 }).toBe(true)
  const painted = '(video => video.readyState >= 2 && video.videoWidth > 0)(document.getElementById("v"))'
  await expect.poll(() => app.evaluate((_electron, [tabId, code]) => (globalThis as any).arcBrowser.live.get(tabId).wc.executeJavaScript(code), [id, painted] as const)).toBe(true)
}
/** What the app and the page know about the video, for a failure message: CI keeps no logs of the app. */
const mediaReport = (id: string) =>
  app.evaluate(async (_electron, tabId) => {
    const browser = (globalThis as any).arcBrowser
    const tab = browser.live.get(tabId)
    const video = '(video => video && { paused: video.paused, readyState: video.readyState, videoWidth: video.videoWidth, popover: video.matches(":popover-open"), hidden: document.hidden })(document.getElementById("v"))'
    const page = tab && !tab.destroyed ? await tab.wc.executeJavaScript(video).catch((error: Error) => error.message) : 'no live tab'
    return JSON.stringify({ media: browser.media.state, floatVideos: browser.state.settings.floatVideos, onScreen: browser.media.onScreen.has(tabId), playerTab: browser.media.floating.tabId, playing: tab?.playing, audible: tab?.wc.isCurrentlyAudible(), page })
  }, id)
const untilFloating = async (id: string) => {
  try {
    await expect.poll(async () => (await state()).media.floating, { timeout: 10_000 }).toBe(id)
  } catch (error) {
    throw new Error(`${(error as Error).message}\n${await mediaReport(id)}`)
  }
}
const floatingPlayer = () =>
  app.evaluate(({ BaseWindow }) => {
    const player = BaseWindow.getAllWindows().find((candidate) => candidate.getTitle() === 'Floating Player' && candidate.isVisible())
    return player ? { onTop: player.isAlwaysOnTop(), resizable: player.isResizable() } : null
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

  await app.evaluate(() => (globalThis as any).arcBrowser.media.minimizeFloating())
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
  await app.evaluate((_electron, id) => (globalThis as any).arcBrowser.live.get(id).wc.executeJavaScript('document.getElementById("v").pause()'), video)
  await expect.poll(() => isPlaying(video)).toBe(false)
  // Chromium reports the tab audible for a moment after the pause, and an audible tab gets a card.
  await expect.poll(() => app.evaluate((_electron, id) => (globalThis as any).arcBrowser.live.get(id).wc.isCurrentlyAudible(), video)).toBe(false)

  await app.evaluate((_electron, id) => {
    const media = (globalThis as any).arcBrowser.media
    const tabLeft = media.tabLeft
    media.tabLeft = (left: string) => {
      const done = tabLeft.call(media, left)
      if (left === id) (globalThis as any).videoLeft = done
      return done
    }
  }, video)
  await dispatch({ type: 'open', url: `${base}/after-paused-video` })
  await expect.poll(() => app.evaluate(() => !!(globalThis as any).videoLeft)).toBe(true)
  await app.evaluate(() => (globalThis as any).videoLeft)
  const videoReport = await app.evaluate((_electron, id) => {
    const tab = (globalThis as any).arcBrowser.live.get(id)
    return `video ${id}: playing ${tab.playing}, audible ${tab.wc.isCurrentlyAudible()}`
  }, video)
  expect((await state()).media, videoReport).toEqual({ cards: [], floating: undefined, videos: [] })
  await dispatch({ type: 'close', id: video })
})
