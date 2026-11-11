// History sync through a folder the user already syncs (iCloud Drive, Dropbox, OneDrive), or
// directly between computers on the same network (nearby.ts, a proof of concept), where each
// computer keeps a private copy of the folder and the computers copy the encrypted files themselves.
// YARC has no server either way.
// Only the main controller syncs; incognito windows have their own Profiles and never reach here.
import { app, dialog, safeStorage, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HistorySyncStatus } from '../../shared/sync'
import type { Profile } from '../../shared/types'
import type { History } from '../history'
import { changePassword, createHeader, openKeyring, SyncCryptoError, unlockHeader, type Keyring, type SyncHeader } from './crypto'
import { HEADER_FILE, newSyncId, readHeader, SyncEngine, writeHeader, type SyncedProfileInfo } from './engine'
import { derivePairingKey, NearbySync } from './nearby'

/** What the main controller lends to sync. */
export interface SyncHost {
  readonly profileList: Profile[]
  history(profileId: string): History
  settings: { syncHistory: boolean; syncFolder: string; syncNearby: boolean }
  saveState(): void
  emitSoon(): void
  window(): BrowserWindow | undefined
}

/** Where the master key is kept between launches; never the password itself. */
interface SavedKey {
  folderId: string
  check: string
  master: string
  emptyPassword: boolean
  /** Nearby sync: pairing keys, base64, the current one first (see nearby.ts). */
  pairing?: string[]
}

const SEND_DELAY = 10_000
const WATCH_DELAY = 2_000
const FOCUS_INTERVAL = 30_000
const POLL_INTERVAL = 5 * 60_000
/** The folder created inside a non-empty folder the user picks, so YARC's files stay together. */
const SUBFOLDER = 'YARC Sync'
/** How long joining looks for a computer with the same password on the network. */
const NEARBY_SEARCH = 20_000

export class HistorySync {
  status: HistorySyncStatus = { state: 'off' }
  private engine: SyncEngine | undefined
  private header: SyncHeader | undefined
  private master: Buffer | undefined
  private emptyPassword = false
  private watcher: FSWatcher | undefined
  private timers: NodeJS.Timeout[] = []
  private sendTimer: NodeJS.Timeout | undefined
  private watchTimer: NodeJS.Timeout | undefined
  private lastReceive = 0
  /** One folder operation at a time. */
  private queue: Promise<unknown> = Promise.resolve()
  private passQueued = false
  private readonly dir = join(app.getPath('userData'), 'Sync')
  /** Nearby sync's private copy of the sync folder. */
  private readonly nearbyDir = join(this.dir, 'Nearby')
  private mode: 'folder' | 'nearby' = 'folder'
  private nearby: NearbySync | undefined

  constructor(private host: SyncHost) {}

  // ---------------------------------------------------------------- lifecycle

  /** At launch: resumes sync with the saved key, or asks for the password. */
  start(): void {
    const { syncHistory, syncFolder, syncNearby } = this.host.settings
    if (!syncHistory || !syncFolder) return
    this.mode = syncNearby ? 'nearby' : 'folder'
    void this.serial(async () => {
      const saved = this.loadKey()
      if (this.mode === 'nearby') {
        mkdirSync(syncFolder, { recursive: true })
        if (saved?.pairing?.length) {
          await this.startNearby(saved.pairing.map((k) => Buffer.from(k, 'base64'))).catch((err) => console.warn('[sync] nearby:', err))
        }
      }
      if (!existsSync(syncFolder)) return this.setStatus({ state: 'locked', folder: syncFolder, reason: 'missing-folder' })
      const header = await readHeader(syncFolder).catch(() => undefined)
      if (!saved || !header || header.folderId !== saved.folderId) return this.setStatus({ state: 'locked', folder: syncFolder, reason: 'no-saved-key' })
      try {
        this.resume(syncFolder, header, Buffer.from(saved.master, 'base64'), openKeyring(header, Buffer.from(saved.master, 'base64')), saved.emptyPassword)
      } catch (err) {
        if (err instanceof SyncCryptoError && err.code === 'wrong-password') return this.setStatus({ state: 'locked', folder: syncFolder, reason: 'password-changed' })
        return this.setStatus({ state: 'locked', folder: syncFolder, reason: 'no-saved-key', error: (err as Error).message })
      }
    }).then(() => this.passSoon())
  }

