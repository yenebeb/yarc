import { COLORS, TEXT_SIZES, type BoardItem, type TextItem } from '../../shared/canvas'
import { cx } from './api'
import { hasColor, type Style, type Tool } from './canvas-board'
import { paint, TEXT } from './canvas-item'
import { shortcut } from './canvas-menu'
import { Icon, type IconName } from './icons'

export const TOOLS: { tool: Tool; icon: IconName; label: string; key: string }[] = [
  { tool: 'select', icon: 'pointer', label: 'Select', key: 'V' },
  { tool: 'hand', icon: 'hand', label: 'Move the board', key: 'H' },
  { tool: 'text', icon: 'text', label: 'Text', key: 'T' },
  { tool: 'rect', icon: 'rectangle', label: 'Rectangle', key: 'R' },
  { tool: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'O' },
  { tool: 'arrow', icon: 'arrow', label: 'Arrow', key: 'A' },
  { tool: 'draw', icon: 'pen', label: 'Draw', key: 'P' }
]

const DRAWS_IN_COLOR: Tool[] = ['text', 'rect', 'ellipse', 'arrow', 'draw']
const isShape = (item: BoardItem) => item.kind === 'rect' || item.kind === 'ellipse'

export function Toolbar({ tool, onTool, onPickImage }: { tool: Tool; onTool: (tool: Tool) => void; onPickImage: () => void }) {
  return (
    <div className="toolbar" onPointerDown={(event) => event.stopPropagation()}>
      {TOOLS.map((entry) => (
        <button key={entry.tool} className={cx(tool === entry.tool && 'on')} title={`${entry.label} (${entry.key})`} onClick={() => onTool(entry.tool)}>
          <Icon name={entry.icon} size={18} />
        </button>
      ))}
      <button title="Image from a file (I)" onClick={onPickImage}>
        <Icon name="image" size={18} />
      </button>
    </div>
  )
}

/** Shows the selection's color, fill and text size, or the ones the chosen tool will draw with. */
export function StyleBar({ tool, chosen, style, dark, onRestyle }: { tool: Tool; chosen: BoardItem[]; style: Style; dark: boolean; onRestyle: (next: Partial<Style>) => void }) {
  const colored = chosen.filter(hasColor)
  if (!DRAWS_IN_COLOR.includes(tool) && !colored.length) return null
  const showFill = tool === 'rect' || tool === 'ellipse' || chosen.some(isShape)
  const showSizes = tool === 'text' || chosen.some((item) => item.kind === 'text')
  const currentColor = colored[0]?.color ?? style.color
  const firstShape = chosen.find((item) => item.kind === 'rect' || item.kind === 'ellipse')
  const currentFill = firstShape && (firstShape.kind === 'rect' || firstShape.kind === 'ellipse') ? firstShape.fill : style.fill
  const currentSize = chosen.find((item): item is TextItem => item.kind === 'text')?.size ?? style.textSize
  return (
    <div className="toolbar stylebar" onPointerDown={(event) => event.stopPropagation()}>
      {COLORS.map((color) => (
        <button key={color} className={cx('swatch', currentColor === color && 'on')} title={color} onClick={() => onRestyle({ color })}>
          <span style={{ background: paint(color, dark) }} />
        </button>
      ))}
      {showFill ? (
        <>
          <span className="toolbar-line" />
          <button className={cx('fill', currentFill && 'on')} title="Fill" onClick={() => onRestyle({ fill: !currentFill })}>
            <span style={{ borderColor: paint(currentColor, dark), background: currentFill ? `${paint(currentColor, dark)}55` : 'transparent' }} />
          </button>
        </>
      ) : null}
      {showSizes ? (
        <>
          <span className="toolbar-line" />
          {TEXT_SIZES.map((size) => (
            <button key={size} className={cx('size', currentSize === size && 'on')} title={TEXT[size].label} onClick={() => onRestyle({ textSize: size })}>
              {size === 'title' ? 'L' : size === 'heading' ? 'M' : 'S'}
            </button>
          ))}
        </>
      ) : null}
    </div>
  )
}

export function ZoomBar({ zoom, onZoomBy, onActualSize }: { zoom: number; onZoomBy: (factor: number) => void; onActualSize: () => void }) {
  return (
    <div className="zoombar" onPointerDown={(event) => event.stopPropagation()}>
      <button title={`Zoom out (${shortcut('-')})`} onClick={() => onZoomBy(0.8)}>
        <Icon name="minus" size={16} />
      </button>
      <button className="zoom" title={`Actual size (${shortcut('0')})`} onClick={onActualSize}>
        {Math.round(zoom * 100)}%
      </button>
      <button title={`Zoom in (${shortcut('+')})`} onClick={() => onZoomBy(1.25)}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  )
}
