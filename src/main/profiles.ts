// One Electron session per profile: separate cookies, storage, cache, extensions and history.
import { app, safeStorage, session, type Session, type WebContents } from 'electron'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { History } from './history'
import { PermissionQueue, type MediaType } from './permission-queue'
import { SessionCookies, type Cipher } from './session-cookies'
import { SiteDecisions } from './site-permissions'
import { CHROME_UA_HOSTS, userAgentFor } from './useragent'
import type { ID } from '../shared/types'

export interface ProfileRuntime {
  id: ID
  session: Session
  history: History
}

/** Permissions granted without asking. Those in PROMPT ask the user (PermissionQueue), who answers per profile (SiteDecisions). */
const AUTO_GRANT = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'window-management', 'speaker-selection'])
const PROMPT = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'display-capture', 'idle-detection', 'hid', 'serial', 'usb'])

/**
 * Prompted permissions that report "granted" until the user blocks them. Electron's check handler
 * can only say granted or denied, not "ask". Sites like Google Meet read "denied" as blocked and
 * never request access. Each request still goes through the prompt.
 */
const ASK_ON_REQUEST = new Set(['media'])

/** "https://meet.google.com", whether Electron hands over an origin ("…/") or a URL. */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/** Whether a frame's URL is from another origin than the page embedding it (unknown = no). */
function crossOrigin(url: string, embedding: string | undefined): boolean {
  if (!embedding) return false
  return originOf(url) !== originOf(embedding)
}

/**
 * Saved session cookies are encrypted where the Cookies database is (Windows and Linux, the
 * EnableCookieEncryption fuse). On macOS neither is: the Keychain would ask for the login password
 * after every update (docs/electron-notes.md section 8).
 */
function cookieCipher(): Cipher | undefined {
  if (process.platform === 'darwin' || !safeStorage.isEncryptionAvailable()) return undefined
  return { encrypt: (text) => safeStorage.encryptString(text), decrypt: (data) => safeStorage.decryptString(data) }
}

export class Profiles {
  private runtimes = new Map<ID, ProfileRuntime>()
  /** Requests waiting for the user. The browser draws the prompt. */
  readonly permissionQueue: PermissionQueue
  /** Each profile's answers, loaded on first use; incognito ones stay in memory. */
  private siteDecisions = new Map<ID, SiteDecisions>()
  private watched = new WeakSet<WebContents>()
  /** Session cookies saved across restarts, per profile (none for incognito). */
  private sessionCookies = new Map<ID, SessionCookies>()

  /** Incognito profiles keep nothing on disk: an in-memory session and history. */
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

  /** The profile's answers to permission prompts, kept in Profiles/<id>/permissions.json. */
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
          mkdirSync(this.dir(id), { recursive: true })
          writeFileSync(`${file}.tmp`, JSON.stringify(data))
          renameSync(`${file}.tmp`, file)
        } catch (err) {
          console.error('Saving site permissions failed', err)
        }
      })
    }
    this.siteDecisions.set(id, d)
    return d
  }

  private permissionsFile(id: ID): string {
    return join(this.dir(id), 'permissions.json')
  }

  /**
   * Sets each profile's session cookies from the last run again, before its pages load. They're
   * saved from then on, also for profiles created later (get()).
   */
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
    // A partition without "persist:" stays in memory.
    const ses = session.fromPartition(this.incognito ? `incognito-${id}` : Profiles.partition(id))
    if (!this.incognito) this.keepSessionCookies(id)
    ses.setUserAgent(app.userAgentFallback)
    ses.webRequest.onBeforeSendHeaders({ urls: CHROME_UA_HOSTS.map((host) => `*://${host}/*`) }, (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, 'User-Agent': userAgentFor(details.url, app.userAgentFallback) } })
    })
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

  async remove(id: ID): Promise<void> {
    this.siteDecisions.delete(id)
    if (!this.incognito) rmSync(this.permissionsFile(id), { force: true })
    const rt = this.runtimes.get(id)
    if (!rt) return
    rt.history.close()
    this.sessionCookies.get(id)?.forget()
    this.sessionCookies.delete(id)
    await rt.session.clearData()
    this.runtimes.delete(id)
  }

  closeAll(): void {
    for (const rt of this.runtimes.values()) rt.history.close()
    for (const kept of this.sessionCookies.values()) kept.save()
  }

  private permissions(ses: Session, profileId: ID): void {
    ses.setPermissionCheckHandler((_wc, permission, origin, details) => {
      if (AUTO_GRANT.has(permission)) return true
      if (permission === 'notifications' && crossOrigin(origin, (details as { embeddingOrigin?: string }).embeddingOrigin)) return false
      const type = (details as { mediaType?: string }).mediaType
      const media = type === 'video' || type === 'audio' ? [type as MediaType] : undefined
      return this.permissionQueue.decided(profileId, originOf(origin), permission, media) ?? ASK_ON_REQUEST.has(permission)
    })
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (AUTO_GRANT.has(permission)) return callback(true)
      if (!PROMPT.has(permission) || !wc) return callback(false)
      // Like Chrome, a frame from another site can't ask for notifications: Meet inside Gmail
      // would otherwise ask on every launch.
      if (permission === 'notifications' && !details.isMainFrame && crossOrigin(details.requestingUrl, wc.getURL())) return callback(false)
      const requested = (details as { mediaTypes?: string[] }).mediaTypes ?? []
      const mediaTypes = requested.filter((t): t is MediaType => t === 'video' || t === 'audio')
      this.watch(wc)
      this.permissionQueue.request(
        { profileId, wcId: wc.id, origin: originOf(details.requestingUrl), permission, mediaTypes: permission === 'media' ? mediaTypes : undefined },
        callback
      )
    })
  }

  /** A page's open questions end when it goes to another page or closes. */
  private watch(wc: WebContents): void {
    if (this.watched.has(wc)) return
    this.watched.add(wc)
    const id = wc.id
    wc.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.permissionQueue.cancel(id)
    })
    wc.once('destroyed', () => this.permissionQueue.cancel(id))
  }
}
