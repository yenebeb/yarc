import { useState } from 'react'
import { CLOUD_DRIVE_NAME, locationName, syncExposure, type HistorySyncStatus, type SyncLocation } from '../../../shared/sync'
import type { AppState, Profile } from '../../../shared/types'
import { dispatch } from '../api'
import { Group, Row, ToggleRow } from './settings-controls'

type Status<State extends HistorySyncStatus['state']> = Extract<HistorySyncStatus, { state: State }>

export function SyncSettings({ state }: { state: AppState }) {
  const status = state.historySync
  return (
    <>
      <p className="set-note">
        Sync history between your computers. YARC encrypts it with your sync password before it leaves this computer, so wherever you keep it only
        ever sees encrypted files. There is no YARC server or account. Incognito windows never sync.
      </p>
      {status.state === 'off' && <SyncOff status={status} />}
      {status.state === 'setup' && <SyncSetup status={status} />}
      {status.state === 'working' && <SyncWorking status={status} />}
      {status.state === 'locked' && <SyncLocked status={status} />}
      {status.state === 'on' && <SyncOn status={status} profiles={state.profiles} />}
    </>
  )
}

function SyncOff({ status }: { status: Status<'off'> }) {
  const [serverForm, setServerForm] = useState(false)
  if (serverForm) return <ServerForm error={status.error} onCancel={() => setServerForm(false)} />
  return (
    <>
      {status.error && <p className="set-note warn">{status.error}</p>}
      <Group title="Keep it in">
        {status.drives.map((drive) => (
          <Row key={drive} title={CLOUD_DRIVE_NAME[drive]} hint="Sign in once on each computer. YARC can only open its own folder there.">
            <button className="btn" onClick={() => dispatch({ type: 'syncCloud', drive })}>
              Sign In…
            </button>
          </Row>
        ))}
        {status.icloud && (
          <Row title="iCloud Drive" hint="Uses iCloud Drive on this computer. Choose it on each of your computers.">
            <button className="btn" onClick={() => dispatch({ type: 'syncICloud' })}>
              Use iCloud Drive
            </button>
          </Row>
        )}
        <Row title="Your own server" hint="Any WebDAV server: Nextcloud, ownCloud, a Synology or QNAP NAS, a Hetzner Storage Box…">
          <button className="btn" onClick={() => setServerForm(true)}>
            Set Up…
          </button>
        </Row>
        <Row title="A folder" hint="One another app keeps in sync, like Syncthing or a network drive. Pick the same folder on each computer.">
          <button className="btn" onClick={() => dispatch({ type: 'syncPickFolder' })}>
            Choose Folder…
          </button>
        </Row>
        <Row title="Nearby computers (experimental)" hint="Nowhere: your computers sync directly when they’re on the same network with YARC open.">
          <button className="btn" onClick={() => dispatch({ type: 'syncNearby' })}>
            Set Up…
          </button>
        </Row>
      </Group>
    </>
  )
}

