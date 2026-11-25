import type { KeyboardEvent } from 'react'
import { enterInList, listLineStart } from '../../shared/canvas-notes'

const insertText = (text: string) => document.execCommand('insertText', false, text)

function caretIn(node: HTMLElement): number | undefined {
  const selection = getSelection()
  if (!selection?.isCollapsed || !selection.focusNode || !node.contains(selection.focusNode)) return undefined
  const upToCaret = document.createRange()
  upToCaret.selectNodeContents(node)
  upToCaret.setEnd(selection.focusNode, selection.focusOffset)
  return upToCaret.toString().length
}

function moveCaret(node: HTMLElement, offset: number): void {
  const textNodes = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  let stillToGo = offset
  while (textNodes.nextNode()) {
    const length = textNodes.currentNode.textContent?.length ?? 0
    if (stillToGo <= length) return getSelection()?.setPosition(textNodes.currentNode, stillToGo)
    stillToGo -= length
  }
}

function continueOrEndList(event: KeyboardEvent<HTMLDivElement>, text: string, caret: number | undefined): void {
  const inList = caret === undefined || event.shiftKey ? undefined : enterInList(text, caret)
  if (!inList) return
  event.preventDefault()
  if ('continueWith' in inList) {
    document.execCommand('insertLineBreak')
    insertText(inList.continueWith)
    return
  }
  for (let removed = 0; removed < inList.endByRemoving; removed += 1) document.execCommand('delete')
}

function indent(event: KeyboardEvent<HTMLDivElement>, text: string, caret: number | undefined): void {
  // Tab would otherwise move focus to the toolbar, which ends the edit.
  event.preventDefault()
  const lineStart = caret === undefined ? undefined : listLineStart(text, caret)
  if (caret === undefined || lineStart === undefined) return void insertText('\t')
  if (!event.shiftKey) {
    moveCaret(event.currentTarget, lineStart)
    insertText('\t')
    return moveCaret(event.currentTarget, caret + 1)
  }
  if (text[lineStart] !== '\t') return
  moveCaret(event.currentTarget, lineStart + 1)
  document.execCommand('delete')
  moveCaret(event.currentTarget, Math.max(lineStart, caret - 1))
}

/** Keys in a text being typed: Escape or ⌘Enter finishes it, Enter and Tab know about lists. The edits go through `execCommand`, so the browser's own undo takes them back. */
export function keepTypingOrFinish(event: KeyboardEvent<HTMLDivElement>): void {
  // An Enter that picks a word in an input method isn't a new line.
  if (event.nativeEvent.isComposing) return
  const node = event.currentTarget
  const finishes = event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))
  if (finishes) {
    event.preventDefault()
    return node.blur()
  }
  if (event.key === 'Enter') return continueOrEndList(event, node.textContent ?? '', caretIn(node))
  if (event.key === 'Tab') indent(event, node.textContent ?? '', caretIn(node))
}
