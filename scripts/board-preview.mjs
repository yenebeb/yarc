// Draws a What's New board (src/main/boards/<spotlight id>.json, docs/whats-new-canvas.md) in the real app and saves a picture,
// so whoever made the board, a person or an AI session, can look at it before it ships.
// `pnpm build`, then `node scripts/board-preview.mjs <spotlight id> [--save-sizes] [--wait=<ms>]`.
// `--wait` takes the picture that long after the board is drawn: a board whose picture plays a loop is looked at once near its start and once near its end.
// It lists the texts whose saved size differs from the drawn one; `--save-sizes` writes the drawn sizes into the JSON, which the
// board check (test/unit/whats-new-boards.test.ts) uses to see that nothing overlaps.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { _electron } from '@playwright/test'

const ROOT = join(import.meta.dirname, '..')
const spotlightId = process.argv.slice(2).find((argument) => !argument.startsWith('--'))
if (!spotlightId) throw new Error('usage: node scripts/board-preview.mjs <spotlight id> [--save-sizes]')
const saveSizes = process.argv.includes('--save-sizes')
const wait = Number(process.argv.find((argument) => argument.startsWith('--wait='))?.slice('--wait='.length) ?? 800)
const out = join(tmpdir(), 'yarc-board-preview', `${spotlightId}.png`)
const boardFile = join(ROOT, 'src/main/boards', `${spotlightId}.json`)
const saved = JSON.parse(readFileSync(boardFile, 'utf8'))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const userData = mkdtempSync(join(tmpdir(), 'yarc-board-'))
// Fresh, so the app doesn't download the real filter lists.
mkdirSync(join(userData, 'adblock'))
writeFileSync(join(userData, 'adblock', 'engine.bin'), ElectronBlocker.parse('||doubleclick.net^').serialize())

const app = await _electron.launch({ args: ['out/main/index.js'], cwd: ROOT, env: { ...process.env, YARC_USER_DATA: userData, YARC_TEST: '1' } })
try {
  await app.firstWindow()
  while (!(await app.evaluate(() => !!globalThis.arcBrowser))) await sleep(100)
  await app.evaluate((_electron, id) => {
    const browser = globalThis.arcBrowser
    browser.activate(browser.canvases.createWhatsNew(browser.space, id).id)
  }, spotlightId)
  const inPage = (code) => app.evaluate((_electron, script) => [...globalThis.arcBrowser.canvases.pages.values()][0].wc.executeJavaScript(script), code)
  while (!(await inPage('document.querySelectorAll(".item").length'))) await sleep(100)
  await sleep(wait)

  const drawn = await inPage('[...document.querySelectorAll(".item[data-id]")].map((node) => ({ id: node.dataset.id, width: node.offsetWidth, height: node.offsetHeight }))')
  const drawnById = new Map(drawn.map((item) => [item.id, item]))
  for (const item of saved.items) {
    const onBoard = drawnById.get(item.id)
    if (!onBoard) console.log(`NOT DRAWN: ${item.id} (the board drops an item it can't read)`)
    else if (item.kind === 'text' && (Math.abs(onBoard.width - item.width) > 1 || Math.abs(onBoard.height - item.height) > 1)) {
      console.log(`${item.id}: saved ${item.width}×${item.height}, drawn ${onBoard.width}×${onBoard.height}`)
      if (saveSizes) Object.assign(item, { width: onBoard.width, height: onBoard.height })
    }
  }
  if (saveSizes) writeFileSync(boardFile, `${JSON.stringify(saved, null, 2)}\n`)

  const png = await app.evaluate(async () => (await [...globalThis.arcBrowser.canvases.pages.values()][0].wc.capturePage()).toPNG().toString('base64'))
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(png, 'base64'))
  console.log(out)
} finally {
  await app.close()
  rmSync(userData, { recursive: true, force: true })
}
