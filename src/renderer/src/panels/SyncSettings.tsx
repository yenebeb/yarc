import { useState } from 'react'
import { CLOUD_DRIVE_NAME, isICloudDrive, locationName, type SyncLocation } from '../../../shared/sync'
import type { AppState, Profile } from '../../../shared/types'
import { dispatch } from '../api'
import { Icon } from '../icons'
import { Group, patch, Row, ToggleRow } from './settings-controls'
import { cancelSetup, Card, Exposure, PasswordFields, placeDetail, PlaceDetail, type Status } from './sync-controls'
import { ServerForm, SyncOff, SyncSetup } from './SyncSetup'

export function SyncSettings({ state }: { state: AppState }) {
  const status = state.historySync
  return (
    <div className="set-sync">
      {status.state === 'off' && <SyncOff status={status} />}
      {status.state === 'setup' && <SyncSetup status={status} />}
      {status.state === 'working' && <SyncWorking status={status} />}
      {status.state === 'locked' && <SyncLocked status={status} />}
      {status.state === 'on' && <SyncOn status={status} profiles={state.profiles} reminderHidden={state.settings.syncReminderHidden} />}
    </div>
  )
}

/** Where history syncs through. */
function WhereRow({ location, peers }: { location: SyncLocation; peers?: number }) {
  if (location.kind === 'nearby') {
    const connected = peers === undefined ? undefined : peers === 1 ? '1 computer connected' : `${peers} computers connected`
    return (
      <Row title="Syncs with" hint={connected}>
        <span className="set-value">Computers on this network</span>
      </Row>
    )
  }
  return (
    <Row title="Kept in" hint={placeDetail(location) && <PlaceDetail location={location} />}>
      <span className="set-kept-in">{capitalized(locationName(location))}</span>
    </Row>
  )
}

function SyncWorking({ status }: { status: Status<'working'> }) {
  return (
    <>
      <Group>
        <WhereRow location={status.location} />
        <div className="set-empty">{status.message}</div>
      </Group>
      {status.cancellable && (
        <div className="set-buttons">
          <button className="btn" onClick={cancelSetup}>
            Cancel
          </button>
        </div>
      )}
    </>
  )
}

function lockedReason(status: Status<'locked'>): string {
  const name = locationName(status.location)
  switch (status.reason) {
    case 'password-changed':
      return 'The sync password was changed on another computer. Type the new one to keep syncing.'
    case 'no-saved-key':
      return 'Type the sync password to keep syncing.'
    case 'signed-out':
      return status.location.kind === 'server'
        ? 'Your server refused the saved password, so nothing syncs. Type it again to carry on.'
        : `${capitalized(name)} signed YARC out, so nothing syncs. Sign in again to carry on.`
    case 'missing-folder':
      return status.location.kind === 'folder'
        ? 'The sync folder isn’t there. Is the drive or cloud service connected? Sync resumes once it’s back.'
        : `YARC can’t read the sync files in ${name} right now and keeps trying. If they’re gone for good, turn sync off and set it up again.`
  }
}

function Unlock({ label, allowEmpty }: { label: string; allowEmpty: boolean }) {
  const [password, setPassword] = useState('')
  return (
    <form
      className="set-row"
      onSubmit={(event) => {
        event.preventDefault()
        void dispatch({ type: 'syncConnect', password })
      }}
    >
      <div className="set-row-text">
        <span className="set-row-title">{label}</span>
      </div>
      <div className="set-control">
        <input className="set-input" type="password" aria-label="Sync password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
        <button className="btn primary" type="submit" disabled={!allowEmpty && password === ''}>
          Unlock
        </button>
      </div>
    </form>
  )
}

function TurnOffRow({ location }: { location: SyncLocation }) {
  const [asking, setAsking] = useState(false)
  const whatStays =
    location.kind === 'nearby'
      ? 'Stops syncing with your other computers. This computer forgets the key; your history here stays.'
      : `The files stay in ${locationName(location)}. This computer forgets the key; your history here stays.`
  return (
    <Row title="Turn off sync" hint={whatStays}>
      {asking ? (
        <>
          <button className="btn" onClick={() => setAsking(false)}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => dispatch({ type: 'syncOff' })}>
            Turn Off Sync
          </button>
        </>
      ) : (
        <button className="btn" onClick={() => setAsking(true)}>
          Turn Off…
        </button>
      )}
    </Row>
  )
}

