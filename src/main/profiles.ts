import { app, safeStorage, session, type OnBeforeSendHeadersListenerDetails, type Session, type WebContents } from 'electron'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeFileAtomic } from './atomic-file'
import { History } from './history'
import { PermissionQueue, type MediaType } from './permission-queue'
import { SessionCookies, type Cipher } from './session-cookies'
import { SiteDecisions } from './site-permissions'
import { swipeToNavigate } from './swipe-nav'
import { CHROME_UA_HOSTS, userAgentFor } from './useragent'
import { PERMISSION_KEYS, permissionOrigin } from '../shared/permissions'
import type { ID } from '../shared/types'
import { originOf } from '../shared/url'

export interface ProfileRuntime {
  id: ID
  session: Session
  history: History
}

/** display-capture: a page can only ask after a click, and the screen picker it opens is the user's consent (share-picker.ts). */
const AUTO_GRANT = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'speaker-selection', 'display-capture'])
const PROMPT = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'idle-detection', 'hid', 'serial', 'usb', 'window-management'])

/** Reported "granted" until blocked: Electron's check can't say "ask", and Meet reads "denied" as blocked and never requests. */
const ASK_ON_REQUEST = new Set(['media'])

function crossOrigin(url: string, embedding: string | undefined): boolean {
  if (!embedding) return false
  return originOf(url) !== originOf(embedding)
}

/** Not on macOS: the Keychain would ask for the login password after every update (docs/electron-notes.md section 8). */
function cookieCipher(): Cipher | undefined {
  if (process.platform === 'darwin' || !safeStorage.isEncryptionAvailable()) return undefined
  return { encrypt: (text) => safeStorage.encryptString(text), decrypt: (data) => safeStorage.decryptString(data) }
}

export class Profiles {
  private runtimes = new Map<ID, ProfileRuntime>()
  readonly permissionQueue: PermissionQueue
  private siteDecisions = new Map<ID, SiteDecisions>()
  private watched = new WeakSet<WebContents>()
  private sessionCookies = new Map<ID, SessionCookies>()

  constructor(
    private onCreated: (rt: ProfileRuntime) => void,
    private incognito = false,
    onPermissionsChanged: () => void = () => {}
  ) {
    this.permissionQueue = new PermissionQueue((id) => this.decisions(id), onPermissionsChanged)
  }

  static partition(id: ID): string {
    return `persist:profile-${id}`
  }

  dir(id: ID): string {
    return join(app.getPath('userData'), 'Profiles', id)
  }

  decisions(id: ID): SiteDecisions {
    let d = this.siteDecisions.get(id)
    if (d) return d
    if (this.incognito) d = new SiteDecisions()
    else {
      const file = this.permissionsFile(id)
      let stored: unknown
      try {
        stored = JSON.parse(readFileSync(file, 'utf8'))
      } catch {}
      d = new SiteDecisions(stored, (data) => {
        try {
          mkdirSync(this.dir(id), { recursive: true, mode: 0o700 })
          writeFileAtomic(file, JSON.stringify(data))
        } catch (err) {
          console.error('Saving site permissions failed', err)
        }
      })
    }
    this.siteDecisions.set(id, d)
    return d
  }

  /** False for a setting the settings page can't make. */
  setSitePermission(profileId: ID, origin: string, key: string, setting: 'allow' | 'block' | 'reset'): boolean {
    if (typeof origin !== 'string' || typeof key !== 'string') return false
    const settable = permissionOrigin(origin) === origin && (PERMISSION_KEYS as readonly string[]).includes(key) && ['allow', 'block'].includes(setting)
    if (setting !== 'reset' && !settable) return false
    const decisions = this.decisions(profileId)
    if (setting === 'reset') decisions.reset(origin, key)
    else decisions.set(origin, key, setting)
    this.permissionQueue.settle()
    return true
  }

  private permissionsFile(id: ID): string {
    return join(this.dir(id), 'permissions.json')
  }

  /** Before its pages load. */
  async restoreSessionCookies(ids: ID[]): Promise<void> {
    if (this.incognito) return
    await Promise.all(ids.map((id) => this.keepSessionCookies(id).restore()))
  }

  private keepSessionCookies(id: ID): SessionCookies {
    let kept = this.sessionCookies.get(id)
    if (!kept) {
      kept = new SessionCookies(session.fromPartition(Profiles.partition(id)), join(this.dir(id), 'session-cookies.json'), cookieCipher())
      this.sessionCookies.set(id, kept)
    }
    return kept
  }

  get(id: ID): ProfileRuntime {
    let rt = this.runtimes.get(id)
    if (rt) return rt
    const ses = session.fromPartition(this.incognito ? `incognito-${id}` : Profiles.partition(id))
    if (!this.incognito) this.keepSessionCookies(id)
    ses.setUserAgent(app.userAgentFallback)
    listenBeforeSendHeaders(ses)
    swipeToNavigate(ses)
    ses.setSpellCheckerLanguages(app.getPreferredSystemLanguages().slice(0, 3).filter((l) => ses.availableSpellCheckerLanguages.includes(l)))
    this.permissions(ses, id)
    rt = { id, session: ses, history: new History(this.incognito ? undefined : this.dir(id)) }
    this.runtimes.set(id, rt)
    this.onCreated(rt)
    return rt
  }

