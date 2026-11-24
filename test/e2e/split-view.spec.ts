import { expect, test, type Page } from '@playwright/test'
import { app, base, dispatch, pageWithUrl, space, state, useApp } from './app'

useApp()

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
const dragRow = (page: Page, title: string, type: string, fractionX = 0.5, fractionY = 0.5) =>
  page.evaluate(
    ({ title, type, fractionX, fractionY }) => {
      // A dropped tab can already be part of another row (a split) when dragend fires; dragend reaches the sidebar either way.
      const row = [...document.querySelectorAll('.row')].find((candidate) => candidate.querySelector('.title')?.textContent === title) ?? (type === 'dragend' ? document.querySelector('.sidebar') : null)!
      const pageGlobals = window as unknown as { transfer?: DataTransfer }
      if (type === 'dragstart') pageGlobals.transfer = new DataTransfer()
      const rect = row.getBoundingClientRect()
      row.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: rect.left + rect.width * fractionX, clientY: rect.top + rect.height * fractionY, dataTransfer: pageGlobals.transfer }))
    },
    { title, type, fractionX, fractionY }
  )

/** Fires a drag event over the page area's drop layer, at a fraction of its size. */
const dragOverPage = (page: Page, type: 'dragover' | 'drop', fractionX: number, fractionY: number) =>
  page.evaluate(
    ({ type, fractionX, fractionY }) => {
      const dropLayer = document.querySelector('.split-drop')!
      const rect = dropLayer.getBoundingClientRect()
      dropLayer.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: rect.left + rect.width * fractionX, clientY: rect.top + rect.height * fractionY, dataTransfer: new DataTransfer() }))
    },
    { type, fractionX, fractionY }
  )

const dropLayerShown = () =>
  app.evaluate(() => {
    const mainWindow = (globalThis as any).arcBrowser.window
    return mainWindow.win.contentView.children.includes(mainWindow.overlay)
  })

const splitLayouts = async () => {
  const snapshot = await state()
  const current = snapshot.spaces.find((candidate) => candidate.id === snapshot.activeSpaceId)!
  const items = [...current.today, ...snapshot.profiles.flatMap((profile) => profile.favorites)]
  const shape = (node: any): string =>
    node.itemId ? items.find((item) => item.id === node.itemId)!.url.split('/').pop()! : `${node.dir}(${node.children.map(shape).join(', ')})`
  return current.splits.map((split) => shape(split.root))
}

test('dragging a sidebar tab onto the page or onto another tab makes a split, and leaves nothing behind', async () => {
  await dispatch({ type: 'unsplit' })
  for (const name of ['drag-a', 'drag-b', 'drag-c']) await dispatch({ type: 'open', url: `${base}/${name}`, where: 'tab' })
  const ui = await pageWithUrl('index.html')
  // A row shows the page's title once it has loaded; the drags below find rows by title.
  for (const name of ['drag-a', 'drag-b', 'drag-c']) await expect(ui.locator('.row .title', { hasText: `Page ${name}` })).toBeVisible()
  const dragB = (await space()).today.find((tab) => tab.url.endsWith('/drag-b'))!
  await dispatch({ type: 'activate', id: dragB.id })

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
  await expect.poll(splitLayouts).toEqual(['row(drag-a, drag-b)'])
  await expect.poll(dropLayerShown).toBe(false)
  // The sidebar draws the split as one row a moment after the main process makes it; drag onto that row, not the old one.
  await expect(ui.locator('.split-row')).toBeVisible()

  // A drag that ends without a drop (Escape, or outside the window) changes nothing.
  await dragRow(ui, 'Page drag-c', 'dragstart')
  await expect.poll(dropLayerShown).toBe(true)
  await dragRow(ui, 'Page drag-c', 'dragend')
  await expect.poll(dropLayerShown).toBe(false)
  expect(await splitLayouts()).toEqual(['row(drag-a, drag-b)'])

  // The split is one sidebar row, a half per tab. Onto the middle of drag-a's half, right of its
  // center: the tab joins as the pane right of drag-a.
  await dragRow(ui, 'Page drag-c', 'dragstart')
  await expect(async () => {
    await dragRow(ui, 'Page drag-a', 'dragover', 0.4, 0.5)
    await expect(ui.locator('.split-preview')).toBeVisible({ timeout: 200 })
  }).toPass()
  await dragRow(ui, 'Page drag-a', 'drop', 0.4, 0.5)
  await dragRow(ui, 'Page drag-c', 'dragend')
  await expect.poll(splitLayouts).toEqual(['row(drag-a, drag-c, drag-b)'])
  await expect.poll(dropLayerShown).toBe(false)
  await dispatch({ type: 'unsplit' })
})

test('a split is one sidebar row, and each pane has its own bar that closes just that tab', async () => {
  for (const name of ['bar-a', 'bar-b']) await dispatch({ type: 'open', url: `${base}/${name}`, where: 'tab' })
  const current = await space()
  const [barA, barB] = ['bar-a', 'bar-b'].map((name) => current.today.find((tab) => tab.url.endsWith(`/${name}`))!)
  await dispatch({ type: 'activate', id: barA.id })
  await dispatch({ type: 'placeInSplit', id: barB.id, target: barA.id, side: 'right' })
  const ui = await pageWithUrl('index.html')
  await expect(ui.locator('.split-row .half .title')).toHaveText(['Page bar-a', 'Page bar-b'])
  await expect(ui.locator('.row:not(.split-row) .title', { hasText: /^Page bar-/ })).toHaveCount(0)

  // Each page sits under its pane's bar.
  const views = (await state()).layout.views
  expect(views.map((view) => view.rect.y - view.bar!.y)).toEqual([32, 32])
  await expect(ui.locator('.pane-bar')).toHaveCount(2)

  // The left half of the row focuses bar-a; the right pane's close button closes bar-b only.
  await ui.locator('.split-row .half').first().click()
  await expect.poll(async () => (await space()).activeItemId).toBe(barA.id)
  await ui.locator('.pane-bar').nth(1).locator('button[title="Close tab"]').click()
  await expect.poll(async () => (await space()).today.some((tab) => tab.id === barB.id)).toBe(false)
  expect((await space()).splits).toEqual([])
  await expect(ui.locator('.pane-bar')).toHaveCount(0)
})
