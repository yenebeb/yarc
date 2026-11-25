// History sync between the user's computers through a place they choose (SyncLocation): a folder
// another app syncs (iCloud Drive…), a cloud drive YARC signs in to, their own WebDAV server, or
// directly between computers on the same network (nearby.ts, a proof of concept). For everything
// but a folder, this computer keeps a copy of the sync folder that remote.ts or nearby.ts keeps in
// step, and the engine works on the copy. Everything leaves this computer encrypted; YARC has no
// server either way. Only the main controller syncs; incognito windows have their own Profiles.
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, rmSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { locationName, type CloudDrive, type HistorySyncStatus, type SyncLocation } from '../../shared/sync'
import type { Profile } from '../../shared/types'
import type { History } from '../history'
import { availableDrives, driveApp, driveStore } from './cloud-drives'
import { changePassword, createHeader, openKeyring, SyncCryptoError, unlockHeader, type Keyring, type SyncHeader } from './crypto'
import { HEADER_FILE, newSyncId, readHeader, SyncEngine, writeHeader, type SyncedProfileInfo } from './engine'
import { cloudFolderGuess, icloudFolder, syncRoot } from './locations'
import { derivePairingKey, NearbySync } from './nearby'
import { OAuthSession, signIn } from './oauth'
import { RemoteMirror, SignedOutError, type RemoteStore } from './remote'
import { deviceId, forgetKey, loadKey, saveKey } from './saved-key'
import { WebDavStore } from './webdav'

/** What the main controller lends to sync. */
export interface SyncHost {
  readonly profileList: Profile[]
  history(profileId: string): History
  settings: { syncHistory: boolean; syncLocation?: SyncLocation }
  saveState(): void
  emitSoon(): void
  window(): BrowserWindow | undefined
}

const SEND_DELAY = 10_000
const WATCH_DELAY = 2_000
const FOCUS_INTERVAL = 30_000
const POLL_INTERVAL = 5 * 60_000
/** How long joining looks for a computer with the same password on the network. */
const NEARBY_SEARCH = 20_000

type RemoteLocation = Extract<SyncLocation, { kind: 'cloud' | 'server' }>

export class HistorySync {
  status: HistorySyncStatus
  private engine: SyncEngine | undefined
  private header: SyncHeader | undefined
  private master: Buffer | undefined
  private emptyPassword = false
  private watcher: FSWatcher | undefined
  private timers: NodeJS.Timeout[] = []
  private sendTimer: NodeJS.Timeout | undefined
  private watchTimer: NodeJS.Timeout | undefined
  private unfocus: (() => void) | undefined
  private lastReceive = 0
  /** One sync operation at a time. */
  private queue: Promise<unknown> = Promise.resolve()
  private passQueued = false
  private readonly dir = join(app.getPath('userData'), 'Sync')
  /** Nearby sync's copy of the sync folder. */
  private readonly nearbyDir = join(this.dir, 'Nearby')
  /** The copy of a cloud drive's or server's sync folder. */
  private readonly remoteDir = join(this.dir, 'Remote')
  private readonly host: SyncHost
  /** Where sync is set up, or being set up. */
  private location: SyncLocation | undefined
  private nearby: NearbySync | undefined
  private mirror: RemoteMirror | undefined
  /** The cloud drive's refresh token or the server's password, saved with the key once sync is on. */
  private credential: string | undefined
  private signingIn: AbortController | undefined

  constructor(host: SyncHost) {
    this.host = host
    this.status = this.offStatus()
  }

  // ---------------------------------------------------------------- lifecycle

  /** At launch: resumes sync with the saved key, or asks for the password. */
  start(): void {
    const { syncHistory, syncLocation } = this.host.settings
    if (!syncHistory || !syncLocation) return
    this.location = syncLocation
    void this.serial(() => this.restore()).then(() => this.passSoon())
  }

