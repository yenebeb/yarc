import type { WaitingUpdate } from '../shared/types'

const DAY = 24 * 60 * 60_000

export const ESCALATE_AFTER = 7 * DAY
/** Most people restart some time in a day, and then a security update just installs. */
export const ESCALATE_SECURITY_AFTER = DAY
export const REMIND_AFTER = DAY

/** The clock starts with the first update ready while this version runs: a newer release replacing it doesn't restart it. */
export function startWaiting(saved: WaitingUpdate | undefined, running: string, now: number): WaitingUpdate {
  return saved?.from === running ? saved : { from: running, since: now }
}

export function shouldAsk(waiting: WaitingUpdate, security: boolean, now: number): boolean {
  const wait = security ? ESCALATE_SECURITY_AFTER : ESCALATE_AFTER
  if (now - waiting.since < wait) return false
  return waiting.askedAt === undefined || now - waiting.askedAt >= REMIND_AFTER
}

/** `releaseJson` is written by release.yml. Electron releases carry Chromium and V8 security fixes, which reach YARC no other way. */
export function isSecurityUpdate(runningElectron: string, releaseJson: unknown): boolean {
  if (!releaseJson || typeof releaseJson !== 'object' || !('electron' in releaseJson)) return false
  const electron = releaseJson.electron
  return typeof electron === 'string' && electron !== '' && electron !== runningElectron
}
