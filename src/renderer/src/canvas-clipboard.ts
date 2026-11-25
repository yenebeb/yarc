import { useEffect, useRef, type RefObject } from 'react'
import { boundsOf, freeSpot, IMAGE_TYPES, intersects, isBoardItem, placedSize, placeNext, type BoardItem, type CanvasImage, type Color, type ImageItem, type TextItem } from '../../shared/canvas'
import { copyOf, isTyping, newId, type Board } from './canvas-board'
import { hasImageFile } from './canvas-item'
import { loadImage } from './canvas-png'
import type { Point } from './canvas-view'

const CLIP_TYPE = 'application/x-yarc-canvas'
const PASTE_STEP = 24

function readDataURL(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function hashOf(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A one-off copy event: needs no clipboard permission. */
export function copyText(text: string): void {
  const onCopy = (event: ClipboardEvent) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    event.clipboardData?.setData('text/plain', text)
  }
  document.addEventListener('copy', onCopy, { capture: true, once: true })
  document.execCommand('copy')
}

/** Copy, cut and paste on the board while no text is being typed; returns how image files are added, for a drop or the file picker too. */
export function useClipboard(board: Board, textColor: Color, editingRef: RefObject<string | undefined>) {
  const { itemsRef, selectedRef, files, change, setSelected, selectedItems, center } = board
  const pasteCount = useRef(0)

  const addImageFiles = async (list: File[], at: Point) => {
    const added: ImageItem[] = []
    for (const file of list) {
      if (!IMAGE_TYPES[file.type]) continue
      const dataURL = await readDataURL(file)
      const fileId = await hashOf(file)
      const decoded = await loadImage(dataURL).catch(() => undefined)
      const size = placedSize(decoded?.naturalWidth ?? 320, decoded?.naturalHeight ?? 240)
      const spot = placeNext(added[added.length - 1], size, at)
      files.set(fileId, { mimeType: file.type, dataURL })
      added.push({ id: newId(), kind: 'image', fileId, ...spot, ...size })
    }
    const bounds = boundsOf(added)
    if (!bounds) return
    const shift = at.x - (bounds.x + bounds.width / 2)
    const placed = added.map((item) => ({ ...item, x: item.x + shift }))
    change([...itemsRef.current, ...placed])
    setSelected(placed.map((item) => item.id))
  }

  const copySelection = (event: ClipboardEvent, cut: boolean) => {
    const chosen = selectedItems()
    if (!chosen.length || !event.clipboardData) return
    event.preventDefault()
    const used: Record<string, CanvasImage> = {}
    for (const item of chosen.filter(hasImageFile)) {
      const file = files.get(item.fileId)
      if (file) used[item.fileId] = file
    }
    event.clipboardData.setData(CLIP_TYPE, JSON.stringify({ items: chosen, files: used }))
    const text = chosen
      .map((item) => (item.kind === 'text' ? item.text : item.kind === 'capture' ? (item.source?.url ?? '') : ''))
      .filter(Boolean)
      .join('\n\n')
    if (text) event.clipboardData.setData('text/plain', text)
    pasteCount.current = 0
    if (cut) {
      change(itemsRef.current.filter((item) => !selectedRef.current.includes(item.id)))
      setSelected([])
    }
  }

  const pasteClip = (json: string) => {
    let clip
    try {
      clip = JSON.parse(json)
    } catch {
      return
    }
    const pasted: BoardItem[] = Array.isArray(clip?.items) ? clip.items.filter(isBoardItem) : []
    const bounds = boundsOf(pasted)
    if (!bounds) return
    for (const [id, file] of Object.entries<CanvasImage>(clip.files ?? {})) if (!files.has(id)) files.set(id, file)
    pasteCount.current += 1
    const step = PASTE_STEP * pasteCount.current
    const middleOfBoard = center()
    const copiedOutOfSight = !intersects(bounds, board.shownPartOfBoard())
    const shift = copiedOutOfSight
      ? { x: middleOfBoard.x - (bounds.x + bounds.width / 2) + step, y: middleOfBoard.y - (bounds.y + bounds.height / 2) + step }
      : { x: step, y: step }
    const copies = pasted.map((item) => copyOf(item, shift))
    change([...itemsRef.current, ...copies])
    setSelected(copies.map((item) => item.id))
  }

  const paste = (event: ClipboardEvent) => {
    const data = event.clipboardData
    if (!data) return
    event.preventDefault()
    const ours = data.getData(CLIP_TYPE)
    if (ours) return pasteClip(ours)
    const images = [...data.files].filter((file) => IMAGE_TYPES[file.type])
    if (images.length) return void addImageFiles(images, center())
    const text = data.getData('text/plain').trim()
    if (!text) return
    const textItem: TextItem = { id: newId(), kind: 'text', ...freeSpot(itemsRef.current, center(), PASTE_STEP), width: 0, height: 0, text, size: 'body', color: textColor }
    change([...itemsRef.current, textItem])
    setSelected([textItem.id])
  }

  const latest = useRef({ copySelection, paste })
  latest.current = { copySelection, paste }
  useEffect(() => {
    const meantForBoard = (event: Event) => !editingRef.current && !isTyping(event.target)
    const onCopy = (event: ClipboardEvent) => meantForBoard(event) && latest.current.copySelection(event, false)
    const onCut = (event: ClipboardEvent) => meantForBoard(event) && latest.current.copySelection(event, true)
    const onPaste = (event: ClipboardEvent) => meantForBoard(event) && latest.current.paste(event)
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  }, [])

  return addImageFiles
}