  /** At quit: writes what's still waiting, synchronously. A cloud drive or server gets it at the next launch. */
  shutdown(): void {
    this.stopWatching()
    this.stopNearby()
    this.signingIn?.abort()
    if (!this.engine) return
    for (const profile of this.syncedProfiles()) {
      try {
        const history = this.host.history(profile.id)
        if (history.meta('seq') !== undefined) this.engine.send(profile.syncKey!, history)
      } catch (error) {
        console.warn('[sync] could not send at quit:', (error as Error).message)
      }
    }
  }

  // ---------------------------------------------------------------- choosing where

  async pickFolder(): Promise<void> {
    const win = this.host.window()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a folder your computers sync',
      message: 'Pick a folder another app keeps in sync, like Syncthing or a network drive. On your other computers, pick the same folder.',
      buttonLabel: 'Use This Folder',
      defaultPath: cloudFolderGuess(),
      properties: ['openDirectory', 'createDirectory']
    }
    const result = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return
    this.setUpFolder(syncRoot(picked))
  }

  useICloud(): void {
    const folder = icloudFolder()
    if (folder) this.setUpFolder(syncRoot(folder))
  }

  setUpNearby(): void {
    this.leaveLocation()
    this.location = { kind: 'nearby' }
    this.setStatus({ state: 'setup', location: this.location, existing: false })
  }

  /** Opens the drive's sign-in page in the browser, then looks for a sync already there. */
  signInToDrive(drive: CloudDrive): Promise<void> {
    this.leaveLocation()
    const location: RemoteLocation = { kind: 'cloud', drive }
    this.location = location
    return this.whileSigningIn(location, async (signal) => {
      const signedIn = await signIn(driveApp(drive), (url) => void shell.openExternal(url), signal)
      this.credential = signedIn.refreshToken
      const store = this.remoteStore(location)
      location.account = signedIn.email ?? (await store.email?.())
      await this.openRemote(location, store)
    })
  }

  /** The cloud drive signed YARC out: signs in again and carries on. */
  signInAgain(): Promise<void> {
    const location = this.location
    if (location?.kind !== 'cloud' || this.status.state !== 'locked') return Promise.resolve()
    return this.whileSigningIn(location, async (signal) => {
      const signedIn = await signIn(driveApp(location.drive), (url) => void shell.openExternal(url), signal)
      this.saveCredential(signedIn.refreshToken)
      await this.restore()
    }).then(() => this.passSoon())
  }

  /** Connects to a WebDAV server, or signs in to it again when it refused the saved password. */
  setUpServer(url: string, username: string, password: string): Promise<void> {
    const before = this.status
    const current = this.location
    const again = before.state === 'locked' && current?.kind === 'server' && current.url === url && current.username === username
    return this.serial(async () => {
      try {
        const store = new WebDavStore({ url, username, password })
        const location: RemoteLocation = { kind: 'server', url: store.folderUrl, username }
        this.setStatus({ state: 'working', location, message: 'Connecting to your server…' })
        await store.connect()
        if (again) {
          this.saveCredential(password)
          return this.restore()
        }
        this.leaveLocation()
        this.location = location
        this.credential = password
        await this.openRemote(location, store)
      } catch (error) {
        const message = (error as Error).message
        this.setStatus(before.state === 'locked' ? { ...before, error: message } : this.offStatus(message))
      }
    }).then(() => this.passSoon())
  }

  private setUpFolder(path: string): void {
    this.leaveLocation()
    this.location = { kind: 'folder', path }
    this.setStatus({ state: 'setup', location: this.location, existing: existsSync(join(path, HEADER_FILE)) })
  }

  private whileSigningIn(location: RemoteLocation, task: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const before = this.status
    const signing = new AbortController()
    this.signingIn = signing
    this.setStatus({ state: 'working', location, message: `Sign in to ${locationName(location)} in your browser…`, cancellable: true })
    return this.serial(async () => {
      try {
        await task(signing.signal)
      } catch (error) {
        const message = signing.signal.aborted ? undefined : (error as Error).message
        if (before.state === 'locked') return this.setStatus({ ...before, error: message })
        this.leaveLocation()
        this.setStatus(this.offStatus(message))
      } finally {
        this.signingIn = undefined
      }
    })
  }

  /** Starts a fresh copy of the store's sync folder, and asks for the sync password next. */
  private async openRemote(location: RemoteLocation, store: RemoteStore): Promise<void> {
    rmSync(this.remoteDir, { recursive: true, force: true })
    this.mirror = new RemoteMirror({ root: this.remoteDir, store, deviceId: deviceId(this.dir) })
    this.setStatus({ state: 'working', location, message: `Looking for a sync in ${locationName(location)}…` })
    await this.mirror.pull()
    this.setStatus({ state: 'setup', location, existing: existsSync(join(this.remoteDir, HEADER_FILE)) })
  }

  private remoteStore(location: RemoteLocation): RemoteStore & { email?(): Promise<string | undefined> } {
    const credential = this.credential ?? ''
    if (location.kind === 'server') return new WebDavStore({ url: location.url, username: location.username, password: credential })
    return driveStore(location.drive, new OAuthSession(driveApp(location.drive), credential, (token) => this.saveCredential(token)))
  }

  /** A new refresh token or server password; saved with the key once sync is on. */
  private saveCredential(credential: string): void {
    this.credential = credential
    const saved = loadKey(this.dir)
    if (saved) saveKey(this.dir, { ...saved, credential })
  }

  // ---------------------------------------------------------------- turning on

  /**
   * Turns sync on at the chosen location: joins its sync when it has one, else starts one
   * protected by `password`. With nearby sync, joins a computer on the network with the same
   * password, or starts a new sync when `create` is set.
   */
  connect(password: string, create = false): Promise<void> {
    const before = this.status
    if (before.state !== 'setup' && before.state !== 'locked') return Promise.resolve()
    const location = before.location
    if (location.kind === 'nearby') return this.connectNearby(password, create)
    const existing = before.state === 'locked' || before.existing
    const root = this.rootOf(location)
    return this.serial(async () => {
      this.setStatus({ state: 'working', location, message: existing ? 'Checking the password…' : 'Setting up sync…' })
      try {
        mkdirSync(root, { recursive: true })
        await this.mirror?.pull()
        let header = await readHeader(root)
        let master: Buffer
        let keyring: Keyring
        if (header) {
          ;({ master, keyring } = await unlockHeader(header, password))
        } else {
          ;({ header, master, keyring } = await createHeader(password))
          writeHeader(root, header)
        }
        await this.begin(header, master, keyring, password)
      } catch (error) {
        const message = error instanceof SyncCryptoError && error.code === 'wrong-password' ? 'Wrong password. Nothing was synced.' : (error as Error).message
        this.setStatus(before.state === 'locked' ? { ...before, error: message } : { state: 'setup', location, existing, error: message })
      }
    }).then(() => this.passSoon())
  }

  /**
   * Nearby sync: starts looking for computers with the same password, then waits for a sync.json
   * the password opens (this computer's own, or one a nearby computer sends). With `create` and
   * no sync.json, starts a new sync instead of waiting.
   */
  private connectNearby(password: string, create: boolean): Promise<void> {
    const before = this.status
    const location: SyncLocation = { kind: 'nearby' }
    const root = this.nearbyDir
    const fail = (error: string, searched = false) =>
      this.setStatus(before.state === 'locked' ? { ...before, error } : { state: 'setup', location, existing: false, searched, error })
    if (password === '') {
      fail('Nearby sync needs a password: without one, anyone on your network could join it.')
      return Promise.resolve()
    }
    return this.serial(async () => {
      this.setStatus({ state: 'working', location, message: create ? 'Starting a new sync…' : 'Looking for a computer with this password on your network…' })
      try {
        mkdirSync(root, { recursive: true })
        const pairing = await derivePairingKey(password)
        await this.startNearby([pairing])
        const deadline = Date.now() + (create ? 0 : NEARBY_SEARCH)
        let tried: string | undefined
        let unlocked: { header: SyncHeader; master: Buffer; keyring: Keyring } | undefined
        for (;;) {
          const header = await readHeader(root).catch(() => undefined)
          if (header && header.check !== tried) {
            tried = header.check
            try {
              unlocked = { header, ...(await unlockHeader(header, password)) }
              break
            } catch (error) {
              if (!(error instanceof SyncCryptoError && error.code === 'wrong-password')) throw error
            }
          }
          if (Date.now() >= deadline) break
          await new Promise((resolve) => setTimeout(resolve, 1_000))
        }
        if (!unlocked) {
          const header = await readHeader(root).catch(() => undefined)
          if (!create || header) {
            this.stopNearby()
            return fail(
              header
                ? 'Wrong password. Nothing was synced.'
                : 'No computer with this password found on your network. Open YARC on your other computer with nearby sync on, or start a new sync here.',
              !header
            )
          }
          unlocked = await createHeader(password)
          writeHeader(root, unlocked.header)
        }
        await this.begin(unlocked.header, unlocked.master, unlocked.keyring, password, [pairing])
      } catch (error) {
        this.stopNearby()
        fail((error as Error).message)
      }
    }).then(() => this.passSoon())
  }

  /** Saves the key and settings, then starts syncing. */
  private async begin(header: SyncHeader, master: Buffer, keyring: Keyring, password: string, pairing?: Buffer[]): Promise<void> {
    saveKey(this.dir, {
      folderId: header.folderId,
      check: header.check,
      master: master.toString('base64'),
      emptyPassword: password === '',
      pairing: pairing?.map((key) => key.toString('base64')),
      credential: this.credential
    })
    Object.assign(this.host.settings, { syncHistory: true, syncLocation: this.location })
    this.host.saveState()
    this.resume(header, master, keyring, password === '')
    await this.matchProfiles()
  }

  /** At launch or after signing in again: resumes with the saved key, else asks for the password. */
  private async restore(): Promise<void> {
    const location = this.location!
    const saved = loadKey(this.dir)
    const root = this.rootOf(location)
    if (location.kind === 'nearby') {
      mkdirSync(root, { recursive: true })
      if (saved?.pairing?.length) await this.startNearby(saved.pairing.map((key) => Buffer.from(key, 'base64'))).catch((error) => console.warn('[sync] nearby:', error))
    }
    if (location.kind === 'cloud' || location.kind === 'server') {
      this.credential = saved?.credential
      if (!this.credential) return this.lock('signed-out')
      this.mirror = new RemoteMirror({ root, store: this.remoteStore(location), deviceId: deviceId(this.dir) })
      try {
        await this.mirror.pull()
      } catch (error) {
        if (error instanceof SignedOutError) return this.lock('signed-out')
        console.warn('[sync] offline, starting from the copy here:', (error as Error).message)
      }
    }
    if (!existsSync(root)) return this.lock('missing-folder')
    const header = await readHeader(root).catch(() => undefined)
    if (!saved || !header || header.folderId !== saved.folderId) return this.lock('no-saved-key')
    try {
      const master = Buffer.from(saved.master, 'base64')
      this.resume(header, master, openKeyring(header, master), saved.emptyPassword)
    } catch (error) {
      if (error instanceof SyncCryptoError && error.code === 'wrong-password') return this.lock('password-changed')
      this.setStatus({ state: 'locked', location, reason: 'no-saved-key', error: (error as Error).message })
    }
  }

  // ---------------------------------------------------------------- while on

  /** Rotates to a new key protected by `password`; other devices ask for it on their next sync. */
  changePassword(password: string): Promise<void> {
    return this.serial(async () => {
      const engine = this.engine
      const header = this.header
      const location = this.location
      if (!engine || !header || !location || this.status.state !== 'on') return
      this.setStatus({ state: 'working', location, message: 'Changing the password…' })
      try {
        const next = await changePassword(header, engine.keyring, password)
        // Nearby: the new password meets computers under a new pairing key; the old one stays, so
        // computers still on the old password get the new sync.json and ask for the new password.
        let pairing: Buffer[] | undefined
        if (location.kind === 'nearby') {
          const old = loadKey(this.dir)?.pairing?.[0]
          pairing = [await derivePairingKey(password), ...(old ? [Buffer.from(old, 'base64')] : [])]
        }
        writeHeader(engine.root, next.header)
        saveKey(this.dir, {
          folderId: next.header.folderId,
          check: next.header.check,
          master: next.master.toString('base64'),
          emptyPassword: password === '',
          pairing: pairing?.map((key) => key.toString('base64')),
          credential: this.credential
        })
        if (pairing) await this.startNearby(pairing)
        this.header = next.header
        this.master = next.master
        this.emptyPassword = password === ''
        engine.keyring = next.keyring
        this.writeProfiles(engine)
        for (const profile of this.syncedProfiles()) await engine.reencrypt(profile.syncKey!, this.host.history(profile.id))
        await this.mirror?.push()
        this.setStatus({ state: 'on', location, emptyPassword: this.emptyPassword, lastSync: Date.now() })
      } catch (error) {
        this.setStatus({ state: 'on', location, emptyPassword: this.emptyPassword, error: `Couldn’t change the password: ${(error as Error).message}` })
      }
    })
  }

  /** Stops syncing. The synced files are left as they are; this device forgets the key and its sync bookkeeping. */
  turnOff(): Promise<void> {
    return this.serial(async () => {
      this.stopWatching()
      for (const profile of this.host.profileList) {
        try {
          this.host.history(profile.id).unlink()
        } catch {}
      }
      this.engine = undefined
      this.header = undefined
      this.master = undefined
      this.leaveLocation()
      forgetKey(this.dir)
      this.host.settings.syncHistory = false
      delete this.host.settings.syncLocation
      this.host.saveState()
      this.setStatus(this.offStatus())
    })
  }

  /** Cancels waiting for a sign-in, or a location that wasn't confirmed with a password. */
  cancelSetup(): void {
    if (this.status.state === 'working' && this.status.cancellable) return this.signingIn?.abort()
    if (this.status.state !== 'setup') return
    this.leaveLocation()
    this.setStatus(this.offStatus())
  }

  /** The profile's switch in Settings. Off forgets its sync bookkeeping; its key is kept, so on again picks up where it was. */
  setProfileSync(profileId: string, on: boolean): Promise<void> {
    return this.serial(async () => {
      const profile = this.host.profileList.find((candidate) => candidate.id === profileId)
      if (!profile) return
      profile.syncHistory = on
      this.host.saveState()
      if (!on) {
        const history = this.host.history(profileId)
        history.onChange = undefined
        if (!history.isClosed) history.unlink()
      }
      if (this.engine) this.writeProfiles(this.engine)
      this.host.emitSoon()
    }).then(() => this.passSoon())
  }

  /** Profiles were added, renamed or removed. */
  profilesChanged(): void {
    if (this.engine) this.passSoon()
  }

  // ---------------------------------------------------------------- syncing

  private resume(header: SyncHeader, master: Buffer, keyring: Keyring, emptyPassword: boolean): void {
    const location = this.location!
    const root = this.rootOf(location)
    this.header = header
    this.master = master
    this.emptyPassword = emptyPassword
    this.engine = new SyncEngine({ root, deviceId: deviceId(this.dir), keyring })
    for (const profile of this.syncedProfiles()) this.linkHistory(profile.id)
    this.setStatus({ state: 'on', location, emptyPassword })
    this.startWatching(root)
  }

  /** Profiles whose history syncs, each with its sync key. */
  private syncedProfiles(): Profile[] {
    return this.host.profileList.filter((profile) => profile.syncKey && syncsHistory(profile))
  }

  /**
   * Gives every profile a sync key: the one it already has when the sync knows it, else the key
   * of a profile with the same name on another device, else a new one. The link is kept, so
   * renaming a profile later doesn't break it.
   */
  private async matchProfiles(): Promise<void> {
    const engine = this.engine
    if (!engine) return
    const remote = await engine.readProfiles()
    const known = new Set(remote.map((info) => info.key))
    const taken = new Set<string>()
    let changed = false
    for (const profile of this.host.profileList.filter(syncsHistory)) {
      if (profile.syncKey && known.has(profile.syncKey)) {
        taken.add(profile.syncKey)
        continue
      }
      const sameName = remote.find((info) => !taken.has(info.key) && sameProfileName(info.name, profile.name))
      const key = sameName?.key ?? profile.syncKey ?? newSyncId()
      if (key !== profile.syncKey) {
        profile.syncKey = key
        changed = true
      }
      taken.add(key)
    }
    if (changed) this.host.saveState()
    this.writeProfiles(engine)
  }

  /** From now on, the profile's local changes are queued for the sync folder and sent soon after. */
  private linkHistory(profileId: string): History {
    const history = this.host.history(profileId)
    if (history.isClosed) return history
    history.link(this.header!.folderId)
    history.onChange = () => this.sendSoon()
    return history
  }

  private writeProfiles(engine: SyncEngine): void {
    engine.writeProfiles(this.syncedProfiles().map((profile): SyncedProfileInfo => ({ key: profile.syncKey!, name: profile.name })))
  }

  /** A full pass: fetch from the store, check the header, give new profiles keys, send, receive, compact, upload. */
  private passSoon(): void {
    if (this.passQueued || !this.engine) return
    this.passQueued = true
    void this.serial(async () => {
      this.passQueued = false
      await this.pass()
    })
  }

  private async pass(receiveOnly = false): Promise<void> {
    const engine = this.engine
    const location = this.location
    if (!engine || !location || this.status.state !== 'on') return
    try {
      await this.mirror?.pull()
      if (!(await this.checkHeader())) return
      if (!receiveOnly) await this.matchProfiles()
      let unknownKey = false
      for (const profile of this.syncedProfiles()) {
        const history = this.linkHistory(profile.id)
        if (history.isClosed) continue
        await engine.lastSeq(profile.syncKey!, history)
        if (!receiveOnly) engine.send(profile.syncKey!, history)
        const received = await engine.receive(profile.syncKey!, history)
        unknownKey ||= received.unknownKey
        if (!receiveOnly) await engine.compact(profile.syncKey!, history)
      }
      this.lastReceive = Date.now()
      // A chunk sealed with a key we lack means the password changed: the header says so too.
      if (unknownKey && !(await this.checkHeader())) return
      await this.mirror?.push()
      if (this.status.state === 'on') this.setStatus({ state: 'on', location, emptyPassword: this.emptyPassword, lastSync: Date.now() })
    } catch (error) {
      if (error instanceof SignedOutError) return this.lock('signed-out')
      console.warn('[sync]', error)
      const message = isOffline(error) ? `Couldn’t reach ${locationName(location)}. YARC tries again in a few minutes.` : (error as Error).message
      if (this.status.state === 'on') this.setStatus({ ...this.status, error: message })
    }
  }

  /** Re-reads sync.json: another device may have changed the password. Returns false when sync must stop. */
  private async checkHeader(): Promise<boolean> {
    const engine = this.engine!
    const header = await readHeader(engine.root).catch(() => undefined)
    if (!header) {
      this.lock('missing-folder')
      return false
    }
    if (header.check === this.header?.check && header.keyring === this.header.keyring) return true
    try {
      engine.keyring = openKeyring(header, this.master!)
      this.header = header
      return true
    } catch {
      this.lock('password-changed')
      return false
    }
  }

  private lock(reason: Extract<HistorySyncStatus, { state: 'locked' }>['reason']): void {
    this.stopWatching()
    this.engine = undefined
    this.setStatus({ state: 'locked', location: this.location!, reason })
  }

  private sendSoon(): void {
    clearTimeout(this.sendTimer)
    this.sendTimer = setTimeout(() => this.passSoon(), SEND_DELAY)
  }

  private receiveSoon(): void {
    if (!this.engine) return
    void this.serial(() => this.pass(true))
  }

  /** A synced folder is watched; a cloud drive or server, which nothing announces, is checked every few minutes and on focus. */
  private startWatching(root: string): void {
    this.stopWatching()
    const ownId = deviceId(this.dir)
    if (!this.mirror) {
      try {
        this.watcher = watch(root, { recursive: true }, (_event, name) => {
          const file = String(name ?? '')
          // Our own writes, and temporary files, don't need a pass.
          if (file.includes(ownId) || file.endsWith('.tmp')) return
          clearTimeout(this.watchTimer)
          this.watchTimer = setTimeout(() => this.receiveSoon(), WATCH_DELAY)
        })
        this.watcher.on('error', () => this.watcher?.close())
      } catch (error) {
        console.warn('[sync] can’t watch the folder, checking every few minutes instead:', (error as Error).message)
      }
    }
    this.timers.push(setInterval(() => this.passSoon(), POLL_INTERVAL))
    const onFocus = () => {
      if (Date.now() - this.lastReceive > FOCUS_INTERVAL) this.receiveSoon()
    }
    app.on('browser-window-focus', onFocus)
    this.unfocus = () => app.off('browser-window-focus', onFocus)
  }

  private stopWatching(): void {
    this.watcher?.close()
    this.watcher = undefined
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
    clearTimeout(this.sendTimer)
    clearTimeout(this.watchTimer)
    this.unfocus?.()
    this.unfocus = undefined
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }

  private setStatus(status: HistorySyncStatus): void {
    this.status = status.state === 'on' && this.nearby ? { ...status, peers: this.nearby.peerCount } : status
    this.host.emitSoon()
  }

  private offStatus(error?: string): HistorySyncStatus {
    return { state: 'off', drives: availableDrives(), icloud: !!icloudFolder(), error }
  }

  // ---------------------------------------------------------------- where the files are

  private rootOf(location: SyncLocation): string {
    if (location.kind === 'folder') return location.path
    return location.kind === 'nearby' ? this.nearbyDir : this.remoteDir
  }

  /** Forgets the location being set up or synced with. Nearby's copy stays; a cloud drive's or server's copy is only a cache. */
  private leaveLocation(): void {
    this.stopNearby()
    this.mirror = undefined
    this.credential = undefined
    this.location = undefined
    rmSync(this.remoteDir, { recursive: true, force: true })
  }

  private async startNearby(keys: Buffer[]): Promise<void> {
    this.stopNearby()
    const nearby = new NearbySync({
      root: this.nearbyDir,
      deviceId: deviceId(this.dir),
      keys,
      onPeers: () => {
        if (this.status.state !== 'off') this.setStatus(this.status)
      },
      onReceived: () => this.receiveSoon(),
      onConflict: (error) => {
        if (this.status.state === 'on') this.setStatus({ ...this.status, error })
      }
    })
    this.nearby = nearby
    try {
      await nearby.start()
    } catch (error) {
      nearby.stop()
      this.nearby = undefined
      throw error
    }
  }

  private stopNearby(): void {
    this.nearby?.stop()
    this.nearby = undefined
  }
}

/** fetch fails with a TypeError when the network is down, and times out with a TimeoutError. */
function isOffline(error: unknown): boolean {
  return (error instanceof TypeError && error.message === 'fetch failed') || (error instanceof Error && error.name === 'TimeoutError')
}

function syncsHistory(profile: Profile): boolean {
  return profile.syncHistory !== false
}

function sameProfileName(name: string, other: string): boolean {
  return name.trim().localeCompare(other.trim(), undefined, { sensitivity: 'accent' }) === 0
}
