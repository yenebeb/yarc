import type { ID, PersistedState, PinnedFolder, PinnedNode, Space, TabItem } from './types'

export type ItemLocation =
  | { kind: 'favorite'; profileId: ID; list: TabItem[]; index: number }
  | { kind: 'pinned'; spaceId: ID; list: PinnedNode[]; index: number; folder?: PinnedFolder }
  | { kind: 'today'; spaceId: ID; list: TabItem[]; index: number }

export interface FoundItem {
  item: TabItem
  loc: ItemLocation
}

export function findInPinned(
  nodes: PinnedNode[],
  id: ID,
  folder?: PinnedFolder
): { list: PinnedNode[]; index: number; folder?: PinnedFolder } | undefined {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (n.id === id) return { list: nodes, index: i, folder }
    if (n.kind === 'folder') {
      const hit = findInPinned(n.children, id, n)
      if (hit) return hit
    }
  }
  return undefined
}

export function findItem(state: PersistedState, id: ID): FoundItem | undefined {
  for (const p of state.profiles) {
    const index = p.favorites.findIndex((f) => f.id === id)
    if (index >= 0) return { item: p.favorites[index], loc: { kind: 'favorite', profileId: p.id, list: p.favorites, index } }
  }
  for (const s of state.spaces) {
    const today = s.today.findIndex((t) => t.id === id)
    if (today >= 0) return { item: s.today[today], loc: { kind: 'today', spaceId: s.id, list: s.today, index: today } }
    const hit = findInPinned(s.pinned, id)
    if (hit && hit.list[hit.index].kind === 'tab') {
      return { item: hit.list[hit.index] as TabItem, loc: { kind: 'pinned', spaceId: s.id, ...hit } }
    }
  }
  return undefined
}

export function findFolder(space: Space, id: ID): PinnedFolder | undefined {
  const hit = findInPinned(space.pinned, id)
  const node = hit?.list[hit.index]
  return node?.kind === 'folder' ? node : undefined
}

export function* walkPinned(nodes: PinnedNode[]): Generator<PinnedNode> {
  for (const n of nodes) {
    yield n
    if (n.kind === 'folder') yield* walkPinned(n.children)
  }
}

/** In sidebar order: favorites, pinned (depth-first), today. */
export function spaceItems(state: PersistedState, space: Space): TabItem[] {
  const profile = state.profiles.find((p) => p.id === space.profileId)
  const out: TabItem[] = [...(profile?.favorites ?? [])]
  for (const n of walkPinned(space.pinned)) if (n.kind === 'tab') out.push(n)
  out.push(...space.today)
  return out
}

export function profileOfItem(state: PersistedState, id: ID): ID | undefined {
  const found = findItem(state, id)
  if (!found) return undefined
  if (found.loc.kind === 'favorite') return found.loc.profileId
  const spaceId = found.loc.spaceId
  return state.spaces.find((s) => s.id === spaceId)?.profileId
}

export function containsNode(node: PinnedNode, id: ID): boolean {
  if (node.id === id) return true
  return node.kind === 'folder' && node.children.some((c) => containsNode(c, id))
}

export function isAwayFromSaved(item: TabItem, currentUrl?: string): boolean {
  if (!item.savedUrl) return false
  const url = currentUrl ?? item.url
  return stripHash(url) !== stripHash(item.savedUrl)
}

function stripHash(url: string): string {
  const i = url.indexOf('#')
  return (i >= 0 ? url.slice(0, i) : url).replace(/\/$/, '')
}
