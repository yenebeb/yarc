import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { History } from '../../src/main/core/history.ts'
import { changePassword, createHeader } from '../../src/main/sync/crypto.ts'
import { HEADER_FILE, newSyncId, readHeader, SyncEngine, writeHeader } from '../../src/main/sync/engine.ts'
import { contentHash } from '../../src/main/sync/paths.ts'
import { RemoteMirror, type RemoteStore } from '../../src/main/sync/remote.ts'
import { parseMultistatus, serverFolder } from '../../src/main/sync/webdav.ts'

/** Cheap key derivation, so tests stay fast; real syncs use DEFAULT_KDF_COST. */
const FAST = { N: 2 ** 10, r: 8, p: 1 }
const PROFILE = newSyncId()

/** A cloud drive in memory: the version of a file is its content's hash, as Google Drive's md5Checksum would be. */
class MemoryStore implements RemoteStore {
  readonly files = new Map<string, Buffer>()

  async list() {
    return new Map([...this.files].map(([path, data]) => [path, contentHash(data)]))
  }
  async read(path: string) {
    return this.files.get(path)!
  }
  async write(path: string, data: Buffer) {
    this.files.set(path, data)
  }
  async remove(path: string) {
    this.files.delete(path)
  }
}

/** A computer syncing one profile's history through the store, by way of its own copy of the sync folder. */
function computer(store: RemoteStore, deviceId = newSyncId(), root = mkdtempSync(join(tmpdir(), 'yarc-mirror-'))) {
  const mirror = new RemoteMirror({ root, store, deviceId })
  const history = new History(undefined)
  return {
    root,
    deviceId,
    history,
    mirror,
    async startSync(password = 'secret') {
      await mirror.pull()
      const { header, keyring } = await createHeader(password, FAST)
      writeHeader(root, header)
      await mirror.push()
      return { header, keyring }
    },
    /** One pass, as HistorySync runs it: fetch, send and receive through the copy, upload. */
    async sync(keyring: Awaited<ReturnType<typeof createHeader>>['keyring'], folderId: string) {
      await mirror.pull()
      history.link(folderId)
      const engine = new SyncEngine({ root, deviceId, keyring })
      await engine.lastSeq(PROFILE, history)
      engine.send(PROFILE, history)
      await engine.receive(PROFILE, history)
      await mirror.push()
      return engine
    },
    visitsTo(url: string) {
      return history.recent(1000).filter((visit) => visit.url === url).length
    }
  }
}

