import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { arrowEnds, arrowHead, smoothPath, type ArrowItem, type BoardItem, type CanvasImage, type CardItem, type Color, type DrawItem, type ImageItem, type TextItem, type TextSize } from '../../shared/canvas'
import { isListed, linkParts, noteLine, type NoteLine } from '../../shared/canvas-notes'
import { arc, cx } from './api'
import { keepTypingOrFinish } from './canvas-text-keys'
import { Icon } from './icons'

export const STROKE = 2.5
export const DRAW_STROKE = 3
export const LINE_HEIGHT = 1.25
export const NOTE_PADDING = { x: 14, y: 12 }
export const LIST_INDENT_EM = 1.4
const ONE_SIZE_UP: Record<TextSize, TextSize> = { body: 'heading', heading: 'title', title: 'title' }
export const TEXT: Record<TextSize, { size: number; weight: number; label: string }> = {
  title: { size: 36, weight: 700, label: 'Title' },
  heading: { size: 24, weight: 600, label: 'Heading' },
  body: { size: 16, weight: 400, label: 'Body' }
}
const PALETTE: Record<Color, { light: string; dark: string }> = {
  ink: { light: '#1d1b22', dark: '#ecebf0' },
  grey: { light: '#8a8794', dark: '#9e9ba8' },
  red: { light: '#e5484d', dark: '#ff6369' },
  orange: { light: '#f76b15', dark: '#ff8b3e' },
  yellow: { light: '#e2a336', dark: '#ffca16' },
  green: { light: '#30a46c', dark: '#3dd68c' },
  blue: { light: '#0090ff', dark: '#70b8ff' },
  purple: { light: '#8e4ec6', dark: '#bf7af0' }
}

export const paint = (color: Color, dark: boolean) => PALETTE[color][dark ? 'dark' : 'light']
export const textFont = (size: TextSize, family: string) => `${TEXT[size].weight} ${TEXT[size].size}px ${family}`
export const lineTextSize = (item: TextItem, line: NoteLine): TextSize => (line.mark === 'heading' ? ONE_SIZE_UP[item.size] : item.size)
export const hasImageFile = (item: BoardItem): item is CardItem | ImageItem => item.kind === 'capture' || item.kind === 'image'
export const drawScale = (item: DrawItem) => ({ scaleX: item.width / item.drawnWidth || 1, scaleY: item.height / item.drawnHeight || 1 })

export function arrowPath(item: ArrowItem): string {
  const { x1, y1, x2, y2 } = arrowEnds(item)
  return `M ${x1} ${y1} L ${x2} ${y2} ${arrowHead(x1, y1, x2, y2)}`
}

function lineStyle(item: TextItem, line: NoteLine): CSSProperties | undefined {
  if (isListed(line)) return { paddingLeft: `${(line.level + 1) * LIST_INDENT_EM}em` }
  if (line.mark !== 'heading') return undefined
  const heading = TEXT[lineTextSize(item, line)]
  return { fontSize: heading.size, fontWeight: heading.weight }
}

/** A text that isn't being typed in: its lines with their bullets, checkboxes, headings and links drawn. */
function Lines({ item }: { item: TextItem }) {
  return item.text.split('\n').map((typed, lineIndex) => {
    const line = noteLine(typed)
    const markerLeft = `${line.level * LIST_INDENT_EM}em`
    return (
      <div key={lineIndex} className={cx('line', line.mark)} style={lineStyle(item, line)}>
        {line.mark === 'bullet' ? (
          <span className="marker" style={{ left: markerLeft }}>
            •
          </span>
        ) : null}
        {line.mark === 'unchecked' || line.mark === 'checked' ? <span className="marker box" data-check={lineIndex} style={{ left: markerLeft }} /> : null}
        {linkParts(line.text).map((part, partIndex) =>
          part.url ? (
            <span key={partIndex} className="link" data-url={part.url}>
              {part.text}
            </span>
          ) : (
            part.text
          )
        )}
      </div>
    )
  })
}

