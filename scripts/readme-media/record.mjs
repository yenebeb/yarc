// Records the README's GIFs and screenshots from the real app, on demo pages under invented .test domains.
// `pnpm build`, then `node scripts/readme-media/record.mjs [name…]`, then `python3 scripts/readme-media/make.py` (needs Pillow).
// macOS only (screencapture); leave the window alone while it runs.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron } from '@playwright/test'

const ROOT = join(import.meta.dirname, '../..')
const FRAMES = join(tmpdir(), 'yarc-readme-media')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CARD = '(() => { const r = document.getElementById("card").getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()'

const server = createServer((req, res) => {
  try {
    const file = readFileSync(join(import.meta.dirname, 'site', req.url.slice(1)))
    res.writeHead(200, { 'content-type': req.url.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' })
    res.end(req.url.endsWith('.html') ? file.toString().replaceAll('PORT', String(port)) : file)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const url = (host, page) => `http://${host}:${port}/${page}.html`

async function launch(name) {
  rmSync(join(FRAMES, name), { recursive: true, force: true })
  mkdirSync(join(FRAMES, name), { recursive: true })
  const app = await _electron.launch({
    args: [join(ROOT, 'out/main/index.js'), '--host-resolver-rules=MAP *.test 127.0.0.1'],
    env: { ...process.env, YARC_USER_DATA: mkdtempSync(join(tmpdir(), 'yarc-readme-')), YARC_TEST: '1' }
  })
  await sleep(2000)
  const ev = (fn, arg) => app.evaluate(fn, arg)
  // On top, because macOS stops redrawing a covered window and the capture would show a stale picture.
  const windowId = await ev(() => {
    const w = globalThis.arcBrowser.window.win
    w.setBounds({ x: 100, y: 60, width: 1360, height: 860 })
    w.setAlwaysOnTop(true, 'floating')
    w.focus()
    return w.getMediaSourceId().split(':')[1]
  })
  const frames = []
  const capture = (id, file, shadow = false) => execFileSync('screencapture', ['-x', ...(shadow ? [] : ['-o']), `-l${id}`, join(FRAMES, name, file)])
  const s = {
    ev,
    capture,
    dispatch: (a) => ev((_e, action) => globalThis.arcBrowser.dispatch(action), a),
    page: (fragment) => app.windows().find((w) => w.url().includes(fragment)),
    /** `cursor` is in window points; make.py draws it. */
    frame: async (label, hold, cursor = null, fade = true) => {
      await sleep(150)
      const file = `${String(frames.length).padStart(3, '0')}-${label}.png`
      capture(windowId, file)
      frames.push({ file: join(FRAMES, name, file), hold, cursor, fade })
    },
    close: async () => {
      writeFileSync(join(FRAMES, `${name}.json`), JSON.stringify(frames))
      await app.close()
    }
  }
  await setUp(s)
  return s
}

async function setUp(s) {
  const state = () => s.ev(() => globalThis.arcBrowser.state)
  s.item = async (fragment) => {
    const st = await state()
    const space = st.spaces.find((x) => x.id === st.activeSpaceId)
    return [...space.today, ...space.pinned, ...st.profiles.flatMap((p) => p.favorites)].find((t) => t.url?.includes(fragment))
  }
  const open = async (host, page) => {
    await s.dispatch({ type: 'open', url: url(host, page), where: 'tab' })
    await sleep(600)
  }
  await open('hourly.test', 'clock')
  await s.dispatch({ type: 'addFavorite', id: (await s.item('clock')).id })
  await open('huestudio.test', 'palette')
  await s.dispatch({ type: 'addFavorite', id: (await s.item('palette')).id })
  for (const [host, page] of [['mailbox.test', 'mail'], ['tunes.test', 'music']]) {
    await open(host, page)
    await s.dispatch({ type: 'addFavorite', id: (await s.item(page)).id })
  }
  await open('trailhead.test', 'photo')
  await s.dispatch({ type: 'togglePin', id: (await s.item('photo')).id })
  await open('tally.test', 'chart')
  await open('skyline.test', 'weather')
  s.personal = (await state()).activeSpaceId
  await s.dispatch({ type: 'createSpace', name: 'Work', emoji: '💼', color: '#3fa7d6', profileId: 'new' })
  await sleep(500)
  s.work = (await state()).activeSpaceId
  await open('paper.test', 'notes')
  await open('taskly.test', 'tasks')
  await s.dispatch({ type: 'switchSpace', id: s.personal })
  await sleep(400)
  await s.dispatch({ type: 'activate', id: (await s.item('weather')).id })
  await sleep(900)
}

const rectIn = (page, selector, text) =>
  page.evaluate(([selector, text]) => {
    const r = [...document.querySelectorAll(selector)].find((e) => !text || e.textContent.includes(text)).getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.x, top: r.y, width: r.width, height: r.height }
  }, [selector, text])

const cardOf = (s, tabId) =>
  s.ev(async (_e, [id, code]) => {
    const tab = globalThis.arcBrowser.live.get(id)
    const v = tab.view.getBounds()
    const r = await tab.wc.executeJavaScript(code)
    return { win: { x: v.x + r.x + r.width / 2, y: v.y + r.y + r.height / 2 }, tab: r }
  }, [tabId, CARD])

const click = (s, target, p) =>
  s.ev(async (_e, [target, p]) => {
    const b = globalThis.arcBrowser
    const wc = target.tab ? b.live.get(target.tab).wc : target.canvas ? b.canvases.page(target.canvas).wc : b.window.overlay.webContents
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
      wc.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 })
      await new Promise((r) => setTimeout(r, 60))
    }
  }, [target, p])

/** Captures the demo cards onto the canvas, opens it and lays the cards out two by two. */
async function board(s, canvasId, fragments) {
  for (const fragment of fragments) {
    await s.ev(async (_e, [id, canvasId, code]) => {
      const b = globalThis.arcBrowser
      const tab = b.live.get(id)
      await b.canvases.capture(tab, await tab.wc.executeJavaScript(code), canvasId)
    }, [(await s.item(fragment)).id, canvasId, CARD])
  }
  await s.dispatch({ type: 'activate', id: canvasId })
  await sleep(1800)
  await s.ev((_e, canvasId) => {
    const b = globalThis.arcBrowser
    const files = b.canvases.files(canvasId)
    const scene = files.readScene()
    const order = ['Skyline', 'Hue Studio', 'Trailhead', 'Hourly']
    const cards = scene.items.filter((i) => i.kind === 'capture').sort((a, c) => order.findIndex((o) => a.source.title.includes(o)) - order.findIndex((o) => c.source.title.includes(o)))
    const width = Math.max(cards[0].width, cards[2].width) + 40
    const height = Math.max(cards[0].height, cards[1].height) + 40
    cards.forEach((c, i) => Object.assign(c, { x: (i % 2) * width, y: Math.floor(i / 2) * height }))
    const title = scene.items.find((i) => i.kind === 'text')
    Object.assign(title, { x: 0, y: -title.height - 24 })
    delete scene.view
    files.writeScene(scene)
    b.canvases.page(canvasId).wc.reload()
  }, canvasId)
  await sleep(2000)
}

const flows = {
  async hero(s) {
    await s.ev(() => globalThis.arcBrowser.canvases.create(globalThis.arcBrowser.space, 'Lisbon trip'))
    await s.dispatch({ type: 'open', url: 'https://en.wikipedia.org/wiki/Rick_Astley', where: 'tab' })
    await sleep(6000)
    await s.frame('hero', 1000)
  },

  async spaces(s) {
    await s.frame('personal', 1500)
    await s.dispatch({ type: 'switchSpace', id: s.work })
    await sleep(900)
    await s.frame('work', 1500)
  },

  async command(s) {
    await s.dispatch({ type: 'activate', id: (await s.item('photo')).id })
    await sleep(700)
    await s.frame('page', 900)
    await s.dispatch({ type: 'overlay', mode: { kind: 'command', target: 'tab' } })
    await sleep(600)
    await s.frame('open', 600, null, false)
    const input = s.page('overlay.html').locator('.command input')
    for (const ch of 'lisbon w') {
      await input.pressSequentially(ch)
      await sleep(220)
      await s.frame('type', 140, null, false)
    }
    await sleep(500)
    await s.frame('results', 1400, null, false)
    await input.press('Enter')
    await sleep(900)
    await s.frame('switched', 1300)
  },

  async split(s) {
    const ui = s.page('index.html')
    const row = await rectIn(ui, '.row', 'Golden hour')
    await s.frame('page', 900, [row.x + 40, row.y + 40])
    await s.frame('grab', 400, [row.x, row.y], false)
    await ui.evaluate((title) => {
      const r = [...document.querySelectorAll('.row')].find((e) => e.textContent.includes(title))
      const b = r.getBoundingClientRect()
      window.dt = new DataTransfer()
      r.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, clientX: b.x + 20, clientY: b.y + 10, dataTransfer: window.dt }))
    }, 'Golden hour')
    await sleep(400)
    const ob = await s.ev(() => globalThis.arcBrowser.window.overlay.getBounds())
    const overlay = s.page('overlay.html')
    const drop = await rectIn(overlay, '.split-drop')
    const at = { x: ob.x + drop.left + drop.width * 0.15, y: ob.y + drop.top + drop.height * 0.5 }
    for (let i = 1; i <= 4; i++) await s.frame('drag', 90, [row.x + ((at.x - row.x) * i) / 4, row.y + ((at.y - row.y) * i) / 4], false)
    const dragOnPage = (type) =>
      overlay.evaluate((type) => {
        const el = document.querySelector('.split-drop')
        const r = el.getBoundingClientRect()
        el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: r.left + r.width * 0.15, clientY: r.top + r.height * 0.5, dataTransfer: new DataTransfer() }))
      }, type)
    for (let i = 0; i < 4; i++) {
      await dragOnPage('dragover')
      await sleep(150)
    }
    await sleep(300)
    await s.frame('zone', 1000, [at.x, at.y], false)
    await dragOnPage('drop')
    await ui.evaluate(() => document.querySelector('.sidebar').dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: window.dt })))
    await sleep(1200)
    await s.frame('split', 1800, [at.x, at.y])
  },

  async peek(s) {
    const favorite = await s.item('palette')
    await s.dispatch({ type: 'activate', id: favorite.id })
    await sleep(900)
    const link = await s.ev(async (_e, id) => {
      const tab = globalThis.arcBrowser.live.get(id)
      const v = tab.view.getBounds()
      const r = await tab.wc.executeJavaScript('(() => { const r = document.getElementById("link").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()')
      return { win: { x: v.x + r.x, y: v.y + r.y }, tab: r }
    }, favorite.id)
    await s.frame('page', 900, [link.win.x + 120, link.win.y + 90])
    await s.frame('hover', 600, [link.win.x, link.win.y], false)
    await click(s, { tab: favorite.id }, link.tab)
    await sleep(1500)
    await s.frame('peek', 2000, [link.win.x, link.win.y])
  },

  async canvases(s) {
    const canvasId = await s.ev(() => globalThis.arcBrowser.canvases.create(globalThis.arcBrowser.space, 'Lisbon trip').id)
    const weather = (await s.item('weather')).id
    const card = await cardOf(s, weather)
    await s.frame('page', 1000, [card.win.x + 260, card.win.y + 200])
    await s.ev(() => globalThis.arcBrowser.startCapture())
    await sleep(1200)
    const page = await s.ev(() => globalThis.arcBrowser.window.overlayMode.page)
    const at = { x: page.x + card.tab.x + card.tab.width / 2, y: page.y + card.tab.y + card.tab.height / 2 }
    const input = (type, p) => s.ev((_e, [type, p]) => globalThis.arcBrowser.window.overlay.webContents.sendInputEvent({ type, x: Math.round(p.x), y: Math.round(p.y), button: 'left', clickCount: 1 }), [type, p])
    await input('mouseMove', at)
    await sleep(250)
    await input('mouseMove', at)
    await sleep(400)
    await s.frame('picked', 1200, [card.win.x, card.win.y])
    await input('mouseDown', at)
    await sleep(60)
    await input('mouseUp', at)
    await sleep(500)
    const target = await s.ev(async () => {
      const o = globalThis.arcBrowser.window.overlay
      const r = await o.webContents.executeJavaScript(`(() => { const r = [...document.querySelectorAll('button, div')].reverse().find((e) => e.textContent.trim() === 'Lisbon trip').getBoundingClientRect(); return { x: r.x + 40, y: r.y + r.height / 2 } })()`)
      return { x: o.getBounds().x + r.x, y: o.getBounds().y + r.y, local: r }
    })
    await s.frame('send-to', 600, [card.win.x, card.win.y + 40])
    await input('mouseMove', target.local)
    await sleep(250)
    await s.frame('send-to-hover', 900, [target.x, target.y])
    await click(s, {}, target.local)
    await sleep(900)
    await s.frame('added', 900, [target.x, target.y])
    await board(s, canvasId, ['palette', 'photo', 'clock'])
    const clock = await s.ev(async (_e, canvasId) => {
      const p = globalThis.arcBrowser.canvases.page(canvasId)
      const r = await p.wc.executeJavaScript(`(() => { const r = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes('Hourly')).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
      return { view: p.view.getBounds(), r }
    }, canvasId)
    const inWindow = (p) => [clock.view.x + p.x, clock.view.y + p.y]
    await s.frame('board', 1600, inWindow({ x: clock.r.x - 260, y: clock.r.y + 260 }))
    await s.ev((_e, [canvasId, p]) => globalThis.arcBrowser.canvases.page(canvasId).wc.sendInputEvent({ type: 'mouseMove', x: Math.round(p.x), y: Math.round(p.y) }), [canvasId, clock.r])
    await sleep(400)
    const play = await s.ev((_e, canvasId) =>
      globalThis.arcBrowser.canvases.page(canvasId).wc.executeJavaScript(`(() => { const r = [...document.querySelectorAll('button[title="Show the live page"]')].map((b) => b.getBoundingClientRect()).find((r) => r.width > 0); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`), canvasId)
    await s.frame('hover', 900, inWindow(play))
    await click(s, { canvas: canvasId }, play)
    await sleep(3000)
    for (let i = 0; i < 7; i++) {
      await s.frame('live', 520, inWindow(play), false)
      await sleep(250)
    }
  },

  async little(s) {
    await s.dispatch({ type: 'open', url: url('skyline.test', 'weather'), where: 'little' })
    await sleep(2500)
    const id = await s.ev(() => {
      const l = [...globalThis.arcBrowser.littles][0]
      l.win.setBounds({ x: 300, y: 160, width: 760, height: 560 })
      l.win.focus()
      return l.win.getMediaSourceId().split(':')[1]
    })
    await sleep(800)
    s.capture(id, 'little.png', true)
  },

  async floating(s) {
    await s.dispatch({ type: 'command', id: 'floatingPlayerDemo' })
    await sleep(7000)
    const player = await s.ev(() => {
      const b = globalThis.arcBrowser
      const w = b.floating.win
      w.setBounds({ x: 100 + 1360 - 360 - 28, y: 60 + 860 - 203 - 28, width: 360, height: 203 })
      return { id: w.getMediaSourceId().split(':')[1], bounds: w.getBounds(), main: b.window.win.getBounds() }
    })
    await sleep(800)
    await s.frame('main', 0)
    s.capture(player.id, 'player.png')
    writeFileSync(join(FRAMES, 'floating', 'player.json'), JSON.stringify(player))
  }
}

for (const name of process.argv.length > 2 ? process.argv.slice(2) : Object.keys(flows)) {
  const s = await launch(name)
  await flows[name](s)
  await s.close()
}
server.close()
