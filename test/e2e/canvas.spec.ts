import { expect, test, type Page } from '@playwright/test'
import type { BoardItem } from '../../src/shared/canvas'
import { app, base, captureNextMenu, dispatch, overlayKind, pageWithUrl, useApp } from './app'

useApp()

const CLIP_TYPE = 'application/x-yarc-canvas'
const LONGER_THAN_THE_WINDOW = 'a line that runs on well past the right edge of the window '.repeat(6)

interface OpenCanvas {
  id: string
  board: Page
}

/** A new canvas, shown in the window, holding only its title. */
async function openCanvas(name: string): Promise<OpenCanvas> {
  const id: string = await app.evaluate((_electron, name) => {
    const browser = (globalThis as any).arcBrowser
    const canvas = browser.canvases.create(browser.space, name)
    browser.activate(canvas.id)
    return canvas.id
  }, name)
  const board = await pageWithUrl(id)
  await expect(board.locator('.item.text')).toHaveText(name)
  return { id, board }
}

const savedItems = (canvas: OpenCanvas): Promise<BoardItem[]> => app.evaluate((_electron, id) => (globalThis as any).arcBrowser.canvases.files(id).readScene()?.items ?? [], canvas.id)
const savedTexts = async (canvas: OpenCanvas) => (await savedItems(canvas)).flatMap((item) => (item.kind === 'text' ? [item.text] : []))
const savedImageFiles = (canvas: OpenCanvas): Promise<number> =>
  app.evaluate((_electron, id) => Object.keys((globalThis as any).arcBrowser.canvases.files(id).readImages()).length, canvas.id)
const savedAppearance = (canvas: OpenCanvas): Promise<string | undefined> => app.evaluate((_electron, id) => (globalThis as any).arcBrowser.canvases.files(id).readScene()?.appearance, canvas.id)
const reopen = (canvas: OpenCanvas) => app.evaluate((_electron, id) => (globalThis as any).arcBrowser.canvases.page(id).wc.reload(), canvas.id)

const texts = (board: Page) => board.locator('.item.text')
const textBeingTyped = (board: Page) => board.locator('.item.text.editing')
const boxOf = async (part: ReturnType<Page['locator']>) => (await part.boundingBox())!

/** Starts a new text with the text tool, in the empty part of the board left of the title. */
async function startTyping(board: Page, text: string): Promise<void> {
  await board.keyboard.press('t')
  await board.mouse.click(120, 200)
  await expect(textBeingTyped(board)).toBeFocused()
  await board.keyboard.type(text)
}

/** Places a note with the note tool, in the empty part of the board left of the title. */
async function startNote(board: Page, text: string): Promise<void> {
  await board.keyboard.press('n')
  await board.mouse.click(120, 200)
  await expect(textBeingTyped(board)).toBeFocused()
  await board.keyboard.type(text)
}

const savedNote = async (canvas: OpenCanvas) => (await savedItems(canvas)).find((item) => item.kind === 'text' && item.card)

/** What a real paste hands the board, without touching the machine's clipboard. */
const paste = (board: Page, type: string, content: string) =>
  board.evaluate(
    ({ type, content }) => {
      const clipboard = new DataTransfer()
      clipboard.setData(type, content)
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }))
    },
    { type, content }
  )

const pasteAPicture = (board: Page) =>
  board.evaluate(async () => {
    const picture = document.createElement('canvas')
    picture.width = 320
    picture.height = 200
    picture.getContext('2d')!.fillRect(0, 0, 320, 200)
    const png = await new Promise<Blob | null>((resolve) => picture.toBlob(resolve, 'image/png'))
    const clipboard = new DataTransfer()
    clipboard.items.add(new File([png!], 'picture.png', { type: 'image/png' }))
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }))
  })

