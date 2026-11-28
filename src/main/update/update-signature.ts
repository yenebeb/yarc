// No Electron imports: the release workflow signs with this (scripts/sign-update.mts).
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { download, releaseAssetUrl, windowsInstallerName } from './release.ts'

export const UPDATE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAGkPUNdZdczkp7AOd3w6v6VOBs06cqsF364n0uC954fM=
-----END PUBLIC KEY-----
`

function signedMessage(fileName: string, file: Uint8Array): Buffer {
  const digest = createHash('sha512').update(file).digest('hex')
  // The old name stays: it's in every signature, and installed apps check for it.
  return Buffer.from(`arc-shell-update\n${fileName}\n${digest}\n`)
}

export function signUpdate(fileName: string, file: Uint8Array, privateKeyPem: string): string {
  return sign(null, signedMessage(fileName, file), createPrivateKey(privateKeyPem)).toString('base64')
}

export function verifyUpdate(fileName: string, file: Uint8Array, signature: string, publicKeyPem: string): boolean {
  try {
    return verify(null, signedMessage(fileName, file), createPublicKey(publicKeyPem), Buffer.from(signature.trim(), 'base64'))
  } catch {
    return false
  }
}

export function publicKeyOf(privateKeyPem: string): string {
  return createPublicKey(createPrivateKey(privateKeyPem)).export({ type: 'spki', format: 'pem' }).toString()
}

export interface CheckedInstaller {
  file: string
  name: string
  signature: string
}

export async function verifyInstaller(file: string, version: string, arch: string): Promise<CheckedInstaller> {
  const name = windowsInstallerName(version, arch)
  // The signature covers the name, which carries the version and CPU: an older signed installer can't pass for this one.
  if (path.basename(file) !== name) throw new Error(`The update is ${path.basename(file)}, not ${name}`)
  const [sigFile, installer] = await Promise.all([download(releaseAssetUrl(version, `${name}.sig`), 60_000), fs.promises.readFile(file)])
  const signature = sigFile.toString('utf8')
  if (!verifyUpdate(name, installer, signature, UPDATE_PUBLIC_KEY)) throw new Error(`${name} doesn't match its signature`)
  return { file, name, signature }
}

/** Synchronous, for the quit handler: the installer waited in the profile folder, where another program could have swapped it. */
export function stillSigned(checked: CheckedInstaller): boolean {
  try {
    return verifyUpdate(checked.name, fs.readFileSync(checked.file), checked.signature, UPDATE_PUBLIC_KEY)
  } catch {
    return false
  }
}
