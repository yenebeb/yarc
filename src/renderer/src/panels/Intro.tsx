// The tour (first run, or Take the Tour) and What's New (first launch after an update, or from the
// menu and command bar). The tour's setup steps and What's New are cards over the dimmed window;
// the tour's try-it steps float over the page so the user can do what they describe.
import { useEffect, useRef, type ReactNode } from 'react'
import logo from '../../../../build/icon.svg'
import { bindingLabel, type CommandId } from '../../../shared/keymap'
import { isFloating, nextStep, previousStep, TOUR_STEPS, tryEvent, type TourStep } from '../../../shared/tour'
import { spaceItems } from '../../../shared/tree'
import type { AppState, ReleaseNotes, UpdateStatus } from '../../../shared/types'
import { activeSpace, dispatch, isMac } from '../api'
import { Icon } from '../icons'
import './panels.css'

const key = (id: CommandId) => <kbd className="kbd">{bindingLabel(id, isMac)}</kbd>

const go = (step: TourStep | undefined) => step && dispatch({ type: 'overlay', mode: { kind: 'tour', step } })

const importFrom = (source: 'arc' | 'chrome' | 'zen') => () => dispatch({ type: 'import', source, keepOverlay: true })

const SHORTCUTS: { id: CommandId; label: string }[] = [
  { id: 'newTab', label: 'New tab, search or command' },
  { id: 'toggleSidebar', label: 'Show or hide the sidebar' },
  { id: 'togglePin', label: 'Pin or unpin a tab' },
  { id: 'newIncognitoWindow', label: 'New incognito window' },
  { id: 'switcherNext', label: 'Switch to a recent tab' },
  { id: 'littleArc', label: 'New Little Window' }
]

interface StepContent {
  title: string
  text: ReactNode
  /** What to do to go on, for a try-it step. */
  tryIt?: ReactNode
  body?: ReactNode
}

function content(step: TourStep, state: AppState): StepContent {
  const s = state.settings
  const edge = s.sidebarRight ? 'right' : 'left'
  const tabs = spaceItems(state, activeSpace(state)).length
  switch (step) {
    case 'welcome':
      return {
        title: 'Welcome to YARC',
        text: 'Spaces, pinned tabs, a command bar and split view, all in one sidebar. A two-minute tour shows you around.'
      }
    case 'import':
      return {
        title: 'Bring your tabs along',
        text: 'Spaces, pinned tabs, favorites and history from Arc or Zen; history and bookmarks from Chrome, Edge or Brave.',
        body: (
          <div className="intro-buttons centered">
            <button className="btn primary" onClick={importFrom('arc')}>
              Import from Arc
            </button>
            <button className="btn" onClick={importFrom('chrome')}>
              Chrome
            </button>
            <button className="btn" onClick={importFrom('zen')}>
              Zen
            </button>
          </div>
        )
      }
    case 'default':
      return {
        title: 'Make YARC your default browser',
        text: 'Links from other apps then open in a Little Window, a small window you can keep or turn into a tab.',
        body: (
          <div className="intro-buttons centered">
            <button className="btn primary" onClick={() => dispatch({ type: 'command', id: 'setDefaultBrowser', keepOverlay: true })}>
              Set as Default Browser
            </button>
          </div>
        )
      }
    case 'spaces':
      return {
        title: 'Spaces and the sidebar',
        text: (
          <>
            Each space has its own pinned tabs, today’s tabs and profile. Switch with {key('space1')}, {key('space2')}…
            {isMac ? ' or swipe sideways on the sidebar.' : '.'}
          </>
        ),
        tryIt: <>Press {key('toggleSidebar')} to hide the sidebar</>
      }
    case 'peek':
      return s.sidebarVisible
        ? {
            title: 'Peek at the hidden sidebar',
            text: `With the sidebar hidden, point at the window’s ${edge} edge and it slides out over the page.`,
            tryIt: <>Press {key('toggleSidebar')} to hide it</>
          }
        : {
            title: 'Peek at the hidden sidebar',
            text: `Point at the window’s ${edge} edge: the sidebar slides out over the page, and away again when you leave it.`,
            tryIt: <>Press {key('toggleSidebar')} to bring it back</>
          }
    case 'command':
      return {
        title: 'The command bar',
        text: 'Open a site, search, switch tabs or run a command. Type a site like youtube.com, then Tab, to search it.',
        tryIt: <>Press {key('newTab')}</>
      }
    case 'pin':
      return {
        title: 'Pin what you keep',
        text:
          s.archiveAfterHours > 0
            ? `Pinned tabs stay in the sidebar. Unpinned ones are archived after ${s.archiveAfterHours} hours, so the sidebar tidies itself.`
            : 'Pinned tabs stay in the sidebar, above the tabs you open today.',
        tryIt: tabs ? <>Press {key('togglePin')} to pin this tab</> : <>Open a tab with {key('newTab')}, then press {key('togglePin')}</>
      }
    case 'split':
      return {
        title: 'Split view',
        text: 'Drag a tab from the sidebar onto the page to see both side by side. Up to four fit.',
        tryIt: tabs >= 2 ? <>Drag a tab onto the page</> : <>Open two tabs, then drag one onto the page</>
      }
    case 'little':
      return {
        title: 'Little Window',
        text: 'A small window for a quick look, and where links from other apps open. One click makes it a tab.',
        // Ctrl+Alt+N types ñ on US-International and other AltGr keyboards, so offer the command bar too.
        tryIt: isMac ? <>Press {key('littleArc')}</> : <>Press {key('littleArc')}, or pick New Little Window in the command bar</>
      }
    case 'incognito':
      return {
        title: 'Incognito windows',
        text: 'Browse without a trace: its history, cookies and tabs are gone once you close the window.',
        tryIt: <>Press {key('newIncognitoWindow')}</>
      }
    case 'done':
      return {
        title: 'You’re all set',
        text: (
          <>
            Shortcuts worth learning first. Take the tour again from the command bar: <em>Take the YARC Tour</em>.
          </>
        ),
        body: (
          <ul className="intro-shortcuts">
            {SHORTCUTS.map((sc) => (
              <li key={sc.id}>
                {key(sc.id)}
                <span>{sc.label}</span>
              </li>
            ))}
          </ul>
        )
      }
  }
}