test.describe('writing on a canvas', () => {
  test('a text is saved while it is still being typed', async () => {
    const canvas = await openCanvas('Shopping')
    await startTyping(canvas.board, 'Buy chairs')
    await expect(textBeingTyped(canvas.board)).toBeFocused()
    await expect.poll(() => savedTexts(canvas)).toEqual(['Shopping', 'Buy chairs'])
  })

  test('a text started and left empty is never saved', async () => {
    const canvas = await openCanvas('Empty text')
    await startTyping(canvas.board, 'x')
    await expect.poll(() => savedTexts(canvas)).toEqual(['Empty text', 'x'])
    await canvas.board.keyboard.press('Backspace')
    await expect.poll(() => savedTexts(canvas)).toEqual(['Empty text'])
  })

  test('the outline around a text grows with it while typing', async () => {
    const canvas = await openCanvas('Outline')
    await startTyping(canvas.board, 'A sentence of some length')
    const text = await boxOf(textBeingTyped(canvas.board))
    await expect.poll(async () => (await boxOf(canvas.board.locator('.selection'))).width).toBeGreaterThanOrEqual(text.width)
  })

  test('typing past the edge of the window moves the view along with the caret, and leaves the board itself where it was', async () => {
    const canvas = await openCanvas('Long line')
    await startTyping(canvas.board, LONGER_THAN_THE_WINDOW)
    const caretRight = () => canvas.board.evaluate(() => getSelection()!.getRangeAt(0).getBoundingClientRect().right)
    const boardEdges = await boxOf(canvas.board.locator('.board'))
    await expect.poll(caretRight).toBeLessThan(boardEdges.x + boardEdges.width)
    expect(await canvas.board.locator('.board').evaluate((board) => board.scrollLeft)).toBe(0)
  })

  test('Tab indents and typing goes on', async () => {
    const canvas = await openCanvas('Indent')
    await startTyping(canvas.board, 'milk')
    await canvas.board.keyboard.press('Tab')
    await canvas.board.keyboard.type('oat')
    await expect(textBeingTyped(canvas.board)).toBeFocused()
    await expect.poll(() => savedTexts(canvas)).toEqual(['Indent', 'milk\toat'])
  })

  test('the text tool on a text that is already there edits it, and adds no second one', async () => {
    const canvas = await openCanvas('Chairs')
    const title = await boxOf(texts(canvas.board))
    await canvas.board.keyboard.press('t')
    await canvas.board.mouse.click(title.x + title.width / 2, title.y + title.height / 2)
    await expect(textBeingTyped(canvas.board)).toBeFocused()
    await canvas.board.keyboard.type(' to buy')
    await expect.poll(() => savedTexts(canvas)).toEqual(['Chairs to buy'])
  })

  test('Enter starts editing the selected text', async () => {
    const canvas = await openCanvas('Tables')
    const title = await boxOf(texts(canvas.board))
    await canvas.board.mouse.click(title.x + title.width / 2, title.y + title.height / 2)
    await canvas.board.keyboard.press('Enter')
    await expect(textBeingTyped(canvas.board)).toBeFocused()
    await canvas.board.keyboard.type(' and lamps')
    await expect.poll(() => savedTexts(canvas)).toEqual(['Tables and lamps'])
  })
})

