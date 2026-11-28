import type { DropTarget } from '../../shared/actions'
import { paneIds, removeFromSplits, splitOf } from '../../shared/split'
import { containsNode, findCanvas, findFolder, findInPinned, findItem, profileOfItem, spaceItems, stripKind, walkPinned } from '../../shared/tree'
import type { ID, PinnedNode, PinnedTab, Space, SplitAt, TabItem } from '../../shared/types'
import { resolveInput } from '../../shared/url'
import type { Browser } from '../browser'
import { MAX_ARCHIVE, newId } from '../core/store'
import type { LiveTab } from '../core/tab'
import { inAnyView } from './window-state'

const UNLOAD_HIDDEN_AFTER = 3600_000

interface ClosedTab {
  url: string
  title: string
  spaceId: ID
}

/** The tabs of the sidebar: opening, closing, archiving, pinning and moving them. */
export class Tabs {
  /** Most recently used first. */
  mru: ID[] = []
  private closedTabs: ClosedTab[] = []
  private hiddenSince = new Map<ID, number>()
  private readonly browser: Browser

  constructor(browser: Browser) {
    this.browser = browser
  }

  used(id: ID): void {
    this.mru = [id, ...this.mru.filter((recent) => recent !== id)].slice(0, 200)
  }

  takeInAsTodayTab(tab: LiveTab, space: Space): ID {
    const item: TabItem = { id: newId(), url: tab.wc.getURL(), title: tab.wc.getTitle(), favicon: tab.favicon, lastActive: Date.now() }
    space.today.unshift(item)
    tab.itemId = item.id
    this.browser.live.set(item.id, tab)
    return item.id
  }

  newTab(url: string, opts: { activate?: boolean; spaceId?: ID } = {}): TabItem {
    const space = (opts.spaceId && this.browser.store.space(opts.spaceId)) || this.browser.space
    const item: TabItem = { id: newId(), url, title: url, lastActive: Date.now() }
    space.today.unshift(item)
    if (opts.activate !== false) this.browser.activate(item.id)
    else this.browser.changed()
    return item
  }

  open(input: string, where: 'tab' | 'current' | 'split' | 'background' | 'little' = 'tab', splitAt?: SplitAt): void {
    const url = resolveInput(input, this.browser.state.settings.searchEngine)
    if (where === 'little') return void this.browser.openLittle(url)
    if (where === 'current') {
      const tab = this.browser.activeTab()
      if (tab) return void tab.load(url)
      where = 'tab'
    }
    if (where === 'split') {
      const item = this.newTab(url, { activate: false })
      return this.browser.splits.splitWith(item.id, splitAt)
    }
    this.newTab(url, { activate: where === 'tab' })
  }

  nextActiveAfter(space: Space, closedId: ID, splitPartner?: ID): ID | undefined {
    if (splitPartner) return splitPartner
    const visible = new Set(spaceItems(this.browser.state, space).map((item) => item.id))
    visible.delete(closedId)
    const recent = this.mru.find((id) => visible.has(id) && this.browser.live.has(id))
    if (recent) return recent
    return space.today.find((item) => item.id !== closedId)?.id
  }

  close(id: ID): void {
    const canvas = findCanvas(this.browser.state, id)
    if (canvas) {
      // Closing a canvas only deselects it; Delete Canvas is in its menu.
      if (canvas.space.activeItemId === id) canvas.space.activeItemId = undefined
      if (canvas.canvas.temporary) this.browser.canvases.discard(id)
      this.browser.layout()
      return this.browser.changed()
    }
    const found = findItem(this.browser.state, id)
    if (!found) return
    const loc = found.loc
    const space = loc.kind === 'favorite' ? this.browser.space : this.browser.store.space(loc.spaceId)!
    const split = splitOf(space.splits, id)
    const partner = split && paneIds(split.root).find((paneId) => paneId !== id)
    const wasActive = space.activeItemId === id
    space.splits = removeFromSplits(space.splits, id)
    this.browser.dropLive(id)
    this.mru = this.mru.filter((recent) => recent !== id)
    if (loc.kind === 'today') {
      loc.list.splice(loc.index, 1)
      this.archiveClosed(found.item, space.id)
    } else if (found.item.savedUrl) found.item.url = found.item.savedUrl
    if (wasActive) {
      space.activeItemId = this.nextActiveAfter(space, id, partner)
      if (space.activeItemId) return this.browser.activate(space.activeItemId)
    }
    this.browser.relayout()
  }

  archive(item: Pick<TabItem, 'url' | 'title' | 'favicon'>, spaceId: ID): void {
    if (!/^https?:/.test(item.url)) return
    this.browser.state.archive.unshift({ id: newId(), url: item.url, title: item.title, favicon: item.favicon, spaceId, archivedAt: Date.now() })
    if (this.browser.state.archive.length > MAX_ARCHIVE) this.browser.state.archive.length = MAX_ARCHIVE
  }

