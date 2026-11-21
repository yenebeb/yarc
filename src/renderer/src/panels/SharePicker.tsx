// Picking is the consent: nothing is shared until Share, and closing the panel any way is Cancel.
import { useState } from 'react'
import type { OverlayMode } from '../../../shared/types'
import { cx, dispatch } from '../api'

type Mode = Extract<OverlayMode, { kind: 'share-picker' }>

export function SharePicker({ mode }: { mode: Mode }) {
  const screens = mode.sources.filter((s) => s.screen)
  const windows = mode.sources.filter((s) => !s.screen)
  const [tab, setTab] = useState<'screen' | 'window'>('screen')
  const [selected, setSelected] = useState<string | undefined>(screens.length === 1 ? screens[0].id : undefined)
  const [systemAudio, setSystemAudio] = useState(true)
  const shown = tab === 'screen' ? screens : windows

  const answer = (sourceId?: string) => dispatch({ type: 'sharePick', id: mode.id, sourceId, systemAudio: mode.systemAudio && systemAudio })
  const pickTab = (next: 'screen' | 'window') => {
    setTab(next)
    setSelected(next === 'screen' && screens.length === 1 ? screens[0].id : undefined)
  }

  return (
    <div className="panel share-picker" role="dialog" aria-label={`Choose what to share with ${mode.site}`} onMouseDown={(e) => e.stopPropagation()}>
      <header>
        <h2>Choose what to share with {mode.site}</h2>
        <div className="share-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'screen'} className={tab === 'screen' ? 'on' : ''} onClick={() => pickTab('screen')}>
            Entire Screen
          </button>
          <button role="tab" aria-selected={tab === 'window'} className={tab === 'window' ? 'on' : ''} onClick={() => pickTab('window')}>
            Window
          </button>
        </div>
      </header>
      <div className="share-grid">
        {shown.length ? (
          shown.map((s) => (
            <button
              key={s.id}
              className={cx('share-source', selected === s.id && 'on')}
              onClick={() => setSelected(s.id)}
              onDoubleClick={() => answer(s.id)}
              title={s.name}
            >
              {s.thumbnail ? <img src={s.thumbnail} alt="" /> : <span className="share-blank" />}
              <span className="share-name">{s.screen && screens.length === 1 ? 'Entire screen' : s.name}</span>
            </button>
          ))
        ) : (
          <p className="muted">No windows to share.</p>
        )}
      </div>
      <footer className="intro-footer">
        {mode.systemAudio ? (
          <label className="share-audio">
            <input type="checkbox" checked={systemAudio} onChange={(e) => setSystemAudio(e.target.checked)} /> Also share system audio
          </label>
        ) : null}
        <span className="spacer" />
        <button className="btn" onClick={() => answer()}>
          Cancel
        </button>
        <button className="btn primary" disabled={!selected} onClick={() => answer(selected)}>
          Share
        </button>
      </footer>
    </div>
  )
}