test.describe('notes on a canvas', () => {
  const NOTE_WIDTH = 280
  const PASTED_WIDTH = 420

  test('the note tool places a card that wraps what is typed in it', async () => {
    const canvas = await openCanvas('Notes')
    await startNote(canvas.board, 'one line')
    const oneLine = await boxOf(textBeingTyped(canvas.board))
    await canvas.board.keyboard.type(' that goes on for long enough to need a second and a third row on a card this narrow')
    await expect.poll(async () => (await boxOf(textBeingTyped(canvas.board))).height).toBeGreaterThan(oneLine.height)
    expect((await boxOf(textBeingTyped(canvas.board))).width).toBe(NOTE_WIDTH)
    await expect.poll(() => savedNote(canvas)).toMatchObject({ card: true, wrapWidth: NOTE_WIDTH })
  })

  test('dragging with the text tool makes a text as wide as the drag', async () => {
    const canvas = await openCanvas('Drag')
    await canvas.board.keyboard.press('t')
    await canvas.board.mouse.move(120, 200)
    await canvas.board.mouse.down()
    await canvas.board.mouse.move(420, 260, { steps: 5 })
    await canvas.board.mouse.up()
    await expect(textBeingTyped(canvas.board)).toBeFocused()
    expect((await boxOf(textBeingTyped(canvas.board))).width).toBe(300)
  })

  test('a pasted paragraph is wrapped, not one line running off the board', async () => {
    const canvas = await openCanvas('Paragraph')
    await paste(canvas.board, 'text/plain', LONGER_THAN_THE_WINDOW)
    await expect.poll(async () => (await boxOf(texts(canvas.board).nth(1))).width).toBe(PASTED_WIDTH)
  })

  test('dragging a text’s left handle makes it narrower and taller, and its right side stays', async () => {
    const canvas = await openCanvas('Handle')
    await paste(canvas.board, 'text/plain', LONGER_THAN_THE_WINDOW)
    const paragraph = texts(canvas.board).nth(1)
    await expect.poll(async () => (await boxOf(paragraph)).width).toBe(PASTED_WIDTH)
    const before = await boxOf(paragraph)
    const handle = await boxOf(canvas.board.locator('.handle-w'))
    const grabbedAt = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
    await canvas.board.mouse.move(grabbedAt.x, grabbedAt.y)
    await canvas.board.mouse.down()
    await canvas.board.mouse.move(grabbedAt.x + 200, grabbedAt.y, { steps: 5 })
    await canvas.board.mouse.up()
    await expect.poll(async () => (await boxOf(paragraph)).width).toBe(PASTED_WIDTH - 200)
    const after = await boxOf(paragraph)
    expect(after.height).toBeGreaterThan(before.height)
    expect(after.x + after.width).toBeCloseTo(before.x + before.width)
  })

  test('a click on a checkbox ticks it without starting to type, and undo unticks it', async () => {
    const canvas = await openCanvas('Checklist')
    await startNote(canvas.board, '[ ] chairs')
    await canvas.board.keyboard.press('Escape')
    await canvas.board.locator('.item.text .box').click()
    await expect.poll(() => savedTexts(canvas)).toEqual(['Checklist', '[x] chairs'])
    await expect(textBeingTyped(canvas.board)).toHaveCount(0)
    await canvas.board.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => savedTexts(canvas)).toEqual(['Checklist', '[ ] chairs'])
  })

  test('Enter goes on with a list, and Enter on an empty list line ends it', async () => {
    const canvas = await openCanvas('List')
    await startNote(canvas.board, '- milk')
    await canvas.board.keyboard.press('Enter')
    await canvas.board.keyboard.type('eggs')
    await canvas.board.keyboard.press('Enter')
    await canvas.board.keyboard.press('Enter')
    await canvas.board.keyboard.type('not on the list')
    await expect.poll(() => savedTexts(canvas)).toEqual(['List', '- milk\n- eggs\nnot on the list'])
  })

  test('Tab puts a list line one level deeper and Shift+Tab takes it back, with the caret where it was', async () => {
    const canvas = await openCanvas('Levels')
    await startNote(canvas.board, '- oat')
    await canvas.board.keyboard.press('Tab')
    await canvas.board.keyboard.type(' milk')
    await expect.poll(() => savedTexts(canvas)).toEqual(['Levels', '\t- oat milk'])
    await canvas.board.keyboard.press('Shift+Tab')
    await canvas.board.keyboard.type('!')
    await expect.poll(() => savedTexts(canvas)).toEqual(['Levels', '- oat milk!'])
  })
})

