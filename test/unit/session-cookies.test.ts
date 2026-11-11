import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import type { Cookie, CookiesSetDetails, Session } from 'electron'
import { decodeCookies, encodeCookies, SessionCookieJar, SessionCookies, setDetailsFor, type Cipher } from '../../src/main/session-cookies.ts'

/** Microsoft's sign-in cookie: no expiry, so Electron drops it at quit. */
const signIn: Cookie = { name: 'ESTSAUTH', value: 'token-1', domain: '.login.microsoftonline.com', path: '/', hostOnly: false, secure: true, httpOnly: true, session: true, sameSite: 'no_restriction' }
/** A cookie with an expiry: the Cookies database keeps it already. */
const remembered: Cookie = { name: 'SID', value: 'sid-1', domain: '.google.com', path: '/', hostOnly: false, secure: true, httpOnly: true, session: false, expirationDate: 2_000_000_000, sameSite: 'unspecified' }
/** A portal's login, only for its own host. */
const portal: Cookie = { name: '__Host-session', value: 'p-1', domain: 'portal.example.com', path: '/', hostOnly: true, secure: true, httpOnly: true, session: true, sameSite: 'lax' }

describe('which cookies are kept', () => {
  test('session cookies are kept; cookies with an expiry are left to the Cookies database', () => {
    const jar = new SessionCookieJar()
    jar.apply(signIn, false)
    jar.apply(remembered, false)
    assert.deepEqual(jar.list(), [signIn])
  })

  test('a new value replaces the old one', () => {
    const jar = new SessionCookieJar()
    jar.apply(signIn, false)
    jar.apply({ ...signIn, value: 'token-2' }, false)
    assert.deepEqual(jar.list().map((c) => c.value), ['token-2'])
  })

  test('signing out (the site removes the cookie) forgets it', () => {
    const jar = new SessionCookieJar()
    jar.apply(signIn, false)
    jar.apply(signIn, true)
    assert.deepEqual(jar.list(), [])
  })

  test('a session cookie the site replaces with a lasting one is no longer kept', () => {
    const jar = new SessionCookieJar()
    jar.apply(signIn, false)
    jar.apply({ ...signIn, session: false, expirationDate: 2_000_000_000 }, false)
    assert.deepEqual(jar.list(), [])
  })

  test('the same name on another domain or path is another cookie', () => {
    const jar = new SessionCookieJar()
    jar.apply(signIn, false)
    jar.apply({ ...signIn, domain: '.login.live.com' }, false)
    jar.apply({ ...signIn, path: '/common' }, false)
    assert.equal(jar.list().length, 3)
  })
})

describe('setting a saved cookie again', () => {
  test('a domain cookie comes back for the domain and its subdomains', () => {
    assert.deepEqual(setDetailsFor(signIn), {
      url: 'https://login.microsoftonline.com/',
      name: 'ESTSAUTH',
      value: 'token-1',
      domain: '.login.microsoftonline.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'no_restriction'
    })
  })

  test('a host-only cookie comes back without a domain, as __Host- cookies require', () => {
    const details = setDetailsFor(portal)
    assert.equal(details.domain, undefined)
    assert.equal(details.url, 'https://portal.example.com/')
  })

  test('a cookie that isn\'t secure is set from an http address, under its own path', () => {
    const details = setDetailsFor({ ...portal, name: 'app', secure: false, path: '/app' })
    assert.equal(details.url, 'http://portal.example.com/app')
    assert.equal(details.path, '/app')
  })

  test('an IPv6 host gets its brackets', () => {
    assert.equal(setDetailsFor({ ...portal, domain: '::1' }).url, 'https://[::1]/')
  })
})

