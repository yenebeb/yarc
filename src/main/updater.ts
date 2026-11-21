import { app, BrowserWindow, dialog, net, shell, type MessageBoxOptions } from 'electron'
import type { NsisUpdater } from 'electron-updater'
import type { ReleaseNotes, UpdateStatus, WaitingUpdate } from '../shared/types'
import type { Browser } from './browser'
import { cleanUpStaging, installStaged, stageUpdate, updatableBundle, UpdateRejected } from './mac-update'
import { installAppMenu } from './menus'
import { parseChangelog, pendingReleases } from './changelog'
import { isNewer, LATEST_RELEASE_API, pickDownload, pickMacUpdate, releaseAssetUrl, releasePage, type GithubRelease, type MacUpdate } from './release'
import { isSecurityUpdate, shouldAsk, startWaiting } from './update-escalation'
import { stillSigned, verifyInstaller, type CheckedInstaller } from './update-signature'

const CHECK_EVERY = 60 * 60_000

export class Updater {
  status: UpdateStatus = { state: 'none' }
  private notifyOnlyDownload = { installer: '', page: '' }
  private nsis: NsisUpdater | undefined
  private windowsInstallOnQuit = false
  private timer: NodeJS.Timeout | undefined
  private securityUpdate = false
  private checking = false
  private macRejectedVersion = ''
  private macRelaunchPath = ''
  private macCleanup = process.platform === 'darwin' ? cleanUpStaging().catch((err) => console.error('[updater]', err)) : Promise.resolve()

  constructor(private browser: Browser) {}

  sync(): void {
    clearInterval(this.timer)
    this.timer = undefined
    if (!app.isPackaged || !this.browser.state.settings.autoUpdate) return
    this.timer = setInterval(() => void this.check(false), CHECK_EVERY)
    void this.check(false)
  }

  /** `manual` checks report "up to date" and errors; automatic ones stay quiet. */
  async check(manual: boolean): Promise<void> {
    if (!app.isPackaged) {
      if (manual) this.browser.toast('Updates only work in the installed app')
      return
    }
    if (this.status.state === 'ready') {
      if (manual) this.browser.toast(`YARC ${this.status.version} is ready. Restart to update.`)
      else this.offerRelaunch()
      return
    }
    if (this.status.state === 'downloading') {
      if (manual) this.browser.toast(`Downloading YARC ${this.status.version}…`)
      return
    }
    if (this.checking) return
    this.checking = true
    if (manual) this.browser.toast('Checking for updates…')
    try {
      const found = process.platform === 'win32' ? await this.checkWindows() : await this.checkGithub()
      if (manual && !found) this.browser.toast(`YARC ${app.getVersion()} is up to date`)
      if (manual && found && this.status.state === 'available') await this.apply()
    } catch (err) {
      console.error('[updater] check failed', err)
      if (manual) this.browser.toast(`Couldn't check for updates: ${(err as Error).message}`)
    } finally {
      this.checking = false
    }
  }

  /** `notesRead`: relaunched from the card, which already listed the changes, so skip What's New after. */
  async apply(notesRead = false): Promise<void> {
    if (this.status.state === 'ready') {
      if (notesRead) {
        this.browser.state.lastSeenVersion = this.status.version
        this.browser.store.save()
      }
      if (this.nsis) return this.nsis.quitAndInstall(true, true)
      app.relaunch({ execPath: this.macRelaunchPath })
      return app.quit()
    }
    if (this.status.state !== 'available') return this.check(true)
    const mac = process.platform === 'darwin'
    const options: MessageBoxOptions = {
      type: 'info',
      buttons: ['Download', 'Release Notes', 'Later'],
      defaultId: 0,
      cancelId: 2,
      message: `YARC ${this.status.version} is available`,
      detail: mac
        ? 'YARC couldn’t update itself, for example because it can’t write to the folder it’s in.\n\n' +
          'Download the new version, quit YARC, and drag YARC from the disk image into Applications to replace this one. ' +
          'The first time you open it, macOS blocks it once: allow it in System Settings → Privacy & Security → Open Anyway.'
        : 'Download the new AppImage and use it in place of this one.'
    }
    const response = await this.ask(options)
    if (response === 0) {
      void shell.openExternal(this.notifyOnlyDownload.installer)
    } else if (response === 1) {
      void shell.openExternal(this.notifyOnlyDownload.page)
    }
  }

  actionTitle(): string | undefined {
    if (this.status.state === 'ready') return 'Restart to Update'
    if (this.status.state === 'available') return `Download YARC ${this.status.version}…`
    return undefined
  }

  async ready(version: string): Promise<void> {
    const [notes, security] = await Promise.all([this.notesUpTo(version), this.isSecurity(version)])
    this.securityUpdate = security
    this.set({ state: 'ready', version, notes })
    const waiting = startWaiting(this.browser.state.waitingUpdate, app.getVersion(), Date.now())
    if (waiting !== this.browser.state.waitingUpdate) this.saveWaiting(waiting)
    this.offerRelaunch()
  }