  /** At quit: writes what's still waiting, synchronously. */
  shutdown(): void {
    this.stopWatching()
    this.stopNearby()
    if (!this.engine) return
    for (const p of this.syncedProfiles()) {
      try {
        if (this.host.history(p.id).meta('seq') !== undefined) this.engine.send(p.syncKey!, this.host.history(p.id))
      } catch (err) {
        console.warn('[sync] could not send at quit:', (err as Error).message)
      }
    }
  }

  // ---------------------------------------------------------------- user actions

  async pickFolder(): Promise<void> {
    const win = this.host.window()
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a folder your computers sync',
      message: 'Pick a folder in iCloud Drive, Dropbox or OneDrive. On your other computers, pick the same folder.',
      buttonLabel: 'Use This Folder',
      defaultPath: cloudFolderGuess(),
      properties: ['openDirectory', 'createDirectory']
    }
    const res = await (win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts))
    const picked = res.filePaths[0]
    if (res.canceled || !picked) return
    const root = syncRoot(picked)
    this.stopNearby()
    this.mode = 'folder'
    this.setStatus({ state: 'setup', folder: root, existing: existsSync(join(root, HEADER_FILE)) })
  }

  /** Nearby sync instead of a folder: asks for the password next. */
  setUpNearby(): void {
    this.stopNearby()
    this.mode = 'nearby'
    this.setStatus({ state: 'setup', folder: this.nearbyDir, existing: false })
  }

  /**
   * Turns sync on with the picked folder: joins its sync when it has one, else starts one protected
   * by `password`. With nearby sync, joins a computer on the network with the same password, or
   * starts a new sync when `create` is set.
   */
  connect(password: string, create = false): Promise<void> {
    const s = this.status
    const folder = s.state === 'setup' || s.state === 'locked' ? s.folder : undefined
    if (!folder) return Promise.resolve()
    if (this.mode === 'nearby') return this.connectNearby(folder, password, create)
    const existing = s.state === 'locked' || (s.state === 'setup' && s.existing)
    return this.serial(async () => {
      this.setStatus({ state: 'working', folder, message: existing ? 'Checking the password…' : 'Setting up the sync folder…' })
      try {
        mkdirSync(folder, { recursive: true })
        let header = await readHeader(folder)
        let master: Buffer
        let keyring: Keyring
        if (header) {
          ;({ master, keyring } = await unlockHeader(header, password))
        } else {
          ;({ header, master, keyring } = await createHeader(password))
          writeHeader(folder, header)
        }
        await this.begin(folder, header, master, keyring, password)
      } catch (err) {
        const message = err instanceof SyncCryptoError && err.code === 'wrong-password' ? 'Wrong password. Nothing was synced.' : (err as Error).message
        this.setStatus(s.state === 'locked' ? { ...s, error: message } : { state: 'setup', folder, existing, error: message })
      }
    }).then(() => this.passSoon())
  }

  /**
   * Nearby sync: starts looking for computers with the same password, then waits for a sync.json
   * the password opens (this computer's own, or one a nearby computer sends). With `create` and
   * no sync.json, starts a new sync instead of waiting.
   */
  private connectNearby(folder: string, password: string, create: boolean): Promise<void> {
    const s = this.status
    const fail = (error: string, searched = false) =>
      this.setStatus(s.state === 'locked' ? { ...s, error } : { state: 'setup', folder, existing: false, searched, error })
    if (password === '') {
      fail('Nearby sync needs a password: without one, anyone on your network could join it.')
      return Promise.resolve()
    }
    return this.serial(async () => {
      this.setStatus({ state: 'working', folder, message: create ? 'Starting a new sync…' : 'Looking for a computer with this password on your network…' })
      try {
        mkdirSync(folder, { recursive: true })
        const pairing = await derivePairingKey(password)
        await this.startNearby([pairing])
        const deadline = Date.now() + (create ? 0 : NEARBY_SEARCH)
        let tried: string | undefined
        let unlocked: { header: SyncHeader; master: Buffer; keyring: Keyring } | undefined
        for (;;) {
          const header = await readHeader(folder).catch(() => undefined)
          if (header && header.check !== tried) {
            tried = header.check
            try {
              unlocked = { header, ...(await unlockHeader(header, password)) }
              break
            } catch (err) {
              if (!(err instanceof SyncCryptoError && err.code === 'wrong-password')) throw err
            }
          }
          if (Date.now() >= deadline) break
          await new Promise((resolve) => setTimeout(resolve, 1_000))
        }
        if (!unlocked) {
          const header = await readHeader(folder).catch(() => undefined)
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
          writeHeader(folder, unlocked.header)
        }
        await this.begin(folder, unlocked.header, unlocked.master, unlocked.keyring, password, [pairing])
      } catch (err) {
        this.stopNearby()
        fail((err as Error).message)
      }
    }).then(() => this.passSoon())
  }

  /** Saves the key and settings, then starts syncing. */
  private async begin(folder: string, header: SyncHeader, master: Buffer, keyring: Keyring, password: string, pairing?: Buffer[]): Promise<void> {
    this.saveKey({
      folderId: header.folderId,
      check: header.check,
      master: master.toString('base64'),
      emptyPassword: password === '',
      pairing: pairing?.map((k) => k.toString('base64'))
    })
    Object.assign(this.host.settings, { syncHistory: true, syncFolder: folder, syncNearby: this.mode === 'nearby' })
    this.host.saveState()
    this.resume(folder, header, master, keyring, password === '')
    await this.matchProfiles()
  }

  /** Rotates to a new key protected by `password`; other devices ask for it on their next sync. */
  changePassword(password: string): Promise<void> {
    return this.serial(async () => {
      const engine = this.engine
      const header = this.header
      if (!engine || !header || this.status.state !== 'on') return
      const folder = this.status.folder
      this.setStatus({ state: 'working', folder, message: 'Changing the password…' })
      try {
        const next = await changePassword(header, engine.keyring, password)
        // Nearby: the new password meets computers under a new pairing key; the old one stays, so
        // computers still on the old password get the new sync.json and ask for the new password.
        let pairing: Buffer[] | undefined
        if (this.mode === 'nearby') {
          const old = this.loadKey()?.pairing?.[0]
          pairing = [await derivePairingKey(password), ...(old ? [Buffer.from(old, 'base64')] : [])]
        }
        writeHeader(folder, next.header)
        this.saveKey({
          folderId: next.header.folderId,
          check: next.header.check,
          master: next.master.toString('base64'),
          emptyPassword: password === '',
          pairing: pairing?.map((k) => k.toString('base64'))
        })
        if (pairing) await this.startNearby(pairing)
        this.header = next.header
        this.master = next.master
        this.emptyPassword = password === ''
        engine.keyring = next.keyring
        this.writeProfiles(engine)
        for (const p of this.syncedProfiles()) await engine.reencrypt(p.syncKey!, this.host.history(p.id))
        this.setStatus({ state: 'on', folder, emptyPassword: this.emptyPassword, lastSync: Date.now() })
      } catch (err) {
        this.setStatus({ state: 'on', folder, emptyPassword: this.emptyPassword, error: `Couldn’t change the password: ${(err as Error).message}` })
      }
    })
  }

  /** Stops syncing. The folder is left as it is; this device forgets the key and its sync bookkeeping. */
  turnOff(): Promise<void> {
    return this.serial(async () => {
      this.stopWatching()
      this.stopNearby()
      for (const p of this.host.profileList) {
        try {
          this.host.history(p.id).unlink()
        } catch {}
      }
      this.engine = undefined
      this.header = undefined
      this.master = undefined
      rmSync(join(this.dir, 'key.json'), { force: true })
      Object.assign(this.host.settings, { syncHistory: false, syncFolder: '', syncNearby: false })
      this.host.saveState()
      this.mode = 'folder'
      this.setStatus({ state: 'off' })
    })
  }

  /** Cancels a folder pick that wasn't confirmed with a password. */
  cancelSetup(): void {
    if (this.status.state !== 'setup') return
    this.stopNearby()
    this.mode = 'folder'
    this.setStatus({ state: 'off' })
  }

  /** The profile's switch in Settings. Off forgets its sync bookkeeping; its key is kept, so on again picks up where it was. */
  setProfileSync(profileId: string, on: boolean): Promise<void> {
    return this.serial(async () => {
      const profile = this.host.profileList.find((p) => p.id === profileId)
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

  private resume(folder: string, header: SyncHeader, master: Buffer, keyring: Keyring, emptyPassword: boolean): void {
    this.header = header
    this.master = master
    this.emptyPassword = emptyPassword
    this.engine = new SyncEngine({ root: folder, deviceId: this.deviceId(), keyring })
    for (const p of this.syncedProfiles()) this.linkHistory(p.id)
    this.setStatus({ state: 'on', folder, emptyPassword })
    this.startWatching(folder)
  }

  /** Profiles whose history syncs, each with its sync key. */
  private syncedProfiles(): Profile[] {
    return this.host.profileList.filter((p) => p.syncKey && syncsHistory(p))
  }

  /**
   * Gives every profile a sync key: the one it already has when the folder knows it, else the key
   * of a profile with the same name on another device, else a new one. The link is kept, so
   * renaming a profile later doesn't break it.
   */
  private async matchProfiles(): Promise<void> {
    const engine = this.engine
    if (!engine) return
    const remote = await engine.readProfiles()
    const known = new Set(remote.map((r) => r.key))
    const taken = new Set<string>()
    let changed = false
    for (const p of this.host.profileList.filter(syncsHistory)) {
      if (p.syncKey && known.has(p.syncKey)) {
        taken.add(p.syncKey)
        continue
      }
      const sameName = remote.find((r) => !taken.has(r.key) && sameProfileName(r.name, p.name))
      const key = sameName?.key ?? p.syncKey ?? newSyncId()
      if (key !== p.syncKey) {
        p.syncKey = key
        changed = true
      }
      taken.add(key)
    }
    if (changed) this.host.saveState()
    this.writeProfiles(engine)
  }

  /** From now on, the profile's local changes are queued for the folder and sent soon after. */
  private linkHistory(profileId: string): History {
    const history = this.host.history(profileId)
    if (history.isClosed) return history
    history.link(this.header!.folderId)
    history.onChange = () => this.sendSoon()
    return history
  }

  private writeProfiles(engine: SyncEngine): void {
    engine.writeProfiles(this.syncedProfiles().map((p): SyncedProfileInfo => ({ key: p.syncKey!, name: p.name })))
  }

  /** A full pass: check the header, give new profiles keys, send, receive, compact. */
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
    if (!engine || this.status.state !== 'on') return
    const folder = engine.root
    try {
      if (!(await this.checkHeader())) return
      if (!receiveOnly) await this.matchProfiles()
      let unknownKey = false
      for (const p of this.syncedProfiles()) {
        const history = this.linkHistory(p.id)
        if (history.isClosed) continue
        await engine.lastSeq(p.syncKey!, history)
        if (!receiveOnly) engine.send(p.syncKey!, history)
        const got = await engine.receive(p.syncKey!, history)
        unknownKey ||= got.unknownKey
        if (!receiveOnly) await engine.compact(p.syncKey!, history)
      }
      this.lastReceive = Date.now()
      // A chunk sealed with a key we lack means the password changed: the header says so too.
      if (unknownKey) await this.checkHeader()
      if (this.status.state === 'on') this.setStatus({ state: 'on', folder, emptyPassword: this.emptyPassword, lastSync: Date.now() })
    } catch (err) {
      console.warn('[sync]', err)
      if (this.status.state === 'on') this.setStatus({ ...this.status, error: (err as Error).message })
    }
  }

  /** Re-reads sync.json: another device may have changed the password. Returns false when sync must stop. */
  private async checkHeader(): Promise<boolean> {
    const engine = this.engine!
    const folder = engine.root
    const header = await readHeader(folder).catch(() => undefined)
    if (!header) {
      this.setStatus({ state: 'locked', folder, reason: 'missing-folder' })
      return false
    }
    if (header.check === this.header?.check && header.keyring === this.header.keyring) return true
    try {
      engine.keyring = openKeyring(header, this.master!)
      this.header = header
      return true
    } catch {
      this.stopWatching()
      this.engine = undefined
      this.setStatus({ state: 'locked', folder, reason: 'password-changed' })
      return false
    }
  }

  private sendSoon(): void {
    clearTimeout(this.sendTimer)
    this.sendTimer = setTimeout(() => this.passSoon(), SEND_DELAY)
  }

  private receiveSoon(): void {
    if (!this.engine) return
    void this.serial(() => this.pass(true))
  }

  private startWatching(folder: string): void {
    this.stopWatching()
    const deviceId = this.deviceId()
    try {
      this.watcher = watch(folder, { recursive: true }, (_event, name) => {
        const file = String(name ?? '')
        // Our own writes, and temporary files, don't need a pass.
        if (file.includes(deviceId) || file.endsWith('.tmp')) return
        clearTimeout(this.watchTimer)
        this.watchTimer = setTimeout(() => this.receiveSoon(), WATCH_DELAY)
      })
      this.watcher.on('error', () => this.watcher?.close())
    } catch (err) {
      console.warn('[sync] can’t watch the folder, checking every few minutes instead:', (err as Error).message)
    }
    this.timers.push(setInterval(() => this.passSoon(), POLL_INTERVAL))
    const onFocus = () => {
      if (Date.now() - this.lastReceive > FOCUS_INTERVAL) this.receiveSoon()
    }
    app.on('browser-window-focus', onFocus)
    this.unfocus = () => app.off('browser-window-focus', onFocus)
  }

  private unfocus: (() => void) | undefined

  private stopWatching(): void {
    this.watcher?.close()
    this.watcher = undefined
    for (const t of this.timers) clearInterval(t)
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
    if (status.state !== 'off' && this.mode === 'nearby') status = { ...status, nearby: true }
    if (status.state === 'on') status = { ...status, peers: this.nearby?.peerCount }
    this.status = status
    this.host.emitSoon()
  }

  // ---------------------------------------------------------------- nearby

  private async startNearby(keys: Buffer[]): Promise<void> {
    this.stopNearby()
    const nearby = new NearbySync({
      root: this.nearbyDir,
      deviceId: this.deviceId(),
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
    } catch (err) {
      nearby.stop()
      this.nearby = undefined
      throw err
    }
  }

  private stopNearby(): void {
    this.nearby?.stop()
    this.nearby = undefined
  }

  // ---------------------------------------------------------------- local files

  /** A random ID for this installation, the name of its logs in the folder. */
  private deviceId(): string {
    const file = join(this.dir, 'device.json')
    try {
      const id = JSON.parse(readFileSync(file, 'utf8')).id
      if (/^[0-9a-f]{32}$/.test(id)) return id
    } catch {}
    const id = newSyncId()
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(file, JSON.stringify({ id }))
    return id
  }

  /**
   * The master key, protected by the OS where that costs nothing: DPAPI on Windows, the Secret
   * Service on Linux. Not on macOS: without an Apple Developer ID the keychain asks for the login
   * password after every update (docs/electron-notes.md section 8), so there the key sits in the
   * profile folder next to history.sqlite and the cookies, which are not encrypted either.
   */
  private saveKey(key: SavedKey): void {
    mkdirSync(this.dir, { recursive: true })
    const json = JSON.stringify(key)
    const protect = process.platform !== 'darwin' && safeStorage.isEncryptionAvailable()
    const data = protect ? { protected: 'safeStorage', data: safeStorage.encryptString(json).toString('base64') } : { protected: 'none', data: json }
    writeFileSync(join(this.dir, 'key.json'), JSON.stringify(data), { mode: 0o600 })
  }

  private loadKey(): SavedKey | undefined {
    try {
      const raw = JSON.parse(readFileSync(join(this.dir, 'key.json'), 'utf8')) as { protected: string; data: string }
      const json = raw.protected === 'safeStorage' ? safeStorage.decryptString(Buffer.from(raw.data, 'base64')) : raw.data
      return JSON.parse(json)
    } catch {
      return undefined
    }
  }
}

function syncsHistory(p: Profile): boolean {
  return p.syncHistory !== false
}

function sameProfileName(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), undefined, { sensitivity: 'accent' }) === 0
}

/**
 * The folder to sync in, from the one the user picked: it (when it's already a sync folder or
 * empty), its "YARC Sync" folder when it has one, else a new "YARC Sync" folder inside it.
 */
function syncRoot(picked: string): string {
  if (existsSync(join(picked, HEADER_FILE)) || existsSync(join(picked, `.${HEADER_FILE}.icloud`))) return picked
  const sub = join(picked, SUBFOLDER)
  if (existsSync(sub)) return sub
  const visible = readdirSync(picked).filter((n) => !n.startsWith('.') && n !== 'desktop.ini' && n !== 'Icon\r')
  return visible.length === 0 ? picked : sub
}

/** Where the dialog opens: the first cloud folder found. */
function cloudFolderGuess(): string | undefined {
  const home = homedir()
  const candidates = [
    process.env.OneDrive,
    join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'),
    join(home, 'Library', 'CloudStorage'),
    join(home, 'Dropbox'),
    join(home, 'OneDrive'),
    join(home, 'iCloudDrive')
  ]
  return candidates.find((c): c is string => !!c && existsSync(c))
}
