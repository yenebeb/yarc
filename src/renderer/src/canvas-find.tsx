import { useEffect, useRef, useState } from 'react'
import { matchAfter, textsHolding } from '../../shared/canvas-find'
import { arc } from './api'
import type { Board } from './canvas-board'
import { Icon } from './icons'

/** ⌘F on a canvas: the texts that hold what's typed, in a bar on the page; each Enter pans to the next. */
export function useCanvasFind(board: Board) {
  const { itemsRef, panTo } = board
  const [query, setQuery] = useState<string>()
  const [current, setCurrent] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const latest = useRef({ query, current })
  latest.current = { query, current }

  const matches = query === undefined ? [] : textsHolding(board.items, query)
  const showMatch = (index: number, ids: string[]) => {
    setCurrent(index)
    const shown = itemsRef.current.find((item) => item.id === ids[index])
    if (shown) panTo(shown)
  }
  const search = (typed: string) => {
    setQuery(typed)
    showMatch(0, textsHolding(itemsRef.current, typed))
  }
  const step = (direction: 1 | -1) => {
    const ids = textsHolding(itemsRef.current, latest.current.query ?? '')
    showMatch(matchAfter(ids.length, latest.current.current, direction), ids)
  }
  const close = () => setQuery(undefined)

  useEffect(
    () =>
      arc.onCanvasFind((op) => {
        if (op === 'open' || latest.current.query === undefined) {
          setQuery((typed) => typed ?? '')
          input.current?.focus()
          input.current?.select()
          return
        }
        step(op === 'next' ? 1 : -1)
      }),
    []
  )
  useEffect(() => {
    if (query !== undefined) input.current?.focus()
  }, [query === undefined])

  const found = matches[current] === undefined ? undefined : { current: matches[current], others: matches.filter((id) => id !== matches[current]) }
  return { query, matches, current, found, input, search, step, close }
}

export function FindBar({ find }: { find: ReturnType<typeof useCanvasFind> }) {
  if (find.query === undefined) return null
  return (
    <div className="canvas-find" onPointerDown={(event) => event.stopPropagation()}>
      <Icon name="search" size={15} />
      <input
        ref={find.input}
        value={find.query}
        placeholder="Find on this canvas"
        spellCheck={false}
        onChange={(event) => find.search(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') find.step(event.shiftKey ? -1 : 1)
          if (event.key === 'Escape') find.close()
          event.stopPropagation()
        }}
      />
      {find.query.trim() ? (
        <span className="count">
          {find.matches.length ? find.current + 1 : 0}/{find.matches.length}
        </span>
      ) : null}
      <button title="Previous" onClick={() => find.step(-1)}>
        <Icon name="up" size={16} />
      </button>
      <button title="Next" onClick={() => find.step(1)}>
        <Icon name="down" size={16} />
      </button>
      <button title="Close" onClick={find.close}>
        <Icon name="x" size={16} />
      </button>
    </div>
  )
}
