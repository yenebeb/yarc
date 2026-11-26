import { expect, test } from '@playwright/test'
import { createSocket } from 'node:dgram'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { unlockHeader, type Keyring } from '../../src/main/sync/crypto.ts'
import { newSyncId, readHeader, writeAtomic } from '../../src/main/sync/engine.ts'
import { chunkContext, decodeChunk, encodeChunk } from '../../src/main/sync/log.ts'
import type { HistorySyncStatus, SyncRecord } from '../../src/shared/sync'
import { app, base, dispatch, pageWithUrl, restart, state, useApp } from './app'

useApp()

const SERVER_USER = 'yarc-test'
const SERVER_PASSWORD = 'only-for-this-test-server'
const SYNC_PASSWORD = 'correct horse battery staple'
const NEARBY_BEACON_PORT = 47391

const scratch = mkdtempSync(join(tmpdir(), 'yarc-e2e-sync-'))
const serverFolder = join(scratch, 'dav')
const serverSyncFolder = join(serverFolder, 'YARC Sync')
const localSyncFolder = join(scratch, 'synced-folder')
let server: Server
let serverUrl = ''

const bodyOf = async (request: IncomingMessage): Promise<Buffer> => {
  const pieces: Buffer[] = []
  for await (const piece of request) pieces.push(piece as Buffer)
  return Buffer.concat(pieces)
}

const davEntry = (href: string, file: string): string => {
  const info = statSync(file)
  const folder = info.isDirectory()
  return (
    `<d:response><d:href>${encodeURI(folder && !href.endsWith('/') ? `${href}/` : href)}</d:href><d:propstat><d:prop>` +
    `<d:resourcetype>${folder ? '<d:collection/>' : ''}</d:resourcetype><d:getetag>"${info.mtimeMs}-${info.size}"</d:getetag>` +
    `</d:prop></d:propstat></d:response>`
  )
}

