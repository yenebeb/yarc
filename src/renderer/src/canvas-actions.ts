import { useState } from 'react'
import { arrangeInGrid, boundsOf, type BoardItem, type TextItem } from '../../shared/canvas'
import { withLinkLine, withListMark, type ListKind } from '../../shared/canvas-notes'
import { arc } from './api'
import { copyOf, hasColor, type Board, type Style } from './canvas-board'
import { renderPng } from './canvas-png'

/** What the menu, the keyboard and the bars do to the board and its selection. */
export function boardActions(board: Board) {
  const { itemsRef, selectedRef, setItems, change, setSelected, selectedItems, files } = board
  const isSelected = (item: BoardItem) => selectedRef.current.includes(item.id)

  const selectAll = () => setSelected(itemsRef.current.map((item) => item.id))
  const zoomToFit = () => board.reveal(boundsOf(itemsRef.current))
  const duplicate = () => {
    const copies = selectedItems().map((item) => copyOf(item, { x: 16, y: 16 }))
    if (!copies.length) return
    change([...itemsRef.current, ...copies])
    setSelected(copies.map((item) => item.id))
  }
  const remove = () => {
    if (!selectedRef.current.length) return
    change(itemsRef.current.filter((item) => !isSelected(item)))
    setSelected([])
  }
  const reorder = (toFront: boolean) => {
    const chosen = selectedItems()
    if (!chosen.length) return
    const rest = itemsRef.current.filter((item) => !isSelected(item))
    change(toFront ? [...rest, ...chosen] : [...chosen, ...rest])
  }
  const arrange = () => {
    const moves = arrangeInGrid(selectedItems())
    if (moves.size < 2) return
    change(itemsRef.current.map((item) => ({ ...item, ...moves.get(item.id) })))
  }
  const makeTitle = (id: string) =>
    change(itemsRef.current.map((item) => (item.kind !== 'text' ? item : item.id === id ? { ...item, title: true, size: 'title' } : item.title ? { ...item, title: false } : item)))
  const nudge = (dx: number, dy: number) => {
    if (!selectedRef.current.length) return
    change(itemsRef.current.map((item) => (isSelected(item) ? { ...item, x: item.x + dx, y: item.y + dy } : item)))
  }
  const togglePlay = (id: string) => setItems(itemsRef.current.map((item) => (item.id === id && item.kind === 'capture' ? { ...item, live: !item.live || undefined } : item)))
  const selectedTexts = () => selectedItems().filter((item): item is TextItem => item.kind === 'text')
  const rewriteSelectedTexts = (rewrite: (item: TextItem, index: number) => string) => {
    const texts = selectedTexts()
    const rewritten = new Map(texts.map((item, index) => [item.id, rewrite(item, index)]))
    if (texts.every((item) => rewritten.get(item.id) === item.text)) return
    change(itemsRef.current.map((item) => (item.kind === 'text' && rewritten.has(item.id) ? { ...item, text: rewritten.get(item.id)! } : item)))
  }
  const markLines = (kind: ListKind) => {
    const marked = withListMark(selectedTexts().map((item) => item.text), kind)
    rewriteSelectedTexts((_item, index) => marked[index])
  }
  const addLink = (address: string) => rewriteSelectedTexts((item) => withLinkLine(item.text, address))
  const exportPng = async (to: 'file' | 'clipboard') => {
    const png = await renderPng(itemsRef.current, files)
    if (png) await arc.canvasExport(png, to)
  }

  return { selectAll, zoomToFit, duplicate, remove, reorder, arrange, makeTitle, nudge, togglePlay, markLines, addLink, exportPng }
}

export type BoardActions = ReturnType<typeof boardActions>

/** The color, fill and text size new items get; changing one also restyles the selection. */
export function useStyle(board: Board) {
  const [style, setStyle] = useState<Style>({ color: 'ink', fill: false, textSize: 'body' })
  const restyle = (next: Partial<Style>) => {
    setStyle({ ...style, ...next })
    const ids = new Set(board.selectedRef.current)
    if (!ids.size) return
    let changed = false
    const updated = board.itemsRef.current.map((item): BoardItem => {
      if (!ids.has(item.id)) return item
      let restyled = item
      if (next.color && hasColor(restyled) && restyled.color !== next.color) restyled = { ...restyled, color: next.color }
      if (next.fill !== undefined && (restyled.kind === 'rect' || restyled.kind === 'ellipse') && restyled.fill !== next.fill) restyled = { ...restyled, fill: next.fill }
      if (next.textSize && restyled.kind === 'text' && restyled.size !== next.textSize) restyled = { ...restyled, size: next.textSize }
      if (restyled !== item) changed = true
      return restyled
    })
    if (changed) board.change(updated)
  }
  return { style, restyle }
}