test.describe('pasting onto a canvas', () => {
  test('a second pasted text lands beside the first, not on top of it', async () => {
    const canvas = await openCanvas('Pastes')
    await paste(canvas.board, 'text/plain', 'first note')
    await paste(canvas.board, 'text/plain', 'second note')
    await expect(texts(canvas.board)).toHaveCount(3)
    const first = await boxOf(texts(canvas.board).nth(1))
    const second = await boxOf(texts(canvas.board).nth(2))
    expect(second.y).toBeGreaterThan(first.y)
    expect(second.x).toBeGreaterThan(first.x)
  })

  test('something copied far outside what the window shows is pasted in view', async () => {
    const canvas = await openCanvas('From elsewhere')
    const farAway = { x: 9000, y: 9000 }
    const copiedNote = { id: 'copied-note', kind: 'text', ...farAway, width: 120, height: 20, text: 'copied on another canvas', size: 'body', color: 'ink' }
    await paste(canvas.board, CLIP_TYPE, JSON.stringify({ items: [copiedNote], files: {} }))
    await expect(texts(canvas.board).nth(1)).toBeInViewport()
  })

  test('a pasted item the board can’t draw is left out, and the board stays', async () => {
    const canvas = await openCanvas('Odd clipboard')
    const drawingWithoutItsPoints = { id: 'scribble', kind: 'draw', x: 0, y: 0, width: 10, height: 10, color: 'ink' }
    await paste(canvas.board, CLIP_TYPE, JSON.stringify({ items: [drawingWithoutItsPoints], files: {} }))
    await paste(canvas.board, 'text/plain', 'still works')
    await expect(texts(canvas.board)).toHaveText(['Odd clipboard', 'still works'])
  })

  test('a pasted card that was showing its page live comes in as its picture, so a paste loads no page', async () => {
    const canvas = await openCanvas('Live clip')
    const onePixel = { mimeType: 'image/png', dataURL: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }
    const liveCard = { id: 'live-card', kind: 'capture', x: 0, y: 0, width: 200, height: 120, fileId: 'one-pixel', live: true, source: { url: 'https://example.com/', title: 'Example' } }
    await paste(canvas.board, CLIP_TYPE, JSON.stringify({ items: [liveCard], files: { 'one-pixel': onePixel } }))
    await expect(canvas.board.locator('.item.capture')).toHaveCount(1)
    await expect(canvas.board.locator('.item.capture.live')).toHaveCount(0)
  })

  test('a picture deleted and brought back with undo is still there when the canvas is opened again', async () => {
    const canvas = await openCanvas('Picture')
    await pasteAPicture(canvas.board)
    await expect.poll(() => savedImageFiles(canvas)).toBe(1)
    await canvas.board.keyboard.press('Backspace')
    await expect.poll(() => savedImageFiles(canvas)).toBe(0)
    await canvas.board.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => savedImageFiles(canvas)).toBe(1)
    await reopen(canvas)
    await expect.poll(() => canvas.board.locator('.item.image img').evaluate((picture: HTMLImageElement) => picture.naturalWidth)).toBeGreaterThan(0)
  })
})

