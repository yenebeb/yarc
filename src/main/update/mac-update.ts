// The running app's files stay in place until it quits: a helper process started from a half-replaced bundle would be the wrong version.
import { app } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { download, type MacUpdate } from './release'
import { UPDATE_PUBLIC_KEY, verifyUpdate } from './update-signature'

const run = promisify(execFile)
const DOWNLOAD_TIMEOUT = 15 * 60_000

/** Holds the unpacked update until the app quits, then the replaced app until the next start. */
const stagingDir = (): string => path.join(app.getPath('userData'), 'Update')

/** Not in development, not translocated, and in a folder this user can write to. */
export function updatableBundle(): string | undefined {
  const bundle = path.resolve(process.execPath, '../../..')
  if (!app.isPackaged || !bundle.endsWith('.app') || bundle.includes('/AppTranslocation/')) return undefined
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK)
    fs.accessSync(bundle, fs.constants.W_OK)
  } catch {
    return undefined
  }
  return bundle
}

/** With rm, not fs.rm: Electron's fs treats app.asar as a folder and leaves it behind. */
export async function cleanUpStaging(): Promise<void> {
  await run('/bin/rm', ['-rf', stagingDir()])
}

export interface StagedUpdate {
  app: string
  /** installStaged checks the app against it again, since it then waited (possibly for days) in the profile folder. */
  requirement: string
  /** Inside the running bundle's path: the new app's executable can have another name (the Arc Shell → YARC rename). */
  executable: string
}

/** The update itself failed a check (signature, contents, code signature): not tried again this run. */
export class UpdateRejected extends Error {}

export async function stageUpdate(update: MacUpdate, version: string, bundle: string): Promise<StagedUpdate> {
  const [zip, signature] = await Promise.all([download(update.url, DOWNLOAD_TIMEOUT), download(update.signatureUrl, DOWNLOAD_TIMEOUT)])
  if (!verifyUpdate(update.name, zip, signature.toString('utf8'), UPDATE_PUBLIC_KEY)) {
    throw new UpdateRejected(`${update.name} doesn't match its signature`)
  }
  try {
    return await unpack(update, zip, version, bundle)
  } catch (err) {
    throw new UpdateRejected(`${update.name} failed its checks: ${(err as Error).message}`)
  }
}

async function unpack(update: MacUpdate, zip: Buffer, version: string, bundle: string): Promise<StagedUpdate> {
  const dir = stagingDir()
  await cleanUpStaging()
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 })
  const zipPath = path.join(dir, update.name)
  await fs.promises.writeFile(zipPath, zip)
  const unpacked = path.join(dir, 'new')
  await run('/usr/bin/ditto', ['-x', '-k', '--noqtn', zipPath, unpacked])
  await fs.promises.rm(zipPath)
  const apps = (await fs.promises.readdir(unpacked)).filter((name) => name.endsWith('.app'))
  if (apps.length !== 1) throw new Error(`${update.name} holds ${apps.length} apps`)
  const staged = path.join(unpacked, apps[0])
  await checkBundle(staged, bundle, version)
  return {
    app: staged,
    requirement: await designatedRequirement(staged),
    executable: path.join(bundle, 'Contents', 'MacOS', await plistValue(staged, 'CFBundleExecutable'))
  }
}

async function designatedRequirement(app: string): Promise<string> {
  const { stdout, stderr } = await run('/usr/bin/codesign', ['-d', '-r-', app])
  const found = /designated => (.+)/.exec(`${stdout}\n${stderr}`)?.[1]?.trim()
  if (!found) throw new Error('The update has no designated requirement')
  return found
}

async function checkBundle(staged: string, bundle: string, version: string): Promise<void> {
  const id = await plistValue(staged, 'CFBundleIdentifier')
  if (id !== (await plistValue(bundle, 'CFBundleIdentifier'))) throw new Error(`The update is a different app (${id})`)
  const stagedVersion = await plistValue(staged, 'CFBundleShortVersionString')
  if (stagedVersion !== version) throw new Error(`The update is version ${stagedVersion}, not ${version}`)
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged])
  const quarantined = await run('/usr/bin/xattr', ['-p', 'com.apple.quarantine', staged]).then(
    () => true,
    () => false
  )
  if (quarantined) {
    console.warn('[updater] the unpacked update is quarantined; removing the flag')
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', staged])
  }
}

async function plistValue(bundle: string, key: string): Promise<string> {
  const plist = path.join(bundle, 'Contents', 'Info.plist')
  const { stdout } = await run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', plist])
  return stdout.trim()
}

/** Two renames, rolled back if the second fails (Node has no rename-swap). Synchronous: it runs in will-quit. */
export function installStaged(staged: StagedUpdate, bundle: string): void {
  execFileSync('/usr/bin/codesign', ['--verify', '--strict', `-R=${staged.requirement}`, staged.app], { timeout: 30_000, stdio: 'ignore' })
  const replaced = path.join(stagingDir(), 'replaced.app')
  fs.renameSync(bundle, replaced)
  try {
    fs.renameSync(staged.app, bundle)
  } catch (err) {
    fs.renameSync(replaced, bundle)
    throw err
  }
}
