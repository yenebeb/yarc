// Encryption for everything YARC writes to the sync folder (no Electron imports, so unit tests run in Node).
//
// A sync password goes through scrypt (slow on purpose) to a master key. The master key never
// encrypts data itself: it opens the keyring in sync.json, which holds random data keys. A
// password change adds a new data key and re-wraps the keyring with the new password, so data
// written before the change stays readable and data written after it needs the new password.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

export interface KdfParams {
  alg: 'scrypt'
  /** CPU/memory cost (a power of two), block size and parallelism. */
  N: number
  r: number
  p: number
  /** Random, base64. */
  salt: string
}

/** About 0.3 s and 128 MB on a 2024 laptop: cheap once per device, expensive per guess. */
export const DEFAULT_KDF_COST = { N: 2 ** 17, r: 8, p: 1 }

/** The plain-text header of a sync folder. It holds nothing about the user: random IDs, the salt, and sealed bytes. */
export interface SyncHeader {
  format: 'yarc-sync'
  version: 1
  /** Random; tells devices that two folders are different syncs. */
  folderId: string
  kdf: KdfParams
  /** Derived from the master key; a mismatch means a wrong password, not corrupt data. */
  check: string
  /** The keyring, sealed with a key derived from the master key, base64. */
  keyring: string
}

export interface DataKey {
  /** 8 random bytes, hex; stored in front of everything sealed with this key. */
  id: string
  /** 32 bytes, base64. */
  key: string
}

/** Every data key the folder has used, oldest first. New data is sealed with the last one. */
export interface Keyring {
  keys: DataKey[]
}

export type SyncCryptoErrorCode = 'wrong-password' | 'corrupt' | 'unknown-key'

export class SyncCryptoError extends Error {
  constructor(
    readonly code: SyncCryptoErrorCode,
    message: string
  ) {
    super(message)
  }
}

const ENVELOPE_VERSION = 1
const KEY_ID_BYTES = 8
const NONCE_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = 1 + KEY_ID_BYTES + NONCE_BYTES
/** The keyring is sealed with the password-derived key, which has no id of its own. */
const KEYRING_KEY_ID = Buffer.alloc(KEY_ID_BYTES)

export function newKdfParams(cost = DEFAULT_KDF_COST): KdfParams {
  return { alg: 'scrypt', ...cost, salt: randomBytes(16).toString('base64') }
}

/** The same password typed on macOS and Windows can differ in Unicode normalization. */
function passwordBytes(password: string): Buffer {
  return Buffer.from(password.normalize('NFC'), 'utf8')
}

export function deriveMasterKey(password: string, kdf: KdfParams): Promise<Buffer> {
  if (kdf.alg !== 'scrypt') return Promise.reject(new SyncCryptoError('corrupt', `Unknown key derivation "${kdf.alg}"`))
  const maxmem = 128 * kdf.N * kdf.r * kdf.p + 32 * 1024 * 1024
  return new Promise((resolve, reject) => {
    scrypt(passwordBytes(password), Buffer.from(kdf.salt, 'base64'), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  })
}

function subKey(master: Buffer, purpose: 'check' | 'keyring'): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), `yarc-sync ${purpose}`, 32))
}

function checkValue(master: Buffer): string {
  return subKey(master, 'check').toString('base64')
}

/** Encrypts `plaintext` with AES-256-GCM and a fresh random nonce. `context` (e.g. the file's place in the folder) is authenticated, not stored. */
export function seal(key: Buffer, keyId: Buffer, plaintext: Buffer, context: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES)
  const header = Buffer.concat([Buffer.from([ENVELOPE_VERSION]), keyId, nonce])
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.concat([header, Buffer.from(context, 'utf8')]))
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([header, body, cipher.getAuthTag()])
}

/** The id of the key that sealed `data`, or undefined when it isn't sealed data at all. */
export function sealedKeyId(data: Buffer): string | undefined {
  if (data.length < HEADER_BYTES + TAG_BYTES || data[0] !== ENVELOPE_VERSION) return undefined
  return data.subarray(1, 1 + KEY_ID_BYTES).toString('hex')
}