function Dots({ step }: { step: TourStep }) {
  const at = TOUR_STEPS.indexOf(step)
  return (
    <span className="tour-dots" aria-label={`Step ${at + 1} of ${TOUR_STEPS.length}`}>
      {TOUR_STEPS.map((s, i) => (
        <i key={s} className={i === at ? 'on' : i < at ? 'done' : ''} />
      ))}
    </span>
  )
}

export function Tour({ step, state, close }: { step: TourStep; state: AppState; close: () => void }) {
  const c = content(step, state)
  const next = nextStep(step)
  const back = previousStep(step)
  const primary = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!isFloating(step)) primary.current?.focus()
  }, [step])

  if (isFloating(step)) {
    return (
      <div className="panel tour-float" onKeyDown={(e) => e.key === 'Escape' && close()}>
        <div className="tour-float-head">
          <Dots step={step} />
          <button className="icon-btn" title="End the tour" onClick={close}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <h2>{c.title}</h2>
        <p>{c.text}</p>
        <div className="tour-float-foot">
          {c.tryIt ? <span className="tour-try">{c.tryIt}</span> : null}
          <span className="spacer" />
          {back ? (
            <button className="btn ghost small" onClick={() => go(back)}>
              Back
            </button>
          ) : null}
          <button className="btn small" onClick={() => go(next)} title={tryEvent(step) ? 'Go on without trying it' : undefined}>
            {tryEvent(step) ? 'Skip' : 'Next'}
          </button>
        </div>
      </div>
    )
  }

  const first = step === 'welcome'
  return (
    <div className="panel intro tour" onMouseDown={(e) => e.stopPropagation()}>
      <div className={`intro-hero${first ? '' : ' compact'}`}>
        <img className="logo" src={logo} alt="" />
        <h1>{c.title}</h1>
        <p>{c.text}</p>
      </div>
      {c.body ? <div className="intro-body">{c.body}</div> : null}
      <footer className="intro-footer">
        {first ? (
          <button className="btn ghost" onClick={close}>
            Skip
          </button>
        ) : (
          <button className="btn ghost" onClick={() => go(back)}>
            Back
          </button>
        )}
        <span className="spacer" />
        {first ? null : <Dots step={step} />}
        <span className="spacer" />
        {step === 'done' ? (
          <button ref={primary} className="btn primary" onClick={close}>
            Start Browsing
          </button>
        ) : (
          <button ref={primary} className="btn primary" onClick={() => go(next)}>
            {first ? 'Take the Tour' : step === 'import' || step === 'default' ? 'Next' : 'Continue'}
          </button>
        )}
      </footer>
    </div>
  )
}

/**
 * The relaunch card for a downloaded update, at most once a day: every version since the running one
 * with its changes. Neither button has the focus, so typing meant for a page can't restart YARC.
 */
export function UpdateReady({ update, close }: { update: UpdateStatus; close: () => void }) {
  if (update.state !== 'ready') return null
  const releases = update.notes ?? []
  const count = Math.max(1, releases.length)
  return (
    <div className="panel intro whats-new update-ready" onMouseDown={(e) => e.stopPropagation()}>
      <div className="intro-hero compact">
        <img className="logo" src={logo} alt="" />
        <h1>{count > 1 ? `${count} updates are ready` : 'An update is ready'}</h1>
        <p>Relaunch to get YARC {update.version}. Your spaces and tabs come right back.</p>
      </div>
      <div className="intro-body">
        {releases.some((r) => r.changes.length) ? (
          releases.map((r) => (
            <section key={r.version} className="release">
              <h2>Version {r.version}</h2>
              {r.changes.length ? (
                <ul>
                  {r.changes.map((change, i) => (
                    <li key={i}>{change}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Small fixes and improvements.</p>
              )}
            </section>
          ))
        ) : (
          <p className="muted">Fixes and improvements, including the latest Chromium security fixes.</p>
        )}
      </div>
      <footer className="intro-footer">
        <span className="muted hint">Otherwise it installs the next time you quit.</span>
        <span className="spacer" />
        <button className="btn" onClick={close}>
          Later
        </button>
        <button className="btn primary" onClick={() => dispatch({ type: 'relaunchUpdate' })}>
          Relaunch now
        </button>
      </footer>
    </div>
  )
}

export function WhatsNew({ releases, close }: { releases: ReleaseNotes[]; close: () => void }) {
  return (
    <div className="panel intro whats-new" onMouseDown={(e) => e.stopPropagation()}>
      <div className="intro-hero compact">
        <img className="logo" src={logo} alt="" />
        <h1>What's New</h1>
        {releases.length ? <p>YARC {releases[0].version}</p> : null}
      </div>
      <div className="intro-body">
        {releases.length ? (
          releases.map((r) => (
            <section key={r.version} className="release">
              {releases.length > 1 ? <h2>Version {r.version}</h2> : null}
              <ul>
                {r.changes.map((change, i) => (
                  <li key={i}>{change}</li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <p className="muted">This build has no release notes. Releases from GitHub list their changes here.</p>
        )}
      </div>
      <footer className="intro-footer">
        <span className="spacer" />
        <button className="btn primary" onClick={close}>
          Continue
        </button>
      </footer>
    </div>
  )
}
