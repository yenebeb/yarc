import { expect, test } from '@playwright/test'
import { release } from 'node:os'
import { app, base, captureNextMenu, dispatch, mod, overlayKind, pageWithUrl, pressInActiveTab, space, state, useApp } from './app'

useApp()

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

/** macOS 26 (Darwin 25) spaces the window buttons 23pt apart instead of 20. */
const trafficLightsWidth = Number(release().split('.')[0]) >= 25 ? 60 : 54

test('the traffic lights sit in the sidebar at the window outer corner on macOS, docked and revealed, left and right', async () => {
  if (process.platform !== 'darwin') return
  const lights = () => app.evaluate(() => (globalThis as any).arcBrowser.window.win.getWindowButtonPosition())
  const right = () => app.evaluate((_electron, width) => (globalThis as any).arcBrowser.window.size().width - 13 - width, trafficLightsWidth)
  const reveal = async (show: boolean) => dispatch({ type: 'overlay', mode: { kind: show ? 'sidebar' : 'none' } })
  expect(await lights()).toEqual({ x: 13, y: 16 })
  await dispatch({ type: 'settings', patch: { sidebarVisible: false } })
  await reveal(true)
  expect(await lights()).toEqual({ x: 13, y: 20 })
  await reveal(false)
  await dispatch({ type: 'settings', patch: { sidebarRight: true } })
  await reveal(true)
  expect(await lights()).toEqual({ x: await right(), y: 20 })
  await reveal(false)
  await dispatch({ type: 'settings', patch: { sidebarVisible: true } })
  expect(await lights()).toEqual({ x: await right(), y: 16 })
  await dispatch({ type: 'settings', patch: { sidebarRight: false } })
  expect(await lights()).toEqual({ x: 13, y: 16 })
})

test('moving the sidebar to the right moves the traffic lights in every window on macOS', async () => {
  if (process.platform !== 'darwin') return
  await app.evaluate(() => (globalThis as any).arcBrowser.openNewWindow())
  const lights = () =>
    app.evaluate((_electron, width) => {
      const wins = (globalThis as any).arcBrowser.wins
      return wins.map((mainWindow: any) => mainWindow.main.win.getWindowButtonPosition().x - (mainWindow.main.size().width - 13 - width))
    }, trafficLightsWidth)
  await dispatch({ type: 'settings', patch: { sidebarRight: true } })
  expect(await lights()).toEqual([0, 0])
  await dispatch({ type: 'settings', patch: { sidebarRight: false } })
  await app.evaluate(() => (globalThis as any).arcBrowser.wins[1].main.win.close())
})

test('the menu button opens Settings on Windows and Linux; macOS has the menu bar instead', async () => {
  const ui = await pageWithUrl('index.html')
  const button = ui.locator('.topbar button[title="Menu"]')
  if (process.platform === 'darwin') return expect(button).toHaveCount(0)
  await captureNextMenu('appMenu')
  await button.click()
  await expect.poll(() => app.evaluate(() => !!(globalThis as any).appMenu)).toBe(true)
  await app.evaluate(() => (globalThis as any).appMenu.items.find((item: Electron.MenuItem) => item.label === 'Settings…').click())
  await expect.poll(overlayKind).toBe('settings')
  await dispatch({ type: 'overlay', mode: { kind: 'none' } })
})