/** The WebDAV server's address and sign-in; with `server`, only the password, to sign in to it again. */
function ServerForm({ server, error, onCancel }: { server?: Extract<SyncLocation, { kind: 'server' }>; error?: string; onCancel?: () => void }) {
  const [url, setUrl] = useState(server?.url ?? '')
  const [username, setUsername] = useState(server?.username ?? '')
  const [password, setPassword] = useState('')
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void dispatch({ type: 'syncServer', url, username, password })
      }}
    >
      {!server && (
        <p className="set-note">
          The address of a folder on your WebDAV server, such as <code>https://cloud.example.com/remote.php/dav/files/you/</code> for Nextcloud. YARC
          keeps its files in a <code>YARC Sync</code> folder there. Use the same address on each computer.
        </p>
      )}
      {error && <p className="set-note warn">{error}</p>}
      <Group>
        {!server && (
          <>
            <Row title="Address">
              <input className="set-input" type="url" aria-label="Server address" value={url} onChange={(event) => setUrl(event.target.value)} autoFocus />
            </Row>
            <Row title="User name">
              <input className="set-input" aria-label="Server user name" value={username} onChange={(event) => setUsername(event.target.value)} />
            </Row>
          </>
        )}
        <Row title="Server password" hint="Your server’s, not the sync password. An app password works too.">
          <input
            className="set-input"
            type="password"
            aria-label="Server password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus={!!server}
          />
        </Row>
        <div className="set-row set-actions">
          {onCancel && (
            <button className="btn" type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button className="btn primary" type="submit" disabled={!url.trim() || !username || !password}>
            Connect
          </button>
        </div>
      </Group>
    </form>
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
  if (location.kind === 'cloud') {
    return (
      <Row title="Kept in" hint={location.account}>
        <span className="set-value">{CLOUD_DRIVE_NAME[location.drive]}</span>
      </Row>
    )
  }
  const where = location.kind === 'server' ? location.url : location.path
  return (
    <Row title={location.kind === 'server' ? 'Server' : 'Sync folder'} hint={location.kind === 'server' ? location.username : undefined}>
      <code className="set-sync-folder" title={where}>
        {where}
      </code>
    </Row>
  )
}

/** Lists exactly what the sync writes (src/shared/sync.ts), for an empty password. */
function Exposure() {
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

function PasswordFields({
  confirm,
  submitLabel,
  onSubmit,
  allowEmpty = true,
  secondary
}: {
  confirm: boolean
  submitLabel: string
  onSubmit: (password: string) => void
  /** Nearby sync refuses an empty password. */
  allowEmpty?: boolean
  /** A second button that submits the same password differently. */
  secondary?: { label: string; onSubmit: (password: string) => void }
}) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const mismatch = (confirm && password !== again) || (!allowEmpty && password === '')
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!mismatch) onSubmit(password)
      }}
    >
      <Group>
        <Row title="Sync password" hint={confirm ? 'You type it once on each computer. It can’t be recovered: if you forget it, choose a new one on a computer that still syncs, or start over.' : undefined}>
          <input className="set-input" type="password" aria-label="Sync password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
        </Row>
        {confirm && (
          <Row title="Type it again" hint={password !== again && again !== '' ? 'The passwords don’t match.' : undefined}>
            <input className="set-input" type="password" aria-label="Sync password again" value={again} onChange={(event) => setAgain(event.target.value)} />
          </Row>
        )}
        <div className="set-row set-actions">
          {secondary && (
            <button className="btn" type="button" disabled={mismatch} onClick={() => secondary.onSubmit(password)}>
              {secondary.label}
            </button>
          )}
          <button className="btn primary" type="submit" disabled={mismatch}>
            {submitLabel}
          </button>
        </div>
      </Group>
      {password === '' && allowEmpty && <Exposure />}
    </form>
  )
}

function CancelButton() {
  return (
    <div className="set-buttons">
      <button className="btn" onClick={() => dispatch({ type: 'syncCancel' })}>
        Cancel
      </button>
    </div>
  )
}

function SyncSetup({ status }: { status: Status<'setup'> }) {
  if (status.location.kind === 'nearby') return <NearbySetup status={status} />
  const where = status.location.kind === 'folder' ? 'This folder doesn’t' : `${capitalized(locationName(status.location))} doesn’t`
  return (
    <>
      <Group>
        <WhereRow location={status.location} />
      </Group>
      <p className="set-note">
        {status.existing
          ? 'Another computer already syncs here. Type the sync password you chose there.'
          : `${where} have a YARC sync yet. Choose a password to start one; you’ll type it on your other computers.`}
      </p>
      {status.error && <p className="set-note warn">{status.error}</p>}
      <PasswordFields
        confirm={!status.existing}
        submitLabel={status.existing ? 'Join and Sync' : 'Turn On Sync'}
        onSubmit={(password) => dispatch({ type: 'syncConnect', password })}
      />
      {status.existing && <ForgotPassword />}
      <CancelButton />
    </>
  )
}

function ForgotPassword() {
  const [startingOver, setStartingOver] = useState(false)
  if (!startingOver) {
    return (
      <div className="set-buttons">
        <button className="btn" onClick={() => setStartingOver(true)}>
          Forgot the Password?
        </button>
      </div>
    )
  }
  return (
    <>
      <p className="set-note">
        The password can’t be recovered. If another computer still syncs, choose a new one there: Settings → Sync → Change Password. Otherwise start
        over here: the sync kept here is replaced by a new one under a new password. Your history stays on each computer, and your other computers
        ask for the new password.
      </p>
      <PasswordFields confirm submitLabel="Start Over Here" onSubmit={(password) => dispatch({ type: 'syncConnect', password, create: true })} />
    </>
  )
}

