// In-app updates. Windows installs them in place with electron-updater (NSIS installer), once the
// installer's signature checks out (windows-update.ts). macOS
// builds are only ad-hoc signed, which Squirrel.Mac refuses, so macOS replaces its own bundle
// with a signed zip from the release (mac-update.ts). Linux, and a Mac that can't write to the
// app's folder, only hear about a new release and open its download.
// Updates are how Chromium security fixes arrive, so checks are hourly. Releases are frequent, so,
// like Arc and Chrome, a downloaded update stays quiet: a "Restart to Update" pill in the sidebar,
// and it installs on quit. YARC's relaunch card (listing every version since the running one) only
// opens once an update has waited too long without a restart (update-escalation.ts).
import { app, BrowserWindow, dialog, net, shell, type MessageBoxOptions } from 'electron'
import type { NsisUpdater } from 'electron-updater'
import type { ReleaseNotes, UpdateStatus, WaitingUpdate } from '../shared/types'
import type { Browser } from './browser'
import { cleanUpStaging, installStaged, stageUpdate, updatableBundle, UpdateRejected } from './mac-update'
import { installAppMenu } from './menus'
import { isNewer, LATEST_RELEASE_API, pickDownload, pickMacUpdate, releasePage, type GithubRelease, type MacUpdate } from './release'
import { isSecurityUpdate, releaseInfoUrl, shouldAsk, startWaiting } from './update-escalation'
import { changelogUrl, parseChangelog, pendingReleases } from './update-notes'
import { stillSigned, verifyInstaller } from './windows-update'

const CHECK_EVERY = 60 * 60_000

export class Updater {
  status: UpdateStatus = { state: 'none' }
  /** For a notify-only update: the installer to open, and the release page. */
  private download = { installer: '', page: '' }
  private nsis: NsisUpdater | undefined
  /** Windows: an update passed its signature check, so it installs when YARC quits. */
  private installOnQuit = false
  private timer: NodeJS.Timeout | undefined
  /** The ready update has a newer Electron, so Chromium security fixes: the card comes sooner. */
  private security = false
  private checking = false
  /** macOS: a version whose update failed its checks, not retried until the next launch. */
  private failedVersion = ''
  /** macOS: the downloaded update's executable, to relaunch into once it's swapped in. */
  private relaunchPath = ''
  /** macOS: removing the app the last update replaced; a new download waits for it. */
  private cleanup: Promise<void>

  constructor(private browser: Browser) {
    this.cleanup = process.platform === 'darwin' ? cleanUpStaging().catch((err) => console.error('[updater]', err)) : Promise.resolve()
  }

  /** Start or stop the automatic checks (at startup, then every few hours) to match Settings. */
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
      // The hourly check is also what opens the card once the update has waited too long.
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

  /**
   * "Restart to Update" on Windows and macOS; otherwise explain the manual install and open the download.
   * `notesRead`: relaunched from the card, which already listed the changes, so skip What's New after.
   */
  async apply(notesRead = false): Promise<void> {
    if (this.status.state === 'ready') {
      if (notesRead) {
        this.browser.state.lastSeenVersion = this.status.version
        this.browser.store.save()
      }
      if (this.nsis) return this.nsis.quitAndInstall(true, true)
      // macOS: the will-quit handler from updateMac swaps the new app in before the relaunch.
      app.relaunch({ execPath: this.relaunchPath })
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
      void shell.openExternal(this.download.installer)
    } else if (response === 1) {
      void shell.openExternal(this.download.page)
    }
  }

  /** Command-bar title for applying the update, or undefined when there's nothing to apply. */
  actionTitle(): string | undefined {
    if (this.status.state === 'ready') return 'Restart to Update'
    if (this.status.state === 'available') return `Download YARC ${this.status.version}…`
    return undefined
  }

  /**
   * The update is downloaded and installs on quit: show the sidebar pill (and the menu item), with
   * what's new in every version since the running one for the card, and start the wait that ends in
   * the card only if the user doesn't restart for a long time.
   */
  async ready(version: string): Promise<void> {
    const [notes, security] = await Promise.all([this.notesUpTo(version), this.isSecurity(version)])
    this.security = security
    this.set({ state: 'ready', version, notes })
    const waiting = startWaiting(this.browser.state.waitingUpdate, app.getVersion(), Date.now())
    if (waiting !== this.browser.state.waitingUpdate) this.saveWaiting(waiting)
    this.offerRelaunch()
  }

