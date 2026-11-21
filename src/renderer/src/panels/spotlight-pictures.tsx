// Draw with the panel's colors (--space, --panel, --text, --accent, --line) so pictures suit light and dark spaces.
import type { ReactNode } from 'react'
import logo from '../../../../build/icon.svg'

export function MiniWindow({ tabs = 4, active = 0, children }: { tabs?: number; active?: number; children?: ReactNode }) {
  return (
    <div className="mini-window">
      <div className="mini-sidebar">
        {Array.from({ length: tabs }, (_, i) => (
          <i key={i} className={i === active ? 'on' : undefined} />
        ))}
      </div>
      <div className="mini-page">{children}</div>
    </div>
  )
}

function FloatingPlayer() {
  return (
    <div className="fp-scene">
      <MiniWindow active={-1}>
        <div className="fp-other">
          <i />
          <i />
          <i />
          <i />
        </div>
      </MiniWindow>
      <span className="fp-tab" />
      <div className="fp-video">
        <span className="fp-play" />
      </div>
    </div>
  )
}

function Canvases() {
  return (
    <div className="cv-scene">
      <MiniWindow active={1}>
        <div className="cv-page">
          <i />
          <span className="cv-photo" />
          <i />
          <i />
        </div>
      </MiniWindow>
      <span className="cv-pick" />
      <div className="cv-board">
        <i />
        <span className="cv-pin" />
        <span className="cv-pin" />
      </div>
      <span className="cv-card" />
    </div>
  )
}

function TrafficControl() {
  return (
    <div className="tc-scene">
      <div className="tc-app">
        <i />
        <i />
        <span className="tc-chip" />
        <i />
      </div>
      <div className="mini-window tc-window">
        <div className="mini-sidebar">
          <span className="tc-tab" />
          <i />
          <i />
          <i />
          <span className="tc-spaces">
            <b />
            <b />
            <b />
          </span>
        </div>
        <div className="mini-page">
          <div className="tc-page">
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>
      <span className="tc-link" />
    </div>
  )
}

const PICTURES: Record<string, () => ReactNode> = {
  'traffic-control': TrafficControl,
  canvases: Canvases,
  'floating-player': FloatingPlayer
}

export function SpotlightPicture({ id }: { id: string }) {
  const draw = PICTURES[id]
  return (
    <div className="spotlight-picture" aria-hidden="true">
      {draw ? draw() : <img className="logo" src={logo} alt="" />}
    </div>
  )
}