  offerRelaunch(now = Date.now()): void {
    const waiting = this.browser.state.waitingUpdate
    if (this.status.state !== 'ready' || !waiting || !shouldAsk(waiting, this.securityUpdate, now)) return
    const w = this.browser.window
    if (!w || w.win.isDestroyed() || !w.win.isVisible() || w.win.isMinimized() || w.overlayMode.kind !== 'none') return
    this.saveWaiting({ ...waiting, askedAt: now })
    this.browser.setOverlay({ kind: 'update' })
  }

  private async isSecurity(version: string): Promise<boolean> {
    try {
      const res = await net.fetch(releaseAssetUrl(version, 'release.json'))
      return res.ok && isSecurityUpdate(process.versions.electron, await res.json())
    } catch (err) {
      console.warn('[updater] no release info for', version, err)
      return false
    }
  }

  private saveWaiting(waiting: WaitingUpdate): void {
    this.browser.state.waitingUpdate = waiting
    this.browser.store.save()
  }

  private async notesUpTo(version: string): Promise<ReleaseNotes[]> {
    try {
      const res = await net.fetch(releaseAssetUrl(version, 'changelog.json'))
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
      return pendingReleases(parseChangelog(await res.json()), app.getVersion(), version)
    } catch (err) {
      console.warn('[updater] release notes unavailable', err)
      return []
    }
  }

  private async ask(options: MessageBoxOptions): Promise<number> {
    const win = BrowserWindow.getFocusedWindow() ?? this.browser.window?.win
    const { response } = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return response
  }

  private set(status: UpdateStatus): void {
    this.status = status
    this.browser.emitAll()
    installAppMenu(this.browser)
  }

  private async checkWindows(): Promise<boolean> {
    const result = await (await this.nsisUpdater()).checkForUpdates()
    return !!result?.isUpdateAvailable
  }

  private async nsisUpdater(): Promise<NsisUpdater> {
    if (this.nsis) return this.nsis
    const { NsisUpdater } = await import('electron-updater')
    const updater = new NsisUpdater()
    updater.autoDownload = true
    // Not electron-updater's install on quit: it would install before the signature check is done.
    updater.autoInstallOnAppQuit = false
    updater.on('update-available', (info) => this.set({ state: 'downloading', version: info.version }))
    updater.on('update-downloaded', (info) => void this.readyWindows(updater, info.version, info.downloadedFile))
    updater.on('error', (err) => {
      console.error('[updater]', err)
      if (this.status.state === 'downloading') this.set({ state: 'none' })
    })
    this.nsis = updater
    return updater
  }

  private async readyWindows(updater: NsisUpdater, version: string, file: string): Promise<void> {
    let checked: CheckedInstaller
    try {
      checked = await verifyInstaller(file, version, process.arch)
    } catch (err) {
      console.error('[updater] not installing the Windows update', err)
      this.set({ state: 'none' })
      return
    }
    if (!this.windowsInstallOnQuit) {
      this.windowsInstallOnQuit = true
      app.once('quit', (_event, exitCode) => {
        if (exitCode !== 0) return
        if (stillSigned(checked)) updater.install(true, false)
        else console.error('[updater] the installer changed since it was checked; not installing it')
      })
    }
    void this.ready(version)
  }

  private async checkGithub(): Promise<boolean> {
    const res = await net.fetch(LATEST_RELEASE_API, { headers: { accept: 'application/vnd.github+json' } })
    const nothingPublished = res.status === 404
    if (nothingPublished) return false
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const release = (await res.json()) as GithubRelease
    const version = release.tag_name.replace(/^v/i, '')
    if (!isNewer(version, app.getVersion())) return false
    this.notifyOnlyDownload = { installer: pickDownload(release, process.platform, process.arch), page: releasePage(release) }
    if (process.platform === 'darwin') {
      const bundle = updatableBundle()
      if (bundle) {
        // Never falls back to the download: a release without its signed zip, or one that failed its checks, could be anyone's.
        if (version === this.macRejectedVersion) return false
        const update = pickMacUpdate(release, process.arch)
        if (!update) {
          console.warn('[updater] no signed macOS update in release', version)
          return false
        }
        void this.updateMac(update, version, bundle)
        return true
      }
    }
    if (this.status.state !== 'available' || this.status.version !== version) this.set({ state: 'available', version })
    return true
  }

  private async updateMac(update: MacUpdate, version: string, bundle: string): Promise<void> {
    this.set({ state: 'downloading', version })
    try {
      await this.macCleanup
      const staged = await stageUpdate(update, version, bundle)
      this.macRelaunchPath = staged.executable
      app.once('will-quit', () => {
        try {
          installStaged(staged, bundle)
        } catch (err) {
          console.error('[updater] installing the update failed', err)
        }
      })
      void this.ready(version)
    } catch (err) {
      console.error('[updater] macOS update failed', err)
      if (err instanceof UpdateRejected) this.macRejectedVersion = version
      this.set({ state: 'none' })
    }
  }
}