describe('the saved file', () => {
  /** Stands in for safeStorage: reversible, and not plain text. */
  const cipher: Cipher = {
    encrypt: (text) => Buffer.from(text.split('').reverse().join('')),
    decrypt: (data) => data.toString().split('').reverse().join('')
  }

  test('cookies come back as they were saved', () => {
    assert.deepEqual(decodeCookies(encodeCookies([signIn, portal])), [signIn, portal])
  })

  test('encrypted (Windows, Linux), the cookie values are not in the file', () => {
    const text = encodeCookies([signIn], cipher)
    assert.ok(!text.includes('token-1'))
    assert.deepEqual(decodeCookies(text, cipher), [signIn])
  })

  test('an encrypted file without the key, or a damaged one, restores nothing', () => {
    assert.deepEqual(decodeCookies(encodeCookies([signIn], cipher)), [])
    assert.deepEqual(decodeCookies('{"version":1,"cookies":[{"na'), [])
    assert.deepEqual(decodeCookies('{"version":2,"cookies":[]}'), [])
  })
})

describe('across a restart', () => {
  /** A session's cookie store: records what's set, and lets the test fire change events. */
  function fakeSession() {
    const set: CookiesSetDetails[] = []
    let listener: ((e: unknown, c: Cookie, cause: string, removed: boolean) => void) | undefined
    const cookies = {
      on: (_event: string, fn: typeof listener) => void (listener = fn),
      off: () => void (listener = undefined),
      set: async (details: CookiesSetDetails) => {
        if (details.name === 'refused') throw new Error('invalid')
        set.push(details)
      }
    }
    const change = (c: Cookie, removed = false) => listener?.({}, c, removed ? 'explicit' : 'inserted', removed)
    return { session: { cookies } as unknown as Session, set, change, listening: () => !!listener }
  }
  const tempFile = () => join(mkdtempSync(join(tmpdir(), 'yarc-cookies-')), 'Profiles', 'p1', 'session-cookies.json')

  test('the session cookies saved at quit are set again at the next launch', async () => {
    const file = tempFile()
    const first = fakeSession()
    const before = new SessionCookies(first.session, file)
    first.change(signIn)
    first.change(remembered)
    before.save()

    const second = fakeSession()
    await new SessionCookies(second.session, file).restore()
    assert.deepEqual(second.set.map((d) => d.name), ['ESTSAUTH'])
  })

  test('only its owner can read the file', () => {
    const file = tempFile()
    const s = fakeSession()
    const kept = new SessionCookies(s.session, file)
    s.change(signIn)
    kept.save()
    assert.equal(statSync(file).mode & 0o777, 0o600)
  })

  test('restored cookies are saved again at the next quit, even before their change events arrive', async () => {
    const file = tempFile()
    const first = fakeSession()
    const run1 = new SessionCookies(first.session, file)
    first.change(signIn)
    run1.save()

    const second = fakeSession()
    const run2 = new SessionCookies(second.session, file)
    await run2.restore()
    second.change(portal)
    run2.save()
    assert.deepEqual(decodeCookies(readFileSync(file, 'utf8')).map((c) => c.name).sort(), ['ESTSAUTH', '__Host-session'])
  })

  test('one cookie the store refuses doesn\'t keep the others out', async () => {
    const file = tempFile()
    const first = fakeSession()
    const kept = new SessionCookies(first.session, file)
    first.change({ ...portal, name: 'refused' })
    first.change(signIn)
    kept.save()

    const second = fakeSession()
    await new SessionCookies(second.session, file).restore()
    assert.deepEqual(second.set.map((d) => d.name), ['ESTSAUTH'])
  })

  test('a removed profile stops saving and its file is deleted', async () => {
    const file = tempFile()
    const s = fakeSession()
    const kept = new SessionCookies(s.session, file)
    s.change(signIn)
    kept.save()
    kept.forget()
    assert.equal(s.listening(), false)

    const next = fakeSession()
    await new SessionCookies(next.session, file).restore()
    assert.deepEqual(next.set, [])
  })

  test('a first launch has nothing to restore', async () => {
    const s = fakeSession()
    await new SessionCookies(s.session, tempFile()).restore()
    assert.deepEqual(s.set, [])
  })
})
