// Signs the update files installed copies check before installing (src/main/update/update-signature.ts):
// the macOS zips and the Windows installers.
//
//   node --experimental-strip-types scripts/sign-update.mts keygen <private-key-file>
//     Once: writes a new Ed25519 private key and prints its public key, which goes in UPDATE_PUBLIC_KEY.
//     The private key file's contents go in the MAC_UPDATE_SIGNING_KEY repository secret (named before
//     Windows used it too).
//
//   MAC_UPDATE_SIGNING_KEY=<pem> node --experimental-strip-types scripts/sign-update.mts <file>...
//     Writes <file>.sig next to each file (the release workflow does this).
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { publicKeyOf, signUpdate, UPDATE_PUBLIC_KEY } from '../src/main/update/update-signature.ts'

const args = process.argv.slice(2)

if (args[0] === 'keygen') {
  const file = args[1]
  if (!file) throw new Error('Usage: sign-update.mts keygen <private-key-file>')
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  // "wx": never overwrite an existing key.
  writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 })
  console.log(`Private key written to ${file}. Public key:\n`)
  console.log(publicKey.export({ type: 'spki', format: 'pem' }))
} else {
  const key = process.env.MAC_UPDATE_SIGNING_KEY
  if (!key) throw new Error('MAC_UPDATE_SIGNING_KEY is not set: the repository secret is missing')
  // Installed apps only accept files signed with the key matching the one they were built with.
  if (publicKeyOf(key).trim() !== UPDATE_PUBLIC_KEY.trim()) {
    throw new Error("MAC_UPDATE_SIGNING_KEY doesn't match UPDATE_PUBLIC_KEY in src/main/update/update-signature.ts")
  }
  if (args.length === 0) throw new Error('No files to sign')
  for (const file of args) {
    writeFileSync(`${file}.sig`, `${signUpdate(basename(file), readFileSync(file), key)}\n`)
    console.log(`Signed ${file}`)
  }
}
