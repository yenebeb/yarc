import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { History } from '../../src/main/history.ts'
import {
  changePassword,
  createHeader,
  SyncCryptoError,
  unlockHeader,
  unsealWith,
  sealWith,
  type Keyring
} from '../../src/main/sync/crypto.ts'
import { HEADER_FILE, newSyncId, readHeader, SyncEngine, writeHeader } from '../../src/main/sync/engine.ts'
import { chunkContext, encodeChunk } from '../../src/main/sync/log.ts'
import { syncExposure, type SyncRecord } from '../../src/shared/sync.ts'

/** Cheap key derivation, so tests stay fast; real folders use DEFAULT_KDF_COST. */
const FAST = { N: 2 ** 10, r: 8, p: 1 }
const PASSWORD = 'correct horse battery staple'
const PROFILE = newSyncId()
const HOUR = 3600_000

const rejectsWith = (code: SyncCryptoError['code']) => (err: unknown) => err instanceof SyncCryptoError && err.code === code
const throwsWith = rejectsWith

async function newSyncFolder(password = PASSWORD) {
  const root = mkdtempSync(join(tmpdir(), 'yarc-sync-'))
  const { header, keyring } = await createHeader(password, FAST)
  writeHeader(root, header)
  return { root, header, keyring }
}

/** A computer syncing one profile's history through `root`. */
function computer(root: string, keyring: Keyring, folderId: string) {
  const history = new History(undefined)
  history.link(folderId)
  const engine = new SyncEngine({ root, deviceId: newSyncId(), keyring })
  return {
    history,
    engine,
    async sync() {
      await engine.lastSeq(PROFILE, history)
      engine.send(PROFILE, history)
      return engine.receive(PROFILE, history)
    },
    visitsTo(url: string) {
      return history.recent(1000).filter((v) => v.url === url).length
    }
  }
}

async function twoComputers() {
  const folder = await newSyncFolder()
  const a = computer(folder.root, folder.keyring, folder.header.folderId)
  const b = computer(folder.root, folder.keyring, folder.header.folderId)
  return { ...folder, a, b }
}

function filesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((p) => statSync(join(dir, p)).isFile())
}

describe('the sync password', () => {
  test('the same password opens the folder on another computer', async () => {
    const { header, keyring } = await newSyncFolder()
    const opened = await unlockHeader(header, PASSWORD)
    assert.deepEqual(opened.keyring, keyring)
  })

  test('a wrong password is refused as a wrong password, not as damage', async () => {
    const { header } = await newSyncFolder()
    await assert.rejects(unlockHeader(header, 'correct horse battery stable'), rejectsWith('wrong-password'))
  })

  test('the password is compared after Unicode normalization, so macOS and Windows agree', async () => {
    const { header } = await newSyncFolder('café')
    await unlockHeader(header, 'café')
  })

  test('a damaged keyring with the right password is reported as damage', async () => {
    const { header } = await newSyncFolder()
    const keyring = Buffer.from(header.keyring, 'base64')
    keyring[keyring.length - 1] ^= 1
    await assert.rejects(unlockHeader({ ...header, keyring: keyring.toString('base64') }, PASSWORD), rejectsWith('corrupt'))
  })

  test('an empty password still encrypts, and anyone can open it with an empty password', async () => {
    const { header } = await newSyncFolder('')
    await assert.rejects(unlockHeader(header, 'guess'), rejectsWith('wrong-password'))
    await unlockHeader(header, '')
  })

  test('the empty-password warning lists everything the sync writes', () => {
    assert.deepEqual(syncExposure(), [
      'Every URL visited, including search terms and anything else in the address',
      'Page titles',
      'When each page was visited',
      'Which device visited it (as a random device ID, not the device’s name)',
      'URLs deleted from history, and when they were deleted',
      'When history was cleared',
      'The names of synced profiles'
    ])
  })
})

