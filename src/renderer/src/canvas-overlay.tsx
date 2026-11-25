import type { BoardItem, Box, Guide, Handle } from '../../shared/canvas'
import { keepsShape } from './canvas-board'
import { toScreen, type View } from './canvas-view'

const CORNERS: Handle[] = ['nw', 'ne', 'sw', 'se']
const CORNERS_AND_SIDES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const LEFT_AND_RIGHT: Handle[] = ['w', 'e']

/** A text is as tall as what it says, so only its sides move; an item being typed in isn't resized. */
function handlesOf(chosen: BoardItem[], editing: boolean): { item: BoardItem; handles: Handle[] } | undefined {
  const [item, ...others] = chosen
  if (!item || others.length || editing) return undefined
  if (item.kind === 'text') return { item, handles: LEFT_AND_RIGHT }
  return { item, handles: keepsShape(item) ? CORNERS : CORNERS_AND_SIDES }
}

/** Drawn over the board in the window's pixels, so outlines and handles keep their size at any zoom. */
export function SelectionOverlay({ chosen, view, guides, marquee, editing }: { chosen: BoardItem[]; view: View; guides: Guide[]; marquee: Box | undefined; editing: boolean }) {
  const resizable = handlesOf(chosen, editing)
  return (
    <div className="overlay">
      {chosen.map((item) => {
        const box = toScreen(item, view)
        return <div key={item.id} className="selection" style={{ left: box.x - 3, top: box.y - 3, width: box.width + 6, height: box.height + 6 }} />
      })}
      {resizable?.handles.map((handle) => {
        const box = toScreen(resizable.item, view)
        const left = handle.includes('w') ? box.x - 3 : handle.includes('e') ? box.x + box.width + 3 : box.x + box.width / 2
        const top = handle.includes('n') ? box.y - 3 : handle.includes('s') ? box.y + box.height + 3 : box.y + box.height / 2
        return <div key={handle} className={`handle handle-${handle}`} data-handle={handle} style={{ left, top }} />
      })}
      {guides.map((guide, index) => {
        const at = guide.axis === 'x' ? guide.at * view.zoom + view.x : guide.at * view.zoom + view.y
        const from = guide.axis === 'x' ? guide.from * view.zoom + view.y : guide.from * view.zoom + view.x
        const to = guide.axis === 'x' ? guide.to * view.zoom + view.y : guide.to * view.zoom + view.x
        return <div key={index} className="guide" style={guide.axis === 'x' ? { left: at, top: from, height: to - from } : { top: at, left: from, width: to - from }} />
      })}
      {marquee ? <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.width, height: marquee.height }} /> : null}
    </div>
  )
}
