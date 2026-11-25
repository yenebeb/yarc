import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { COLORS, TEXT_SIZES, type BoardItem, type Box, type TextItem } from '../../shared/canvas'
import { cx } from './api'
import { hasColor, type Style, type Tool } from './canvas-board'
import { paint, TEXT } from './canvas-item'
import { shortcut } from './canvas-menu'
import { placeBarBy, type Point } from './canvas-view'
import { Icon, type IconName } from './icons'

type ToolButton = { tool: Tool; icon: IconName; label: string; key: string }

const TOOL_GROUPS: ToolButton[][] = [
  [
    { tool: 'select', icon: 'pointer', label: 'Select', key: 'V' },
    { tool: 'hand', icon: 'hand', label: 'Move the board', key: 'H' }
  ],
  [
    { tool: 'text', icon: 'text', label: 'Text', key: 'T' },
    { tool: 'note', icon: 'note', label: 'Note', key: 'N' }
  ],
  [
    { tool: 'rect', icon: 'rectangle', label: 'Rectangle', key: 'R' },
    { tool: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'O' },
    { tool: 'arrow', icon: 'arrow', label: 'Arrow', key: 'A' },
    { tool: 'draw', icon: 'pen', label: 'Draw', key: 'P' }
  ]
]
export const TOOLS = TOOL_GROUPS.flat()
const ROOM_FOR_TOOLBAR = 68
const SMALLEST_SIZE_FIRST = [...TEXT_SIZES].reverse()

const WRITES: Tool[] = ['text', 'note']
const DRAWS_IN_COLOR: Tool[] = [...WRITES, 'rect', 'ellipse', 'arrow', 'draw']
const isShape = (item: BoardItem) => item.kind === 'rect' || item.kind === 'ellipse'

export function Toolbar({ tool, onTool, onPickImage }: { tool: Tool; onTool: (tool: Tool) => void; onPickImage: () => void }) {
  return (
    <div className="toolbar" onPointerDown={(event) => event.stopPropagation()}>
      {TOOL_GROUPS.map((group, groupIndex) => (
        <Fragment key={groupIndex}>
          {group.map((entry) => (
            <button key={entry.tool} className={cx(tool === entry.tool && 'on')} title={`${entry.label} (${entry.key})`} onClick={() => onTool(entry.tool)}>
              <Icon name={entry.icon} size={18} />
            </button>
          ))}
          <span className="toolbar-line" />
        </Fragment>
      ))}
      <button title="Image from a file (I)" onClick={onPickImage}>
        <Icon name="image" size={18} />
      </button>
    </div>
  )
}

/** The selection's color, fill and text size, beside the selection; with nothing selected, what the chosen tool will draw with, above the toolbar. */
export function StyleBar({
  tool,
  chosen,
  selectionOnScreen,
  style,
  dark,
  onRestyle
}: {
  tool: Tool
  chosen: BoardItem[]
  selectionOnScreen: Box | undefined
  style: Style
  dark: boolean
  onRestyle: (next: Partial<Style>) => void
}) {
  const bar = useRef<HTMLDivElement>(null)
  const [besideSelection, setBesideSelection] = useState<Point>()
  useLayoutEffect(() => {
    const page = bar.current?.offsetParent
    if (!bar.current || !page || !selectionOnScreen) return setBesideSelection(undefined)
    const barSize = { width: bar.current.offsetWidth, height: bar.current.offsetHeight }
    const spot = placeBarBy(selectionOnScreen, barSize, { width: page.clientWidth, height: page.clientHeight - ROOM_FOR_TOOLBAR })
    setBesideSelection((current) => (current?.x === spot.x && current.y === spot.y ? current : spot))
  })

  const colored = chosen.filter(hasColor)
  if (!DRAWS_IN_COLOR.includes(tool) && !colored.length) return null
  const showFill = tool === 'rect' || tool === 'ellipse' || chosen.some(isShape)
  const showSizes = WRITES.includes(tool) || chosen.some((item) => item.kind === 'text')
  const currentColor = colored[0]?.color ?? style.color
  const firstShape = chosen.find((item) => item.kind === 'rect' || item.kind === 'ellipse')
  const currentFill = firstShape && (firstShape.kind === 'rect' || firstShape.kind === 'ellipse') ? firstShape.fill : style.fill
  const currentSize = chosen.find((item): item is TextItem => item.kind === 'text')?.size ?? style.textSize
  return (
    <div
      ref={bar}
      className={cx('toolbar', 'stylebar', besideSelection && 'beside-selection')}
      style={besideSelection ? { left: besideSelection.x, top: besideSelection.y } : undefined}
      onPointerDown={(event) => event.stopPropagation()}
    >
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
          {SMALLEST_SIZE_FIRST.map((size) => (
            <button key={size} className={cx('size', currentSize === size && 'on')} onClick={() => onRestyle({ textSize: size })}>
              {TEXT[size].label}
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