describe('syncing through a cloud drive', () => {
  test('starting over removes the old sync from the drive and from the copy here, so a new one can begin', async () => {
    const drive = new MemoryStore()
    const laptop = computer(drive)
    const forgotten = await laptop.startSync('a password nobody remembers')
    laptop.history.visit('https://example.com/', 'Example')
    await laptop.sync(forgotten.keyring, forgotten.header.folderId)
    assert.ok(drive.files.size > 1)

    await laptop.mirror.clear()
    assert.equal(drive.files.size, 0)
    assert.equal(await readHeader(laptop.root), undefined)

    const fresh = await laptop.startSync('a new password')
    assert.notEqual(fresh.header.folderId, forgotten.header.folderId)
    await laptop.sync(fresh.keyring, fresh.header.folderId)
    const desktop = computer(drive)
    await desktop.sync(fresh.keyring, fresh.header.folderId)
    assert.equal(desktop.visitsTo('https://example.com/'), 1)
  })

  test('a visit on one computer reaches the other', async () => {
    const drive = new MemoryStore()
    const laptop = computer(drive)
    const desktop = computer(drive)
    const { header, keyring } = await laptop.startSync()

    laptop.history.visit('https://example.com/', 'Example')
    await laptop.sync(keyring, header.folderId)
    await desktop.sync(keyring, header.folderId)

    assert.equal(desktop.visitsTo('https://example.com/'), 1)
  })

  test('only encrypted files reach the drive', async () => {
    const drive = new MemoryStore()
    const laptop = computer(drive)
    const { header, keyring } = await laptop.startSync()

    laptop.history.visit('https://secret.example/', 'Secret')
    await laptop.sync(keyring, header.folderId)

    for (const data of drive.files.values()) assert.ok(!data.toString('latin1').includes('secret.example'))
  })

  test('a computer uploads only its own files', async () => {
    const drive = new MemoryStore()
    const laptop = computer(drive)
    const desktop = computer(drive)
    const { header, keyring } = await laptop.startSync()
    laptop.history.visit('https://example.com/', 'Example')
    await laptop.sync(keyring, header.folderId)
    const laptopFiles = new Map(drive.files)

    await desktop.sync(keyring, header.folderId)

    for (const [path, data] of laptopFiles) assert.equal(drive.files.get(path), data, `${path} was uploaded again`)
  })

  test('files their owner removed from the drive are removed from the other copies', async () => {
    const drive = new MemoryStore()
    const laptop = computer(drive)
    const desktop = computer(drive)
    const { header, keyring } = await laptop.startSync()
    laptop.history.visit('https://example.com/', 'Example')
    await laptop.sync(keyring, header.folderId)
    await desktop.sync(keyring, header.folderId)
    const laptopChunk = [...drive.files.keys()].find((path) => path.startsWith('history/') && path.includes(laptop.deviceId))!

    drive.files.delete(laptopChunk)
    await desktop.mirror.pull()

    assert.throws(() => readFileSync(join(desktop.root, laptopChunk)))
  })

  test('a computer that cleared its copy gets its own files back before writing more', async () => {
    const drive = new MemoryStore()
    const laptop = computer(drive)
    const { header, keyring } = await laptop.startSync()
    laptop.history.visit('https://example.com/', 'Example')
    await laptop.sync(keyring, header.folderId)
    const uploaded = [...drive.files.keys()].filter((path) => path.includes(laptop.deviceId))

    const sameLaptopFreshCopy = computer(drive, laptop.deviceId)
    await sameLaptopFreshCopy.mirror.pull()

    for (const path of uploaded) assert.ok(readFileSync(join(sameLaptopFreshCopy.root, path)))
  })

  test('a password change here is uploaded, not replaced by the drive’s older sync.json', async () => {
    const drive = new MemoryStore()
    const laptop = computer(drive)
    const { header, keyring } = await laptop.startSync('old password')

    const changed = await changePassword(header, keyring, 'new password')
    writeHeader(laptop.root, changed.header)
    await laptop.mirror.pull()
    await laptop.mirror.push()

    assert.equal(JSON.parse(drive.files.get(HEADER_FILE)!.toString('utf8')).generation, 1)
    assert.equal((await readHeader(laptop.root))!.generation, 1)
  })
})

describe('your own server', () => {
  test('a typed address without a scheme gets https and a trailing slash', () => {
    assert.equal(serverFolder('cloud.example.com/dav/files/you').href, 'https://cloud.example.com/dav/files/you/')
  })

  test('plain http is refused on the internet, so the server password never crosses it unencrypted', () => {
    assert.throws(() => serverFolder('http://cloud.example.com/dav/'), /https/)
  })

  test('plain http is allowed on the local network, for a NAS at home', () => {
    assert.equal(serverFolder('http://192.168.1.20:5005/home/').href, 'http://192.168.1.20:5005/home/')
    assert.equal(serverFolder('http://nas.local/dav/').href, 'http://nas.local/dav/')
  })

  test('a folder listing is read whatever namespace prefix the server uses', () => {
    const nextcloud = `<?xml version="1.0"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response><d:href>/dav/YARC%20Sync/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
        <d:response><d:href>/dav/YARC%20Sync/sync.json</d:href><d:propstat><d:prop><d:resourcetype/><d:getetag>"abc"</d:getetag></d:prop></d:propstat></d:response>
      </d:multistatus>`
    const apache = `<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/YARC%20Sync/profiles/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response></D:multistatus>`

    assert.deepEqual(parseMultistatus(nextcloud), [
      { href: '/dav/YARC%20Sync/', folder: true, version: '|' },
      { href: '/dav/YARC%20Sync/sync.json', folder: false, version: '"abc"' }
    ])
    assert.deepEqual(parseMultistatus(apache), [{ href: '/dav/YARC%20Sync/profiles/', folder: true, version: '|' }])
  })
})
