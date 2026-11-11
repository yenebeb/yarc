// Split view layout: a tree of side-by-side ('row') and stacked ('column') groups whose leaves
// are tabs. Pure functions, shared by the main process (placing views) and the UI (handles and
// drop zones), and covered by unit tests.
import type { ID, Rect, SplitGroup, SplitNode, SplitPane } from './types'

/** Arc's limit: a split view holds at most four tabs. */
export const MAX_PANES = 4
/** Space between panes, in pixels. */
export const SPLIT_GAP = 6

/** The edge of a pane where a dropped tab lands. */
export type Side = 'left' | 'right' | 'top' | 'bottom'

export function isPane(node: SplitNode): node is SplitPane {
  return 'itemId' in node
}

/** The tabs in a split, in reading order (left to right, top to bottom). */
export function paneIds(node: SplitNode): ID[] {
  return isPane(node) ? [node.itemId] : node.children.flatMap(paneIds)
}

function axisOf(side: Side): SplitGroup['dir'] {
  return side === 'left' || side === 'right' ? 'row' : 'column'
}

function before(side: Side): boolean {
  return side === 'left' || side === 'top'
}

/** Two tabs as a new split: `added` goes on `side` of `target`. */
export function newSplitRoot(target: ID, added: ID, side: Side): SplitGroup {
  const children = before(side) ? [{ itemId: added }, { itemId: target }] : [{ itemId: target }, { itemId: added }]
  return { dir: axisOf(side), children, sizes: [0.5, 0.5] }
}

/** Sizes scaled to sum to 1 (equal shares when they sum to nothing). */
function normalizeSizes(sizes: number[]): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0)
  return sum > 0 ? sizes.map((s) => s / sum) : sizes.map(() => 1 / sizes.length)
}

/**
 * Tidies a tree: drops empty groups, replaces one-child groups with their child and merges a
 * group into its parent when both run the same way (so their panes share one row of handles).
 */
function tidy(node: SplitNode): SplitNode | undefined {
  if (isPane(node)) return node
  const children: SplitNode[] = []
  const sizes: number[] = []
  node.children.forEach((c, i) => {
    const t = tidy(c)
    if (!t) return
    const size = node.sizes[i] ?? 0
    if (!isPane(t) && t.dir === node.dir) {
      t.children.forEach((gc, j) => {
        children.push(gc)
        sizes.push(size * t.sizes[j])
      })
    } else {
      children.push(t)
      sizes.push(size)
    }
  })
  if (children.length === 0) return undefined
  if (children.length === 1) return children[0]
  return { dir: node.dir, children, sizes: normalizeSizes(sizes) }
}

/** The split without `id`, or undefined once fewer than two tabs are left. Siblings share its space. */
export function removePane(root: SplitGroup, id: ID): SplitGroup | undefined {
  const strip = (node: SplitNode): SplitNode | undefined => {
    if (isPane(node)) return node.itemId === id ? undefined : node
    const kept = node.children.map(strip)
    return { dir: node.dir, children: kept.filter((c) => c !== undefined), sizes: node.sizes.filter((_, i) => !!kept[i]) }
  }
  const next = strip(root)
  const tidied = next && tidy(next)
  return tidied && !isPane(tidied) ? tidied : undefined
}

/**
 * The split with `added` placed on `side` of the pane showing `target`, which gives up half its
 * space. A side along the pane's group adds a sibling; a side across it stacks the two in a new group.
 */
export function insertPane(root: SplitGroup, target: ID, added: ID, side: Side): SplitGroup {
  const axis = axisOf(side)
  const visit = (group: SplitGroup): SplitGroup => {
    const children: SplitNode[] = []
    const sizes: number[] = []
    group.children.forEach((c, i) => {
      const size = group.sizes[i]
      if (!isPane(c)) {
        children.push(visit(c))
        sizes.push(size)
      } else if (c.itemId !== target) {
        children.push(c)
        sizes.push(size)
      } else if (group.dir === axis) {
        const pair = before(side) ? [{ itemId: added }, c] : [c, { itemId: added }]
        children.push(...pair)
        sizes.push(size / 2, size / 2)
      } else {
        children.push(newSplitRoot(target, added, side))
        sizes.push(size)
      }
    })
    return { dir: group.dir, children, sizes }
  }
  return visit(root)
}

/**
 * Where `added` would end up when dropped on `side` of `target`, moving it if it's already in this
 * split, or undefined when that isn't a change (dropping a pane on itself) or the split is full.
 */
export function placePane(root: SplitGroup | undefined, target: ID, added: ID, side: Side): SplitGroup | undefined {
  if (target === added) return undefined
  const rest = root && removePane(root, added)
  if (!rest) return newSplitRoot(target, added, side)
  if (paneIds(rest).length >= MAX_PANES) return undefined
  return insertPane(rest, target, added, side)
}

