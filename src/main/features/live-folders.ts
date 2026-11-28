import type { Session } from 'electron'
import type { ID, LiveSource, PinnedFolder, Space } from '../../shared/types'
import { walkPinned } from '../../shared/tree'
import type { Browser } from '../browser'
import { newId } from '../core/store'
import { liveSource } from '../net/outbound'
import { feedLinkInHtml, githubSearchUrl, LiveError, looksLikeHtml, mergeLive, parseFeed, parseGitHubSearch, type LiveEntry } from './live-sources'

const REFRESH_EVERY = 10 * 60_000
/** Opening a folder refreshes it when it's older than this. */
const FRESH_FOR = 60_000
const FIRST_REFRESH_AFTER = 5_000
const TIMEOUT = 20_000

/** Fills live folders from their source with the space's profile session: its cookies, nothing of YARC's. */
export class LiveFolders {
  private readonly browser: Browser
  private readonly checkedAt = new Map<ID, number>()
  private readonly running = new Set<ID>()
  private timer: NodeJS.Timeout | undefined

  constructor(browser: Browser) {
    this.browser = browser
  }

  start(): void {
    this.timer = setTimeout(() => {
      this.timer = setInterval(() => void this.refreshStale(REFRESH_EVERY), REFRESH_EVERY)
      void this.refreshStale(0)
    }, FIRST_REFRESH_AFTER)
  }

  stop(): void {
    clearTimeout(this.timer)
  }

  opened(id: ID): void {
    if (Date.now() - (this.checkedAt.get(id) ?? 0) > FRESH_FOR) void this.refresh(id)
  }

  async refresh(id: ID): Promise<void> {
    const found = this.find(id)
    if (!found || this.running.has(id)) return
    const { folder, space } = found
    const source = folder.live!
    this.running.add(id)
    let entries: LiveEntry[] | undefined
    let error: string | undefined
    try {
      entries = await fetchEntries(source, this.browser.profiles.get(space.profileId).session)
    } catch (e) {
      error = e instanceof LiveError ? e.message : `Couldn’t reach ${host(source)}.`
    } finally {
      this.running.delete(id)
      this.checkedAt.set(id, Date.now())
    }
    const now = this.find(id)
    if (!now) return
    if (now.folder.live !== source) return void this.refresh(id)
    this.apply(now.folder, entries, error)
  }

  private apply(folder: PinnedFolder, entries: LiveEntry[] | undefined, error: string | undefined): void {
    const children = entries && mergeLive(folder.children, entries, (id) => this.inUse(id), newId, faviconOf)
    if (!children && folder.liveError === error) return
    if (children) folder.children = children
    folder.liveError = error
    this.browser.changed()
  }

  private async refreshStale(age: number): Promise<void> {
    const ids = this.browser.state.spaces.flatMap((s) => liveFoldersOf(s).map((f) => f.id))
    for (const id of ids) if (Date.now() - (this.checkedAt.get(id) ?? 0) >= age) await this.refresh(id)
  }

  private inUse(id: ID): boolean {
    const state = this.browser.state
    return this.browser.live.has(id) || state.spaces.some((s) => s.activeItemId === id) || state.windows.some((w) => Object.values(w.selected).includes(id))
  }

  private find(id: ID): { folder: PinnedFolder; space: Space } | undefined {
    for (const space of this.browser.state.spaces) {
      const folder = liveFoldersOf(space).find((f) => f.id === id)
      if (folder) return { folder, space }
    }
    return undefined
  }
}

function liveFoldersOf(space: Space): PinnedFolder[] {
  return [...walkPinned(space.pinned)].filter((n): n is PinnedFolder => n.kind === 'folder' && !!n.live)
}

async function fetchEntries(source: LiveSource, ses: Session): Promise<LiveEntry[]> {
  if (source.kind === 'github') {
    const res = await get(ses, githubSearchUrl(source.query), 'application/json')
    return parseGitHubSearch(await res.json().catch(() => undefined), source.query)
  }
  let url = source.url
  let text = await (await get(ses, url, 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.5')).text()
  if (looksLikeHtml(text)) {
    const feed = feedLinkInHtml(text, url)
    if (!feed) throw new LiveError('No feed found at this address.')
    url = feed
    text = await (await get(ses, url, 'application/rss+xml, application/atom+xml, application/xml')).text()
  }
  return parseFeed(text, url)
}

async function get(ses: Session, url: string, accept: string): Promise<Response> {
  const res = await liveSource(ses, url, accept, TIMEOUT)
  if (!res.ok) throw new LiveError(`${new URL(url).hostname} answered ${res.status}.`)
  return res
}

function faviconOf(url: string): string {
  return new URL('/favicon.ico', url).href
}

function host(source: LiveSource): string {
  return source.kind === 'github' ? 'GitHub' : new URL(source.url).hostname
}