describe('sealed data', () => {
  test('round-trips, with a different nonce every time', async () => {
    const { keyring } = await newSyncFolder()
    const one = sealWith(keyring, Buffer.from('hello'), 'ctx')
    const two = sealWith(keyring, Buffer.from('hello'), 'ctx')
    assert.notDeepEqual(one, two)
    assert.equal(unsealWith(keyring, one, 'ctx').toString(), 'hello')
  })

  test('a changed byte anywhere is rejected', async () => {
    const { keyring } = await newSyncFolder()
    const sealed = sealWith(keyring, Buffer.from('https://example.com/secret'), 'ctx')
    for (const at of [1, 12, 25, sealed.length - 1]) {
      const tampered = Buffer.from(sealed)
      tampered[at] ^= 1
      assert.throws(() => unsealWith(keyring, tampered, 'ctx'), (err) => err instanceof SyncCryptoError)
    }
  })

  test('a file moved to another log is rejected', async () => {
    const { keyring } = await newSyncFolder()
    const sealed = sealWith(keyring, Buffer.from('x'), chunkContext(PROFILE, 'aaaa'))
    assert.throws(() => unsealWith(keyring, sealed, chunkContext(PROFILE, 'bbbb')), throwsWith('corrupt'))
  })
})

describe('changing the password', () => {
  test('the old password stops working and the new one opens everything written before', async () => {
    const { header, keyring } = await newSyncFolder()
    const before = sealWith(keyring, Buffer.from('old visit'), 'ctx')
    const changed = await changePassword(header, keyring, 'new password', FAST)
    await assert.rejects(unlockHeader(changed.header, PASSWORD), rejectsWith('wrong-password'))
    const reopened = await unlockHeader(changed.header, 'new password')
    assert.equal(unsealWith(reopened.keyring, before, 'ctx').toString(), 'old visit')
  })

  test('a computer that still has the old keys can’t read what is written after the change', async () => {
    const { header, keyring } = await newSyncFolder()
    const changed = await changePassword(header, keyring, 'new password', FAST)
    const after = sealWith(changed.keyring, Buffer.from('new visit'), 'ctx')
    assert.throws(() => unsealWith(keyring, after, 'ctx'), throwsWith('unknown-key'))
  })

  test('re-encrypting a log moves it to the new key and keeps it readable', async () => {
    const { root, a, b, header } = await twoComputers()
    a.history.visit('https://example.com/', 'Example')
    await a.sync()
    const changed = await changePassword(header, a.engine.keyring, 'new password', FAST)
    writeHeader(root, changed.header)
    a.engine.keyring = changed.keyring
    await a.engine.reencrypt(PROFILE, a.history)
    await assert.rejects(unlockHeader((await readHeader(root))!, PASSWORD), rejectsWith('wrong-password'))
    b.engine.keyring = (await unlockHeader((await readHeader(root))!, 'new password')).keyring
    await b.sync()
    assert.equal(b.visitsTo('https://example.com/'), 1)
  })
})

