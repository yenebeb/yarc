import { app } from 'electron'
import { watch, type FSWatcher } from 'node:fs'

const SEND_DELAY = 10_000
const WATCH_DELAY = 2_000
const FOCUS_INTERVAL = 30_000
const POLL_INTERVAL = 5 * 60_000
const RETRY_DELAY = 60_000

export interface ScheduledSync {
  pass(): void
  receive(): void
}

export class SyncSchedule {
  lastReceive = 0
  private readonly sync: ScheduledSync
  private watcher: FSWatcher | undefined
  private pollTimer: NodeJS.Timeout | undefined
  private sendTimer: NodeJS.Timeout | undefined
  private watchTimer: NodeJS.Timeout | undefined
  private retryTimer: NodeJS.Timeout | undefined
  private stopFocus: (() => void) | undefined

  constructor(sync: ScheduledSync) {
    this.sync = sync
  }

  // Nothing announces a change in a cloud drive or on a server: those are only polled, and checked on focus.
  start(root: string, ownDeviceId: string, changesAnnounced: boolean): void {
    this.stop()
    if (changesAnnounced) this.watchFolder(root, ownDeviceId)
    this.pollTimer = setInterval(() => this.sync.pass(), POLL_INTERVAL)
    const onFocus = () => {
      if (Date.now() - this.lastReceive > FOCUS_INTERVAL) this.sync.receive()
    }
    app.on('browser-window-focus', onFocus)
    this.stopFocus = () => app.off('browser-window-focus', onFocus)
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = undefined
    clearInterval(this.pollTimer)
    clearTimeout(this.sendTimer)
    clearTimeout(this.watchTimer)
    clearTimeout(this.retryTimer)
    this.stopFocus?.()
    this.stopFocus = undefined
  }

  sendSoon(): void {
    clearTimeout(this.sendTimer)
    this.sendTimer = setTimeout(() => this.sync.pass(), SEND_DELAY)
  }

  retrySoon(retry: () => void): void {
    clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(retry, RETRY_DELAY)
  }

  private watchFolder(root: string, ownDeviceId: string): void {
    try {
      this.watcher = watch(root, { recursive: true }, (_event, name) => {
        const file = String(name ?? '')
        if (file.includes(ownDeviceId) || file.endsWith('.tmp')) return
        clearTimeout(this.watchTimer)
        this.watchTimer = setTimeout(() => this.sync.receive(), WATCH_DELAY)
      })
      this.watcher.on('error', () => this.watcher?.close())
    } catch (error) {
      console.warn('[sync] can’t watch the folder, checking every few minutes instead:', (error as Error).message)
    }
  }
}
