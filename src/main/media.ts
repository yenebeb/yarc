import { screen, type View } from 'electron'
import { setTimeout as sleep } from 'node:timers/promises'
import type { Action } from '../shared/actions'
import { findItem } from '../shared/tree'
import type { AppState, ID } from '../shared/types'
import type { Browser } from './browser'
import { FloatingPlayer, type FloatAnchor, type FloatingHost } from './floating-player'
import { pauseMedia, probeMedia, toggleMedia } from './media-page'
import * as mediaState from './media-state'
import type { LeftWith, MediaState } from './media-state'
import type { LiveTab } from './tab'

// Chromium still reports a tab audible for a moment after its media paused; only sound that lasts gets a card.
const AUDIBLE_SETTLE_MS = 500

type MediaCardOp = Extract<Action, { type: 'media' }>['op']

export class Media implements FloatingHost {
  private readonly browser: Browser
  readonly floating: FloatingPlayer
  state: MediaState = mediaState.emptyMedia()
  onScreen = new Set<ID>()
  private readonly videoTabs = new Set<ID>()

  constructor(browser: Browser) {
    this.browser = browser
    this.floating = new FloatingPlayer(this)
  }

  snapshot(): AppState['media'] {
    return { cards: [...this.state.cards], floating: this.state.floating, videos: this.state.cards.filter((id) => this.videoTabs.has(id)) }
  }

  keepsLoaded(id: ID): boolean {
    return this.state.cards.includes(id) || this.floating.tabId === id
  }

  reset(): void {
    this.floating.dispose()
    this.state = mediaState.emptyMedia()
    this.onScreen.clear()
  }

  sync(nowOnScreen: Set<ID>): void {
    const before = this.onScreen
    this.onScreen = nowOnScreen
    for (const id of nowOnScreen) if (!before.has(id)) this.change(mediaState.shown(this.state, id))
    for (const id of before) if (!nowOnScreen.has(id)) void this.tabLeft(id)
  }

  takeBackFloating(views: View[]): void {
    const floatingId = this.floating.tabId
    if (floatingId && views.some((view) => view === this.floating.view)) this.change(mediaState.shown(this.state, floatingId))
  }

  pageChanged(id: ID, navigated: boolean | undefined): void {
    if (this.floating.tabId !== id) return
    // Same-page navigations (YouTube's next video) aren't `navigated` and keep the video.
    if (navigated) this.change(mediaState.closed(this.state, id))
    else this.floating.update()
  }

  gone(id: ID): void {
    this.onScreen.delete(id)
    this.videoTabs.delete(id)
    this.change(mediaState.closed(this.state, id))
  }

  backToTab(id: ID): void {
    if (!findItem(this.browser.state, id)) return
    this.browser.focusWindow()
    this.browser.activate(id)
  }

  minimizeFloating(): void {
    this.change(mediaState.minimize(this.state))
  }

  closeFloating(): void {
    const tab = this.state.floating ? this.browser.live.get(this.state.floating) : undefined
    if (tab) void pauseMedia(tab.wc)
    this.change(mediaState.closeFloating(this.state))
  }

  async card(id: ID, op: MediaCardOp): Promise<void> {
    const tab = this.browser.live.get(id)
    if (op === 'back') return this.backToTab(id)
    if (op === 'dismiss') {
      if (tab) void pauseMedia(tab.wc)
      return this.change(mediaState.dismiss(this.state, id))
    }
    if (!tab || tab.destroyed) return this.change(mediaState.closed(this.state, id))
    if (op === 'toggle') return void (await toggleMedia(tab.wc))
    if (!this.onScreen.has(id)) await this.floatTab(tab, () => this.outOfSight(id, tab))
  }

  private async tabLeft(id: ID): Promise<void> {
    const tab = this.browser.live.get(id)
    if (!tab || tab.destroyed || (!tab.playing && !tab.wc.isCurrentlyAudible())) return
    const found = await probeMedia(tab.wc)
    if (found === null && !tab.playing) await sleep(AUDIBLE_SETTLE_MS)
    const stillOutOfSight = () => this.outOfSight(id, tab)
    if (!stillOutOfSight()) return
    const playing: LeftWith = found === null ? (tab.wc.isCurrentlyAudible() ? 'audio' : 'nothing') : found === 'audio' ? 'audio' : 'video'
    if (playing === 'video') this.videoTabs.add(id)
    else this.videoTabs.delete(id)
    const next = mediaState.left(this.state, id, playing, this.browser.state.settings.floatVideos)
    if (next.floating !== id) return this.change(next)
    await this.floatTab(tab, stillOutOfSight)
  }

  private outOfSight(id: ID, tab: LiveTab): boolean {
    return !this.onScreen.has(id) && this.browser.live.get(id) === tab && !tab.destroyed
  }

  private async floatTab(tab: LiveTab, wanted: () => boolean): Promise<void> {
    const id = tab.itemId
    const opened = await this.floating.open(tab, this.floatAnchor(), wanted)
    if (!wanted()) return
    this.change(opened ? mediaState.float(this.state, id) : mediaState.left(this.state, id, 'audio', false))
  }

  private floatAnchor(): FloatAnchor {
    const current = this.browser.window
    const win = current && !current.win.isDestroyed() ? current.win.getBounds() : screen.getPrimaryDisplay().workArea
    return { win, sidebarRight: this.browser.state.settings.sidebarRight }
  }

  private change(next: MediaState): void {
    const before = this.state
    if (next === before) return
    this.state = next
    if (before.floating && before.floating !== next.floating && this.floating.tabId === before.floating) this.floating.release()
    this.browser.emitSoon()
  }
}