/** A WebDAV server over a folder: just what a sync store asks of one. */
async function startWebDavServer(): Promise<void> {
  mkdirSync(serverFolder, { recursive: true })
  const signedIn = `Basic ${Buffer.from(`${SERVER_USER}:${SERVER_PASSWORD}`).toString('base64')}`
  server = createServer(async (request, response) => {
    const answer = (status: number, body: string | Buffer = '') => response.writeHead(status).end(body)
    if (request.headers.authorization !== signedIn) return answer(401)
    const href = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    const file = join(scratch, href)
    const there = existsSync(file)
    switch (request.method) {
      case 'PROPFIND': {
        if (!there) return answer(404)
        const children = request.headers.depth !== '0' && statSync(file).isDirectory() ? readdirSync(file) : []
        const entries = [davEntry(href, file), ...children.map((name) => davEntry(`${href.replace(/\/$/, '')}/${name}`, join(file, name)))]
        return answer(207, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${entries.join('')}</d:multistatus>`)
      }
      case 'MKCOL':
        if (there) return answer(405)
        if (!existsSync(dirname(file))) return answer(409)
        mkdirSync(file)
        return answer(201)
      case 'PUT':
        if (!existsSync(dirname(file))) return answer(409)
        writeFileSync(file, await bodyOf(request))
        return answer(201)
      case 'GET':
        return there ? answer(200, readFileSync(file)) : answer(404)
      case 'DELETE':
        if (!there) return answer(404)
        rmSync(file, { recursive: true })
        return answer(204)
      default:
        return answer(405)
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/dav/`
}

test.beforeAll(startWebDavServer)
test.afterAll(() => {
  server?.closeAllConnections()
  server?.close()
  rmSync(scratch, { recursive: true, force: true })
})

const sync = async (): Promise<HistorySyncStatus> => (await state()).historySync
const syncState = async () => (await sync()).state
const syncNow = () => app.evaluate(() => (globalThis as any).arcBrowser.historySync.passSoon())
const historyHere = () =>
  app.evaluate(() => {
    const browser = (globalThis as any).arcBrowser
    return browser.profiles.history(browser.space.profileId).recent(100).map((visit: { url: string }) => visit.url) as string[]
  })
const syncKeyOfThisProfile = async () => {
  const current = await state()
  const profileId = current.spaces.find((candidate) => candidate.id === current.activeSpaceId)!.profileId
  return current.profiles.find((profile) => profile.id === profileId)!.syncKey!
}

const filesIn = (folder: string): string[] =>
  existsSync(folder) ? readdirSync(folder, { recursive: true, encoding: 'utf8' }).filter((path) => statSync(join(folder, path)).isFile()) : []

const keyringOf = async (syncFolder: string): Promise<Keyring> => (await unlockHeader((await readHeader(syncFolder))!, SYNC_PASSWORD)).keyring

/** Every history record in a sync folder, read the way another computer with the password would. */
async function recordsIn(syncFolder: string): Promise<SyncRecord[]> {
  const keyring = await keyringOf(syncFolder)
  return filesIn(join(syncFolder, 'history')).flatMap((path) => {
    const [profileKey, device] = path.split(/[\\/]/)
    return decodeChunk(readFileSync(join(syncFolder, 'history', path)), keyring, chunkContext(profileKey, device)).records
  })
}

async function fillServerForm(overlay: Awaited<ReturnType<typeof pageWithUrl>>, serverPassword: string): Promise<void> {
  // A refused password is answered so fast that the form may never leave the screen.
  const formIsOpen = (await overlay.getByLabel('Server address').count()) > 0
  if (!formIsOpen) await overlay.locator('.set-row', { hasText: 'Your own server' }).click()
  await overlay.getByLabel('Server address').fill(serverUrl)
  await overlay.getByLabel('Server user name').fill(SERVER_USER)
  await overlay.getByLabel('Server password').fill(serverPassword)
  await overlay.locator('button', { hasText: 'Connect' }).click()
}

test('your own server: set up in Settings, and only encrypted files reach it', async () => {
  await dispatch({ type: 'overlay', mode: { kind: 'settings', section: 'sync' } })
  const overlay = await pageWithUrl('overlay.html')
  await expect(overlay.locator('.set-row', { hasText: 'Your own server' })).toHaveCount(1)
  await expect(overlay.locator('.set-row-title', { hasText: 'Google Drive' }), 'a drive this build can’t sign in to isn’t offered').toHaveCount(0)

  await fillServerForm(overlay, 'not the server password')
  await expect(overlay.locator('.set-note.warn')).toContainText('refused the user name or password')
  expect(await syncState()).toBe('off')

  await fillServerForm(overlay, SERVER_PASSWORD)
  await expect(overlay.getByText('No YARC sync there yet')).toHaveCount(1)
  await expect(overlay.locator('button', { hasText: 'Turn On Sync' }), 'an empty password has to be asked for').toBeDisabled()
  await overlay.getByLabel('Sync password', { exact: true }).fill(SYNC_PASSWORD)
  await overlay.getByLabel('Sync password again').fill(SYNC_PASSWORD)
  await overlay.locator('button', { hasText: 'Turn On Sync' }).click()
  await expect.poll(syncState).toBe('on')
  await expect(overlay.locator('.set-status.ok', { hasText: 'History is syncing' })).toHaveCount(1)
  await dispatch({ type: 'overlay', mode: { kind: 'none' } })

  await dispatch({ type: 'open', url: `${base}/secret-recipe`, where: 'tab' })
  await expect.poll(historyHere).toContain(`${base}/secret-recipe`)
  await syncNow()
  await expect.poll(() => filesIn(join(serverSyncFolder, 'history')).length).toBeGreaterThan(0)

  const onServer = filesIn(serverSyncFolder)
  expect(onServer).toContain('sync.json')
  for (const path of onServer) {
    expect(path, 'file names say nothing').toMatch(/^(sync\.json|(profiles|history)([\\/][0-9a-f]{16,64})+)$/)
    expect(readFileSync(join(serverSyncFolder, path)).includes('secret-recipe'), `${path} is readable without the password`).toBe(false)
  }
  const urls = (await recordsIn(serverSyncFolder)).flatMap((record) => (record.kind === 'visit' ? [record.url] : []))
  expect(urls).toContain(`${base}/secret-recipe`)
})

test('a visit made on another computer arrives through the server', async () => {
  const otherComputer = newSyncId()
  const profileKey = await syncKeyOfThisProfile()
  const visit: SyncRecord = { kind: 'visit', seq: 1, url: 'https://example.com/from-the-laptop', title: 'From the laptop', time: Date.now() }
  writeAtomic(
    join(serverSyncFolder, 'history', profileKey, otherComputer, newSyncId()),
    encodeChunk({ first: 1, last: 1, records: [visit] }, await keyringOf(serverSyncFolder), chunkContext(profileKey, otherComputer))
  )
  await syncNow()
  await expect.poll(historyHere).toContain('https://example.com/from-the-laptop')
})

test('sync carries on after a restart without asking for either password', async () => {
  await restart()
  await expect.poll(syncState).toBe('on')
  const status = await sync()
  expect(status.state === 'on' && status.location.kind).toBe('server')
})

test('a synced folder: a wrong password joins nothing, and a sync.json that goes missing only pauses sync', async () => {
  await dispatch({ type: 'syncOff' })
  await expect.poll(syncState).toBe('off')
  mkdirSync(localSyncFolder)
  const chooseFolder = () => app.evaluate((_electron, folder) => (globalThis as any).arcBrowser.historySync.setUpFolder(folder), localSyncFolder)

  await chooseFolder()
  await dispatch({ type: 'syncConnect', password: SYNC_PASSWORD })
  await expect.poll(syncState).toBe('on')
  await dispatch({ type: 'syncOff' })

  await chooseFolder()
  expect(await sync()).toMatchObject({ state: 'setup', existing: true })
  await dispatch({ type: 'syncConnect', password: 'not the sync password' })
  expect(await sync()).toMatchObject({ state: 'setup', error: 'Wrong password. Nothing was synced.' })
  await dispatch({ type: 'syncConnect', password: SYNC_PASSWORD })
  await expect.poll(syncState).toBe('on')

  // As when iCloud Drive evicts the file, or the drive it's on is unplugged.
  renameSync(join(localSyncFolder, 'sync.json'), join(localSyncFolder, 'sync.json.away'))
  await syncNow()
  await expect.poll(sync).toMatchObject({ state: 'locked', reason: 'missing-folder' })
  await dispatch({ type: 'overlay', mode: { kind: 'settings', section: 'sync' } })
  const overlay = await pageWithUrl('overlay.html')
  await expect(overlay.locator('.set-status.paused')).toContainText('Sync resumes once it’s back')
  await expect(overlay.getByLabel('Sync password', { exact: true })).toHaveCount(0)
  await dispatch({ type: 'overlay', mode: { kind: 'none' } })

  renameSync(join(localSyncFolder, 'sync.json.away'), join(localSyncFolder, 'sync.json'))
  // The app retries by itself once a minute; don't wait for that here.
  await app.evaluate(() => (globalThis as any).arcBrowser.historySync.restoreThenPass(() => true))
  await expect.poll(syncState).toBe('on')
})

test('a forgotten password: starting over replaces the sync kept in the folder, and history is sent again', async () => {
  const before = (await readHeader(localSyncFolder))!.folderId
  await dispatch({ type: 'syncOff' })
  await app.evaluate((_electron, folder) => (globalThis as any).arcBrowser.historySync.setUpFolder(folder), localSyncFolder)
  await dispatch({ type: 'overlay', mode: { kind: 'settings', section: 'sync' } })
  const overlay = await pageWithUrl('overlay.html')
  await expect(overlay.locator('.set-callout')).toContainText('A sync was found in the sync folder')
  await overlay.locator('button', { hasText: 'Forgot the password?' }).click()
  const startOver = overlay.locator('form', { has: overlay.locator('button', { hasText: 'Start Over Here' }) })
  await startOver.getByLabel('Sync password', { exact: true }).fill('a brand new password')
  await startOver.getByLabel('Sync password again').fill('a brand new password')
  await startOver.locator('button', { hasText: 'Start Over Here' }).click()
  await expect.poll(syncState).toBe('on')
  await dispatch({ type: 'overlay', mode: { kind: 'none' } })

  const header = (await readHeader(localSyncFolder))!
  expect(header.folderId).not.toBe(before)
  const { keyring } = await unlockHeader(header, 'a brand new password')
  await syncNow()
  await expect
    .poll(() =>
      filesIn(join(localSyncFolder, 'history')).flatMap((path) => {
        const [profileKey, device] = path.split(/[\\/]/)
        return decodeChunk(readFileSync(join(localSyncFolder, 'history', path)), keyring, chunkContext(profileKey, device)).records.map((record) => 'url' in record && record.url)
      })
    )
    .toContain(`${base}/secret-recipe`)
})

test('nearby sync: junk from the network does no harm, and it can be started over with a new password', async () => {
  await dispatch({ type: 'syncOff' })
  await dispatch({ type: 'syncNearby' })
  await dispatch({ type: 'syncConnect', password: 'the first nearby password', create: true })
  await expect.poll(syncState).toBe('on')

  await app.evaluate(() => {
    const seen = globalThis as { uncaughtInMain?: number }
    seen.uncaughtInMain = 0
    process.on('uncaughtExceptionMonitor', () => seen.uncaughtInMain!++)
  })
  const nearbyPort = await app.evaluate(() => (globalThis as any).arcBrowser.historySync.nearby.port as number)
  const beacons = createSocket('udp4')
  for (const junk of ['null', '[]', '{"app":"yarc-sync","v":1}', 'not json']) {
    await new Promise((sent) => beacons.send(junk, NEARBY_BEACON_PORT, '127.0.0.1', sent))
  }
  beacons.close()
  for (const junk of ['null', '{"version":1,"group":7}', '{}']) {
    const frame = Buffer.concat([Buffer.alloc(4), Buffer.from(junk)])
    frame.writeUInt32BE(frame.length - 4)
    const connection = connect({ host: '127.0.0.1', port: nearbyPort })
    connection.on('error', () => {})
    connection.write(frame)
    await new Promise((closed) => connection.once('close', closed))
  }
  expect(await app.evaluate(() => (globalThis as { uncaughtInMain?: number }).uncaughtInMain)).toBe(0)
  expect(await syncState()).toBe('on')

  await dispatch({ type: 'syncOff' })
  await dispatch({ type: 'syncNearby' })
  await dispatch({ type: 'syncConnect', password: 'a different nearby password', create: true })
  expect(await sync()).toMatchObject({ state: 'on', location: { kind: 'nearby' } })
  await dispatch({ type: 'syncOff' })
})
