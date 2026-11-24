import { useState, type MouseEvent } from 'react'
import type { AppState, ID } from '../../shared/types'
import { cx, dispatch, displayHost } from './api'
import { Favicon, Icon } from './icons'

export function MediaCards({ state }: { state: AppState }) {
  const [open, setOpen] = useState(false)
  const { cards, videos } = state.media
  const shown = new Set(state.layout.views.filter((view) => !view.elsewhere).map((view) => view.id))
  const list = cards.filter((id) => state.live[id] && !shown.has(id))
  if (!list.length) return null
  const newestFirst = [...list].reverse()
  const visible = open ? newestFirst : newestFirst.slice(0, 1)
  return (
    <div
      className={cx('media-cards', open && 'open')}
      data-behind={open ? 0 : Math.min(2, list.length - 1)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {visible.map((id) => (
        <MediaCard key={id} id={id} state={state} video={videos.includes(id)} expanded={open} />
      ))}
    </div>
  )
}

function MediaCard({ id, state, video, expanded }: { id: ID; state: AppState; video: boolean; expanded: boolean }) {
  const live = state.live[id]
  const send = (op: 'back' | 'toggle' | 'float' | 'dismiss') => (event: MouseEvent) => {
    event.stopPropagation()
    dispatch({ type: 'media', id, op })
  }
  return (
    <div className="media-card" title={live.title}>
      {expanded && (
        <div className="media-card-title">
          <span>{live.title || displayHost(live.url)}</span>
          {video && (
            <button className="icon-btn" onClick={send('float')} title="Float the Video">
              <Icon name="pip" size={14} />
            </button>
          )}
          <button className="icon-btn" onClick={send('dismiss')} title="Close (pauses it)">
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
      <div className="media-card-controls">
        <button className="icon-btn media-card-site" onClick={send('back')} title="Back to Tab">
          <Favicon url={live.url} favicon={live.favicon} />
        </button>
        <button className="icon-btn" onClick={send('toggle')} title={live.playing ? 'Pause' : 'Play'}>
          <Icon name={live.playing ? 'pause' : 'play'} size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={(event) => {
            event.stopPropagation()
            dispatch({ type: 'mute', id })
          }}
          title={live.muted ? 'Unmute Tab' : 'Mute Tab'}
        >
          <Icon name={live.muted ? 'muted' : 'speaker'} size={15} />
        </button>
      </div>
    </div>
  )
}