test('Ctrl/Cmd+S toggles the sidebar and the page grows', async () => {
  await dispatch({ type: 'open', url: `${base}/sidebar-keys`, where: 'tab' })
  await pageWithUrl('/sidebar-keys')
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
  await app.evaluate((_electron, modifiers) => {
    const wc = (globalThis as any).arcBrowser.window.overlay.webContents
    wc.focus()
    for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode: 'Y', modifiers })
  }, [mod, 'shift'])
  await expect.poll(async () => (await state()).settings.shortcuts.toggleSidebar).toEqual([mod === 'meta' ? 'Cmd+Shift+Y' : 'Ctrl+Shift+Y'])
  await dispatch({ type: 'overlay', mode: { kind: 'none' } })

  const inPage = (js: string) => app.evaluate((_electron, code) => (globalThis as any).arcBrowser.activeTab().wc.executeJavaScript(code), js)
  await inPage(`window.keys = []; addEventListener('keydown', (event) => keys.push(event.code))`)
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
  const ui = app.windows().find((page) => page.url().endsWith('index.html'))!
  const drag = async (offsetX: number) => {
    const box = (await ui.locator('.sidebar-resize').boundingBox())!
    const pointerX = box.x + box.width / 2
    const pointerY = box.y + 200
    await ui.mouse.move(pointerX, pointerY)
    await ui.mouse.down()
    await ui.mouse.move(pointerX + offsetX, pointerY, { steps: 5 })
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

test('favorites live at the top and belong to the profile', async () => {
  await dispatch({ type: 'open', url: `${base}/two`, where: 'tab' })
  const two = (await space()).today[0]
  await dispatch({ type: 'addFavorite', id: two.id })
  const snapshot = await state()
  const profile = snapshot.profiles.find((candidate) => candidate.id === (snapshot.spaces.find((spaceState) => spaceState.id === snapshot.activeSpaceId)!.profileId))!
  expect(profile.favorites.map((favorite) => favorite.id)).toContain(two.id)
  const ui = await pageWithUrl('index.html')
  await expect(ui.locator('.favorite')).toHaveCount(profile.favorites.length)
})

test('switching tabs ends a rename started by a double-click, and the row stays clickable', async () => {
  // The double-click's second click used to give the keyboard to the page, which doesn't blur the
  // sidebar's field: after a tab switch the rename stayed open and swallowed clicks on its row.
  await dispatch({ type: 'open', url: `${base}/fav-target`, where: 'tab' })
  await dispatch({ type: 'addFavorite', id: (await space()).today[0].id })
  await dispatch({ type: 'open', url: `${base}/rename-me`, where: 'tab' })
  const current = await space()
  const tab = current.today.find((item) => item.url.endsWith('/rename-me'))!
  const favorite = (await state()).profiles.find((profile) => profile.id === current.profileId)!.favorites[0]
  const ui = await pageWithUrl('index.html')
  const row = ui.locator('.row', { hasText: 'Page rename-me' })
  const box = (await row.boundingBox())!
  await app.evaluate((_electron, at) => {
    const wc = (globalThis as any).arcBrowser.window.ui
    for (const clickCount of [1, 2]) for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, ...at, button: 'left', clickCount })
  }, { x: Math.round(box.x + 60), y: Math.round(box.y + box.height / 2) })
  await expect(ui.locator('input.rename')).toBeFocused()
  await expect.poll(() => app.evaluate(() => (globalThis as any).arcBrowser.window.ui.isFocused())).toBe(true)

  // Cmd/Ctrl+1, typed in the sidebar, selects the first favorite.
  await app.evaluate((_electron, modifiers) => (globalThis as any).arcBrowser.window.ui.sendInputEvent({ type: 'keyDown', keyCode: '1', modifiers }), [mod])
  await expect.poll(async () => (await space()).activeItemId).toBe(favorite.id)
  await expect(ui.locator('input.rename')).toHaveCount(0)
  // Left untouched, the rename saved nothing: the title still follows the page.
  expect((await space()).today.find((item) => item.id === tab.id)!.savedTitle).toBeUndefined()

  await row.click()
  await expect.poll(async () => (await space()).activeItemId).toBe(tab.id)
})

