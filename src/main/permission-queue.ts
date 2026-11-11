// Site permission requests waiting for an answer. Kept free of Electron so unit tests can import it;
// profiles.ts feeds it, the browser shows it, and each profile's SiteDecisions keeps the answers.
import { keysFor, type MediaType, type SiteDecisions } from './site-permissions.ts'

export type { MediaType } from './site-permissions.ts'

/**
 * Allow sticks across restarts. Not Now (also Escape) refuses the site for the rest of the run and
 * counts toward a quiet week. 'dismiss' is no answer at all: a page with nowhere to show the prompt.
 */
export type PromptAnswer = 'allow' | 'deny' | 'dismiss'

export interface PermissionRequest {
  id: string
  /** Answers belong to the profile the page is signed in with. */
  profileId: string
  /** The webContents of the page that asked: its prompt shows only while that page is on screen. */
  wcId: number
  /** "https://meet.google.com" */
  origin: string
  permission: string
  /** For 'media': what the page wants, camera ('video') and/or microphone ('audio'). */
  mediaTypes?: MediaType[]
}

interface Pending extends PermissionRequest {
  callbacks: ((allowed: boolean) => void)[]
}

export class PermissionQueue {
  private pending: Pending[] = []
  private nextId = 1
  private onChange: () => void
  private decisionsFor: (profileId: string) => SiteDecisions

  /**
   * `decisionsFor` gives a profile's stored answers. `onChange` runs whenever the set of waiting
   * requests changes, so the prompt can be redrawn.
   */
  constructor(decisionsFor: (profileId: string) => SiteDecisions, onChange: () => void = () => {}) {
    this.decisionsFor = decisionsFor
    this.onChange = onChange
  }

  /**
   * The answer for a site: true once every part was allowed, false once any part was refused,
   * undefined while something still needs asking.
   */
  decided(profileId: string, origin: string, permission: string, mediaTypes?: MediaType[]): boolean | undefined {
    const decisions = this.decisionsFor(profileId)
    const answers = keysFor(permission, mediaTypes).map((k) => decisions.answer(origin, k))
    if (answers.includes(false)) return false
    if (answers.every((a) => a === true)) return true
    return undefined
  }

  /** Answers at once when the site already has an answer; otherwise waits for the user. */
  request(req: Omit<PermissionRequest, 'id'>, callback: (allowed: boolean) => void): void {
    const known = this.decided(req.profileId, req.origin, req.permission, req.mediaTypes)
    if (known !== undefined) return callback(known)
    // A page asking again before the first prompt is answered gets the same prompt, not a second one.
    const same = this.pending.find(
      (p) => p.wcId === req.wcId && p.origin === req.origin && p.permission === req.permission && sameMedia(p.mediaTypes, req.mediaTypes)
    )
    if (same) return void same.callbacks.push(callback)
    this.pending.push({ ...req, mediaTypes: req.mediaTypes && [...req.mediaTypes], id: String(this.nextId++), callbacks: [callback] })
    this.onChange()
  }

  /** The request to show: the oldest one from the first of these pages (most important first) that has any. */
  next(wcIds: number[]): PermissionRequest | undefined {
    for (const wcId of wcIds) {
      const found = this.pending.find((p) => p.wcId === wcId)
      if (found) return publicPart(found)
    }
    return undefined
  }

  /** Pages with requests waiting. */
  waitingPages(): number[] {
    return [...new Set(this.pending.map((p) => p.wcId))]
  }

  answer(id: string, answer: PromptAnswer): void {
    const req = this.pending.find((p) => p.id === id)
    if (!req) return
    this.pending = this.pending.filter((p) => p !== req)
    const decisions = this.decisionsFor(req.profileId)
    for (const key of keysFor(req.permission, req.mediaTypes)) {
      if (answer === 'allow') decisions.set(req.origin, key, 'allow')
      else if (answer === 'deny') decisions.notNow(req.origin, key)
    }
    for (const cb of req.callbacks) cb(answer === 'allow')
    this.settle()
  }

  /**
   * Answers waiting requests that now have an answer: the same question from the site's other
   * tabs, or one just changed in Settings.
   */
  settle(): void {
    for (const other of [...this.pending]) {
      const known = this.decided(other.profileId, other.origin, other.permission, other.mediaTypes)
      if (known === undefined) continue
      this.pending = this.pending.filter((p) => p !== other)
      for (const cb of other.callbacks) cb(known)
    }
    this.onChange()
  }

  /** The page navigated away or closed: its questions no longer apply, and the site hears "no". */
  cancel(wcId: number): void {
    const gone = this.pending.filter((p) => p.wcId === wcId)
    if (!gone.length) return
    this.pending = this.pending.filter((p) => p.wcId !== wcId)
    for (const req of gone) for (const cb of req.callbacks) cb(false)
    this.onChange()
  }
}

function sameMedia(a: MediaType[] = [], b: MediaType[] = []): boolean {
  return a.length === b.length && a.every((t) => b.includes(t))
}

function publicPart(p: Pending): PermissionRequest {
  const { callbacks: _callbacks, ...req } = p
  return req
}
