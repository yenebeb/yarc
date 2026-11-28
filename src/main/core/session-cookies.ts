// Electron never writes session cookies to the Cookies database, so Microsoft/Entra logins were gone after a quit (docs/electron-notes.md section 10).
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Cookie, CookiesSetDetails, Session } from 'electron'
import { writeFileAtomic } from './atomic-file.ts'

export interface Cipher {
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

export function cookieKey(c: Pick<Cookie, 'name' | 'domain' | 'path'>): string {
  return `${c.name}\n${c.domain ?? ''}\n${c.path ?? '/'}`
}

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

export class SessionCookieJar {
  private cookies = new Map<string, Cookie>()

  /** Returns whether the jar changed. */
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
  /** Base64 when encrypted. */
  cookies: Cookie[] | string
}

export function encodeCookies(cookies: Cookie[], cipher?: Cipher): string {
  const file: SavedFile = { version: 1, cookies: cipher ? cipher.encrypt(JSON.stringify(cookies)).toString('base64') : cookies }
  return JSON.stringify(file)
}

/** None if it can't be read (another version, another machine's key). */
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

const SAVE_DELAY = 2000

/** Never for incognito profiles: their cookies must go when the window closes. */
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

  /** Call before the profile's pages load. */
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
        } catch {}
      })
    )
  }

  /** Synchronous: it runs as the app quits. */
  save(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.dirty || this.stopped) return
    this.dirty = false
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileAtomic(this.file, encodeCookies(this.jar.list(), this.cipher))
    } catch (err) {
      console.error('Could not save session cookies', err)
    }
  }

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