test.describe('the bars around the board', () => {
  test('the tools stay where they are when a selection brings up its colours', async () => {
    const canvas = await openCanvas('Toolbar')
    const selectTool = canvas.board.locator('.toolbar button').first()
    const before = await boxOf(selectTool)
    const title = await boxOf(texts(canvas.board))
    await canvas.board.mouse.click(title.x + title.width / 2, title.y + title.height / 2)
    await expect(canvas.board.locator('.stylebar .swatch').first()).toBeVisible()
    expect(await boxOf(selectTool)).toEqual(before)
  })

  test('a selection’s colors and text sizes sit right above it', async () => {
    const canvas = await openCanvas('Style bar')
    const title = await boxOf(texts(canvas.board))
    await canvas.board.mouse.click(title.x + title.width / 2, title.y + title.height / 2)
    const styleBar = await boxOf(canvas.board.locator('.stylebar'))
    const gapAboveTitle = title.y - (styleBar.y + styleBar.height)
    expect(gapAboveTitle).toBeGreaterThan(0)
    expect(gapAboveTitle).toBeLessThan(40)
    await expect(canvas.board.locator('.stylebar .size')).toHaveText(['Body', 'Heading', 'Title'])
  })

  test('the list and checklist buttons mark every line of the selected note, and one undo takes it back', async () => {
    const canvas = await openCanvas('Marks')
    await startNote(canvas.board, 'milk')
    await canvas.board.keyboard.press('Enter')
    await canvas.board.keyboard.type('eggs')
    await canvas.board.keyboard.press('Escape')
    await texts(canvas.board).nth(1).click()
    await canvas.board.getByTitle('Bulleted list').click()
    await expect.poll(() => savedTexts(canvas)).toEqual(['Marks', '- milk\n- eggs'])
    await canvas.board.getByTitle('Checklist').click()
    await expect.poll(() => savedTexts(canvas)).toEqual(['Marks', '[ ] milk\n[ ] eggs'])
    await canvas.board.getByTitle('Checklist').click()
    await expect.poll(() => savedTexts(canvas)).toEqual(['Marks', 'milk\neggs'])
    await canvas.board.keyboard.press('ControlOrMeta+z')
    await expect.poll(() => savedTexts(canvas)).toEqual(['Marks', '[ ] milk\n[ ] eggs'])
  })

  test('the link button asks for an address in the bar and adds it as a last line, and turns down what is no address', async () => {
    const canvas = await openCanvas('Links')
    await startNote(canvas.board, 'read this')
    await canvas.board.keyboard.press('Escape')
    await texts(canvas.board).nth(1).click()
    await canvas.board.getByTitle('Add a link').click()
    const field = canvas.board.locator('.stylebar .link-field')
    await expect(field).toBeFocused()
    await field.fill('two words')
    await field.press('Enter')
    await expect(field).toHaveClass(/invalid/)
    await field.fill('example.com/docs')
    await field.press('Enter')
    await expect(field).toHaveCount(0)
    await expect.poll(() => savedTexts(canvas)).toEqual(['Links', 'read this\nhttps://example.com/docs'])
    await expect(canvas.board.locator('.item.text .link')).toHaveText('https://example.com/docs')
  })

  test('the light/dark button gives the board the other look, and the canvas keeps it when opened again', async () => {
    const canvas = await openCanvas('Night board')
    const page = canvas.board.locator('.canvas-page')
    const wasDark = await page.evaluate((element) => element.classList.contains('dark'))
    const otherLook = wasDark ? 'light' : 'dark'
    await canvas.board.locator('.appearance-button').click()
    await expect(page).toHaveClass(wasDark ? 'canvas-page' : 'canvas-page dark')
    await expect.poll(() => savedAppearance(canvas)).toBe(otherLook)
    await page.evaluate((element) => element.setAttribute('data-from-before-reopening', ''))
    await reopen(canvas)
    await expect(canvas.board.locator('.canvas-page:not([data-from-before-reopening])')).toHaveClass(wasDark ? 'canvas-page' : 'canvas-page dark')
  })

  test('Find on a canvas searches its texts, pans to each match and closes with Escape, and the page-find bar stays shut', async () => {
    const canvas = await openCanvas('Find me')
    const { board } = canvas
    await startNote(board, 'chairs and tables')
    await board.keyboard.press('Escape')
    await board.keyboard.press('n')
    await board.mouse.click(120, 420)
    await expect(textBeingTyped(board)).toBeFocused()
    await board.keyboard.type('more CHAIRS')
    await board.keyboard.press('Escape')

    await app.evaluate(() => (globalThis as any).arcBrowser.runCommand('find'))
    const field = board.locator('.canvas-find input')
    await expect(field).toBeFocused()
    expect(await overlayKind()).toBe('none')
    await field.fill('chairs')
    await expect(board.locator('.canvas-find .count')).toHaveText('1/2')
    const centered = async (note: string) => {
      await expect(board.locator('.item.found-current')).toContainText(note)
      await expect
        .poll(async () => {
          const page = await boxOf(board.locator('.canvas-page'))
          const shown = await boxOf(board.locator('.item.found-current'))
          return Math.abs(shown.y + shown.height / 2 - (page.y + page.height / 2))
        })
        .toBeLessThan(40)
    }
    await centered('chairs and tables')
    await field.press('Enter')
    await expect(board.locator('.canvas-find .count')).toHaveText('2/2')
    await centered('more CHAIRS')
    await field.press('Enter')
    await expect(board.locator('.canvas-find .count')).toHaveText('1/2')
    await field.press('Shift+Enter')
    await expect(board.locator('.canvas-find .count')).toHaveText('2/2')
    await app.evaluate(() => (globalThis as any).arcBrowser.runCommand('findNext'))
    await expect(board.locator('.canvas-find .count')).toHaveText('1/2')
    await app.evaluate(() => (globalThis as any).arcBrowser.runCommand('findPrev'))
    await expect(board.locator('.canvas-find .count')).toHaveText('2/2')
    await field.press('Escape')
    await expect(board.locator('.canvas-find')).toHaveCount(0)
    await expect(board.locator('.item.found-current')).toHaveCount(0)
  })

  test('Find on a canvas says when nothing matches', async () => {
    const { board } = await openCanvas('Nothing here')
    await app.evaluate(() => (globalThis as any).arcBrowser.runCommand('find'))
    await board.locator('.canvas-find input').fill('zebra')
    await expect(board.locator('.canvas-find .count')).toHaveText('0/0')
    await expect(board.locator('.item.found-current')).toHaveCount(0)
  })
})

