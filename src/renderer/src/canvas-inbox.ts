import { useEffect, useRef } from 'react'
import { boundsOf, placedSize, placeNext, type CardItem, type InboxItem } from '../../shared/canvas'
import { arc } from './api'
import { newId, titleOf, type Board } from './canvas-board'
import { loadImage } from './canvas-png'

/** Places the captures main queued for this canvas: at once while it's open, else when it opens. */
export function useInbox(board: Board): void {
  const { itemsRef, files, change, center, reveal } = board
  const lastPlaced = useRef<string>(undefined)

  const takeInbox = async () => {
    const queued: InboxItem[] = await arc.canvasTakeInbox()
    if (!queued.length) return
    const added: CardItem[] = []
    for (const entry of queued) {
      const natural =
        entry.width > 0 && entry.height > 0
          ? entry
          : await loadImage(entry.dataURL).then(
              (image) => ({ width: image.naturalWidth, height: image.naturalHeight }),
              () => ({ width: 320, height: 240 })
            )
      const size = placedSize(natural.width, natural.height)
      const previous = [...itemsRef.current, ...added].find((item) => item.id === lastPlaced.current)
      const title = titleOf(itemsRef.current)
      const onlyTitle = !previous && title && itemsRef.current.every((item) => item === title)
      const spot = onlyTitle ? { x: Math.round(title.x + (title.width - size.width) / 2), y: Math.round(title.y + title.height + 32) } : placeNext(previous, size, center())
      files.set(entry.fileId, { mimeType: entry.mimeType, dataURL: entry.dataURL })
      const card: CardItem = { id: newId(), kind: 'capture', fileId: entry.fileId, ...spot, ...size, source: entry.data.source, capture: entry.data.capture, imageUrl: entry.data.imageUrl }
      added.push(card)
      lastPlaced.current = card.id
    }
    change([...itemsRef.current, ...added])
    reveal(boundsOf(added), true)
  }
  useEffect(() => {
    void takeInbox()
    return arc.onCanvasInbox(() => void takeInbox())
  }, [])
}

/** The title follows a rename in the sidebar while it still reads the old name. */
export function useSidebarRename(board: Board): void {
  const { itemsRef, setItems } = board
  useEffect(
    () =>
      arc.onCanvasRenamed(({ from, to }) => {
        setItems(itemsRef.current.map((item) => (item.kind === 'text' && item.title && item.text === from ? { ...item, text: to } : item)))
      }),
    []
  )
}