describe('merging another computer’s history', () => {
  test('a visit on one computer shows up on the other, with its title', async () => {
    const { a, b } = await twoComputers()
    a.history.visit('https://example.com/', 'Example Domain')
    await a.sync()
    await b.sync()
    assert.equal(b.visitsTo('https://example.com/'), 1)
    assert.equal(b.history.search('example')[0].title, 'Example Domain')
  })

  test('reading the same log again never counts a visit twice', async () => {
    const { a, b } = await twoComputers()
    a.history.visit('https://example.com/', 'Example')
    await a.sync()
    await b.sync()
    await b.sync()
    // Even when the computer forgot which files it read (as after a crash), the cursor holds.
    b.history.forgetFiles([...b.history.readFiles().keys()])
    await b.sync()
    assert.equal(b.visitsTo('https://example.com/'), 1)
    // And the computer that made the visit doesn't get it back from the other one.
    await a.sync()
    assert.equal(a.visitsTo('https://example.com/'), 1)
  })

  test('the same visit sent again under new numbers (sync turned off and on) is recognised', async () => {
    const { a, b } = await twoComputers()
    const time = Date.now() - HOUR
    a.history.visit('https://example.com/', 'Example', time)
    await a.sync()
    await b.sync()
    b.history.applyRemote('another-device', [{ kind: 'visit', seq: 1, url: 'https://example.com/', title: 'Example', time }], 1)
    assert.equal(b.visitsTo('https://example.com/'), 1)
  })

  test('a deleted URL is deleted on the other computer too', async () => {
    const { a, b } = await twoComputers()
    a.history.visit('https://example.com/private', 'Private')
    a.history.visit('https://example.com/keep', 'Keep')
    await a.sync()
    await b.sync()
    b.history.deleteUrl('https://example.com/private')
    await b.sync()
    await a.sync()
    assert.equal(a.visitsTo('https://example.com/private'), 0)
    assert.equal(a.visitsTo('https://example.com/keep'), 1)
  })

  test('a deletion also removes an older visit that arrives later from a computer that was offline', async () => {
    const { a } = await twoComputers()
    const deletedAt = Date.now()
    a.history.applyRemote('laptop', [{ kind: 'delete', seq: 1, url: 'https://example.com/private', time: deletedAt }], 1)
    a.history.applyRemote('offline-pc', [{ kind: 'visit', seq: 1, url: 'https://example.com/private', title: 'Private', time: deletedAt - HOUR }], 1)
    assert.equal(a.visitsTo('https://example.com/private'), 0)
  })

  test('clearing history on one computer clears what came before it everywhere', async () => {
    const { a, b } = await twoComputers()
    a.history.visit('https://example.com/one', 'One')
    a.history.visit('https://example.com/two', 'Two')
    await a.sync()
    await b.sync()
    b.history.clear()
    await b.sync()
    await a.sync()
    assert.equal(a.history.recent().length, 0)
    // History made after the clear (on a computer that saw it) is kept.
    a.history.visit('https://example.com/three', 'Three')
    await a.sync()
    await b.sync()
    assert.equal(b.visitsTo('https://example.com/three'), 1)
  })

  test('a computer whose clock runs ahead doesn’t make later visits elsewhere look deleted', async () => {
    const { a } = await twoComputers()
    // The laptop's clock is 2 hours fast: its deletion is stamped in this computer's future.
    a.history.applyRemote('fast-laptop', [{ kind: 'delete', seq: 1, url: 'https://example.com/', time: Date.now() + 2 * HOUR }], 1)
    // Visiting the page here afterwards is stamped after the deletion, so the visit stays.
    a.history.visit('https://example.com/', 'Example')
    assert.equal(a.visitsTo('https://example.com/'), 1)
    assert.ok(a.history.recent()[0].time > Date.now() + HOUR)
  })

  test('a clock that is wildly wrong can’t drag this computer’s timestamps along', async () => {
    const { a } = await twoComputers()
    a.history.applyRemote('broken-clock', [{ kind: 'visit', seq: 1, url: 'https://example.com/', title: '', time: Date.now() + 365 * 24 * HOUR }], 1)
    assert.ok(a.history.now() < Date.now() + HOUR)
  })

  test('a chunk that is only partly downloaded waits, and is applied once complete', async () => {
    const { root, keyring, a } = await twoComputers()
    const device = newSyncId()
    const records: SyncRecord[] = [{ kind: 'visit', seq: 1, url: 'https://example.com/', title: 'Example', time: Date.now() }]
    const full = encodeChunk({ first: 1, last: 1, records }, keyring, chunkContext(PROFILE, device))
    const dir = join(root, 'history', PROFILE, device)
    const file = join(dir, newSyncId())
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, full.subarray(0, full.length - 10))
    const partial = await a.sync()
    assert.equal(partial.waiting, 1)
    assert.equal(a.history.cursor(device), 0)
    writeFileSync(file, full)
    await a.sync()
    assert.equal(a.visitsTo('https://example.com/'), 1)
  })

  test('a chunk that arrives before the one it follows waits for it', async () => {
    const { root, keyring, a } = await twoComputers()
    const device = newSyncId()
    const visit = (seq: number): SyncRecord => ({ kind: 'visit', seq, url: `https://example.com/${seq}`, title: '', time: Date.now() + seq })
    const dir = join(root, 'history', PROFILE, device)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, newSyncId()), encodeChunk({ first: 2, last: 2, records: [visit(2)] }, keyring, chunkContext(PROFILE, device)))
    await a.sync()
    assert.equal(a.history.recent().length, 0)
    writeFileSync(join(dir, newSyncId()), encodeChunk({ first: 1, last: 1, records: [visit(1)] }, keyring, chunkContext(PROFILE, device)))
    await a.sync()
    assert.equal(a.history.recent().length, 2)
  })

  test('a computer with the wrong keys syncs nothing', async () => {
    const { a } = await twoComputers()
    a.history.visit('https://example.com/', 'Example')
    await a.sync()
    const stranger = await newSyncFolder()
    const c = computer(a.engine.root, stranger.keyring, stranger.header.folderId)
    const got = await c.sync()
    assert.equal(got.applied, 0)
    assert.equal(c.history.recent().length, 0)
  })
})

