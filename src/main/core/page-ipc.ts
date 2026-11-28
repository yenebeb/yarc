// Channels a web page or an extension can send on, unlike handleUi's: each handler checks its own sender and treats every argument as hostile.
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { PAGE_IPC } from '../../shared/ipc'

type PageChannel = (typeof PAGE_IPC)[keyof typeof PAGE_IPC]

export function onPage(channel: PageChannel, listener: (event: IpcMainEvent, ...args: unknown[]) => void): void {
  ipcMain.on(channel, listener)
}

export function handlePage(channel: PageChannel, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, handler)
}
