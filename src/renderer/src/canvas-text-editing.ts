import { useEffect, useRef, useState } from 'react'
import type { BoardItem, TextItem } from '../../shared/canvas'
import { newId, type Board, type Style } from './canvas-board'
import { LINE_HEIGHT, TEXT } from './canvas-item'
import { reachesOutBy, type Point } from './canvas-view'

const CARET_ROOM = { beside: 48, aboveToolbars: 130 }

/** Typing a text on the board: one text at a time, kept in the board's items as it's typed and one undo step once it's finished. */
export function useTextEditing(board: Board, style: Style) {
  const { boardRef, itemsRef, setItems, record, setSelected, viewRef, setView, textNodes } = board
  const [editing, setEditing] = useState<string>()
  const editingRef = useRef(editing)
  editingRef.current = editing
  const itemsBeforeEdit = useRef<BoardItem[]>(undefined)

  const startText = (at: Point) => {
    const item: TextItem = { id: newId(), kind: 'text', x: at.x, y: at.y - (TEXT[style.textSize].size * LINE_HEIGHT) / 2, width: 0, height: 0, text: '', size: style.textSize, color: style.color }
    itemsBeforeEdit.current = itemsRef.current
    setItems([...itemsRef.current, item])
    setSelected([item.id])
    setEditing(item.id)
  }
  const editText = (id: string) => {
    itemsBeforeEdit.current = itemsRef.current
    setSelected([id])
    setEditing(id)
  }
  const keepCaretInView = () => {
    const selection = getSelection()
    const edges = boardRef.current?.getBoundingClientRect()
    const [caret] = selection?.rangeCount ? selection.getRangeAt(0).getClientRects() : []
    if (!edges || !caret) return
    const sideways = reachesOutBy(caret.left, caret.right, edges.left + CARET_ROOM.beside, edges.right - CARET_ROOM.beside)
    const upOrDown = reachesOutBy(caret.top, caret.bottom, edges.top + CARET_ROOM.beside, edges.bottom - CARET_ROOM.aboveToolbars)
    if (sideways || upOrDown) setView({ ...viewRef.current, x: viewRef.current.x - sideways, y: viewRef.current.y - upOrDown })
  }
  const typeText = (id: string, text: string) => {
    setItems(itemsRef.current.map((item) => (item.id === id && item.kind === 'text' ? { ...item, text } : item)))
    keepCaretInView()
  }
  const finishEdit = (id: string) => {
    const before = itemsBeforeEdit.current ?? itemsRef.current
    itemsBeforeEdit.current = undefined
    setEditing(undefined)
    const textIn = (list: BoardItem[]) => list.find((item): item is TextItem => item.id === id && item.kind === 'text')?.text
    const original = textIn(before)
    const edited = textIn(itemsRef.current) ?? ''
    if (!edited.trim()) {
      setItems(itemsRef.current.filter((item) => item.id !== id))
      setSelected([])
      if (original !== undefined) record(before)
      return
    }
    if (edited !== original) record(before)
  }

  useEffect(() => {
    if (!editing) return
    const node = textNodes.get(editing)
    if (!node) return
    node.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(node)
    range.collapse(false)
    const selection = getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    keepCaretInView()
  }, [editing])

  return { editing, editingRef, startText, editText, typeText, finishEdit }
}

export type TextEditing = ReturnType<typeof useTextEditing>
