import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync } from 'node:crypto'
import { test } from 'node:test'
import { publicKeyOf, signUpdate, UPDATE_PUBLIC_KEY, verifyUpdate } from '../../src/main/update/update-signature.ts'

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  }
}
const { privateKey, publicKey } = pair()
const name = 'YARC-0.2.0-arm64-mac.zip'
const zip = Buffer.from('PK\u0003\u0004 not really a zip')
const signature = signUpdate(name, zip, privateKey)

test('verifyUpdate accepts a zip signed with the matching key', () => {
  assert.equal(verifyUpdate(name, zip, signature, publicKey), true)
  assert.equal(verifyUpdate(name, zip, `${signature}\n`, publicKey), true)
})

test('verifyUpdate rejects a changed zip, another name or another key', () => {
  assert.equal(verifyUpdate(name, Buffer.concat([zip, Buffer.from('!')]), signature, publicKey), false)
  assert.equal(verifyUpdate('YARC-0.1.0-arm64-mac.zip', zip, signature, publicKey), false)
  assert.equal(verifyUpdate(name, zip, signature, pair().publicKey), false)
})

test('verifyUpdate rejects garbage instead of throwing', () => {
  assert.equal(verifyUpdate(name, zip, 'not base64 !!', publicKey), false)
  assert.equal(verifyUpdate(name, zip, signature, 'not a key'), false)
})

test('publicKeyOf derives the public key from the private key', () => {
  assert.equal(publicKeyOf(privateKey), publicKey)
})

test('UPDATE_PUBLIC_KEY is an Ed25519 public key', () => {
  assert.equal(createPublicKey(UPDATE_PUBLIC_KEY).asymmetricKeyType, 'ed25519')
})