test.describe('quotes from a page', () => {
  /** Selects the paragraph of the test page and right-clicks it: the menu a person would see. */
  async function rightClickSelection(pageName: string): Promise<Page> {
    await dispatch({ type: 'open', url: `${base}/${pageName}`, where: 'tab' })
    const page = await pageWithUrl(`/${pageName}`)
    await page.evaluate(() => getSelection()!.selectAllChildren(document.querySelector('p')!))
    await captureNextMenu('selectionMenu')
    await page.locator('p').click({ button: 'right' })
    return page
  }
  const menuItemLabels = (path: string[]) =>
    app.evaluate(({}, path) => {
      let items: Electron.MenuItem[] = (globalThis as any).selectionMenu.items
      for (const label of path) items = items.find((item) => item.label === label)!.submenu!.items
      return items.map((item) => item.label)
    }, path)

  test('Add Selection to Canvas in a page’s menu puts the selected text on a note, with the page as its footer', async () => {
    const canvas = await openCanvas('Quotes')
    await rightClickSelection('quote-first')
    await expect.poll(() => app.evaluate(() => (globalThis as any).selectionMenu.items.map((item: Electron.MenuItem) => item.label))).toContain('Add Selection to Canvas')
    const offered = await menuItemLabels(['Add Selection to Canvas'])
    expect(offered).toContain('Quotes')
    expect(offered.at(-1)).toBe('New Canvas')
    await app.evaluate(() => {
      const add = (globalThis as any).selectionMenu.items.find((item: Electron.MenuItem) => item.label === 'Add Selection to Canvas')
      add.submenu.items.find((item: Electron.MenuItem) => item.label === 'Quotes').click()
    })
    await app.evaluate((_electron, id) => (globalThis as any).arcBrowser.activate(id), canvas.id)
    const board = await pageWithUrl(canvas.id)
    const note = board.locator('.item.text.note')
    await expect(note).toContainText('findme findme findme')
    await expect(note.locator('.footer .title')).toHaveText('Page quote-first')
    expect(await savedNote(canvas)).toMatchObject({ card: true, wrapWidth: 280, text: 'findme findme findme', source: { url: `${base}/quote-first`, title: 'Page quote-first' } })
  })

  test('a quote can be edited like any note, and the footer comes back when it is done', async () => {
    const canvas = await openCanvas('Edited quotes')
    await rightClickSelection('quote-second')
    await app.evaluate(() => {
      const add = (globalThis as any).selectionMenu.items.find((item: Electron.MenuItem) => item.label === 'Add Selection to Canvas')
      add.submenu.items.find((item: Electron.MenuItem) => item.label === 'Edited quotes').click()
    })
    await app.evaluate((_electron, id) => (globalThis as any).arcBrowser.activate(id), canvas.id)
    const board = await pageWithUrl(canvas.id)
    const note = board.locator('.item.text.note')
    await expect(note.locator('.footer')).toBeVisible()
    await note.dblclick()
    await expect(textBeingTyped(board)).toBeFocused()
    await board.keyboard.type('!')
    await board.keyboard.press('Escape')
    await expect(note.locator('.footer')).toBeVisible()
    await expect.poll(() => savedNote(canvas)).toMatchObject({ text: 'findme findme findme!', source: { title: 'Page quote-second' } })
  })
})
