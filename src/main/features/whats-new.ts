import { app } from 'electron'
import { recentSpotlights, spotlight, SPOTLIGHTS, unseenSpotlights } from '../../shared/spotlights'
import type { AppState, ReleaseNotes } from '../../shared/types'
import type { Browser } from '../browser'
import { changesSince, newestVersion, parseChangelog, RECENT_VERSIONS, recentChanges } from './changelog'
import { hasBoard } from './whats-new-boards'

// Defined by electron.vite.config.ts from build/changelog.json; empty outside release builds.
declare const __CHANGELOG__: unknown
const CHANGELOG = parseChangelog(__CHANGELOG__)
const whatsNewVersion = () => (app.isPackaged ? app.getVersion() : (newestVersion(CHANGELOG) ?? app.getVersion()))
export const plainWindowForTests = () => !!process.env.YARC_TEST && !process.env.YARC_STARTUP_SCREENS

export class WhatsNew {
  /** `since`: the version whose changes the user saw last. */
  private waitingNews: { since?: string; releases: ReleaseNotes[]; spotlights: string[] } = { releases: [], spotlights: [] }
  private readonly browser: Browser

  constructor(browser: Browser) {
    this.browser = browser
  }

  showStartupScreen(): void {
    this.browser.canvases.discardTemporary()
    const current = whatsNewVersion()
    const state = this.browser.state
    const seen = state.whatsNewSeenVersion ?? state.lastSeenVersion
    if (this.browser.store.firstRun || !seen) this.markWhatsNewSeen()
    else {
      state.whatsNewSeenVersion = seen
      this.waitingNews = { since: seen, releases: changesSince(CHANGELOG, seen, current), spotlights: unseenSpotlights(SPOTLIGHTS, state.seenSpotlights) }
    }
    state.lastSeenVersion = app.getVersion()
    this.browser.changed()
    if (plainWindowForTests()) return
    if (this.browser.store.firstRun) this.whenWindowShows(() => this.browser.setOverlay({ kind: 'tour', step: 'welcome' }))
    else if (this.waitingNews.spotlights.length) this.whenWindowShows(() => this.openWhatsNew())
  }

  whenWindowShows(show: () => void): void {
    const win = this.browser.window.win
    if (win.isVisible()) show()
    else win.once('show', show)
  }

  markSpotlightsSeen(): void {
    this.browser.state.seenSpotlights = SPOTLIGHTS.map((known) => known.id)
    this.waitingNews.spotlights = []
  }

  markWhatsNewSeen(): void {
    this.browser.state.whatsNewSeenVersion = whatsNewVersion()
    this.waitingNews.releases = []
    this.markSpotlightsSeen()
  }

  newsWaits(): boolean {
    return this.waitingNews.releases.length + this.waitingNews.spotlights.length > 0
  }

  spotlightsToShow(): string[] {
    return this.newsWaits() ? this.waitingNews.spotlights : recentSpotlights(SPOTLIGHTS)
  }

  boardsToOffer(): string[] {
    return this.browser.incognito ? [] : this.spotlightsToShow().filter(hasBoard)
  }

  whatsNewPill(): AppState['whatsNew'] {
    if (!this.newsWaits()) return undefined
    return { boards: this.boardsToOffer().map((id) => ({ spotlight: id, title: spotlight(id)?.title ?? id })) }
  }

  /** On the user's click, or at launch for an unseen spotlight. What waits when there is something, else the latest changes and features. */
  openWhatsNew(): void {
    const { releases } = this.waitingNews
    this.browser.setOverlay({
      kind: 'whats-new',
      releases: this.newsWaits() ? releases.slice(0, RECENT_VERSIONS) : recentChanges(CHANGELOG, whatsNewVersion()),
      spotlights: this.spotlightsToShow(),
      boards: this.boardsToOffer()
    })
    this.markWhatsNewSeen()
    this.browser.changed()
  }

  openBoard(spotlightId: string): void {
    if (this.browser.incognito || !hasBoard(spotlightId)) return
    this.browser.setOverlay({ kind: 'none' })
    this.browser.activate(this.browser.canvases.createWhatsNew(this.browser.space, spotlightId).id)
  }
}