function SyncLocked({ status }: { status: Status<'locked'> }) {
  const { location, reason } = status
  const asksForPassword = reason === 'password-changed' || reason === 'no-saved-key'
  return (
    <>
      <Card kind="set-status paused">
        <div className="set-row">
          <span className="set-status-icon">
            <Icon name="lock" size={19} stroke={2.1} />
          </span>
          <div className="set-row-text">
            <span className="set-status-title">Sync is paused</span>
            <small>{lockedReason(status)}</small>
          </div>
          {reason === 'signed-out' && location.kind === 'cloud' && (
            <div className="set-control">
              <button className="btn primary" onClick={() => dispatch({ type: 'syncSignIn' })}>
                Sign In Again…
              </button>
            </div>
          )}
        </div>
        {asksForPassword && <Unlock label={reason === 'password-changed' ? 'New sync password' : 'Sync password'} allowEmpty={location.kind !== 'nearby'} />}
      </Card>
      {status.error && <p className="set-note warn">{status.error}</p>}
      {reason === 'signed-out' && location.kind === 'server' && <ServerForm server={location} />}
      <Group>
        <WhereRow location={location} />
        <TurnOffRow location={location} />
      </Group>
      {asksForPassword && (
        <p className="set-note">
          Forgot the password? It can’t be recovered. Choose another on a computer that still syncs, or turn sync off here and set it up again: Forgot
          the password? there starts over.
        </p>
      )}
    </>
  )
}

function pickTheSamePlace(location: SyncLocation): string {
  if (location.kind === 'cloud') return `pick ${CLOUD_DRIVE_NAME[location.drive]}`
  if (location.kind === 'server') return 'enter the same server address'
  if (location.kind === 'nearby') return 'pick Nearby computers'
  return isICloudDrive(location.path) ? 'pick iCloud Drive' : 'pick the same folder'
}

function syncedThrough({ location, peers, lastSync }: Status<'on'>): string {
  const when = lastSync ? `Last synced at ${new Date(lastSync).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Starting'
  if (location.kind !== 'nearby') return `${when}, through ${locationName(location)}`
  const connected = peers === undefined ? '' : peers === 1 ? ' (1 connected)' : ` (${peers} connected)`
  return `${when}, with computers on this network${connected}`
}

function SyncOn({ status, profiles, reminderHidden }: { status: Status<'on'>; profiles: Profile[]; reminderHidden: boolean }) {
  const [changing, setChanging] = useState(false)
  const { location } = status
  return (
    <>
      <Card kind="set-status ok">
        <div className="set-row">
          <span className="set-status-icon">
            <Icon name="check" size={20} stroke={2.4} />
          </span>
          <div className="set-row-text">
            <span className="set-status-title">History is syncing</span>
            <small>{syncedThrough(status)}</small>
            <PlaceDetail location={location} />
          </div>
        </div>
      </Card>
      {!reminderHidden && (
        <Card kind="set-callout">
          <div className="set-row">
            <span className="set-place-icon">
              <Icon name="screen" size={18} />
            </span>
            <div className="set-row-text">
              <span className="set-row-title">Now your other computer</span>
              <small>There, open Settings → Sync, {pickTheSamePlace(location)} and type the same sync password.</small>
            </div>
            <button className="set-dismiss" aria-label="Hide this reminder" onClick={() => patch({ syncReminderHidden: true })}>
              <Icon name="x" size={14} />
            </button>
          </div>
        </Card>
      )}
      {status.error && <p className="set-note warn">{status.error}</p>}
      {status.emptyPassword && <Exposure />}
      <Group title="Profiles that sync">
        {profiles.map((profile) => (
          <ToggleRow
            key={profile.id}
            title={profile.name}
            checked={profile.syncHistory !== false}
            onChange={(on) => dispatch({ type: 'syncProfile', id: profile.id, on })}
          />
        ))}
      </Group>
      <p className="set-note">
        A profile syncs with the profile of the same name on your other computers. One without a match starts its own synced history. Renaming a profile
        later keeps it linked.
      </p>
      {changing && (
        <PasswordFields
          title="Choose a new sync password"
          confirm
          allowEmpty={location.kind !== 'nearby'}
          submitLabel="Change Password"
          onSubmit={(password) => {
            setChanging(false)
            void dispatch({ type: 'syncChangePassword', password })
          }}
          onCancel={() => setChanging(false)}
        />
      )}
      <Group>
        {!changing && (
          <Row title="Sync password" hint="Your other computers will ask for the new one.">
            <button className="btn" onClick={() => setChanging(true)}>
              Change Password…
            </button>
          </Row>
        )}
        <TurnOffRow location={location} />
      </Group>
    </>
  )
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
