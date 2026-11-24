import { expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, base, captureNextMenu, dispatch, pageWithUrl, space, state, useApp, userData } from './app'

useApp()

test('starts with a default space and the sidebar', async () => {
  const ui = await pageWithUrl('index.html')
  await expect(ui.locator('.sidebar')).toBeVisible()
  await expect(ui.locator('.space-name')).toContainText('Personal')
})

test("clicking the current space's icon opens its menu", async () => {
  const ui = await pageWithUrl('index.html')
  await captureNextMenu('poppedMenu')
  await ui.locator('.space-dot.active').click()
  await expect.poll(() => app.evaluate(() => (globalThis as any).poppedMenu?.items.map((item: Electron.MenuItem) => item.label))).toContain('Edit Space…')
})

test("the space editor's own color picker sets a custom color, and a second color ends the sidebar's gradient", async () => {
  const original = await space()
  await dispatch({ type: 'overlay', mode: { kind: 'space-editor', spaceId: original.id } })
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

  await dispatch({ type: 'updateSpace', id: original.id, color: original.color, color2: '' })
  await expect.poll(() => ui.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--space-2'))).toBe(original.color)
})

test("the space editor previews a color in the sidebar until it's saved, and puts the old one back when cancelled", async () => {
  const original = await space()
  const ui = await pageWithUrl('index.html')
  const sidebarColor = () => ui.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--space'))
  const savedColor = () => app.evaluate((_electron, id) => (globalThis as any).arcBrowser.state.spaces.find((candidate: { id: string }) => candidate.id === id).color, original.id)
  const overlay = await pageWithUrl('overlay.html')
  for (const close of [() => overlay.locator('.actions').getByRole('button', { name: 'Cancel' }).click(), () => overlay.locator('.scrim').click({ position: { x: 5, y: 5 } })]) {
    await dispatch({ type: 'overlay', mode: { kind: 'space-editor', spaceId: original.id } })
    const swatch = overlay.locator(`.color-row .sw:not(.custom-sw):not([title="${original.color}"])`).first()
    const picked = (await swatch.getAttribute('title'))!
    await swatch.click()
    await expect.poll(sidebarColor).toBe(picked)
    expect(await savedColor()).toBe(original.color)
    await close()
    await expect.poll(sidebarColor).toBe(original.color)
  }
  expect(await savedColor()).toBe(original.color)
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
  await app.evaluate((_electron, found) => Object.assign((globalThis as any).arcBrowser.imports, { found, scan: Promise.resolve() }), found)
  await dispatch({ type: 'overlay', mode: { kind: 'tour', step: 'import' } })
  const overlay = await pageWithUrl('overlay.html')
  const start = overlay.locator('.import-choices + .intro-buttons .btn')
  await expect(start).toHaveText('Import 2')
  await overlay.locator('.import-choices label', { hasText: 'Chrome' }).click()
  await overlay.locator('.import-choices label', { hasText: 'Arc · Personal' }).click()
  await expect(start).toHaveText('Import 2')
  await start.click()
  await expect(overlay.locator('.intro h1')).toHaveText('Make YARC your default browser')
  const snapshot = await state()
  const added = snapshot.spaces.slice(before)
  expect(added.map((addedSpace) => addedSpace.name)).toEqual(['Work', 'Chrome'])
  expect(new Set(snapshot.spaces.map((existing) => existing.profileId)).size).toBe(snapshot.spaces.length)
  expect(added[1].pinned).toMatchObject([{ kind: 'folder', name: 'Bookmarks', children: [{ url: `${base}/bookmarked`, title: 'Kept' }] }])
  await dispatch({ type: 'endTour' })
  for (const addedSpace of added) await dispatch({ type: 'deleteSpace', id: addedSpace.id })
})

test('spaces with their own profile do not share storage', async () => {
  await dispatch({ type: 'open', url: `${base}/storage`, where: 'tab' })
  const firstPage = await pageWithUrl('/storage')
  await firstPage.evaluate(() => localStorage.setItem('who', 'space-a'))
  const first = await space()
  const spaces = (await state()).spaces.length
  await dispatch({ type: 'createSpace', name: 'Work', emoji: '💼', color: '#3fa7d6', profileId: 'new' })
  const snapshot = await state()
  expect(snapshot.spaces).toHaveLength(spaces + 1)
  expect(snapshot.activeSpaceId).not.toBe(first.id)
  expect((await space()).profileId).not.toBe(first.profileId)
  const firstSpace = first.id
  await dispatch({ type: 'open', url: `${base}/storage-b`, where: 'tab' })
  const secondPage = await pageWithUrl('/storage-b')
  expect(await secondPage.evaluate(() => localStorage.getItem('who'))).toBeNull()
  // Same origin, different profile: cookies are separate too.
  await secondPage.evaluate(() => (document.cookie = 'k=b'))
  expect(await firstPage.evaluate(() => document.cookie)).not.toContain('k=b')
  await dispatch({ type: 'switchSpace', id: firstSpace })
  expect((await state()).activeSpaceId).toBe(firstSpace)
})
