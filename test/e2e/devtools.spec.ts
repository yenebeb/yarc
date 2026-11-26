import { expect, test } from '@playwright/test'
import { app, base, dispatch, pageWithUrl, space, state, useApp } from './app'

useApp()

const dockedLayout = async () => (await state()).layout.devtools
const dockedDevtoolsUrl = () =>
  app.evaluate(() => {
    const browser = (globalThis as any).arcBrowser
    return browser.devtools.viewOf(browser.activeTab())?.webContents.getURL() ?? ''
  })
const detachedOpen = () => app.evaluate(() => (globalThis as any).arcBrowser.activeTab().wc.isDevToolsOpened())

async function openTab(name: string): Promise<string> {
  await dispatch({ type: 'open', url: `${base}/${name}`, where: 'tab' })
  return (await space()).activeItemId!
}

test('Developer Tools dock beside the page, follow their tab, and close again', async () => {
  const first = await openTab('devtools-first')
  const second = await openTab('devtools-second')
  const ui = await pageWithUrl('index.html')
  try {
    await dispatch({ type: 'activate', id: first })
    await dispatch({ type: 'devtools' })
    await expect.poll(async () => (await dockedDevtoolsUrl()).startsWith('devtools:')).toBe(true)
    await expect(ui.locator('.devtools-bar')).toBeVisible()
    const docked = (await dockedLayout())!
    const page = (await state()).layout.content
    expect(page.x + page.width).toBeLessThan(docked.bar.x)
    expect(await detachedOpen()).toBe(false)

    await dispatch({ type: 'activate', id: second })
    await expect(ui.locator('.devtools-bar')).toHaveCount(0)
    expect(await dockedLayout()).toBeUndefined()
    await dispatch({ type: 'activate', id: first })
    await expect(ui.locator('.devtools-bar')).toBeVisible()

    await dispatch({ type: 'devtools' })
    await expect(ui.locator('.devtools-bar')).toHaveCount(0)
    expect(await dockedDevtoolsUrl()).toBe('')
  } finally {
    for (const id of [first, second]) await dispatch({ type: 'close', id })
  }
})

test('Pop Out moves docked Developer Tools to their own window, and the shortcut then closes that', async () => {
  const tabId = await openTab('devtools-pop-out')
  const ui = await pageWithUrl('index.html')
  try {
    await dispatch({ type: 'devtools' })
    await expect(ui.locator('.devtools-bar')).toBeVisible()
    await ui.locator('.devtools-bar').getByTitle('Open in a separate window').click()
    await expect(ui.locator('.devtools-bar')).toHaveCount(0)
    await expect.poll(detachedOpen).toBe(true)
    await dispatch({ type: 'devtools' })
    await expect.poll(detachedOpen).toBe(false)
  } finally {
    await dispatch({ type: 'close', id: tabId })
  }
})

test('closing a tab closes its docked Developer Tools', async () => {
  const tabId = await openTab('devtools-closed-tab')
  await dispatch({ type: 'devtools' })
  await expect.poll(async () => (await dockedDevtoolsUrl()).startsWith('devtools:')).toBe(true)
  const devtoolsId: number = await app.evaluate(() => {
    const browser = (globalThis as any).arcBrowser
    return browser.devtools.viewOf(browser.activeTab()).webContents.id
  })
  await dispatch({ type: 'close', id: tabId })
  await expect.poll(() => app.evaluate(({ webContents }, id) => !webContents.fromId(id) || webContents.fromId(id)!.isDestroyed(), devtoolsId)).toBe(true)
})

test('Inspect docks Developer Tools, and dragging their edge resizes them', async () => {
  const tabId = await openTab('devtools-inspect')
  const ui = await pageWithUrl('index.html')
  try {
    await app.evaluate(() => {
      const browser = (globalThis as any).arcBrowser
      browser.inspect(browser.activeTab(), 20, 20)
    })
    await expect(ui.locator('.devtools-bar')).toBeVisible()
    const before = (await dockedLayout())!.bar.width
    const edge = (await ui.locator('.devtools-resize').boundingBox())!
    await ui.mouse.move(edge.x + edge.width / 2, edge.y + 200)
    await ui.mouse.down()
    await ui.mouse.move(edge.x + edge.width / 2 - 100, edge.y + 200, { steps: 5 })
    await ui.mouse.up()
    await expect.poll(async () => (await dockedLayout())?.bar.width).toBe(before + 100)
  } finally {
    await dispatch({ type: 'settings', patch: { devtoolsWidth: 480 } })
    await dispatch({ type: 'close', id: tabId })
  }
})

test('in split view, Developer Tools dock to the right of all the panes', async () => {
  await dispatch({ type: 'open', url: `${base}/devtools-split-left`, where: 'tab' })
  await dispatch({ type: 'open', url: `${base}/devtools-split-right`, where: 'split' })
  await expect.poll(async () => (await state()).layout.views.length).toBe(2)
  const right = (await space()).today.find((tab) => tab.url.endsWith('/devtools-split-right'))!
  try {
    await dispatch({ type: 'activate', id: right.id })
    await expect.poll(async () => (await space()).activeItemId).toBe(right.id)
    await dispatch({ type: 'devtools' })
    await expect.poll(dockedLayout).toBeDefined()
    const { views, devtools } = await state().then((current) => current.layout)
    for (const view of views) expect(view.rect.x + view.rect.width).toBeLessThan(devtools!.bar.x)
    await dispatch({ type: 'devtools' })
    await expect.poll(dockedLayout).toBeUndefined()
  } finally {
    await dispatch({ type: 'unsplit' })
    for (const tab of (await space()).today.filter((today) => today.url.includes('devtools-split'))) await dispatch({ type: 'close', id: tab.id })
  }
})
