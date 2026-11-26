import { useState, type ReactNode } from 'react'
import { isICloudDrive, syncExposure, type HistorySyncStatus, type SyncLocation } from '../../../shared/sync'
import { dispatch } from '../api'
import type { IconName } from '../icons'
import { Group, Row } from './settings-controls'

export type Status<State extends HistorySyncStatus['state']> = Extract<HistorySyncStatus, { state: State }>

export function Card({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <div className="set-group">
      <div className={`set-card ${kind}`}>{children}</div>
    </div>
  )
}

const PLACE_ICON: Record<SyncLocation['kind'], IconName> = { folder: 'folder', cloud: 'cloud', server: 'server', nearby: 'nearby' }

export const placeIcon = (location: SyncLocation): IconName => (location.kind === 'folder' && isICloudDrive(location.path) ? 'cloud' : PLACE_ICON[location.kind])

export function placeDetail(location: SyncLocation): string | undefined {
  if (location.kind === 'folder') return isICloudDrive(location.path) ? undefined : location.path
  if (location.kind === 'server') return location.url
  if (location.kind === 'cloud') return location.account
  return undefined
}

export function PlaceDetail({ location }: { location: SyncLocation }) {
  const detail = placeDetail(location)
  if (!detail) return null
  return (
    <code className="set-sync-folder" title={detail}>
      {detail}
    </code>
  )
}

/** Lists exactly what the sync writes (src/shared/sync.ts), for an empty password. */
export function Exposure() {
  return (
    <div className="set-note warn" role="alert">
      <strong>With an empty password, anyone who can open the sync files can read:</strong>
      <ul>
        {syncExposure().map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      The files are still encrypted, but the key comes from the empty password, so it protects nothing. Anyone you share them with, and the company or
      person running the place they’re kept, can read them.
    </div>
  )
}

export function PasswordFields({
  title,
  confirm,
  submitLabel,
  onSubmit,
  onCancel,
  allowEmpty = true,
  secondary
}: {
  title?: string
  confirm: boolean
  submitLabel: string
  onSubmit: (password: string) => void
  onCancel: () => void
  /** Nearby sync refuses an empty password. */
  allowEmpty?: boolean
  /** A second button that submits the same password differently. */
  secondary?: { label: string; onSubmit: (password: string) => void }
}) {
  const [typed, setTyped] = useState('')
  const [again, setAgain] = useState('')
  const [unprotected, setUnprotected] = useState(false)
  const password = unprotected ? '' : typed
  const missing = password === '' && !unprotected && (confirm || !allowEmpty)
  const refused = missing || (confirm && !unprotected && typed !== again)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!refused) onSubmit(password)
      }}
    >
      {unprotected ? (
        <Exposure />
      ) : (
        <Group title={title}>
          <Row title="Sync password">
            <input className="set-input" type="password" aria-label="Sync password" value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus />
          </Row>
          {confirm && (
            <Row title="Type it again" hint={typed !== again && again !== '' ? 'The passwords don’t match.' : undefined}>
              <input className="set-input" type="password" aria-label="Sync password again" value={again} onChange={(event) => setAgain(event.target.value)} />
            </Row>
          )}
        </Group>
      )}
      {confirm && !unprotected && (
        <p className="set-note">
          You type it once on each computer. It can’t be recovered: if you forget it, choose a new one on a computer that still syncs, or start over.
        </p>
      )}
      <div className="set-buttons">
        {confirm && allowEmpty && (
          <button className="set-link" type="button" onClick={() => setUnprotected(!unprotected)}>
            {unprotected ? 'Use a password' : 'Sync without a password…'}
          </button>
        )}
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
        {secondary && (
          <button className="btn" type="button" disabled={refused} onClick={() => secondary.onSubmit(password)}>
            {secondary.label}
          </button>
        )}
        <button className="btn primary" type="submit" disabled={refused}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

export const cancelSetup = () => dispatch({ type: 'syncCancel' })
