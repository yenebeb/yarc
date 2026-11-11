// Keeps session cookies (no expiry) across a restart, like Chrome and Arc do when they reopen the
// previous tabs. Electron's network service never writes them to the Cookies database (its
// persist_session_cookies is off and not configurable), so logins that use them are gone after a
// quit: Microsoft/Entra (ESTSAUTH, Teams, Azure), most company portals, any "stay signed in" left
// unticked. We mirror a profile's session cookies from the cookie change events, save them to a
// file in the profile folder, and set them again at the next launch before any tab loads.
// See docs/electron-notes.md section 10.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Cookie, CookiesSetDetails, Session } from 'electron'

/** Turns the saved file's text into bytes and back (safeStorage on Windows and Linux, see SessionCookies). */
export interface Cipher {
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

/** The cookie's identity in the jar: a cookie with the same name, domain and path replaces it. */
export function cookieKey(c: Pick<Cookie, 'name' | 'domain' | 'path'>): string {
  return `${c.name}\n${c.domain ?? ''}\n${c.path ?? '/'}`
}

/** The details that set `c` again as it was: a session cookie, host-only or for the domain and its subdomains. */
export function setDetailsFor(c: Cookie): CookiesSetDetails {
  const domain = c.domain ?? ''
  let host = domain.replace(/^\./, '')
  if (host.includes(':') && !host.startsWith('[')) host = `[${host}]`
  const path = c.path || '/'
  const details: CookiesSetDetails = {
    url: `${c.secure ? 'https' : 'http'}://${host}${path}`,
    name: c.name,
    value: c.value,
    path,
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: c.sameSite
  }
  // Without a domain the cookie is host-only, as __Host- cookies must be.
  if (!c.hostOnly) details.domain = domain
  return details
}

/** A profile's session cookies, kept up to date from the session's cookie change events. */
export class SessionCookieJar {
  private cookies = new Map<string, Cookie>()

  /** One 'changed' event. Returns whether the jar changed. */
  apply(cookie: Cookie, removed: boolean): boolean {
    const key = cookieKey(cookie)
    // A session cookie replaced by one with an expiry is no longer ours to keep.
    if (removed || !cookie.session) return this.cookies.delete(key)
    this.cookies.set(key, cookie)
    return true
  }

  list(): Cookie[] {
    return [...this.cookies.values()]
  }
}

interface SavedFile {
  version: 1
  /** Base64 of the cipher's bytes when encrypted, else the cookies themselves. */
  cookies: Cookie[] | string
}

/** The file's text for `cookies`. */
export function encodeCookies(cookies: Cookie[], cipher?: Cipher): string {
  const file: SavedFile = { version: 1, cookies: cipher ? cipher.encrypt(JSON.stringify(cookies)).toString('base64') : cookies }
  return JSON.stringify(file)
}

/** The cookies in a saved file's text; none if it can't be read (another version, another machine's key). */
export function decodeCookies(text: string, cipher?: Cipher): Cookie[] {
  try {
    const file = JSON.parse(text) as SavedFile
    if (file.version !== 1) return []
    if (typeof file.cookies !== 'string') return Array.isArray(file.cookies) ? file.cookies : []
    if (!cipher) return []
    const cookies = JSON.parse(cipher.decrypt(Buffer.from(file.cookies, 'base64'))) as unknown
    return Array.isArray(cookies) ? (cookies as Cookie[]) : []
  } catch {
    return []
  }
}

/** How long changes wait before they're written, so a page setting many cookies writes once. */
const SAVE_DELAY = 2000

/**
 * Saves `session`'s session cookies to `file` as they change (and at quit), and sets them again
 * with restore(). Never for incognito profiles: their cookies must go when the window closes.
 */
export class SessionCookies {
  private jar = new SessionCookieJar()
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private readonly session: Session
  private readonly file: string
  private readonly cipher: Cipher | undefined
  private readonly onChanged = (_e: unknown, cookie: Cookie, _cause: string, removed: boolean) => {
    if (this.jar.apply(cookie, removed)) this.changed()
  }

  constructor(session: Session, file: string, cipher?: Cipher) {
    this.session = session
    this.file = file
    this.cipher = cipher
    session.cookies.on('changed', this.onChanged)
  }

  /** Sets last run's session cookies again. Call before the profile's pages load. */
  async restore(): Promise<void> {
    if (!existsSync(this.file)) return
    let text = ''
    try {
      text = readFileSync(this.file, 'utf8')
    } catch {
      return
    }
    const saved = decodeCookies(text, this.cipher)
    await Promise.all(
      saved.map(async (c) => {
        try {
          await this.session.cookies.set(setDetailsFor(c))
          // Kept even if the change event comes after a quick quit.
          this.jar.apply({ ...c, session: true }, false)
        } catch {
          // One the network service refuses (an invalid name, say) shouldn't keep the others out.
        }
      })
    )
  }

  /** Writes the cookies now if they changed. Synchronous: it runs as the app quits. */
  save(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.dirty || this.stopped) return
    this.dirty = false
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, encodeCookies(this.jar.list(), this.cipher), { mode: 0o600 })
      renameSync(tmp, this.file)
    } catch (err) {
      console.error('Could not save session cookies', err)
    }
  }

  /** The profile is gone: stop saving and delete the file. */
  forget(): void {
    this.stopped = true
    clearTimeout(this.timer)
    this.session.cookies.off('changed', this.onChanged)
    rmSync(this.file, { force: true })
  }

  private changed(): void {
    this.dirty = true
    if (!this.timer && !this.stopped) this.timer = setTimeout(() => this.save(), SAVE_DELAY)
  }
}
