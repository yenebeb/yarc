import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { SignedOutError } from './remote.ts'

export interface OAuthApp {
  authorizeUrl: string
  tokenUrl: string
  clientId: string
  /** Google requires one from installed apps too, though it can't be kept secret there and isn't treated as one. */
  clientSecret?: string
  scope: string
  extra?: Record<string, string>
}

/** Registered with every provider as the redirect address. */
export const REDIRECT_PORT = 47392
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`
const SIGN_IN_TIMEOUT = 10 * 60_000
const TIMEOUT = 60_000

export interface SignedIn {
  refreshToken: string
  email?: string
}

export async function signIn(app: OAuthApp, open: (url: string) => void, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<SignedIn> {
  const verifier = randomBytes(32).toString('base64url')
  const state = randomBytes(16).toString('base64url')
  const url = new URL(app.authorizeUrl)
  const params = {
    client_id: app.clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: app.scope,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    ...app.extra
  }
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  const code = await waitForRedirect(state, () => open(url.href), signal)
  const tokens = await tokenRequest(app, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier }, fetchImpl)
  if (!tokens.refresh_token) throw new Error('The sign-in didn’t give YARC lasting access. Try again.')
  return { refreshToken: tokens.refresh_token, email: emailIn(tokens.id_token) }
}

export class OAuthSession {
  private readonly app: OAuthApp
  private readonly fetchImpl: typeof fetch
  private readonly onRefreshToken: (token: string) => void
  private refreshToken: string
  private accessToken = ''
  private expiresAt = 0

  /** `onRefreshToken`: the provider replaced the refresh token (Microsoft does on every refresh); save the new one. */
  constructor(app: OAuthApp, refreshToken: string, onRefreshToken: (token: string) => void, fetchImpl: typeof fetch = fetch) {
    this.app = app
    this.refreshToken = refreshToken
    this.onRefreshToken = onRefreshToken
    this.fetchImpl = fetchImpl
  }

  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    if (Date.now() > this.expiresAt - 60_000) await this.refresh()
    let response = await this.send(url, init)
    if (response.status === 401) {
      await this.refresh()
      response = await this.send(url, init)
      if (response.status === 401) throw new SignedOutError('The cloud drive refused YARC’s sign-in.')
    }
    return response
  }

  private send(url: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${this.accessToken}` }, signal: AbortSignal.timeout(TIMEOUT) })
  }

  private async refresh(): Promise<void> {
    const tokens = await tokenRequest(this.app, { grant_type: 'refresh_token', refresh_token: this.refreshToken }, this.fetchImpl)
    this.accessToken = tokens.access_token
    this.expiresAt = expiry(tokens)
    if (tokens.refresh_token && tokens.refresh_token !== this.refreshToken) {
      this.refreshToken = tokens.refresh_token
      this.onRefreshToken(tokens.refresh_token)
    }
  }
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  id_token?: string
}

async function tokenRequest(app: OAuthApp, grant: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const body = new URLSearchParams({ client_id: app.clientId, ...grant })
  if (app.clientSecret) body.set('client_secret', app.clientSecret)
  const response = await fetchImpl(app.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(TIMEOUT)
  })
  const json = (await response.json().catch(() => ({}))) as TokenResponse & { error?: string; error_description?: string }
  // invalid_grant: the refresh token was revoked or expired (password changed, access removed in the account's settings).
  if (json.error === 'invalid_grant') throw new SignedOutError('The cloud drive signed YARC out.')
  if (!response.ok || !json.access_token) throw new Error(`Sign-in failed: ${json.error_description ?? json.error ?? response.status}`)
  return json
}

function expiry(tokens: TokenResponse): number {
  return Date.now() + (tokens.expires_in ?? 3600) * 1000
}

/** The email claim of an ID token. Read, not verified: it came straight from the provider over TLS and is only shown. */
function emailIn(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined
  try {
    const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'))
    return claims.email ?? claims.preferred_username
  } catch {
    return undefined
  }
}

/** Listens on localhost (IPv4 and IPv6: browsers pick either) until the browser comes back with the code. */
function waitForRedirect(state: string, ready: () => void, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const servers: Server[] = []
    const finish = (error: Error | undefined, code?: string) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      for (const server of servers) server.close()
      if (error) reject(error)
      else resolve(code!)
    }
    const onAbort = () => finish(new Error('Sign-in cancelled.'))
    const timer = setTimeout(() => finish(new Error('Sign-in took too long. Try again.')), SIGN_IN_TIMEOUT)
    signal.addEventListener('abort', onAbort)
    const handle = (url: URL): { page: string; result?: [Error | undefined, string?] } => {
      if (url.pathname !== '/callback' || url.searchParams.get('state') !== state) return { page: 'Nothing to see here.' }
      const code = url.searchParams.get('code')
      if (code) return { page: 'You’re signed in. You can close this tab and go back to YARC.', result: [undefined, code] }
      const denied = url.searchParams.get('error') === 'access_denied'
      return { page: 'YARC wasn’t given access. You can close this tab.', result: [new Error(denied ? 'Access wasn’t given, so nothing syncs.' : `Sign-in failed: ${url.searchParams.get('error')}`)] }
    }
    let listening = 0
    let failed = 0
    for (const host of ['127.0.0.1', '::1']) {
      const server = createServer((request, response) => {
        const { page, result } = handle(new URL(request.url ?? '/', REDIRECT_URI))
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
        response.end(`<!doctype html><meta charset="utf-8"><title>YARC</title><body style="font:16px system-ui;padding:48px;text-align:center">${page}</body>`)
        if (result) finish(...result)
      })
      servers.push(server)
      server.on('error', () => {
        if (++failed === 2) finish(new Error(`Another app is using port ${REDIRECT_PORT}, which signing in needs. Close it and try again.`))
        else if (failed + listening === 2) ready()
      })
      server.listen(REDIRECT_PORT, host, () => {
        if (++listening + failed === 2) ready()
      })
    }
  })
}
