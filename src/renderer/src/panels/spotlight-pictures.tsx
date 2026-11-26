// Draw with the panel's colors (--space, --panel, --text, --accent, --line) so pictures suit light and dark spaces.
import type { ReactNode } from 'react'
import logo from '../../../../build/icon.svg'
import { arc } from '../api'
import { Icon, type IconName } from '../icons'
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

function HistoryList({ rows }: { rows: string[] }) {
  return (
    <ul>
      {rows.map((row) => (
        <li key={row}>
          <span>{row}</span>
        </li>
      ))}
    </ul>
  )
}

function PasswordGate({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="hs-gate">
      <header>
        <b>
          <Icon name={icon} size={18} stroke={2.2} />
        </b>
        {children}
      </header>
      <ul>
        {SYNCED_PAGES.map((page) => (
          <li key={page}>
            <span className="hs-then" />
          </li>
        ))}
      </ul>
    </div>
  )
}

function HistorySyncFlow() {
  return (
    <div className="hs-flow">
      <section className="hs-stage">
        <header>
          <Icon name="screen" size={28} />
          <h4>This computer</h4>
          <p>Your history, as you browsed it</p>
        </header>
        <HistoryList rows={SYNCED_PAGES} />
      </section>
      <PasswordGate icon="lock">
        Sealed with
        <br />
        your password
      </PasswordGate>
      <section className="hs-stage hs-sealed">
        <header>
          <Icon name="folder" size={28} />
          <h4>A place you own</h4>
          <p>It only ever sees this</p>
        </header>
        <HistoryList rows={SEALED_FILES} />
      </section>
      <PasswordGate icon="unlock">
        Opened with
        <br />
        the same one
      </PasswordGate>
      <section className="hs-stage">
        <header>
          <Icon name="screen" size={28} />
          <h4>Your other computer</h4>
          <p>Same password, same history</p>
        </header>
        <HistoryList rows={SYNCED_PAGES} />
      </section>
    </div>
  )
}

const TURN_IT_ON = ['Open Settings and choose Sync', 'Pick where the files live', 'Choose a sync password', 'Repeat on your other computer']
const PLACES: { icon: IconName; name: string }[] = [
  { icon: 'cloud', name: 'iCloud Drive' },
  { icon: 'folder', name: 'A synced folder' },
  { icon: 'server', name: 'Your own server' },
  { icon: 'nearby', name: 'Nearby computers' }
]
const WHO_CAN_READ_IT = [
  { who: 'Not YARC: no account, no server', canRead: false },
  { who: 'Not the place you store it', canRead: false },
  { who: 'Only you, with your password', canRead: true }
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
      <button className="hs-try" onPointerDown={(event) => event.stopPropagation()} onClick={() => void arc.canvasSpotlightAction('historySync')}>
        Set Up Sync
      </button>
    </section>
  )
}

function HistorySyncPlaces() {
  return (
    <section className="hs-fact">
      <h4>Where it can live</h4>
      <ul className="hs-places">
        {PLACES.map(({ icon, name }) => (
          <li key={name}>
            <Icon name={icon} size={18} stroke={2} />
            {name}
          </li>
        ))}
      </ul>
      <p>Your own server is any WebDAV address. Nearby is experimental.</p>
    </section>
  )
}

function HistorySyncWhoCanReadIt() {
  return (
    <section className="hs-fact">
      <h4>Who can read it</h4>
      <ul className="hs-readers">
        {WHO_CAN_READ_IT.map(({ who, canRead }) => (
          <li key={who} className={canRead ? 'hs-can-read' : undefined}>
            <b>
              <Icon name={canRead ? 'lock' : 'x'} size={canRead ? 17 : 14} stroke={2.2} />
            </b>
            {who}
          </li>
        ))}
      </ul>
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
  'history-sync-places': HistorySyncPlaces,
  'history-sync-who-can-read-it': HistorySyncWhoCanReadIt,
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