  all(): ProfileRuntime[] {
    return [...this.runtimes.values()]
  }

  /** Its folders go at the next launch (purgeDeleted), when no session has them open. */
  async remove(id: ID): Promise<void> {
    this.siteDecisions.delete(id)
    const rt = this.runtimes.get(id)
    rt?.history.close()
    this.runtimes.delete(id)
    if (this.incognito) return void (await rt?.session.clearData())
    rmSync(this.permissionsFile(id), { force: true })
    this.keepSessionCookies(id).forget()
    this.sessionCookies.delete(id)
    Profiles.markDeleted(id)
    await (rt?.session ?? session.fromPartition(Profiles.partition(id))).clearData()
  }

  private static deletedFile(): string {
    return join(app.getPath('userData'), 'Profiles', 'deleted.json')
  }

  private static markDeleted(id: ID): void {
    const file = Profiles.deletedFile()
    let ids: string[] = []
    try {
      const stored: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (Array.isArray(stored)) ids = stored.filter((x): x is string => typeof x === 'string')
    } catch {}
    try {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      writeFileSync(file, JSON.stringify([...new Set([...ids, id])]), { mode: 0o600 })
    } catch (err) {
      console.error('[profiles] could not note the deleted profile', err)
    }
  }

  /** At launch, before any session. */
  static purgeDeleted(): void {
    const file = Profiles.deletedFile()
    let ids: unknown
    try {
      ids = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return
    }
    const userData = app.getPath('userData')
    for (const id of Array.isArray(ids) ? ids : []) {
      if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) continue
      rmSync(join(userData, 'Partitions', `profile-${id}`), { recursive: true, force: true })
      rmSync(join(userData, 'Profiles', id), { recursive: true, force: true })
    }
    rmSync(file, { force: true })
  }

  closeAll(): void {
    for (const rt of this.runtimes.values()) rt.history.close()
    for (const kept of this.sessionCookies.values()) kept.save()
  }

  private permissions(ses: Session, profileId: ID): void {
    // A frame's permission is the top-level page's: the prompt names the site the user is on (a frame still needs the page's `allow`).
    ses.setPermissionCheckHandler((wc, permission, origin, details) => {
      if (AUTO_GRANT.has(permission)) return true
      if (permission === 'notifications' && crossOrigin(origin, (details as { embeddingOrigin?: string }).embeddingOrigin)) return false
      const top = permissionOrigin(wc && !details.isMainFrame ? wc.getURL() : origin)
      if (!top) return false
      const type = (details as { mediaType?: string }).mediaType
      const media = type === 'video' || type === 'audio' ? [type as MediaType] : undefined
      return this.permissionQueue.decided(profileId, top, permission, media) ?? ASK_ON_REQUEST.has(permission)
    })
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (AUTO_GRANT.has(permission)) return callback(true)
      if (!PROMPT.has(permission) || !wc) return callback(false)
      // Meet inside Gmail would otherwise ask on every launch.
      if (permission === 'notifications' && !details.isMainFrame && crossOrigin(details.requestingUrl, wc.getURL())) return callback(false)
      const top = permissionOrigin(details.isMainFrame ? details.requestingUrl : wc.getURL())
      if (!top) return callback(false)
      const requested = (details as { mediaTypes?: string[] }).mediaTypes ?? []
      const mediaTypes = requested.filter((t): t is MediaType => t === 'video' || t === 'audio')
      this.cancelRequestsOnLeave(wc)
      this.permissionQueue.request({ profileId, wcId: wc.id, origin: top, permission, mediaTypes: permission === 'media' ? mediaTypes : undefined }, callback)
    })
  }

  private cancelRequestsOnLeave(wc: WebContents): void {
    if (this.watched.has(wc)) return
    this.watched.add(wc)
    const id = wc.id
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.permissionQueue.cancel(id)
    })
    wc.once('destroyed', () => this.permissionQueue.cancel(id))
  }
}

type HeaderRewrite = (details: OnBeforeSendHeadersListenerDetails, headers: Record<string, string>) => Record<string, string> | undefined

/** A session has one onBeforeSendHeaders listener: Teams' UA, plus extensions' header rules while they have any (they cost every request a trip to main). */
export function listenBeforeSendHeaders(ses: Session, extensions?: HeaderRewrite): void {
  const urls = extensions ? ['<all_urls>'] : CHROME_UA_HOSTS.map((host) => `*://${host}/*`)
  ses.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    const headers = { ...details.requestHeaders, 'User-Agent': userAgentFor(details.url, app.userAgentFallback) }
    callback({ requestHeaders: extensions?.(details, headers) ?? headers })
  })
}
