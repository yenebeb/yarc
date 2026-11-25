import { useEffect, useRef } from 'react'
import { boundsOf, placedSize, placeNext, type BoardItem, type InboxItem, type InboxPicture } from '../../shared/canvas'
import { NOTE_WIDTH } from '../../shared/canvas-notes'
import { arc } from './api'
import { newId, titleOf, type Board } from './canvas-board'
import { loadImage } from './canvas-png'

const QUOTE_HEIGHT_BEFORE_MEASURED = 120

async function pictureSize(picture: InboxPicture) {
  const natural =
    picture.width > 0 && picture.height > 0
      ? picture
      : await loadImage(picture.dataURL).then(
          (image) => ({ width: image.naturalWidth, height: image.naturalHeight }),
          () => ({ width: 320, height: 240 })
        )
  return placedSize(natural.width, natural.height)
}

/** Places the captures main queued for this canvas: at once while it's open, else when it opens. */
export function useInbox(board: Board): void {
  const { itemsRef, files, change, center, reveal } = board
  const lastPlaced = useRef<string>(undefined)

  const takeInbox = async () => {
    const queued: InboxItem[] = await arc.canvasTakeInbox()
    if (!queued.length) return
    const added: BoardItem[] = []
    for (const entry of queued) {
      const size = 'quote' in entry ? { width: NOTE_WIDTH, height: QUOTE_HEIGHT_BEFORE_MEASURED } : await pictureSize(entry)
      const previous = [...itemsRef.current, ...added].find((item) => item.id === lastPlaced.current)
      const title = titleOf(itemsRef.current)
      const onlyTitle = !previous && title && itemsRef.current.every((item) => item === title)
      const spot = onlyTitle ? { x: Math.round(title.x + (title.width - size.width) / 2), y: Math.round(title.y + title.height + 32) } : placeNext(previous, size, center())
      const placed = { id: newId(), ...spot, ...size }
      if ('quote' in entry) {
        added.push({ ...placed, kind: 'text', text: entry.quote, size: 'body', color: 'ink', wrapWidth: NOTE_WIDTH, card: true, source: entry.source })
      } else {
        files.set(entry.fileId, { mimeType: entry.mimeType, dataURL: entry.dataURL })
        added.push({ ...placed, kind: 'capture', fileId: entry.fileId, source: entry.data.source, capture: entry.data.capture, imageUrl: entry.data.imageUrl })
      }
      lastPlaced.current = placed.id
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