function NearbySetup({ status }: { status: Status<'setup'> }) {
  return (
    <>
      <p className="set-note">
        Type the same sync password on each computer, with YARC open on both and both on the same network. On the first computer, choose{' '}
        <strong>Start a New Sync</strong>; on the others, <strong>Join My Other Computer</strong>. Your computers sync whenever they’re on the same network
        again; nothing goes through the internet.
      </p>
      {status.error && <p className="set-note warn">{status.error}</p>}
      <PasswordFields
        confirm={false}
        allowEmpty={false}
        submitLabel="Join My Other Computer"
        onSubmit={(password) => dispatch({ type: 'syncConnect', password })}
        secondary={{ label: 'Start a New Sync', onSubmit: (password) => dispatch({ type: 'syncConnect', password, create: true }) }}
      />
      <CancelButton />
    </>
  )
}

function SyncWorking({ status }: { status: Status<'working'> }) {
  return (
    <>
      <Group>
        <WhereRow location={status.location} />
        <div className="set-empty">{status.message}</div>
      </Group>
      {status.cancellable && <CancelButton />}
    </>
  )
}

function lockedReason(status: Status<'locked'>): string {
  const name = locationName(status.location)
  switch (status.reason) {
    case 'password-changed':
      return 'The sync password was changed on another computer. Type the new password to keep syncing.'
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

function SyncLocked({ status }: { status: Status<'locked'> }) {
  const { location, reason } = status
  return (
    <>
      <Group>
        <WhereRow location={location} />
      </Group>
      <p className="set-note warn">{lockedReason(status)}</p>
      {status.error && <p className="set-note warn">{status.error}</p>}
      {(reason === 'password-changed' || reason === 'no-saved-key') && (
        <PasswordFields
          confirm={false}
          allowEmpty={location.kind !== 'nearby'}
          submitLabel="Unlock"
          onSubmit={(password) => dispatch({ type: 'syncConnect', password })}
        />
      )}
      {reason === 'signed-out' && location.kind === 'server' && <ServerForm server={location} />}
      <div className="set-buttons">
        <button className="btn" onClick={() => dispatch({ type: 'syncOff' })}>
          Turn Off Sync
        </button>
        {reason === 'signed-out' && location.kind === 'cloud' && (
          <button className="btn primary" onClick={() => dispatch({ type: 'syncSignIn' })}>
            Sign In Again…
          </button>
        )}
      </div>
    </>
  )
}

function SyncOn({ status, profiles }: { status: Status<'on'>; profiles: Profile[] }) {
  const [changing, setChanging] = useState(false)
  const nearby = status.location.kind === 'nearby'
  return (
    <>
      <Group>
        <ToggleRow
          title="Sync history"
          hint={status.lastSync ? `Last synced ${new Date(status.lastSync).toLocaleTimeString()}` : 'Starting…'}
          checked
          onChange={(on) => !on && dispatch({ type: 'syncOff' })}
        />
        <WhereRow location={status.location} peers={status.peers} />
      </Group>
      {status.error && <p className="set-note warn">{status.error}</p>}
      {status.emptyPassword && <Exposure />}
      <Group title="Profiles">
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
        A profile syncs with the profile of the same name on your other computers; one without a match starts its own synced history. Renaming a profile
        later keeps it linked.
      </p>
      {changing ? (
        <PasswordFields
          confirm
          allowEmpty={!nearby}
          submitLabel="Change Password"
          onSubmit={(password) => {
            setChanging(false)
            void dispatch({ type: 'syncChangePassword', password })
          }}
        />
      ) : (
        <Group title="Password">
          <Row title="Sync password" hint="Your other computers will ask for the new one.">
            <button className="btn" onClick={() => setChanging(true)}>
              Change Password…
            </button>
          </Row>
        </Group>
      )}
      <p className="set-note">
        {nearby
          ? 'Turning sync off stops syncing with your other computers. This computer forgets the key; your history here stays.'
          : `Turning sync off leaves the files in ${locationName(status.location)} as they are. This computer forgets the key; your history here stays.`}
      </p>
    </>
  )
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