/**
 * `added` as a new column at the right of the whole split (Add Split View), with columns of equal
 * width. Unchanged if it's already in the split; undefined if the split is full.
 */
export function appendPane(root: SplitGroup, added: ID): SplitGroup | undefined {
  const ids = paneIds(root)
  if (ids.includes(added)) return root
  if (ids.length >= MAX_PANES) return undefined
  if (root.dir === 'row') {
    const n = root.children.length + 1
    return { dir: 'row', children: [...root.children, { itemId: added }], sizes: Array(n).fill(1 / n) }
  }
  return { dir: 'row', children: [root, { itemId: added }], sizes: [0.5, 0.5] }
}

/** Cuts a rect along `dir` into parts with these relative sizes, `gap` pixels apart. */
function cut(rect: Rect, dir: SplitGroup['dir'], sizes: number[], gap: number): Rect[] {
  const row = dir === 'row'
  const length = row ? rect.width : rect.height
  const start = row ? rect.x : rect.y
  const total = length - gap * (sizes.length - 1)
  let at = start
  return sizes.map((s, i) => {
    const len = i === sizes.length - 1 ? start + length - at : Math.round(total * s)
    const r = row ? { x: at, y: rect.y, width: len, height: rect.height } : { x: rect.x, y: at, width: rect.width, height: len }
    at += len + gap
    return r
  })
}

/** Where each tab of the split sits inside `rect`. */
export function layoutPanes(root: SplitNode, rect: Rect, gap = SPLIT_GAP): { id: ID; rect: Rect }[] {
  if (isPane(root)) return [{ id: root.itemId, rect }]
  const rects = cut(rect, root.dir, root.sizes, gap)
  return root.children.flatMap((c, i) => layoutPanes(c, rects[i], gap))
}

/** A draggable border between two neighbours in a group. */
export interface Divider {
  /** Child indexes from the root down to the group. */
  path: number[]
  /** The border sits after child `index`. */
  index: number
  dir: SplitGroup['dir']
  /** The gap between the two neighbours. */
  rect: Rect
  /** The group's own rect, to turn pixels into sizes. */
  group: Rect
  sizes: number[]
}

/** Every border between panes, for the resize handles. */
export function dividers(root: SplitGroup, rect: Rect, gap = SPLIT_GAP): Divider[] {
  const out: Divider[] = []
  const visit = (group: SplitGroup, r: Rect, path: number[]) => {
    const rects = cut(r, group.dir, group.sizes, gap)
    rects.forEach((cr, i) => {
      if (i < rects.length - 1) {
        const gapRect = group.dir === 'row' ? { x: cr.x + cr.width, y: cr.y, width: gap, height: cr.height } : { x: cr.x, y: cr.y + cr.height, width: cr.width, height: gap }
        out.push({ path, index: i, dir: group.dir, rect: gapRect, group: r, sizes: group.sizes })
      }
      const child = group.children[i]
      if (!isPane(child)) visit(child, cr, [...path, i])
    })
  }
  visit(root, rect, [])
  return out
}

/** The group at `path`, or undefined when the path doesn't lead to one. */
export function groupAt(root: SplitGroup, path: number[]): SplitGroup | undefined {
  let node: SplitNode = root
  for (const i of path) {
    if (isPane(node)) return undefined
    node = node.children[i]
    if (!node) return undefined
  }
  return isPane(node) ? undefined : node
}

/** Sizes of `before` and `before + 1` after moving their border by `delta` pixels in a group `length` long. */
export function dragBorder(sizes: number[], index: number, delta: number, length: number, min = 0.15): number[] {
  const next = [...sizes]
  const pair = sizes[index] + sizes[index + 1]
  const a = Math.min(pair - min, Math.max(min, sizes[index] + delta / length))
  next[index] = a
  next[index + 1] = pair - a
  return next
}

/**
 * Which edge of a pane the cursor is nearest: the pane is cut corner to corner into four
 * triangles, so the middle of the left half means "left" and the middle of the top means "top".
 */
export function sideAt(rect: Rect, x: number, y: number): Side {
  const nx = (x - rect.x) / rect.width - 0.5
  const ny = (y - rect.y) / rect.height - 0.5
  if (Math.abs(nx) >= Math.abs(ny)) return nx < 0 ? 'left' : 'right'
  return ny < 0 ? 'top' : 'bottom'
}

