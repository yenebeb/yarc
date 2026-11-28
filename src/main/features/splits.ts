import { appendPaneIn, flipSplit, gatherSplit, movePane, paneIds, placePaneIn, removeFromSplits, splitOf, type Side } from '../../shared/split'
import { findItem, spaceItems } from '../../shared/tree'
import type { ID, Space, Split, SplitAt } from '../../shared/types'
import type { Browser } from '../browser'
import { newId } from '../core/store'

export class Splits {
  private readonly browser: Browser

  constructor(browser: Browser) {
    this.browser = browser
  }

  splitWith(id: ID, at?: SplitAt): void {
    const space = this.browser.space
    const active = space.activeItemId
    const found = findItem(this.browser.state, id)
    if (!found) return
    if (found.loc.kind !== 'favorite' && found.loc.spaceId !== space.id) this.browser.tabs.moveToSpace(id, space.id)
    if (at && findItem(this.browser.state, at.target) && at.target !== id) return this.placeInSplit(id, at.target, at.side)
    if (!active || active === id || !findItem(this.browser.state, active)) return this.browser.activate(id)
    this.showSplit(space, appendPaneIn(space.splits, active, id, newId()), id)
  }

  /** Shows `id` on `side` of `target`, joining or moving within target's split; does nothing when that split is full. */
  placeInSplit(id: ID, target: ID, side: Side): void {
    const space = this.browser.space
    const visible = new Set(spaceItems(this.browser.state, space).map((item) => item.id))
    if (id === target || !visible.has(id) || !visible.has(target)) return
    const splits = placePaneIn(space.splits, target, id, side, newId())
    if (splits) this.showSplit(space, splits, id)
  }

  showSplit(space: Space, splits: Split[], id: ID): void {
    space.splits = splits
    Object.assign(space, gatherSplit(space, id))
    this.browser.activate(id)
    this.browser.tourEvent('split')
  }

  moveInSplit(id: ID, delta: -1 | 1): void {
    const split = splitOf(this.browser.space.splits, id)
    const root = split && movePane(split.root, id, delta)
    if (!split || !root) return
    split.root = root
    this.browser.relayout()
  }

  flipSplit(id: ID): void {
    const split = splitOf(this.browser.space.splits, id)
    if (!split) return
    split.root = flipSplit(split.root)
    this.browser.relayout()
  }

  separateFromSplit(id: ID): void {
    const space = this.browser.space
    if (!splitOf(space.splits, id)) return
    space.splits = removeFromSplits(space.splits, id)
    this.browser.activate(id)
  }

  unsplit(id?: ID): void {
    const space = this.browser.space
    const target = id ?? space.activeItemId
    space.splits = space.splits.filter((split) => !target || !paneIds(split.root).includes(target))
    this.browser.relayout()
  }
}
