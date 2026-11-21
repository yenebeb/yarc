import { useEffect, useState, type MouseEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { LittleOp, LittleState } from '../../shared/ipc'
import { arc, displayHost, isMac } from './api'
import { Icon } from './icons'
import './styles.css'

function menuBelow(op: LittleOp) {
  return (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    void arc.little(op, { x: Math.round(r.left), y: Math.round(r.bottom + 4) })
  }
}

function App() {
  const [s, setS] = useState<LittleState>()
  useEffect(() => {
    const off = arc.onLittle(setS)
    void arc.little('sync')
    return off
  }, [])
  useEffect(() => {
    if (s) document.documentElement.style.setProperty('--little-bar', s.barColor)
  }, [s?.barColor])
  useEffect(() => {
    if (s?.title) document.title = s.title
  }, [s?.title])

  return (
    <div className={isMac ? 'mac' : 'win'}>
      <div className="little-bar">
        <div className="little-url" title={s?.url}>
          <button className="little-profile" onClick={menuBelow('profileMenu')} title="Open this page with another profile">
            <Icon name="profile" size={14} stroke={2} />
            {s?.profileName}
          </button>
          <span className="little-host">{s ? displayHost(s.url) : ''}</span>
          <button className="icon-btn" onClick={() => void arc.little('copyUrl')} title={`Copy URL (${isMac ? '⇧⌘C' : 'Ctrl+Shift+C'})`}>
            <Icon name="link" />
          </button>
        </div>
        <div className="little-open">
          <button className="little-open-main" onClick={() => void arc.little('openInMain')} title="Move this page into the main window">
            <span className="dim">Open in</span> {s?.spaceName ?? 'YARC'}
            <kbd>{isMac ? '⌘O' : 'Ctrl+O'}</kbd>
          </button>
          {s?.moreSpaces ? (
            <button className="little-open-more" onClick={menuBelow('spaceMenu')} title={`Open in another space (${isMac ? '⇧⌘O' : 'Ctrl+Shift+O'})`}>
              <Icon name="down" size={14} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