/** The half of a pane a tab dropped on `side` would take. */
export function previewRect(rect: Rect, side: Side, gap = SPLIT_GAP): Rect {
  const w = Math.round((rect.width - gap) / 2)
  const h = Math.round((rect.height - gap) / 2)
  switch (side) {
    case 'left':
      return { ...rect, width: w }
    case 'right':
      return { ...rect, x: rect.x + rect.width - w, width: w }
    case 'top':
      return { ...rect, height: h }
    case 'bottom':
      return { ...rect, y: rect.y + rect.height - h, height: h }
  }
}

/** Height of the bar on top of each pane of a split (back, forward, the host, close), as in Arc. */
export const PANE_BAR = 32

/** The group holding pane `id`, its index there and the path to the group (child indexes from the root). */
export function parentOf(root: SplitGroup, id: ID): { group: SplitGroup; index: number; path: number[] } | undefined {
  const visit = (group: SplitGroup, path: number[]): ReturnType<typeof parentOf> => {
    for (const [i, c] of group.children.entries()) {
      if (isPane(c)) {
        if (c.itemId === id) return { group, index: i, path }
      } else {
        const hit = visit(c, [...path, i])
        if (hit) return hit
      }
    }
    return undefined
  }
  return visit(root, [])
}

/** The split with the group at `path` replaced by `change(group)`. */
function updateGroup(root: SplitGroup, path: number[], change: (g: SplitGroup) => SplitGroup): SplitGroup {
  if (path.length === 0) return change(root)
  const [i, ...rest] = path
  const children = root.children.map((c, j) => (j === i && !isPane(c) ? updateGroup(c, rest, change) : c))
  return { ...root, children }
}

/**
 * Pane `id` swapped with its neighbour in its group, keeping its size: -1 is left (or up in a
 * stacked group), +1 right (or down). Undefined when it's already at that edge.
 */
export function movePane(root: SplitGroup, id: ID, delta: -1 | 1): SplitGroup | undefined {
  const at = parentOf(root, id)
  if (!at) return undefined
  const j = at.index + delta
  if (j < 0 || j >= at.group.children.length) return undefined
  return updateGroup(root, at.path, (g) => {
    const children = [...g.children]
    const sizes = [...g.sizes]
    ;[children[at.index], children[j]] = [children[j], children[at.index]]
    ;[sizes[at.index], sizes[j]] = [sizes[j], sizes[at.index]]
    return { ...g, children, sizes }
  })
}

/** The split turned the other way: side-by-side panes stacked, stacked ones side by side. */
export function flipSplit(root: SplitGroup): SplitGroup {
  return {
    dir: root.dir === 'row' ? 'column' : 'row',
    children: root.children.map((c) => (isPane(c) ? c : flipSplit(c))),
    sizes: [...root.sizes]
  }
}

/** What the split menu of pane `id` offers, worded for the way its group runs (Arc's menu). */
export function splitMenuModel(root: SplitGroup, id: ID) {
  const at = parentOf(root, id)
  const row = (at?.group.dir ?? root.dir) === 'row'
  const count = at?.group.children.length ?? 0
  return {
    moveBack: { label: row ? 'Move Left' : 'Move Up', enabled: !!at && at.index > 0 },
    moveForward: { label: row ? 'Move Right' : 'Move Down', enabled: !!at && at.index < count - 1 },
    addAfter: { label: row ? 'Add Right Split' : 'Add Bottom Split', side: (row ? 'right' : 'bottom') as Side },
    addBefore: { label: row ? 'Add Left Split' : 'Add Top Split', side: (row ? 'left' : 'top') as Side },
    canAdd: paneIds(root).length < MAX_PANES,
    convert: root.dir === 'row' ? 'Convert to Vertical Split View' : 'Convert to Horizontal Split View'
  }
}

/**
 * `list` with the entries whose ids are in `ids` brought together where the first of them is,
 * in list order, so a split's tabs sit side by side in the sidebar as one row.
 */
export function gather<T extends { id: ID }>(list: T[], ids: ID[]): T[] {
  const members = list.filter((x) => ids.includes(x.id))
  if (members.length < 2) return list
  const out: T[] = []
  for (const x of list) {
    if (!ids.includes(x.id)) out.push(x)
    else if (x === members[0]) out.push(...members)
  }
  return out
}

/** Reads a split saved by an older version (`itemIds` side by side) or returns it as is. */
export function upgradeSplit(raw: { id: ID; root?: SplitGroup; itemIds?: ID[]; sizes?: number[] }): { id: ID; root: SplitGroup } | undefined {
  if (raw.root) return { id: raw.id, root: raw.root }
  const ids = raw.itemIds ?? []
  if (ids.length < 2) return undefined
  const sizes = raw.sizes?.length === ids.length ? normalizeSizes(raw.sizes) : ids.map(() => 1 / ids.length)
  return { id: raw.id, root: { dir: 'row', children: ids.map((itemId) => ({ itemId })), sizes } }
}
