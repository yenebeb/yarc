import { keysFor, type MediaType, type SiteDecisions } from './site-permissions.ts'

export type { MediaType } from './site-permissions.ts'

/** 'deny' is Not Now (also Escape). 'dismiss' is no answer at all: a page with nowhere to show the prompt. */
export type PromptAnswer = 'allow' | 'deny' | 'dismiss'

export interface PermissionRequest {
  id: string
  profileId: string
  /** Its prompt shows only while that page is on screen. */
  wcId: number
  origin: string
  permission: string
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

  constructor(decisionsFor: (profileId: string) => SiteDecisions, onChange: () => void = () => {}) {
    this.decisionsFor = decisionsFor
    this.onChange = onChange
  }

  decided(profileId: string, origin: string, permission: string, mediaTypes?: MediaType[]): boolean | undefined {
    const decisions = this.decisionsFor(profileId)
    const answers = keysFor(permission, mediaTypes).map((k) => decisions.answer(origin, k))
    if (answers.includes(false)) return false
    if (answers.every((a) => a === true)) return true
    return undefined
  }

  request(req: Omit<PermissionRequest, 'id'>, callback: (allowed: boolean) => void): void {
    const known = this.decided(req.profileId, req.origin, req.permission, req.mediaTypes)
    if (known !== undefined) return callback(known)
    const samePrompt = this.pending.find(
      (p) => p.wcId === req.wcId && p.origin === req.origin && p.permission === req.permission && sameMedia(p.mediaTypes, req.mediaTypes)
    )
    if (samePrompt) return void samePrompt.callbacks.push(callback)
    this.pending.push({ ...req, mediaTypes: req.mediaTypes && [...req.mediaTypes], id: String(this.nextId++), callbacks: [callback] })
    this.onChange()
  }

  /** `wcIds`: most important first. */
  next(wcIds: number[]): PermissionRequest | undefined {
    for (const wcId of wcIds) {
      const found = this.pending.find((p) => p.wcId === wcId)
      if (found) return publicPart(found)
    }
    return undefined
  }

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

  settle(): void {
    for (const other of [...this.pending]) {
      const known = this.decided(other.profileId, other.origin, other.permission, other.mediaTypes)
      if (known === undefined) continue
      this.pending = this.pending.filter((p) => p !== other)
      for (const cb of other.callbacks) cb(known)
    }
    this.onChange()
  }

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
