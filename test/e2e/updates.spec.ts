import { expect, test } from '@playwright/test'
import { app, dispatch, overlayKind, pageWithUrl, useApp } from './app'

useApp()

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
    const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items[0].submenu!.items.map((item) => item.label))
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

test('a downloaded update opens the relaunch card only after a week, then at most once a day', async () => {
  const DAY = 24 * 60 * 60_000
  const since = Date.parse('2026-11-02T09:00:00')
  const offer = (iso: string) => app.evaluate((_electron, iso) => (globalThis as any).arcBrowser.updater.offerRelaunch(Date.parse(iso)), iso)
  await app.evaluate((_electron, since) => {
    const browser = (globalThis as any).arcBrowser
    // set() also redraws the UI, so the sidebar pill appears.
    browser.updater.set({ state: 'ready', version: '9.0.2', notes: [{ version: '9.0.2', changes: ['Second'], thanks: [] }, { version: '9.0.1', changes: ['First'], thanks: [] }] })
    browser.state.waitingUpdate = { from: '0.0.0', since }
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
    const browser = (globalThis as any).arcBrowser
    browser.state.waitingUpdate = undefined
    browser.updater.set({ state: 'none' })
  })
})
