import type { ID, PinnedNode, Rect, Space, Split, SplitGroup, SplitNode, SplitPane } from './types'

export const MAX_PANES = 4
export const SPLIT_GAP = 6

export type Side = 'left' | 'right' | 'top' | 'bottom'

export function isPane(node: SplitNode): node is SplitPane {
  return 'itemId' in node
}

/** In reading order. */
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

function normalizeSizes(sizes: number[]): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0)
  return sum > 0 ? sizes.map((s) => s / sum) : sizes.map(() => 1 / sizes.length)
}

/** Drops empty groups, unwraps one-child groups and merges same-direction groups into their parent. */
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

/** `target` gives up half its space; a side across its group nests the two in a new group. */
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

/** Moves `added` if it's already in the split; undefined for a drop on itself or a full split. */
export function placePane(root: SplitGroup | undefined, target: ID, added: ID, side: Side): SplitGroup | undefined {
  if (target === added) return undefined
  const rest = root && removePane(root, added)
  if (!rest) return newSplitRoot(target, added, side)
  if (paneIds(rest).length >= MAX_PANES) return undefined
  return insertPane(rest, target, added, side)
}

/** A new equal-width column at the right; unchanged if already in, undefined if the split is full. */
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

export function splitOf(splits: Split[], id: ID): Split | undefined {
  return splits.find((sp) => paneIds(sp.root).includes(id))
}

export function removeFromSplits(splits: Split[], id: ID, keep?: Split): Split[] {
  return splits.flatMap((sp) => {
    if (sp === keep || !paneIds(sp.root).includes(id)) return [sp]
    const root = removePane(sp.root, id)
    return root ? [{ ...sp, root }] : []
  })
}

/** Right of `target`, in its split or a new one; `added` is left out of a full split. */
export function appendPaneIn(splits: Split[], target: ID, added: ID, newId: ID): Split[] {
  const rest = removeFromSplits(splits, added)
  const split = splitOf(rest, target)
  if (!split) return [...rest, { id: newId, root: newSplitRoot(target, added, 'right') }]
  const root = appendPane(split.root, added)
  return root ? rest.map((sp) => (sp === split ? { ...sp, root } : sp)) : rest
}

/** Undefined when `target`'s split is full. */
export function placePaneIn(splits: Split[], target: ID, added: ID, side: Side, newId: ID): Split[] | undefined {
  const split = splitOf(splits, target)
  const root = placePane(split?.root, target, added, side)
  if (!root) return undefined
  const rest = removeFromSplits(splits, added, split)
  return split ? rest.map((sp) => (sp === split ? { ...sp, root } : sp)) : [...rest, { id: newId, root }]
}

function cut(rect: Rect, dir: SplitGroup['dir'], sizes: number[], gap: number): Rect[] {
  const row = dir === 'row'
  const length = row ? rect.width : rect.height
  const start = row ? rect.x : rect.y
  const total = Math.max(0, length - gap * (sizes.length - 1))
  let at = start
  return sizes.map((s, i) => {
    const len = Math.max(0, i === sizes.length - 1 ? start + length - at : Math.round(total * s))
    const r = row ? { x: at, y: rect.y, width: len, height: rect.height } : { x: rect.x, y: at, width: rect.width, height: len }
    at += len + gap
    return r
  })
}

export function layoutPanes(root: SplitNode, rect: Rect, gap = SPLIT_GAP): { id: ID; rect: Rect }[] {
  if (isPane(root)) return [{ id: root.itemId, rect }]
  const rects = cut(rect, root.dir, root.sizes, gap)
  return root.children.flatMap((c, i) => layoutPanes(c, rects[i], gap))
}

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

export function groupAt(root: SplitGroup, path: number[]): SplitGroup | undefined {
  let node: SplitNode = root
  for (const i of path) {
    if (isPane(node)) return undefined
    node = node.children[i]
    if (!node) return undefined
  }
  return isPane(node) ? undefined : node
}

/** `sizes` after moving the border after child `index` by `delta` pixels in a group `length` pixels long. */
export function dragBorder(sizes: number[], index: number, delta: number, length: number, min = 0.15): number[] {
  const next = [...sizes]
  const pair = sizes[index] + sizes[index + 1]
  const a = Math.min(pair - min, Math.max(min, sizes[index] + delta / length))
  next[index] = a
  next[index + 1] = pair - a
  return next
}

/** The pane is cut corner to corner into four triangles, one per side. */
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

/** Height of the bar on top of each split pane. */
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

/** Undefined when `sizes` don't match the group's children. */
export function resizeGroup(root: SplitGroup, path: number[], sizes: number[]): SplitGroup | undefined {
  if (sizes.length !== groupAt(root, path)?.children.length) return undefined
  const sum = sizes.reduce((x, y) => x + y, 0)
  return updateGroup(root, path, (g) => ({ ...g, sizes: sizes.map((x) => Math.max(0.1, x / sum)) }))
}

function updateGroup(root: SplitGroup, path: number[], change: (g: SplitGroup) => SplitGroup): SplitGroup {
  if (path.length === 0) return change(root)
  const [i, ...rest] = path
  const children = root.children.map((c, j) => (j === i && !isPane(c) ? updateGroup(c, rest, change) : c))
  return { ...root, children }
}

/** Swaps with a neighbour, sizes included: -1 is left (up when stacked). Undefined at the edge. */
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

export function flipSplit(root: SplitGroup): SplitGroup {
  return {
    dir: root.dir === 'row' ? 'column' : 'row',
    children: root.children.map((c) => (isPane(c) ? c : flipSplit(c))),
    sizes: [...root.sizes]
  }
}

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

/** Brings the `ids` entries together where the first of them is, so a split's tabs form one sidebar row. */
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

export function gatherSplit(space: Pick<Space, 'today' | 'pinned' | 'splits'>, id: ID): Pick<Space, 'today' | 'pinned'> {
  const split = splitOf(space.splits, id)
  const ids = split ? paneIds(split.root) : []
  const inFolders = (list: PinnedNode[]): PinnedNode[] => gather(list, ids).map((n) => (n.kind === 'folder' ? { ...n, children: inFolders(n.children) } : n))
  return { today: gather(space.today, ids), pinned: inFolders(space.pinned) }
}

/** Reads a split saved by an older version (`itemIds` side by side) or returns it as is. */
export function upgradeSplit(raw: { id: ID; root?: SplitGroup; itemIds?: ID[]; sizes?: number[] }): { id: ID; root: SplitGroup } | undefined {
  if (raw.root) return { id: raw.id, root: raw.root }
  const ids = raw.itemIds ?? []
  if (ids.length < 2) return undefined
  const sizes = raw.sizes?.length === ids.length ? normalizeSizes(raw.sizes) : ids.map(() => 1 / ids.length)
  return { id: raw.id, root: { dir: 'row', children: ids.map((itemId) => ({ itemId })), sizes } }
}

/** `rows`: each split's first tab in `list` → its tabs there; `hidden`: the others, drawn in that row. */
export function splitRows(splits: Split[], list: { id: ID }[]): { rows: Map<ID, ID[]>; hidden: Set<ID> } {
  const rows = new Map<ID, ID[]>()
  const hidden = new Set<ID>()
  const inList = new Set(list.map((x) => x.id))
  for (const sp of splits) {
    const ids = paneIds(sp.root).filter((id) => inList.has(id))
    if (ids.length < 2) continue
    const first = list.find((x) => ids.includes(x.id))!.id
    rows.set(first, ids)
    for (const id of ids) if (id !== first) hidden.add(id)
  }
  return { rows, hidden }
}