test('the peeking sidebar stays out while the pointer is near it and slides back once it moves over the page', async () => {
  await dispatch({ type: 'open', url: `${base}/peek-away`, where: 'tab' })
  // Chromium sends mouse moves at the real cursor when views change: keep the window above or below it (a corner of 1024×768 can still be under it).
  const bounds = await app.evaluate(({ screen }) => {
    const win = (globalThis as any).arcBrowser.window.win
    const before = win.getBounds()
    const cursor = screen.getCursorScreenPoint()
    const area = screen.getDisplayNearestPoint(cursor).workArea
    const [above, below] = [cursor.y - area.y, area.y + area.height - cursor.y - 1]
    const height = Math.min(520, Math.max(above, below))
    win.setBounds({ x: area.x, y: above > below ? cursor.y - height : cursor.y + 1, width: 800, height })
    return before
  })
  await dispatch({ type: 'toggleSidebar' })
  await dispatch({ type: 'sidebarReveal', show: true })
  const moveIn = (target: 'overlay' | 'page', pointX: number) =>
    app.evaluate(
      (_electron, [targetView, pagePointX]) => {
        const browser = (globalThis as any).arcBrowser
        const wc = targetView === 'overlay' ? browser.window.overlay.webContents : browser.activeTab().wc
        wc.sendInputEvent({ type: 'mouseMove', x: pagePointX, y: 200 })
      },
      [target, pointX] as const
    )
  await moveIn('overlay', 40)
  // Just past the sidebar's edge, over the page, is still near it: no timer to hide it.
  await app.evaluate(() => {
    const mainWindow = (globalThis as any).arcBrowser.window
    const watch = mainWindow.pointerWatch
    mainWindow.pointerWatch = (pointer: unknown) => {
      watch(pointer)
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
  await app.evaluate((_electron, savedBounds) => (globalThis as any).arcBrowser.window.win.setBounds(savedBounds), bounds)
})

test('dragging a tab inside the peeking sidebar drops in the sidebar, not on the split zones', async () => {
  for (const name of ['peek-fav', 'peek-tube']) await dispatch({ type: 'open', url: `${base}/${name}`, where: 'tab' })
  const favoriteTab = (await space()).today.find((tab) => tab.url.endsWith('/peek-fav'))!
  const tube = (await space()).today.find((tab) => tab.url.endsWith('/peek-tube'))!
  await dispatch({ type: 'addFavorite', id: favoriteTab.id })
  // The hidden sidebar slides out on hover; keep it out although the real pointer is elsewhere.
  await app.evaluate(() => {
    const browser = (globalThis as any).arcBrowser
    browser.realWatchSidebarReveal = browser.watchSidebarReveal
    browser.watchSidebarReveal = () => {}
  })
  await dispatch({ type: 'toggleSidebar' })
  await dispatch({ type: 'sidebarReveal', show: true })
  const overlay = await pageWithUrl('overlay.html')
  await expect(overlay.locator('.sidebar.floating .row .title', { hasText: 'Page peek-tube' })).toBeVisible()
  // Start dragging the tab: the overlay grows over the whole window for the split zones.
  await overlay.evaluate(() => {
    const pageGlobals = window as any
    pageGlobals.dragged = [...document.querySelectorAll('.row')].find((row) => row.querySelector('.title')?.textContent === 'Page peek-tube')
    pageGlobals.transfer = new DataTransfer()
    pageGlobals.dragged.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: pageGlobals.transfer }))
  })
  await expect(overlay.locator('.split-drop')).toBeVisible()
  // Drop on the favorites, at whatever is on top there, as a real drag would hit it.
  const hit = await overlay.evaluate(() => {
    const pageGlobals = window as any
    const rect = document.querySelector('.favorites')!.getBoundingClientRect()
    const dropX = rect.right - 6
    const dropY = rect.top + rect.height / 2
    const target = document.elementFromPoint(dropX, dropY)!
    for (const type of ['dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: dropX, clientY: dropY, dataTransfer: pageGlobals.transfer }))
    pageGlobals.dragged.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: pageGlobals.transfer }))
    return !!target.closest('.sidebar')
  })
  expect(hit).toBe(true)
  await expect.poll(async () => (await state()).profiles[0].favorites.map((favorite) => favorite.id)).toContain(tube.id)
  expect((await space()).splits).toHaveLength(0)
  await dispatch({ type: 'sidebarReveal', show: false })
  await dispatch({ type: 'toggleSidebar' })
  await app.evaluate(() => {
    const browser = (globalThis as any).arcBrowser
    browser.watchSidebarReveal = browser.realWatchSidebarReveal
  })
})