  /**
   * Opens the relaunch card once the update has waited too long (a week; a day for a new Electron),
   * and then at most once a day. Not at a bad moment (another panel is open, or the window is
   * hidden): the hourly check tries again.
   */
  offerRelaunch(now = Date.now()): void {
    const waiting = this.browser.state.waitingUpdate
    if (this.status.state !== 'ready' || !waiting || !shouldAsk(waiting, this.security, now)) return
    const w = this.browser.window
    if (!w || w.win.isDestroyed() || !w.win.isVisible() || w.win.isMinimized() || w.overlayMode.kind !== 'none') return
    this.saveWaiting({ ...waiting, askedAt: now })
    this.browser.setOverlay({ kind: 'update' })
  }

  /** Whether the release changes Electron (its release.json); unknown counts as a normal update. */
  private async isSecurity(version: string): Promise<boolean> {
    try {
      const res = await net.fetch(releaseInfoUrl(version))
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
      const res = await net.fetch(changelogUrl(version))
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
      return pendingReleases(parseChangelog(await res.json()), app.getVersion(), version)
    } catch (err) {
      // The card still offers the relaunch, just without the list.
      console.warn('[updater] release notes unavailable', err)
      return []
    }
  }

  /** A message box on the focused window (an incognito one too), else the main window, else free-standing. */
  private async ask(options: MessageBoxOptions): Promise<number> {
    const win = BrowserWindow.getFocusedWindow() ?? this.browser.window?.win
    const { response } = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    return response
  }

  private set(status: UpdateStatus): void {
    this.status = status
    // Every window shows it: incognito windows share this updater.
    this.browser.emitAll()
    installAppMenu(this.browser)
  }

  private async checkWindows(): Promise<boolean> {
    const result = await (await this.nsisUpdater()).checkForUpdates()
    return !!result?.isUpdateAvailable
  }

  private async nsisUpdater(): Promise<NsisUpdater> {
    if (this.nsis) return this.nsis
    // Reads the feed (GitHub, from electron-builder.yml "publish") from resources/app-update.yml.
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

  /** The installer is downloaded: offer it, and install it on quit, only if its signature checks out. */
  private async readyWindows(updater: NsisUpdater, version: string, file: string): Promise<void> {
    let checked: Awaited<ReturnType<typeof verifyInstaller>>
    try {
      checked = await verifyInstaller(file, version, process.arch)
    } catch (err) {
      console.error('[updater] not installing the Windows update', err)
      this.set({ state: 'none' })
      return
    }
    if (!this.installOnQuit) {
      this.installOnQuit = true
      // What electron-updater's autoInstallOnAppQuit does: a silent install, without relaunching.
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
    // 404: nothing published yet.
    if (res.status === 404) return false
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const release = (await res.json()) as GithubRelease
    const version = release.tag_name.replace(/^v/i, '')
    if (!isNewer(version, app.getVersion())) return false
    this.download = { installer: pickDownload(release, process.platform, process.arch), page: releasePage(release) }
    if (process.platform === 'darwin') {
      const bundle = updatableBundle()
      if (bundle) {
        // An app that can update itself never falls back to the download: a release without its
        // signed zip, or one that failed its checks, could be anyone's.
        if (version === this.failedVersion) return false
        const update = pickMacUpdate(release, process.arch)
        if (!update) {
          console.warn('[updater] no signed macOS update in release', version)
          return false
        }
        void this.updateMac(update, version, bundle)
        return true
      }
    }
    // No toast: the sidebar pill says it, and a newer release only updates the pill.
    if (this.status.state !== 'available' || this.status.version !== version) this.set({ state: 'available', version })
    return true
  }

  /** Downloads and unpacks the update in the background; it installs as the app quits. */
  private async updateMac(update: MacUpdate, version: string, bundle: string): Promise<void> {
    this.set({ state: 'downloading', version })
    try {
      await this.cleanup
      const staged = await stageUpdate(update, version, bundle)
      this.relaunchPath = staged.executable
      app.once('will-quit', () => {
        try {
          installStaged(staged, bundle)
        } catch (err) {
          console.error('[updater] installing the update failed', err)
        }
      })
      void this.ready(version)
    } catch (err) {
      // Never offered as a download instead (the release could be anyone's). A download error is
      // tried again at the next hourly check; an update that failed its checks at the next launch.
      console.error('[updater] macOS update failed', err)
      if (err instanceof UpdateRejected) this.failedVersion = version
      this.set({ state: 'none' })
    }
  }
}
