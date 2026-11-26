import { app, dialog, shell, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { locationName, type CloudDrive, type HistorySyncStatus, type SyncLocation } from '../../shared/sync'
import type { Profile } from '../../shared/types'
import type { History } from '../history'
import { availableDrives, driveApp, driveStore } from './cloud-drives'
import { changePassword, createHeader, openKeyring, SyncCryptoError, unlockHeader, type Keyring, type SyncHeader } from './crypto'
import { HEADER_FILE, newSyncId, readHeader, removeSyncFiles, SyncEngine, writeHeader, type SyncedProfileInfo } from './engine'
import { cloudFolderGuess, icloudFolder, syncRoot } from './locations'
import { derivePairingKey, NearbySync } from './nearby'
import { OAuthSession, signIn } from './oauth'
import { RemoteMirror, SignedOutError, type RemoteStore } from './remote'
import { deviceId, forgetKey, loadKey, saveKey } from './saved-key'
import { SyncSchedule } from './schedule'
import { WebDavStore } from './webdav'

export interface SyncHost {
  readonly profileList: Profile[]
  history(profileId: string): History
  settings: { syncHistory: boolean; syncLocation?: SyncLocation }
  saveState(): void
  emitSoon(): void
  window(): BrowserWindow | undefined
}

const NEARBY_SEARCH = 20_000

type RemoteLocation = Extract<SyncLocation, { kind: 'cloud' | 'server' }>

export class HistorySync {
  status: HistorySyncStatus
  private engine: SyncEngine | undefined
  private header: SyncHeader | undefined
  private master: Buffer | undefined
  private emptyPassword = false
  private readonly schedule = new SyncSchedule({ pass: () => this.passSoon(), receive: () => this.receiveSoon() })
  private queue: Promise<unknown> = Promise.resolve()
  private passQueued = false
  private readonly dir = join(app.getPath('userData'), 'Sync')
  private readonly nearbyDir = join(this.dir, 'Nearby')
  private readonly remoteDir = join(this.dir, 'Remote')
  private readonly host: SyncHost
  private location: SyncLocation | undefined
  private nearby: NearbySync | undefined
  private mirror: RemoteMirror | undefined
  private credential: string | undefined
  private signingIn: AbortController | undefined

  constructor(host: SyncHost) {
    this.host = host
    this.status = this.offStatus()
  }

  start(): void {
    const { syncHistory, syncLocation } = this.host.settings
    if (!syncHistory || !syncLocation) return
    this.location = syncLocation
    this.restoreThenPass(() => true)
  }

  /** At quit: writes what's still waiting, synchronously. A cloud drive or server gets it at the next launch. */
  shutdown(): void {
    this.schedule.stop()
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

  signInAgain(): Promise<void> {
    const location = this.location
    if (location?.kind !== 'cloud' || this.status.state !== 'locked') return Promise.resolve()
    return this.whileSigningIn(location, async (signal) => {
      const signedIn = await signIn(driveApp(location.drive), (url) => void shell.openExternal(url), signal)
      this.saveCredential(signedIn.refreshToken)
      await this.restore()
    }).then(() => this.passSoon())
  }

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

  private saveCredential(credential: string): void {
    this.credential = credential
    const saved = loadKey(this.dir)
    if (saved) saveKey(this.dir, { ...saved, credential })
  }

  connect(password: string, create = false): Promise<void> {
    const before = this.status
    if (before.state !== 'setup' && before.state !== 'locked') return Promise.resolve()
    const location = before.location
    if (location.kind === 'nearby') return this.connectNearby(password, create)
    const existing = before.state === 'locked' || before.existing
    const startOver = create && before.state === 'setup' && before.existing
    const root = this.rootOf(location)
    return this.serial(async () => {
      const message = startOver ? 'Starting a new sync…' : existing ? 'Checking the password…' : 'Setting up sync…'
      this.setStatus({ state: 'working', location, message })
      try {
        mkdirSync(root, { recursive: true })
        await this.mirror?.pull()
        if (startOver) await this.removeSyncKeptThere(root)
        let header = await readHeader(root)
        let master: Buffer
        let keyring: Keyring
        if (header) {
          ;({ master, keyring } = await unlockHeader(header, password))
        } else if (existing && !startOver) {
          throw new Error(`YARC can’t read sync.json in ${locationName(location)} right now. Try again in a moment.`)
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

  // The old sync's files can't be read without its password, and its logs would stand in the way of the new sync's.
  private async removeSyncKeptThere(root: string): Promise<void> {
    if (this.mirror) return this.mirror.clear()
    removeSyncFiles(root)
  }

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
        const found = { otherSync: false }
        const startNearby = () => this.startNearby([pairing], () => (found.otherSync = true))
        await startNearby()
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
          if (found.otherSync && before.state === 'setup') {
            found.otherSync = false
            tried = undefined
            this.emptyNearbyCopy()
            await startNearby()
          }
          if (Date.now() >= deadline) break
          await new Promise((resolve) => setTimeout(resolve, 1_000))
        }
        if (!unlocked) {
          const leftover = await readHeader(root).catch(() => undefined)
          const wrongPassword = !!leftover && before.state === 'locked'
          if (!create || wrongPassword) {
            this.stopNearby()
            return fail(
              wrongPassword
                ? 'Wrong password. Nothing was synced.'
                : 'No computer with this password found on your network. Open YARC on your other computer with nearby sync on, or start a new sync here.',
              !wrongPassword
            )
          }
          if (leftover) {
            this.emptyNearbyCopy()
            await startNearby()
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

  private async restore(): Promise<void> {
    const location = this.location!
    const saved = loadKey(this.dir)
    const root = this.rootOf(location)
    if (location.kind === 'nearby') {
      mkdirSync(root, { recursive: true })
      if (saved?.pairing?.length) await this.startNearby(saved.pairing.map((key) => Buffer.from(key, 'base64'))).catch((error) => console.warn('[sync] nearby:', error))
    }
    if (location.kind === 'cloud' || location.kind === 'server') {
      this.credential = saved?.credential ?? this.credential
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
    if (!header) return this.lock('missing-folder')
    if (!saved || header.folderId !== saved.folderId) return this.lock('no-saved-key')
    try {
      const master = Buffer.from(saved.master, 'base64')
      this.resume(header, master, openKeyring(header, master), saved.emptyPassword)
    } catch (error) {
      if (error instanceof SyncCryptoError && error.code === 'wrong-password') return this.lock('password-changed')
      this.setStatus({ state: 'locked', location, reason: 'no-saved-key', error: (error as Error).message })
    }
  }

  changePassword(password: string): Promise<void> {
    return this.serial(async () => {
      const engine = this.engine
      const header = this.header
      const location = this.location
      if (!engine || !header || !location || this.status.state !== 'on') return
      this.setStatus({ state: 'working', location, message: 'Changing the password…' })
      try {
        const next = await changePassword(header, engine.keyring, password)
        // The old pairing key stays, so computers still on the old password get the new sync.json and ask for the new one.
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

  turnOff(): Promise<void> {
    return this.serial(async () => {
      this.schedule.stop()
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

  cancelSetup(): void {
    if (this.status.state === 'working' && this.status.cancellable) return this.signingIn?.abort()
    if (this.status.state !== 'setup') return
    this.leaveLocation()
    this.setStatus(this.offStatus())
  }

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

  profilesChanged(): void {
    if (this.engine) this.passSoon()
  }

  private resume(header: SyncHeader, master: Buffer, keyring: Keyring, emptyPassword: boolean): void {
    const location = this.location!
    const root = this.rootOf(location)
    this.header = header
    this.master = master
    this.emptyPassword = emptyPassword
    this.engine = new SyncEngine({ root, deviceId: deviceId(this.dir), keyring })
    for (const profile of this.syncedProfiles()) this.linkHistory(profile.id)
    this.setStatus({ state: 'on', location, emptyPassword })
    this.schedule.start(root, deviceId(this.dir), !this.mirror)
  }

  private syncedProfiles(): Profile[] {
    return this.host.profileList.filter((profile) => profile.syncKey && syncsHistory(profile))
  }

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

  private linkHistory(profileId: string): History {
    const history = this.host.history(profileId)
    if (history.isClosed) return history
    history.link(this.header!.folderId)
    history.onChange = () => this.schedule.sendSoon()
    return history
  }

  private writeProfiles(engine: SyncEngine): void {
    engine.writeProfiles(this.syncedProfiles().map((profile): SyncedProfileInfo => ({ key: profile.syncKey!, name: profile.name })))
  }

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
      this.schedule.lastReceive = Date.now()
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
    this.schedule.stop()
    this.engine = undefined
    this.setStatus({ state: 'locked', location: this.location!, reason })
    if (reason === 'missing-folder') this.schedule.retrySoon(() => this.restoreThenPass(() => this.status.state === 'locked' && this.status.reason === 'missing-folder'))
  }

  private restoreThenPass(stillWanted: () => boolean): void {
    const restored = this.serial(async () => {
      if (stillWanted()) await this.restore()
    })
    void restored.then(
      () => this.passSoon(),
      (error) => console.warn('[sync]', error)
    )
  }

  private receiveSoon(): void {
    if (!this.engine) return
    void this.serial(() => this.pass(true))
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

  private async startNearby(keys: Buffer[], onOtherSync?: () => void): Promise<void> {
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
        onOtherSync?.()
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

  // A sync that was turned off leaves its copy behind, and its sync.json keeps another sync's from arriving.
  private emptyNearbyCopy(): void {
    this.stopNearby()
    rmSync(this.nearbyDir, { recursive: true, force: true })
    mkdirSync(this.nearbyDir, { recursive: true })
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
