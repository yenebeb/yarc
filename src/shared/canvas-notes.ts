import type { Handle, TextItem } from './canvas'

export const NOTE_WIDTH = 280
export const PASTED_WRAP_WIDTH = 420
export const MIN_WRAP_WIDTH = 80
const LONG_LINE = 60

export type LineMark = 'bullet' | 'unchecked' | 'checked' | 'heading'

/** A line of a text as the board draws it: `prefix` is the indent and mark as typed, `level` how deep a list line is indented. */
export interface NoteLine {
  mark: LineMark | undefined
  level: number
  prefix: string
  text: string
}

const MARKED_LINE = /^([\t ]*)(- |\* |\[ \] |\[[xX]\] |# )(.*)$/
const MARK_TYPED_AS: Record<string, LineMark> = { '- ': 'bullet', '* ': 'bullet', '[ ] ': 'unchecked', '[x] ': 'checked', '[X] ': 'checked', '# ': 'heading' }
const SPACES_PER_LEVEL = 2

export function noteLine(typed: string): NoteLine {
  const [, indent, typedMark, text] = MARKED_LINE.exec(typed) ?? []
  if (typedMark === undefined) return { mark: undefined, level: 0, prefix: '', text: typed }
  const level = Math.floor(indent.replaceAll('\t', ' '.repeat(SPACES_PER_LEVEL)).length / SPACES_PER_LEVEL)
  return { mark: MARK_TYPED_AS[typedMark], level, prefix: indent + typedMark, text }
}

export const isListed = (line: NoteLine) => line.mark === 'bullet' || line.mark === 'unchecked' || line.mark === 'checked'

function lineAround(text: string, caret: number) {
  const start = text.slice(0, caret).lastIndexOf('\n') + 1
  const nextBreak = text.indexOf('\n', caret)
  const end = nextBreak < 0 ? text.length : nextBreak
  return { start, end, line: noteLine(text.slice(start, end)) }
}

export type EnterInList = { continueWith: string } | { endByRemoving: number }

/** Enter in a list line starts the next one with the same mark; at the end of a list line with nothing in it, the mark goes instead. */
export function enterInList(text: string, caret: number): EnterInList | undefined {
  const { start, end, line } = lineAround(text, caret)
  if (!isListed(line) || caret - start < line.prefix.length) return undefined
  if (line.text) return { continueWith: line.prefix.replace(/\[[xX]\]/, '[ ]') }
  return caret === end ? { endByRemoving: end - start } : undefined
}

/** Where the list line around the caret starts: Tab puts a tab there, Shift+Tab takes one away. */
export function listLineStart(text: string, caret: number): number | undefined {
  const { start, line } = lineAround(text, caret)
  return isListed(line) ? start : undefined
}

export function toggledCheckbox(text: string, lineIndex: number): string {
  const toggled = (typed: string) => typed.replace(/^([\t ]*\[)([ xX])(\] )/, (_whole, open: string, state: string, close: string) => open + (state === ' ' ? 'x' : ' ') + close)
  return text
    .split('\n')
    .map((typed, index) => (index === lineIndex ? toggled(typed) : typed))
    .join('\n')
}

export const hasLongLine = (text: string) => text.split('\n').some((typed) => typed.length > LONG_LINE)

export interface TextPart {
  text: string
  url?: string
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/g
const PUNCTUATION_AFTER_A_URL = /[.,;:!?)\]]+$/

export function linkParts(text: string): TextPart[] {
  const parts: TextPart[] = []
  let shownUpTo = 0
  for (const found of text.matchAll(URL_IN_TEXT)) {
    const url = found[0].replace(PUNCTUATION_AFTER_A_URL, '')
    if (found.index > shownUpTo) parts.push({ text: text.slice(shownUpTo, found.index) })
    parts.push({ text: url, url })
    shownUpTo = found.index + url.length
  }
  if (shownUpTo < text.length || !parts.length) parts.push({ text: text.slice(shownUpTo) })
  return parts
}

/** The rows a line takes when it may be `maxWidth` wide: broken between words, and inside a word only when the word alone is too long. */
export function wrappedRows(text: string, maxWidth: number, widthOf: (text: string) => number): string[] {
  const fits = (row: string) => widthOf(row.trimEnd()) <= maxWidth
  const rows: string[] = []
  let row = ''
  for (const word of text.split(/(?<=\s)(?=\S)/)) {
    if (row && !fits(row + word)) {
      rows.push(row.trimEnd())
      row = ''
    }
    row += word
    while (row.length > 1 && !fits(row)) {
      let kept = 1
      while (kept < row.length - 1 && fits(row.slice(0, kept + 1))) kept += 1
      rows.push(row.slice(0, kept))
      row = row.slice(kept)
    }
  }
  return [...rows, row.trimEnd()]
}

/** A text's side handle sets where its lines wrap; its other side stays where it is. */
export function rewrapped(item: TextItem, handle: Handle, dx: number): TextItem {
  const fromLeft = handle.includes('w')
  const wrapWidth = Math.max(MIN_WRAP_WIDTH, item.width + (fromLeft ? -dx : dx))
  return { ...item, wrapWidth, x: fromLeft ? item.x + item.width - wrapWidth : item.x }
}
