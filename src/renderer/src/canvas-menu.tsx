import { useLayoutEffect, useRef, useState } from 'react'
import type { BoardItem } from '../../shared/canvas'
import { arc, isMac } from './api'
import type { BoardActions } from './canvas-actions'
import { copyText } from './canvas-clipboard'
import type { Point } from './canvas-view'

export interface MenuEntry {
  label: string
  keys?: string
  checked?: boolean
  run: () => void
}

export function Menu({ at, entries, onClose }: { at: Point; entries: (MenuEntry | '-')[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState(at)
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    setPlace({ x: Math.max(8, Math.min(at.x, innerWidth - rect.width - 8)), y: Math.max(8, Math.min(at.y, innerHeight - rect.height - 8)) })
  }, [at])
  return (
    <div ref={ref} className="menu" style={{ left: place.x, top: place.y }} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
      {entries.map((entry, index) =>
        entry === '-' ? (
          <div key={index} className="menu-line" />
        ) : (
          <button
            key={index}
            onClick={() => {
              onClose()
              entry.run()
            }}
          >
            <span className="check">{entry.checked ? '✓' : ''}</span>
            <span className="label">{entry.label}</span>
            {entry.keys ? <span className="keys">{entry.keys}</span> : null}
          </button>
        )
      )}
    </div>
  )
}

export const shortcut = (key: string) => (isMac ? `⌘${key}` : `Ctrl+${key}`)

/** For the items the menu was opened on; with none, the board's own entries. */
export function menuEntries(chosen: BoardItem[], actions: BoardActions, snapping: { on: boolean; toggle: () => void }): (MenuEntry | '-')[] {
  const [first, ...others] = chosen
  const one = others.length ? undefined : first
  const entries: (MenuEntry | '-')[] = []
  if (chosen.length) {
    entries.push(
      { label: 'Cut', keys: shortcut('X'), run: () => document.execCommand('cut') },
      { label: 'Copy', keys: shortcut('C'), run: () => document.execCommand('copy') },
      { label: 'Duplicate', keys: shortcut('D'), run: actions.duplicate },
      { label: 'Delete', keys: '⌫', run: actions.remove },
      '-',
      { label: 'Bring to Front', keys: shortcut('⇧]'), run: () => actions.reorder(true) },
      { label: 'Send to Back', keys: shortcut('⇧['), run: () => actions.reorder(false) }
    )
    if (one?.kind === 'text' && !one.title) entries.push({ label: 'Make Title', run: () => actions.makeTitle(one.id) })
    if (one?.kind === 'capture' && one.source) {
      const url = one.source.url
      entries.push('-', { label: 'Open Page', run: () => void arc.canvasOpenUrl(url) }, { label: 'Copy Page Address', run: () => copyText(url) })
    }
    if (chosen.length > 1) entries.push('-', { label: 'Arrange in Grid', run: actions.arrange })
    entries.push('-')
  } else {
    entries.push({ label: 'Select All', keys: shortcut('A'), run: actions.selectAll }, { label: 'Zoom to Fit', keys: '⇧1', run: actions.zoomToFit }, '-')
  }
  entries.push({ label: 'Snap to Objects', checked: snapping.on, run: snapping.toggle })
  if (!chosen.length) entries.push('-', { label: 'Export as PNG…', run: () => void actions.exportPng('file') }, { label: 'Copy as PNG', run: () => void actions.exportPng('clipboard') })
  return entries
}