  archiveClosed(item: Pick<TabItem, 'url' | 'title' | 'favicon'>, spaceId: ID): void {
    this.archive(item, spaceId)
    this.closedTabs.push({ url: item.url, title: item.title, spaceId })
  }

  shownOrPlaying(id: ID): boolean {
    return inAnyView(this.browser.state.windows, id) || (this.browser.live.get(id)?.info().audible ?? false)
  }

  autoArchive(): void {
    const hours = this.browser.state.settings.archiveAfterHours
    if (!hours) return
    const cutoff = Date.now() - hours * 3600_000
    let any = false
    this.browser.captureCurrent()
    for (const space of this.browser.state.spaces) {
      const keep: TabItem[] = []
      for (const item of space.today) {
        if (!this.shownOrPlaying(item.id) && item.lastActive < cutoff) {
          this.archive(item, space.id)
          this.browser.dropLive(item.id)
          any = true
        } else keep.push(item)
      }
      space.today = keep
    }
    if (any) this.browser.changed()
  }

  unloadHiddenTabs(): void {
    const now = Date.now()
    this.browser.captureCurrent()
    for (const [id, tab] of [...this.browser.live]) {
      if (tab.destroyed) continue
      const inUse = inAnyView(this.browser.state.windows, id) || tab.wc.isCurrentlyAudible() || this.browser.media.keepsLoaded(id)
      const since = this.hiddenSince.get(id)
      if (inUse) this.hiddenSince.delete(id)
      else if (since === undefined) this.hiddenSince.set(id, now)
      else if (now - since >= UNLOAD_HIDDEN_AFTER) this.browser.dropLive(id)
    }
    for (const id of this.hiddenSince.keys()) if (!this.browser.live.has(id)) this.hiddenSince.delete(id)
    this.browser.emitSoon()
  }

  clearToday(): void {
    const space = this.browser.space
    for (const item of [...space.today]) {
      this.archiveClosed(item, space.id)
      space.splits = removeFromSplits(space.splits, item.id)
      this.browser.dropLive(item.id)
    }
    const wasToday = space.today.some((item) => item.id === space.activeItemId)
    space.today = []
    if (wasToday) space.activeItemId = undefined
    this.browser.relayout()
  }

  reopenClosed(): void {
    const last = this.closedTabs.pop()
    if (!last) return
    if (this.browser.store.space(last.spaceId)) this.browser.state.activeSpaceId = last.spaceId
    this.newTab(last.url)
  }

  togglePin(id: ID): void {
    const found = findItem(this.browser.state, id)
    if (!found) return
    this.browser.tourEvent('togglePin')
    const item = found.item
    const space = found.loc.kind === 'favorite' ? this.browser.space : this.browser.store.space(found.loc.spaceId)!
    found.loc.list.splice(found.loc.index, 1)
    if (found.loc.kind === 'today') {
      const pinned: PinnedTab = { ...stripKind(item), kind: 'tab', savedUrl: item.url, savedTitle: item.savedTitle }
      space.pinned.push(pinned)
      this.browser.toast('Pinned tab')
    } else {
      const unpinned = stripKind(item)
      delete unpinned.savedUrl
      space.today.unshift(unpinned)
    }
    this.browser.changed()
  }

  addFavorite(id: ID): void {
    const found = findItem(this.browser.state, id)
    if (!found || found.loc.kind === 'favorite') return
    const space = this.browser.store.space(found.loc.spaceId)!
    const profile = this.browser.store.profile(space.profileId)!
    found.loc.list.splice(found.loc.index, 1)
    const fav = stripKind(found.item)
    fav.savedUrl ??= fav.url
    profile.favorites.push(fav)
    this.browser.changed()
  }

