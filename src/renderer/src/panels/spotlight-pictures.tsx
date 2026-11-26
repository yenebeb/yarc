// Draw with the panel's colors (--space, --panel, --text, --accent, --line) so pictures suit light and dark spaces.
import type { ReactNode } from 'react'
import logo from '../../../../build/icon.svg'
import { arc } from '../api'
import './spotlights.css'

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

function CanvasNotes() {
  return (
    <div className="cn-scene">
      <div className="cn-note">
        <b />
        <span className="cn-line cn-ticked" />
        <span className="cn-line cn-ticking" />
        <span className="cn-line" />
      </div>
      <div className="cn-note cn-list">
        <b />
        <span className="cn-line" />
        <span className="cn-line" />
        <span className="cn-line cn-link" />
      </div>
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

function LiveFolders() {
  return (
    <div className="lf-scene">
      <div className="lf-source">
        <b />
        <i />
        <i />
        <i />
      </div>
      <div className="mini-window lf-window">
        <div className="mini-sidebar">
          <i />
          <span className="lf-folder" />
          <span className="lf-item" />
          <span className="lf-item second" />
          <span className="lf-item third" />
          <i />
        </div>
        <div className="mini-page">
          <div className="lf-page">
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>
    </div>
  )
}

const SYNCED_PAGES = ['github.com/yenebeb/yarc', 'en.wikipedia.org/wiki/WebDAV', 'news.ycombinator.com']
const SEALED_FILES = ['9f2c41d07ab35e88c1f6', '04be7719e3c2a6f05d2b', 'c7a0153b9e48d2f61a70']
const SYNC_STEPS = ['Picked a place', 'Chose a sync password', 'Visited three pages', 'Unlocked the other computer']

function HistoryList({ rows }: { rows: string[] }) {
  return (
    <ul>
      {rows.map((row) => (
        <li key={row}>{row}</li>
      ))}
    </ul>
  )
}

function HistorySyncFlow() {
  return (
    <div className="hs-flow">
      <ol className="hs-steps">
        {SYNC_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="hs-stages">
        <section className="hs-stage">
          <h4>This computer</h4>
          <p>Encrypts your history with your password</p>
          <HistoryList rows={SYNCED_PAGES} />
        </section>
        <span className="hs-then" />
        <section className="hs-stage hs-sealed">
          <h4>A place you own</h4>
          <p>iCloud Drive, a folder, your own server. It only ever sees this</p>
          <HistoryList rows={SEALED_FILES} />
        </section>
        <span className="hs-then" />
        <section className="hs-stage">
          <h4>Your other computer</h4>
          <p>Same password, same history</p>
          <HistoryList rows={SYNCED_PAGES} />
        </section>
      </div>
    </div>
  )
}

const TURN_IT_ON = ['Open Settings and choose Sync', 'Pick where the encrypted files live', 'Choose a sync password', 'Repeat on your other computer']
const PLACES = ['iCloud Drive', 'A synced folder', 'Your own server', 'Nearby computers']
const NOBODY_ELSE = [
  { count: '0', what: 'YARC accounts' },
  { count: '0', what: 'YARC servers' },
  { count: '1', what: 'password, known only to you' }
]

function HistorySyncTurnItOn() {
  return (
    <section className="hs-fact">
      <h4>Turn it on</h4>
      <ol className="hs-numbered">
        {TURN_IT_ON.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  )
}

function HistorySyncTryIt() {
  return (
    <button className="hs-try" onPointerDown={(event) => event.stopPropagation()} onClick={() => void arc.canvasSpotlightAction('historySync')}>
      Try it now
    </button>
  )
}

function HistorySyncPlaces() {
  return (
    <section className="hs-fact">
      <h4>Where it can live</h4>
      <ul className="hs-places">
        {PLACES.map((place) => (
          <li key={place}>{place}</li>
        ))}
      </ul>
      <p>Your own server is any WebDAV address.</p>
    </section>
  )
}

function HistorySyncNobodyElse() {
  return (
    <section className="hs-fact">
      <h4>Nobody else</h4>
      <dl className="hs-counts">
        {NOBODY_ELSE.map(({ count, what }) => (
          <div key={what}>
            <dt>{count}</dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function HistorySync() {
  return (
    <>
      <HistorySyncFlow />
      <HistorySyncSmall />
    </>
  )
}

function HistorySyncSmall() {
  return (
    <div className="hs-scene">
      <div className="hs-computer">
        <b />
        <i />
        <i />
        <i />
      </div>
      <span className="hs-wire" />
      <div className="hs-place">
        <span className="hs-lock" />
        <i />
        <i />
      </div>
      <span className="hs-wire second" />
      <div className="hs-computer second">
        <b />
        <i />
        <i />
        <i />
      </div>
    </div>
  )
}

const PICTURES: Record<string, () => ReactNode> = {
  'history-sync': HistorySync,
  'history-sync-turn-it-on': HistorySyncTurnItOn,
  'history-sync-try-it': HistorySyncTryIt,
  'history-sync-places': HistorySyncPlaces,
  'history-sync-nobody-else': HistorySyncNobodyElse,
  'canvas-notes': CanvasNotes,
  'live-folders': LiveFolders,
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