describe('keeping logs small', () => {
  test('compaction merges small chunks, drops deleted visits, and a new computer still gets the same history', async () => {
    const folder = await newSyncFolder()
    const a = computer(folder.root, folder.keyring, folder.header.folderId)
    a.engine = new SyncEngine({ root: folder.root, deviceId: a.engine.deviceId, keyring: folder.keyring, compactAfter: 4 })
    for (let i = 0; i < 6; i++) {
      a.history.visit(`https://example.com/${i}`, `Page ${i}`)
      await a.sync()
    }
    a.history.deleteUrl('https://example.com/0')
    await a.sync()
    const ownLog = join(folder.root, 'history', PROFILE, a.engine.deviceId)
    assert.equal(readdirSync(ownLog).length, 7)
    assert.equal(await a.engine.compact(PROFILE, a.history), true)
    assert.equal(readdirSync(ownLog).length, 1)
    const b = computer(folder.root, folder.keyring, folder.header.folderId)
    await b.sync()
    assert.deepEqual(
      b.history
        .recent()
        .map((v) => v.url)
        .sort(),
      ['https://example.com/1', 'https://example.com/2', 'https://example.com/3', 'https://example.com/4', 'https://example.com/5']
    )
  })

  test('numbering continues after sync is turned off and on, so other computers don’t skip new visits', async () => {
    const { a, b, header } = await twoComputers()
    a.history.visit('https://example.com/1', 'One')
    await a.sync()
    await b.sync()
    a.history.unlink()
    a.history.link(header.folderId)
    a.history.visit('https://example.com/2', 'Two')
    await a.sync()
    await b.sync()
    assert.equal(b.visitsTo('https://example.com/2'), 1)
    assert.equal(b.visitsTo('https://example.com/1'), 1)
  })
})

describe('what lands in the folder', () => {
  test('no URL, title or profile name appears anywhere, and file names are random IDs', async () => {
    const { root, a, b } = await twoComputers()
    const secrets = ['secret-site.example', 'Top Secret Page Title', 'Work Profile Name']
    a.history.visit('https://secret-site.example/path?q=private', 'Top Secret Page Title')
    a.engine.writeProfiles([{ key: PROFILE, name: 'Work Profile Name' }])
    await a.sync()
    b.history.deleteUrl('https://secret-site.example/path?q=private')
    b.history.clear()
    await b.sync()
    const files = filesIn(root)
    assert.ok(files.length >= 4)
    for (const file of files) {
      const bytes = readFileSync(join(root, file))
      for (const secret of secrets) {
        assert.equal(bytes.includes(Buffer.from(secret)), false, `${file} contains "${secret}"`)
        assert.equal(bytes.includes(Buffer.from(secret, 'utf16le')), false, `${file} contains "${secret}" (UTF-16)`)
      }
      if (file === HEADER_FILE) continue
      for (const part of file.split(/[\\/]/).slice(1)) assert.match(part, /^[0-9a-f]{32}$/, file)
    }
  })
})