  move(id: ID, to: DropTarget): void {
    const space = this.browser.space
    const profile = this.browser.store.profile(space.profileId)!
    let node: PinnedNode | TabItem | undefined
    let fromList: (PinnedNode | TabItem)[] | undefined
    const pinnedHit = findInPinned(space.pinned, id)
    if (pinnedHit) {
      node = pinnedHit.list[pinnedHit.index]
      fromList = pinnedHit.list
    } else {
      const found = findItem(this.browser.state, id)
      if (!found) return
      node = found.item
      fromList = found.loc.list
    }
    // Folders and canvases move as they are, and only among pinned items.
    const isFolder = 'kind' in node && (node.kind === 'folder' || node.kind === 'canvas')
    let target: unknown[]
    if (to.section === 'favorites') target = profile.favorites
    else if (to.section === 'today') target = space.today
    else {
      const folder = to.folderId ? findFolder(space, to.folderId) : undefined
      if (folder && (folder.live || containsNode(node as PinnedNode, folder.id))) return
      target = folder ? folder.children : space.pinned
    }
    if (isFolder && to.section !== 'pinned') return
    const split = isFolder || to.section === 'favorites' ? undefined : splitOf(space.splits, id)
    const ids = split ? paneIds(split.root) : [id]
    const group = fromList.filter((member) => ids.includes(member.id))
    const profileBefore = new Map(group.map((member) => [member.id, profileOfItem(this.browser.state, member.id)]))
    let index = to.index
    if (fromList === target) index -= group.filter((member) => fromList.indexOf(member) < to.index).length
    for (const member of group) fromList.splice(fromList.indexOf(member), 1)
    const moved = group.map((member) => {
      if (isFolder) return member
      const item = stripKind(member as TabItem)
      if (to.section === 'today') delete item.savedUrl
      else item.savedUrl ??= item.url
      return to.section === 'pinned' ? ({ ...item, kind: 'tab' } satisfies PinnedTab) : item
    })
    target.splice(Math.max(0, Math.min(index, target.length)), 0, ...moved)
    if (!isFolder) {
      for (const member of group) {
        if (profileOfItem(this.browser.state, member.id) === profileBefore.get(member.id)) continue
        this.browser.dropLive(member.id)
        if (space.activeItemId === member.id) this.browser.activate(member.id)
      }
    }
    this.browser.relayout()
  }

  moveToSpace(id: ID, spaceId: ID): void {
    const canvas = findCanvas(this.browser.state, id)
    if (canvas) return this.moveCanvasToSpace(id, spaceId)
    const found = findItem(this.browser.state, id)
    const target = this.browser.store.space(spaceId)
    if (!found || !target || found.loc.kind === 'favorite') return
    const from = this.browser.store.space(found.loc.spaceId)!
    if (from.id === target.id) return
    found.loc.list.splice(found.loc.index, 1)
    from.splits = removeFromSplits(from.splits, id)
    const item = stripKind(found.item)
    if (found.loc.kind === 'pinned') target.pinned.push({ ...item, kind: 'tab' })
    else target.today.unshift(item)
    if (from.profileId !== target.profileId) this.browser.dropLive(id)
    if (from.activeItemId === id) {
      from.activeItemId = undefined
      this.browser.activate(id)
    } else this.browser.relayout()
  }

  /** For tabs already taken out of the sidebar. */
  forgetPinned(space: Space, nodes: PinnedNode[]): void {
    const wasActive = space.activeItemId
    for (const node of walkPinned(nodes)) {
      if (node.kind !== 'tab') continue
      this.browser.dropLive(node.id)
      space.splits = removeFromSplits(space.splits, node.id)
      this.mru = this.mru.filter((recent) => recent !== node.id)
      if (space.activeItemId === node.id) space.activeItemId = this.nextActiveAfter(space, node.id)
    }
    if (space.activeItemId !== wasActive && space.activeItemId) return this.browser.activate(space.activeItemId)
    this.browser.relayout()
  }

  resetToSaved(id: ID): void {
    const item = findItem(this.browser.state, id)?.item
    if (!item?.savedUrl) return
    item.url = item.savedUrl
    void this.browser.live.get(id)?.load(item.savedUrl)
    this.browser.activate(id)
  }

  unload(id: ID): void {
    const item = findItem(this.browser.state, id)?.item
    this.browser.dropLive(id)
    if (item?.savedUrl) item.url = item.savedUrl
    if (this.browser.space.activeItemId === id) this.browser.space.activeItemId = this.nextActiveAfter(this.browser.space, id)
    this.browser.relayout()
  }

  restoreArchived(id: ID): void {
    const entry = this.browser.state.archive.find((archived) => archived.id === id)
    if (!entry) return
    this.browser.state.archive = this.browser.state.archive.filter((archived) => archived.id !== id)
    this.browser.setOverlay({ kind: 'none' }, false)
    this.newTab(entry.url, { spaceId: this.browser.store.space(entry.spaceId) ? entry.spaceId : undefined })
  }

  moveCanvasToSpace(id: ID, spaceId: ID): void {
    const hit = findCanvas(this.browser.state, id)
    const target = this.browser.store.space(spaceId)
    if (!hit || !target || hit.space.id === target.id) return
    this.browser.canvases.moveFiles(id, hit.space.profileId, target.profileId)
    hit.list.splice(hit.index, 1)
    target.pinned.push(hit.canvas)
    if (hit.space.activeItemId === id) hit.space.activeItemId = undefined
    this.browser.layout()
    this.browser.changed()
  }
}
