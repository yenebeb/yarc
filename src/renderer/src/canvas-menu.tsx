import { useLayoutEffect, useRef, useState } from 'react'
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
