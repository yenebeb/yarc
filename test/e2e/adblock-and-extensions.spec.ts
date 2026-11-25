import { expect, test, type Page } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { app, base, dispatch, hits, overlayKind, pageWithUrl, space, state, useApp, userData } from './app'

useApp()

const adblockReady = () => app.evaluate(() => !!(globalThis as any).arcBrowser.adblock.engine)

test('built-in ad blocking blocks ad requests and can be turned off per site', async () => {
  await expect.poll(adblockReady).toBe(true)
  await dispatch({ type: 'open', url: `${base}/ads`, where: 'tab' })
  await expect.poll(async () => (await state()).live[(await space()).activeItemId!]?.loading).toBe(false)
  const id = (await space()).activeItemId!
  // Injected from the main process: a Playwright-attached page doesn't survive the reload below in packaged builds.
  await app.evaluate(
    (_electron, src) => (globalThis as any).arcBrowser.activeTab().wc.executeJavaScript(src),
    `for (const src of ['https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js']) {
      const script = document.createElement('script'); script.src = src; document.head.appendChild(script)
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

// Shaped like Ghostery's: helpers declared at top level, keeping state on the function, wrapping Function.prototype.toString.
const SCRIPTLET = `class Helper {}
function wrapToString() {
  if (wrapToString.native) return
  wrapToString.native = Function.prototype.toString
  Function.prototype.toString = new Proxy(wrapToString.native, { apply: (_, self) => wrapToString.native.call(self) })
}
wrapToString()
window.scriptlets = (window.scriptlets ?? 0) + 1`

test('ad block scriptlets run before the page’s own scripts, each in its own scope, and one that throws is caught', async () => {
  await expect.poll(adblockReady).toBe(true)
  await app.evaluate((_electron, scriptlet) => {
    const engine = (globalThis as any).arcBrowser.adblock.engine
    const original = engine.getCosmeticsFilters
    engine.restoreForTest = () => (engine.getCosmeticsFilters = original)
    engine.getCosmeticsFilters = function (request: { url: string; getInjectionRules: boolean }) {
      const result = original.call(this, request)
      if (!request.url.includes('/still-loading') || !request.getInjectionRules) return result
      return { ...result, scripts: [...Array(12).fill(scriptlet), 'throw new Error("scriptlet")'] }
    }
  }, SCRIPTLET)
  try {
    await dispatch({ type: 'open', url: `${base}/still-loading`, where: 'tab' })
    const ran = () =>
      app.evaluate(async () => {
        const wc = (globalThis as any).arcBrowser.activeTab().wc
        return { loading: wc.isLoading(), count: await wc.mainFrame.executeJavaScript('window.scriptlets ?? 0'), seenByPage: await wc.mainFrame.executeJavaScript('window.seenByPage') }
      })
    await expect.poll(async () => (await ran()).count).toBe(12)
    expect(await ran()).toMatchObject({ loading: true, seenByPage: 12 })
    expect(await app.evaluate(() => (globalThis as any).arcBrowser.activeTab().wc.mainFrame.executeJavaScript('Function.prototype.toString.call(alert)'))).toContain('[native code]')
    const log = readFileSync(join(userData, 'logs', 'main.log'), 'utf8')
    expect(log).not.toContain('Script failed to execute')
    expect(log).not.toContain('MaxListenersExceededWarning')
  } finally {
    await app.evaluate(() => (globalThis as any).arcBrowser.adblock.engine.restoreForTest())
    await dispatch({ type: 'close', id: (await space()).activeItemId! })
  }
})

function extensionDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'yarc-ext-'))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content))
  return dir
}

const removeExtension = (id: string) =>
  app.evaluate((_electron, id) => {
    const browser = (globalThis as any).arcBrowser
    browser.profiles.get(browser.store.activeSpace.profileId).session.extensions.removeExtension(id)
  }, id)

// electron-chrome-extensions only fills `chrome`; extensions written against `browser.*` (1Password
// reads browser.windows when its background starts) need the same APIs there.
test('extensions get the chrome.* APIs on browser.* too', async () => {
  const dir = extensionDir({
    'manifest.json': { manifest_version: 3, name: 'browser namespace', version: '1.0', background: { service_worker: 'bg.js', type: 'module' } },
    'bg.js': 'console.log(`browser.windows: ${typeof browser.windows}, browser.tabs.query: ${typeof browser.tabs.query}`)'
  })
  const logged = await app.evaluate(async (_electron, extDir) => {
    const browser = (globalThis as any).arcBrowser
    const ses = browser.profiles.get(browser.store.activeSpace.profileId).session
    const message = new Promise<string>((resolve) =>
      ses.serviceWorkers.on('console-message', (_event: unknown, details: { message: string }) => details.message.startsWith('browser.') && resolve(details.message))
    )
    const ext = await ses.extensions.loadExtension(extDir)
    const result = await message
    ses.extensions.removeExtension(ext.id)
    return result
  }, dir)
  expect(logged).toBe('browser.windows: object, browser.tabs.query: function')
})

// Electron has no declarativeNetRequest: YARC's own one makes MV3 blockers (uBlock Origin Lite) block.
test('an extension’s declarativeNetRequest rules block requests, from its manifest and from its code, and redirect once granted the site', async () => {
  const blockScript = (id: number, urlFilter: string) => ({ id, action: { type: 'block' }, condition: { urlFilter, resourceTypes: ['script'] } })
  // Redirects need the site's permission, which this extension only asks for at runtime.
  const redirectScript = { id: 2, action: { type: 'redirect', redirect: { url: `${base}/dnr-redirected.js` } }, condition: { urlFilter: '/dnr-redirect.js', resourceTypes: ['script'] } }
  const dir = extensionDir({
    'manifest.json': {
      manifest_version: 3,
      name: 'dnr blocker',
      version: '1.0',
      permissions: ['declarativeNetRequest'],
      optional_host_permissions: ['<all_urls>'],
      background: { service_worker: 'bg.js' },
      declarative_net_request: { rule_resources: [{ id: 'on', enabled: true, path: 'on.json' }, { id: 'off', enabled: false, path: 'off.json' }] }
    },
    'on.json': [blockScript(1, '/dnr-static.js')],
    'off.json': [blockScript(1, '/dnr-kept.js')],
    'bg.js': `chrome.permissions.request({ origins: ['<all_urls>'] })
      .then(() => chrome.declarativeNetRequest.updateDynamicRules({ addRules: ${JSON.stringify([blockScript(1, '||127.0.0.1^*/dnr-dynamic.js'), redirectScript])} }))
      .then(() => chrome.declarativeNetRequest.getEnabledRulesets())
      .then((ids) => console.log('dnr ready: ' + ids.join(',')))`
  })
  const extId = await app.evaluate(async (_electron, extDir) => {
    const browser = (globalThis as any).arcBrowser
    const ses = browser.profiles.get(browser.store.activeSpace.profileId).session
    const ready = new Promise<string>((resolve) =>
      ses.serviceWorkers.on('console-message', (_event: unknown, details: { message: string }) => details.message.startsWith('dnr ready') && resolve(details.message))
    )
    const ext = await ses.extensions.loadExtension(extDir)
    if ((await ready) !== 'dnr ready: on') throw new Error('unexpected rulesets')
    return ext.id
  }, dir)
  const scripts = ['/dnr-static.js', '/dnr-dynamic.js', '/dnr-redirect.js', '/dnr-redirected.js', '/dnr-kept.js']
  await dispatch({ type: 'open', url: `${base}/dnr-page`, where: 'tab' })
  const tabId = (await space()).activeItemId!
  try {
    // The redirect is an extra hop, so its script can come after the last one in the page.
    await expect.poll(() => hits.includes('/dnr-kept.js') && hits.includes('/dnr-redirected.js'), { timeout: 15_000 }).toBe(true)
    expect(scripts.filter((script) => hits.includes(script))).toEqual(['/dnr-redirected.js', '/dnr-kept.js'])
  } finally {
    await dispatch({ type: 'close', id: tabId })
    await removeExtension(extId)
  }
})

const loadExtension = (dir: string): Promise<string> =>
  app.evaluate(async (_electron, extDir) => {
    const browser = (globalThis as any).arcBrowser
    return (await browser.profiles.get(browser.store.activeSpace.profileId).session.extensions.loadExtension(extDir)).id
  }, dir)

test('only pinned extensions show in the address field, after the puzzle button opens the rest', async () => {
  const action = { default_popup: 'popup.html' }
  const first = await loadExtension(extensionDir({ 'manifest.json': { manifest_version: 3, name: 'pinned', version: '1.0', action }, 'popup.html': 'popup' }))
  const second = await loadExtension(
    extensionDir({
      'manifest.json': { manifest_version: 3, name: 'badged', version: '1.0', action, background: { service_worker: 'bg.js' } },
      'bg.js': "chrome.action.setBadgeText({ text: '7' })",
      'popup.html': 'popup'
    })
  )
  const { profileId } = await space()
  const ui = app.windows().find((page) => page.url().endsWith('index.html'))!
  const button = (id: string) => ui.locator(`button[is="browser-action"][id="${id}"]`)
  const pin = (extensionId: string, pinned: boolean) => dispatch({ type: 'extensionPin', profileId, extensionId, pinned })
  try {
    await pin(first, true)
    await expect(button(first)).toBeVisible()
    await expect(button(second)).toHaveCount(0)
    await expect(ui.locator('.extensions-button')).toBeVisible()
    await pin(first, false)
    await expect(button(first)).toHaveCount(0)
    await expect(ui.locator('.extensions-button')).toBeVisible()
    await pin(second, true)
    await expect(button(second).locator('.badge')).toHaveText('7')
    await removeExtension(second)
    await expect(button(second)).toHaveCount(0)
  } finally {
    await pin(first, false)
    await pin(second, false)
    await removeExtension(first)
    await removeExtension(second)
  }
})

/** Clicking opens an extension popup; it must lie within the main window's width. */
async function expectPopupInsideWindow(click: () => Promise<void>): Promise<void> {
  await app.evaluate(() => {
    const browser = (globalThis as any).arcBrowser
    browser.extensions.byProfile.get(browser.store.activeSpace.profileId).library.once('browser-action-popup-created', (popup: unknown) => ((globalThis as any).popup = popup))
  })
  await click()
  await expect.poll(() => app.evaluate(() => !!(globalThis as any).popup)).toBe(true)
  const inside = await app.evaluate(() => {
    const globals = globalThis as any
    const popup = globals.popup
    globals.popup = undefined
    // A hidden window doesn't render under test, so the popup never reports a size: size and place it as the library then would.
    popup.setSize({ width: 300, height: 200 })
    popup.updatePosition()
    const popupBounds = popup.browserWindow.getBounds()
    const windowBounds = globals.arcBrowser.window.win.getBounds()
    popup.destroy()
    return popupBounds.x >= windowBounds.x && popupBounds.x + popupBounds.width <= windowBounds.x + windowBounds.width
  })
  expect(inside).toBe(true)
}

const popupExtensionDir = (name: string) =>
  extensionDir({ 'manifest.json': { manifest_version: 3, name, version: '1.0', action: { default_popup: 'popup.html' } }, 'popup.html': 'popup' })

test('a pinned extension shows in a profile whose extensions started after its sidebar did', async () => {
  const before = await space()
  await dispatch({ type: 'createSpace', name: 'Late', emoji: '🐢', color: '#3fa7d6', profileId: 'new' })
  const late = await space()
  const ui = app.windows().find((page) => page.url().endsWith('index.html'))!
  await expect(ui.locator('.extensions-button')).toHaveCount(0)
  await dispatch({ type: 'open', url: `${base}/late-profile`, where: 'tab' })
  const extId = await loadExtension(popupExtensionDir('late profile'))
  try {
    await dispatch({ type: 'extensionPin', profileId: late.profileId, extensionId: extId, pinned: true })
    await expect(ui.locator(`button[is="browser-action"][id="${extId}"]`)).toBeVisible()
  } finally {
    await removeExtension(extId)
    await dispatch({ type: 'switchSpace', id: before.id })
    await dispatch({ type: 'deleteSpace', id: late.id })
  }
})

test('the extensions popover pins and unpins', async () => {
  const extId = await loadExtension(popupExtensionDir('popover pin'))
  const { profileId } = await space()
  const ui = app.windows().find((page) => page.url().endsWith('index.html'))!
  const overlay = await pageWithUrl('overlay.html')
  const pins = async () => (await state()).profiles.find((profile) => profile.id === profileId)!.pinnedExtensions ?? []
  const inBar = ui.locator(`button[is="browser-action"][id="${extId}"]`)
  try {
    await ui.locator('.extensions-button').click()
    await expect.poll(overlayKind).toBe('extensions')
    const pin = overlay.locator(`.extension-row[data-id="${extId}"] .pin`)
    await pin.click()
    await expect.poll(pins).toContain(extId)
    await expect(inBar).toBeVisible()
    await pin.click()
    await expect.poll(pins).not.toContain(extId)
    await expect(inBar).toHaveCount(0)
  } finally {
    await dispatch({ type: 'overlay', mode: { kind: 'none' } })
    await removeExtension(extId)
  }
})

test('an extension opened from the popover opens inside the window, whichever side the sidebar is on', async () => {
  const extId = await loadExtension(popupExtensionDir('popover open'))
  await dispatch({ type: 'open', url: `${base}/popover-open`, where: 'tab' })
  const tabId = (await space()).activeItemId!
  const ui = app.windows().find((page) => page.url().endsWith('index.html'))!
  const overlay = await pageWithUrl('overlay.html')
  try {
    for (const sidebarRight of [false, true]) {
      await dispatch({ type: 'settings', patch: { sidebarRight } })
      const puzzle = ui.locator('.extensions-button')
      const width = await ui.evaluate(() => window.innerWidth)
      await expect.poll(async () => (await puzzle.boundingBox())!.x > width / 2).toBe(sidebarRight)
      await puzzle.click()
      await expect.poll(overlayKind).toBe('extensions')
      await expectPopupInsideWindow(() => overlay.locator(`.extension-row[data-id="${extId}"] button[is="browser-action"]`).click())
      expect(await overlayKind()).toBe('none')
    }
    await dispatch({ type: 'settings', patch: { sidebarVisible: false, sidebarRight: true } })
    await dispatch({ type: 'sidebarReveal', show: true })
    await overlay.locator('.extensions-button').click()
    await expect.poll(overlayKind).toBe('extensions')
    const card = (await overlay.locator('.extensions-popover').boundingBox())!
    expect(card.x).toBeGreaterThan((await overlay.evaluate(() => window.innerWidth)) / 2)
    await expectPopupInsideWindow(() => overlay.locator(`.extension-row[data-id="${extId}"] button[is="browser-action"]`).click())
  } finally {
    await dispatch({ type: 'settings', patch: { sidebarVisible: true, sidebarRight: false } })
    await dispatch({ type: 'close', id: tabId })
    await removeExtension(extId)
  }
})

test("an extension's right-click menu can unpin it", async () => {
  const extId = await loadExtension(popupExtensionDir('menu unpin'))
  const { profileId } = await space()
  const ui = app.windows().find((page) => page.url().endsWith('index.html'))!
  const pins = async () => (await state()).profiles.find((profile) => profile.id === profileId)!.pinnedExtensions ?? []
  await dispatch({ type: 'extensionPin', profileId, extensionId: extId, pinned: true })
  await app.evaluate(({ Menu }) => {
    const globals = globalThis as any
    globals.realPopup = Menu.prototype.popup
    Menu.prototype.popup = function (this: Electron.Menu) {
      globals.shownMenu = this
    }
  })
  try {
    await ui.locator(`button[is="browser-action"][id="${extId}"]`).click({ button: 'right' })
    await expect.poll(() => app.evaluate(() => (globalThis as any).shownMenu?.items.some((item: Electron.MenuItem) => item.label === 'Unpin') ?? false)).toBe(true)
    await app.evaluate(() => (globalThis as any).shownMenu.items.find((item: Electron.MenuItem) => item.label === 'Unpin').click())
    await expect.poll(pins).not.toContain(extId)
  } finally {
    await app.evaluate(({ Menu }) => {
      const globals = globalThis as any
      Menu.prototype.popup = globals.realPopup
      globals.shownMenu = undefined
    })
    await dispatch({ type: 'extensionPin', profileId, extensionId: extId, pinned: false })
    await removeExtension(extId)
  }
})

test('an extension popup opens next to its button, from the sidebar shown or hidden, on either side', async () => {
  const dir = extensionDir({
    'manifest.json': { manifest_version: 3, name: 'popup side', version: '1.0', action: { default_popup: 'popup.html' } },
    'popup.html': 'popup'
  })
  const extId = await loadExtension(dir)
  const { profileId } = await space()
  await dispatch({ type: 'extensionPin', profileId, extensionId: extId, pinned: true })
  await dispatch({ type: 'open', url: `${base}/popup-anchor`, where: 'tab' })
  const tabId = (await space()).activeItemId!
  const ui = app.windows().find((page) => page.url().endsWith('index.html'))!
  const overlay = await pageWithUrl('overlay.html')
  const popupNextToButton = async (page: Page) => {
    await app.evaluate(() => {
      const browser = (globalThis as any).arcBrowser
      browser.extensions.byProfile.get(browser.store.activeSpace.profileId).library.once('browser-action-popup-created', (popup: unknown) => ((globalThis as any).popup = popup))
    })
    await page.locator(`button[is="browser-action"][id="${extId}"]`).click()
    await expect.poll(() => app.evaluate(() => !!(globalThis as any).popup)).toBe(true)
    const { popupBounds, button } = await app.evaluate((_electron, fromOverlay) => {
      const globals = globalThis as any
      const popup = globals.popup
      globals.popup = undefined
      // A hidden window doesn't render under test, so the popup never reports a size: size and place it as the library then would.
      popup.setSize({ width: 300, height: 200 })
      popup.updatePosition()
      const window = globals.arcBrowser.window
      const view = fromOverlay ? window.overlay.getBounds() : { x: 0, y: 0 }
      const content = window.win.getContentBounds()
      const anchor = popup.anchorRect
      const placed = { popupBounds: popup.browserWindow.getBounds(), button: { ...anchor, x: content.x + view.x + anchor.x, y: content.y + view.y + anchor.y } }
      popup.destroy()
      return placed
    }, page === overlay)
    const buttonCenter = button.x + button.width / 2
    expect(popupBounds.x).toBeLessThanOrEqual(buttonCenter)
    expect(popupBounds.x + popupBounds.width).toBeGreaterThanOrEqual(buttonCenter)
    expect(Math.abs(popupBounds.y - (button.y + button.height))).toBeLessThan(40)
  }
  // The hidden sidebar slides away once the real pointer leaves it; keep it out while its button is clicked.
  await app.evaluate(() => {
    const browser = (globalThis as any).arcBrowser
    browser.realWatchSidebarReveal = browser.watchSidebarReveal
    browser.watchSidebarReveal = () => {}
  })
  try {
    for (const sidebarRight of [false, true]) {
      await dispatch({ type: 'settings', patch: { sidebarVisible: true, sidebarRight } })
      await expect(ui.locator(`button[is="browser-action"][id="${extId}"]`)).toHaveAttribute('alignment', sidebarRight ? 'bottom left' : 'bottom right')
      await popupNextToButton(ui)
      await dispatch({ type: 'settings', patch: { sidebarVisible: false } })
      await dispatch({ type: 'sidebarReveal', show: true })
      await expect(overlay.locator(`button[is="browser-action"][id="${extId}"]`)).toHaveAttribute('alignment', sidebarRight ? 'bottom left' : 'bottom right')
      await popupNextToButton(overlay)
    }
  } finally {
    await app.evaluate(() => {
      const browser = (globalThis as any).arcBrowser
      browser.watchSidebarReveal = browser.realWatchSidebarReveal
    })
    await dispatch({ type: 'settings', patch: { sidebarVisible: true, sidebarRight: false } })
    await dispatch({ type: 'extensionPin', profileId, extensionId: extId, pinned: false })
    await dispatch({ type: 'close', id: tabId })
    await removeExtension(extId)
  }
})

// electron-chrome-extensions wrote to a host's closed stdin with no error listener: an uncaught EPIPE crashed the app (#122).
test('an extension whose native messaging host stops reading gets a disconnect, and the app keeps running', async () => {
  test.skip(process.platform === 'win32', 'Windows finds hosts in the registry')
  const host = join(userData, 'closed-host.sh')
  writeFileSync(host, '#!/bin/sh\nexec 0<&-\nsleep 30\n')
  chmodSync(host, 0o755)
  // The host must list the extension's ID before it loads: a manifest key fixes it, as Chrome derives it.
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' })
  const id = [...createHash('sha256').update(key).digest('hex').slice(0, 32)].map((hexDigit) => String.fromCharCode(97 + parseInt(hexDigit, 16))).join('')
  const dir = extensionDir({
    'manifest.json': { manifest_version: 3, name: 'closed host', version: '1.0', key: key.toString('base64'), permissions: ['nativeMessaging'], background: { service_worker: 'bg.js' } },
    'bg.js': `const port = chrome.runtime.connectNative('org.yarc.closed_host')
      const ping = setInterval(() => port.postMessage({ ping: true }), 100)
      port.onDisconnect.addListener(() => { clearInterval(ping); console.log('native host disconnected') })`
  })
  mkdirSync(join(userData, 'NativeMessagingHosts'), { recursive: true })
  writeFileSync(
    join(userData, 'NativeMessagingHosts', 'org.yarc.closed_host.json'),
    JSON.stringify({ name: 'org.yarc.closed_host', description: 'e2e', path: host, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] })
  )
  const extId = await app.evaluate(async (_electron, extDir) => {
    const browser = (globalThis as any).arcBrowser
    const ses = browser.profiles.get(browser.store.activeSpace.profileId).session
    const disconnected = new Promise<void>((resolve) =>
      ses.serviceWorkers.on('console-message', (_event: unknown, details: { message: string }) => details.message === 'native host disconnected' && resolve())
    )
    const ext = await ses.extensions.loadExtension(extDir)
    ;(globalThis as any).nativeHostDisconnected = disconnected
    return ext.id
  }, dir)
  try {
    expect(extId).toBe(id)
    await app.evaluate(() => (globalThis as any).nativeHostDisconnected)
    expect(readFileSync(join(userData, 'logs', 'main.log'), 'utf8')).not.toContain('EPIPE')
  } finally {
    await removeExtension(extId)
  }
})

test('Remove in Settings uninstalls an extension once the question is confirmed', async () => {
  const dir = extensionDir({ 'manifest.json': { manifest_version: 3, name: 'removable', version: '1.0' } })
  const extId = await app.evaluate(async (_electron, extDir) => {
    const browser = (globalThis as any).arcBrowser
    return (await browser.profiles.get(browser.store.activeSpace.profileId).session.extensions.loadExtension(extDir)).id
  }, dir)
  await dispatch({ type: 'overlay', mode: { kind: 'settings', section: 'extensions' } })
  const overlay = await pageWithUrl('overlay.html')
  const row = overlay.locator('.set-ext', { hasText: 'removable' })
  try {
    overlay.once('dialog', (question) => void question.accept())
    await row.getByRole('button', { name: 'Remove' }).click()
    await expect(row).toHaveCount(0)
    expect(Object.values((await state()).extensions).flat().map((extension) => extension.id)).not.toContain(extId)
  } finally {
    await dispatch({ type: 'overlay', mode: { kind: 'none' } })
  }
})