/** Throws a 'corrupt' SyncCryptoError when the data was changed, cut short, or sealed for another context. */
export function unseal(key: Buffer, data: Buffer, context: string): Buffer {
  if (sealedKeyId(data) === undefined) throw new SyncCryptoError('corrupt', 'Not sealed data, or cut short')
  const header = data.subarray(0, HEADER_BYTES)
  const nonce = data.subarray(1 + KEY_ID_BYTES, HEADER_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAAD(Buffer.concat([header, Buffer.from(context, 'utf8')]))
  decipher.setAuthTag(data.subarray(data.length - TAG_BYTES))
  try {
    return Buffer.concat([decipher.update(data.subarray(HEADER_BYTES, data.length - TAG_BYTES)), decipher.final()])
  } catch {
    throw new SyncCryptoError('corrupt', 'The data was changed or is incomplete')
  }
}

export function newDataKey(): DataKey {
  return { id: randomBytes(KEY_ID_BYTES).toString('hex'), key: randomBytes(32).toString('base64') }
}

export function currentKey(keyring: Keyring): DataKey {
  return keyring.keys[keyring.keys.length - 1]
}

/** Seals with the keyring's newest key. */
export function sealWith(keyring: Keyring, plaintext: Buffer, context: string): Buffer {
  const k = currentKey(keyring)
  return seal(Buffer.from(k.key, 'base64'), Buffer.from(k.id, 'hex'), plaintext, context)
}

/** Opens data sealed with any key in the keyring. */
export function unsealWith(keyring: Keyring, data: Buffer, context: string): Buffer {
  const id = sealedKeyId(data)
  if (id === undefined) throw new SyncCryptoError('corrupt', 'Not sealed data, or cut short')
  const k = keyring.keys.find((d) => d.id === id)
  if (!k) throw new SyncCryptoError('unknown-key', 'Sealed with a key this device doesn’t have (was the password changed?)')
  return unseal(Buffer.from(k.key, 'base64'), data, context)
}

function keyringContext(folderId: string): string {
  return `sync.json keyring ${folderId}`
}

function sealKeyring(master: Buffer, keyring: Keyring, folderId: string): string {
  return seal(subKey(master, 'keyring'), KEYRING_KEY_ID, Buffer.from(JSON.stringify(keyring)), keyringContext(folderId)).toString('base64')
}

/** A new sync folder: a random salt, a first data key, both protected by `password` (which may be empty). */
export async function createHeader(password: string, cost = DEFAULT_KDF_COST): Promise<{ header: SyncHeader; master: Buffer; keyring: Keyring }> {
  const kdf = newKdfParams(cost)
  const master = await deriveMasterKey(password, kdf)
  const folderId = randomBytes(16).toString('hex')
  const keyring: Keyring = { keys: [newDataKey()] }
  const header: SyncHeader = { format: 'yarc-sync', version: 1, folderId, kdf, check: checkValue(master), keyring: sealKeyring(master, keyring, folderId) }
  return { header, master, keyring }
}

/** Opens the keyring with a master key derived earlier (or cached). Throws 'wrong-password' or 'corrupt'. */
export function openKeyring(header: SyncHeader, master: Buffer): Keyring {
  const expected = Buffer.from(header.check, 'base64')
  const actual = Buffer.from(checkValue(master), 'base64')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new SyncCryptoError('wrong-password', 'Wrong sync password')
  let keyring: Keyring
  try {
    keyring = JSON.parse(unseal(subKey(master, 'keyring'), Buffer.from(header.keyring, 'base64'), keyringContext(header.folderId)).toString('utf8'))
  } catch {
    throw new SyncCryptoError('corrupt', 'sync.json is damaged')
  }
  if (!Array.isArray(keyring.keys) || keyring.keys.length === 0) throw new SyncCryptoError('corrupt', 'sync.json has no keys')
  return keyring
}

/** Derives the master key from `password` and opens the keyring with it. */
export async function unlockHeader(header: SyncHeader, password: string): Promise<{ master: Buffer; keyring: Keyring }> {
  const master = await deriveMasterKey(password, header.kdf)
  return { master, keyring: openKeyring(header, master) }
}

/**
 * Rotates to a new data key protected by `password`. Old keys stay in the keyring so other
 * devices' older files stay readable; everything written from now on uses the new key.
 */
export async function changePassword(
  header: SyncHeader,
  keyring: Keyring,
  password: string,
  cost = DEFAULT_KDF_COST
): Promise<{ header: SyncHeader; master: Buffer; keyring: Keyring }> {
  const kdf = newKdfParams(cost)
  const master = await deriveMasterKey(password, kdf)
  const next: Keyring = { keys: [...keyring.keys, newDataKey()] }
  return {
    header: { ...header, kdf, check: checkValue(master), keyring: sealKeyring(master, next, header.folderId) },
    master,
    keyring: next
  }
}

export function parseHeader(text: string): SyncHeader {
  let h: SyncHeader
  try {
    h = JSON.parse(text)
  } catch {
    throw new SyncCryptoError('corrupt', 'sync.json is not valid JSON')
  }
  if (h?.format !== 'yarc-sync') throw new SyncCryptoError('corrupt', 'This folder’s sync.json is not a YARC sync header')
  if (h.version !== 1) throw new SyncCryptoError('corrupt', `sync.json version ${h.version} needs a newer YARC`)
  return h
}
