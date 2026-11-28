import type { Action } from '../../shared/actions'
import { cleanLiveSource, liveFolderName } from '../../shared/live-folders'
import { findFolder, findInPinned, spaceCanvases, spaceItems } from '../../shared/tree'
import type { ID, LiveSource, Space } from '../../shared/types'
import type { Browser } from '../browser'
import { newId, SPACE_COLORS } from '../core/store'

/** Spaces and the folders in them. */
export class Spaces {
  private readonly browser: Browser

  constructor(browser: Browser) {
    this.browser = browser
  }

  switchSpace(id: ID): void {
    const space = this.browser.store.space(id)
    if (!space) return
    this.browser.closePeek()
    this.browser.state.activeSpaceId = id
    if (space.activeItemId && this.browser.hasItem(space.activeItemId)) this.browser.activate(space.activeItemId)
    else {
      space.activeItemId = undefined
      this.browser.relayout()
    }
  }

  createSpace(action: Extract<Action, { type: 'createSpace' }>): void {
    let profileId = action.profileId && action.profileId !== 'new' ? action.profileId : undefined
    if (!profileId) {
      profileId = newId()
      this.browser.state.profiles.push({ id: profileId, name: action.profileName || action.name, favorites: [] })
    }
    const space: Space = {
      id: newId(),
      name: action.name || 'New Space',
      emoji: action.emoji,
      color: action.color || SPACE_COLORS[this.browser.state.spaces.length % SPACE_COLORS.length],
      color2: action.color2 || undefined,
      appearance: action.appearance,
      profileId,
      pinned: [],
      today: [],
      splits: []
    }
    this.browser.state.spaces.push(space)
    this.switchSpace(space.id)
  }

  deleteSpace(id: ID): void {
    if (this.browser.state.spaces.length <= 1) return this.browser.toast('You need at least one space')
    const space = this.browser.store.space(id)
    if (!space) return
    for (const canvas of spaceCanvases(space)) this.browser.canvases.delete(canvas.id)
    for (const item of spaceItems(this.browser.state, space)) if (!this.browser.state.profiles.some((profile) => profile.favorites.includes(item))) this.browser.dropLive(item.id)
    this.browser.state.spaces = this.browser.state.spaces.filter((other) => other.id !== id)
    this.browser.state.settings.linkRoutes = this.browser.state.settings.linkRoutes.filter((route) => route.spaceId !== id)
    if (!this.browser.state.spaces.some((other) => other.profileId === space.profileId)) {
      const profile = this.browser.store.profile(space.profileId)
      for (const favorite of profile?.favorites ?? []) this.browser.dropLive(favorite.id)
      this.browser.state.profiles = this.browser.state.profiles.filter((other) => other.id !== space.profileId)
      void this.browser.profiles.remove(space.profileId)
      this.browser.historySync?.profilesChanged()
    }
    if (this.browser.state.activeSpaceId === id) this.switchSpace(this.browser.state.spaces[0].id)
    else this.browser.changed()
  }

  saveLiveFolder(space: Space, id: ID | undefined, name: string, source: LiveSource): void {
    const live = cleanLiveSource(source)
    if (!live) return this.browser.toast('That address can’t be used as a feed')
    let folder = id ? findFolder(space, id) : undefined
    if (id && !folder) return
    if (!folder) {
      folder = { kind: 'folder', id: newId(), name: '', open: true, children: [] }
      space.pinned.unshift(folder)
    }
    folder.name = name.trim() || liveFolderName(live)
    if (JSON.stringify(folder.live) !== JSON.stringify(live)) {
      folder.live = live
      folder.liveError = undefined
    }
    this.browser.changed()
    void this.browser.liveFolders.refresh(folder.id)
  }

  deleteFolder(space: Space, id: ID): void {
    const hit = findInPinned(space.pinned, id)
    const folder = hit?.list[hit.index]
    if (!hit || folder?.kind !== 'folder') return
    if (!folder.live) {
      hit.list.splice(hit.index, 1, ...folder.children)
      return this.browser.changed()
    }
    hit.list.splice(hit.index, 1)
    this.browser.tabs.forgetPinned(space, folder.children)
  }

  updateSpace(action: Extract<Action, { type: 'updateSpace' }>): void {
    const space = this.browser.store.space(action.id)
    if (!space) return
    if (action.name !== undefined) space.name = action.name
    if (action.emoji !== undefined) space.emoji = action.emoji || undefined
    if (action.color) space.color = action.color
    if (action.color2 !== undefined) space.color2 = action.color2 || undefined
    if (action.appearance !== undefined) space.appearance = action.appearance || undefined
    if (action.profileId && action.profileId !== space.profileId && this.browser.store.profile(action.profileId)) {
      for (const item of spaceItems(this.browser.state, space)) this.browser.dropLive(item.id)
      space.profileId = action.profileId
      space.splits = []
      if (space.id === this.browser.space.id && space.activeItemId) return this.browser.activate(space.activeItemId)
    }
    this.browser.relayout()
  }
}