function TextView({
  item,
  classes,
  editing,
  dark,
  nodeRef,
  onTyped,
  onEdited
}: {
  item: TextItem
  classes: string
  editing: boolean
  dark: boolean
  nodeRef: (node: HTMLElement | null) => void
  onTyped: (text: string) => void
  onEdited: () => void
}) {
  const textStyle = TEXT[item.size]
  const node = useRef<HTMLDivElement>(null)
  // While it's being edited the browser owns the text: React writing each keystroke back would move the caret to the start.
  useLayoutEffect(() => {
    if (editing && node.current) node.current.textContent = item.text
  }, [editing])
  return (
    <div
      // A new element for each: what the browser left in the one that was typed in isn't React's to replace with lines.
      key={editing ? 'typed' : 'drawn'}
      ref={(element) => {
        node.current = element
        nodeRef(element)
      }}
      className={cx(classes, item.card && 'note', item.wrapWidth !== undefined && 'wrapped', editing && 'editing')}
      data-id={item.id}
      style={{ left: item.x, top: item.y, width: item.wrapWidth, color: paint(item.color, dark), fontSize: textStyle.size, fontWeight: textStyle.weight, lineHeight: LINE_HEIGHT }}
      contentEditable={editing ? 'plaintext-only' : undefined}
      suppressContentEditableWarning
      spellCheck={editing}
      onInput={editing ? (event) => onTyped(event.currentTarget.innerText.replace(/\n$/, '')) : undefined}
      onBlur={editing ? onEdited : undefined}
      onKeyDown={editing ? keepTypingOrFinish : undefined}
    >
      {editing ? null : <Lines item={item} />}
    </div>
  )
}

export function ItemView({
  item,
  selected,
  editing,
  dark,
  files,
  nodeRef,
  onTyped,
  onEdited,
  onPlay
}: {
  item: BoardItem
  selected: boolean
  editing: boolean
  dark: boolean
  files: Map<string, CanvasImage>
  nodeRef: (node: HTMLElement | null) => void
  onTyped: (text: string) => void
  onEdited: () => void
  onPlay: () => void
}) {
  const place: CSSProperties = { left: item.x, top: item.y, width: item.width, height: item.height }
  const classes = cx('item', item.kind, selected && 'selected')
  if (item.kind === 'capture') {
    const source = item.source
    return (
      <div className={cx(classes, 'card', item.live && 'live')} data-id={item.id} style={place}>
        <div className="frame" />
        <img src={files.get(item.fileId)?.dataURL} alt={source?.title ?? ''} draggable={false} />
        {source ? (
          <div className="footer">
            {source.favicon ? <img className="favicon" src={source.favicon} alt="" draggable={false} /> : <Icon name="globe" size={15} />}
            <span className="title">{source.title || source.url}</span>
            {item.capture ? (
              <button title={item.live ? 'Show the picture' : 'Show the live page'} onPointerDown={(event) => event.stopPropagation()} onClick={onPlay}>
                <Icon name={item.live ? 'pause' : 'play'} size={14} />
              </button>
            ) : null}
            <button title="Open the page" onPointerDown={(event) => event.stopPropagation()} onClick={() => void arc.canvasOpenUrl(source.url)}>
              <Icon name="external" size={14} />
            </button>
          </div>
        ) : null}
      </div>
    )
  }
  if (item.kind === 'image') {
    return (
      <div className={classes} data-id={item.id} style={place}>
        <img src={files.get(item.fileId)?.dataURL} alt="" draggable={false} />
      </div>
    )
  }
  if (item.kind === 'text') return <TextView item={item} classes={classes} editing={editing} dark={dark} nodeRef={nodeRef} onTyped={onTyped} onEdited={onEdited} />
  if (item.kind === 'rect' || item.kind === 'ellipse') {
    const color = paint(item.color, dark)
    return <div className={classes} data-id={item.id} style={{ ...place, borderColor: color, background: item.fill ? `${color}2e` : 'transparent' }} />
  }
  if (item.kind === 'arrow') {
    const path = arrowPath(item)
    return (
      <svg className={classes} data-id={item.id} style={{ left: item.x, top: item.y }} width={Math.max(1, item.width)} height={Math.max(1, item.height)}>
        <path className="hit" d={path} />
        <path d={path} stroke={paint(item.color, dark)} strokeWidth={STROKE} />
      </svg>
    )
  }
  if (item.kind !== 'draw') return null
  const { scaleX, scaleY } = drawScale(item)
  const meanScale = (scaleX + scaleY) / 2
  const path = smoothPath(item.points)
  return (
    <svg
      className={classes}
      data-id={item.id}
      style={{ left: item.x, top: item.y }}
      width={Math.max(1, item.width)}
      height={Math.max(1, item.height)}
      viewBox={`0 0 ${Math.max(1, item.drawnWidth)} ${Math.max(1, item.drawnHeight)}`}
      preserveAspectRatio="none"
    >
      <path className="hit" d={path} strokeWidth={14 / meanScale} />
      <path d={path} stroke={paint(item.color, dark)} strokeWidth={DRAW_STROKE / meanScale} />
    </svg>
  )
}