test('right-clicking the sidebar offers new spaces, the appearance and its side; a tab keeps its own menu', async () => {
  await dispatch({ type: 'open', url: `${base}/sidebar-menu`, where: 'tab' })
  const tabId = (await space()).activeItemId!
  const ui = await pageWithUrl('index.html')
  await app.evaluate(({ Menu }) => {
    const globals = globalThis as any
    globals.realPopup = Menu.prototype.popup
    globals.shownMenus = []
    Menu.prototype.popup = function (this: Electron.Menu) {
      globals.shownMenus.push(this)
    }
  })
  const shownLabels = () => app.evaluate(() => (globalThis as any).shownMenus.map((menu: Electron.Menu) => menu.items.map((item) => item.label)))
  const rightClickSidebarAndChoose = async (...path: string[]) => {
    await app.evaluate(() => ((globalThis as any).shownMenus = []))
    await ui.locator('.sidebar').dispatchEvent('contextmenu')
    await expect.poll(async () => (await shownLabels()).length).toBe(1)
    await app.evaluate((_electron, labels) => {
      let items: Electron.MenuItem[] = (globalThis as any).shownMenus[0].items
      for (const label of labels.slice(0, -1)) items = items.find((item) => item.label === label)!.submenu!.items
      items.find((item) => item.label === labels[labels.length - 1])!.click()
    }, path)
  }
  try {
    await rightClickSidebarAndChoose('Sidebar on the Right')
    await expect.poll(async () => (await state()).settings.sidebarRight).toBe(true)
    await rightClickSidebarAndChoose('Appearance', 'Dark')
    await expect.poll(async () => (await state()).settings.theme).toBe('dark')
    await rightClickSidebarAndChoose('New Space…')
    await expect.poll(overlayKind).toBe('space-editor')
    await dispatch({ type: 'overlay', mode: { kind: 'none' } })

    await app.evaluate(() => ((globalThis as any).shownMenus = []))
    await ui.locator('.row', { hasText: 'Page sidebar-menu' }).click({ button: 'right' })
    await expect.poll(async () => (await shownLabels()).length).toBeGreaterThan(0)
    // Messages from one page arrive in order: once this one is handled, every menu the right-click asked for has opened.
    await ui.evaluate(() => (window as any).arc.dispatch({ type: 'overlay', mode: { kind: 'none' } }))
    const menus = await shownLabels()
    expect(menus).toHaveLength(1)
    expect(menus[0]).not.toContain('New Space…')
  } finally {
    await app.evaluate(({ Menu }) => {
      Menu.prototype.popup = (globalThis as any).realPopup
    })
    await dispatch({ type: 'overlay', mode: { kind: 'none' } })
    await dispatch({ type: 'settings', patch: { sidebarRight: false, theme: 'system' } })
    await dispatch({ type: 'close', id: tabId })
  }
})

test('a toast shows where it can be seen: in the sidebar on either side, and above the page while the sidebar is hidden', async () => {
  await dispatch({ type: 'open', url: `${base}/toast-page`, where: 'tab' })
  const tabId = (await space()).activeItemId!
  const ui = await pageWithUrl('index.html')
  const overlay = await pageWithUrl('overlay.html')
  const copyUrl = () => app.evaluate(() => (globalThis as any).arcBrowser.runCommand('copyUrl'))
  try {
    for (const sidebarRight of [false, true]) {
      await dispatch({ type: 'settings', patch: { sidebarVisible: true, sidebarRight } })
      await expect(ui.locator('.sidebar.right')).toHaveCount(sidebarRight ? 1 : 0)
      await copyUrl()
      const toast = ui.locator('.notices .toast', { hasText: 'Copied URL' })
      await expect(toast).toBeVisible()
      const box = (await toast.boundingBox())!
      const page = (await state()).layout.content
      expect(box.x + box.width <= page.x || box.x >= page.x + page.width).toBe(true)
      await expect(toast).toHaveCount(0)
    }
    await dispatch({ type: 'settings', patch: { sidebarVisible: false } })
    await copyUrl()
    await expect.poll(overlayKind).toBe('notice')
    await expect(overlay.getByText('Copied URL')).toBeVisible()
    await expect.poll(overlayKind, { timeout: 5000 }).toBe('none')

    await dispatch({ type: 'overlay', mode: { kind: 'library', tab: 'history' } })
    await expect.poll(overlayKind).toBe('library')
    await copyUrl()
    await expect(overlay.locator('.overlay-notices .toast', { hasText: 'Copied URL' })).toBeVisible()
    expect(await overlayKind()).toBe('library')
  } finally {
    await dispatch({ type: 'overlay', mode: { kind: 'none' } })
    await dispatch({ type: 'settings', patch: { sidebarVisible: true, sidebarRight: false } })
    await dispatch({ type: 'close', id: tabId })
  }
})
