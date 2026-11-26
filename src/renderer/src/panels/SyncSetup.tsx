import { useState } from 'react'
import { CLOUD_DRIVE_NAME, locationName, type SyncLocation } from '../../../shared/sync'
import { dispatch, isMac } from '../api'
import { Icon, type IconName } from '../icons'
import { Group, Row } from './settings-controls'
import { cancelSetup, Card, PasswordFields, PlaceDetail, placeIcon, type Status } from './sync-controls'

const NEW_SYNC_STEPS = ['Pick a place', 'Choose a password', 'Repeat on your other computer']

const JOIN_STEPS = ['Pick a place', 'Join the sync found there']

function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="set-steps">
      {steps.map((step, index) => (
        <li key={step} className={index < current ? 'done' : index === current ? 'now' : undefined} aria-current={index === current ? 'step' : undefined}>
          <b>{index < current ? <Icon name="check" size={13} stroke={2.6} /> : index + 1}</b>
          {step}
        </li>
      ))}
    </ol>
  )
}

interface Place {
  icon: IconName
  name: string
  hint: string
  tag?: string
  choose: () => void
}

function PlaceRow({ place }: { place: Place }) {
  return (
    <button className="set-row set-place" onClick={place.choose}>
      <span className="set-place-icon">
        <Icon name={place.icon} size={18} />
      </span>
      <span className="set-row-text">
        <span className="set-row-title">
          {place.name}
          {place.tag && <span className="set-tag">{place.tag}</span>}
        </span>
        <small>{place.hint}</small>
      </span>
      <span className="set-place-go">
        <Icon name="chevron" size={16} />
      </span>
    </button>
  )
}

function Places({ title, places, kind = '' }: { title: string; places: Place[]; kind?: string }) {
  if (places.length === 0) return null
  return (
    <div className={`set-group ${kind}`}>
      <h3>{title}</h3>
      <div className="set-card">
        {places.map((place) => (
          <PlaceRow key={place.name} place={place} />
        ))}
      </div>
    </div>
  )
}

export function SyncOff({ status }: { status: Status<'off'> }) {
  const [serverForm, setServerForm] = useState(false)
  const [onlyMacs, setOnlyMacs] = useState(true)
  if (serverForm) {
    return (
      <>
        <Steps steps={NEW_SYNC_STEPS} current={0} />
        <ServerForm error={status.error} onCancel={() => setServerForm(false)} />
      </>
    )
  }

  const asksWhichComputers = isMac && status.icloud
  const everyComputerIsAMac = asksWhichComputers && onlyMacs
  const icloudHint = everyComputerIsAMac ? 'Already on this Mac. Nothing to sign in to.' : isMac ? 'Best when every computer is a Mac.' : 'Uses iCloud Drive on this computer. Choose it on each of your computers.'
  const icloud: Place = { icon: 'cloud', name: 'iCloud Drive', hint: icloudHint, choose: () => dispatch({ type: 'syncICloud' }) }
  const drives: Place[] = status.drives.map((drive) => ({
    icon: 'cloud',
    name: CLOUD_DRIVE_NAME[drive],
    hint: 'Sign in once on each computer. YARC can only open its own folder there.',
    choose: () => dispatch({ type: 'syncCloud', drive })
  }))
  const folder: Place = {
    icon: 'folder',
    name: 'A synced folder',
    hint: 'One another app keeps in sync, like the OneDrive, Google Drive or Dropbox folder, or Syncthing. Pick the same one on each computer.',
    choose: () => dispatch({ type: 'syncPickFolder' })
  }
  const server: Place = { icon: 'server', name: 'Your own server', hint: 'A WebDAV server you run: Nextcloud, a Synology or QNAP NAS…', choose: () => setServerForm(true) }
  const nearby: Place = {
    icon: 'nearby',
    name: 'Nearby computers',
    tag: 'Experimental',
    hint: 'Directly between your computers on the same network.',
    choose: () => dispatch({ type: 'syncNearby' })
  }

  const onEverySystem = drives.length ? drives : [folder]
  const recommended = everyComputerIsAMac ? [icloud] : onEverySystem
  const others = [...drives, folder, ...(status.icloud ? [icloud] : [])].filter((place) => !recommended.includes(place))
  const recommendedFor = everyComputerIsAMac ? 'Recommended when every computer is a Mac' : asksWhichComputers ? 'Recommended across Mac, Windows and Linux' : 'Recommended'
  return (
    <>
      <p className="set-note">
        History syncs between your computers, encrypted with a password only you know. No YARC account, no YARC server, and incognito windows never sync.
      </p>
      <Steps steps={NEW_SYNC_STEPS} current={0} />
      {status.error && <p className="set-note warn">{status.error}</p>}
      {asksWhichComputers && (
        <div className="set-ask">
          <span id="sync-computers">Which computers will sync?</span>
          <div className="set-seg" role="radiogroup" aria-labelledby="sync-computers">
            <button role="radio" aria-checked={onlyMacs} className={onlyMacs ? 'on' : ''} onClick={() => setOnlyMacs(true)}>
              Only Macs
            </button>
            <button role="radio" aria-checked={!onlyMacs} className={onlyMacs ? '' : 'on'} onClick={() => setOnlyMacs(false)}>
              Mac with Windows or Linux
            </button>
          </div>
        </div>
      )}
      <Places title={recommendedFor} places={recommended} kind="recommended" />
      <Places title="Or keep it in" places={others} />
      <div className="set-group">
        <h3>Or with no external service</h3>
        <div className="set-card set-pair">
          <PlaceRow place={server} />
          <PlaceRow place={nearby} />
        </div>
      </div>
    </>
  )
}

/** The WebDAV server's address and sign-in; with `server`, only the password, to sign in to it again. */
export function ServerForm({ server, error, onCancel }: { server?: Extract<SyncLocation, { kind: 'server' }>; error?: string; onCancel?: () => void }) {
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
      </Group>
      <div className="set-buttons">
        {onCancel && (
          <button className="btn" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn primary" type="submit" disabled={!url.trim() || !username || !password}>
          Connect
        </button>
      </div>
    </form>
  )
}

function PickedPlace({ location, title, hint, kind = '' }: { location: SyncLocation; title: string; hint: string; kind?: string }) {
  return (
    <Card kind={kind}>
      <div className="set-row set-picked">
        <span className="set-place-icon">
          <Icon name={placeIcon(location)} size={18} />
        </span>
        <div className="set-row-text">
          <span className="set-row-title">{title}</span>
          <small>{hint}</small>
          <PlaceDetail location={location} />
        </div>
        <div className="set-control">
          <button className="btn" onClick={() => dispatch({ type: 'syncCancel' })}>
            Change…
          </button>
        </div>
      </div>
    </Card>
  )
}

export function SyncSetup({ status }: { status: Status<'setup'> }) {
  if (status.location.kind === 'nearby') return <NearbySetup status={status} />
  return status.existing ? <JoinFoundSync status={status} /> : <StartNewSync status={status} />
}

function StartNewSync({ status }: { status: Status<'setup'> }) {
  const name = locationName(status.location)
  return (
    <>
      <Steps steps={NEW_SYNC_STEPS} current={1} />
      <PickedPlace location={status.location} title={`Kept in ${name}`} hint="No YARC sync there yet, so this computer starts one." />
      <p className="set-note">
        Already set this up on another computer? It may not have arrived here yet. Wait until {name} is up to date, then choose it again.
      </p>
      {status.error && <p className="set-note warn">{status.error}</p>}
      <PasswordFields
        title="Choose a sync password"
        confirm
        submitLabel="Turn On Sync"
        onSubmit={(password) => dispatch({ type: 'syncConnect', password })}
        onCancel={cancelSetup}
      />
    </>
  )
}

function JoinFoundSync({ status }: { status: Status<'setup'> }) {
  const [separate, setSeparate] = useState(false)
  const [startingOver, setStartingOver] = useState(false)
  const [password, setPassword] = useState('')
  const name = locationName(status.location)
  if (startingOver) {
    return (
      <>
        <Steps steps={JOIN_STEPS} current={1} />
        <p className="set-note">
          The password can’t be recovered. If another computer still syncs, choose a new one there: Settings → Sync → Change Password. Otherwise start
          over here: the sync kept in {name} is replaced by a new one under a new password. Your history stays on each computer, and your other
          computers ask for the new password.
        </p>
        {status.error && <p className="set-note warn">{status.error}</p>}
        <PasswordFields
          title="Choose a new sync password"
          confirm
          submitLabel="Start Over Here"
          onSubmit={(newPassword) => dispatch({ type: 'syncConnect', password: newPassword, create: true })}
          onCancel={() => setStartingOver(false)}
        />
      </>
    )
  }
  return (
    <>
      <Steps steps={JOIN_STEPS} current={1} />
      <PickedPlace
        kind="set-callout"
        location={status.location}
        title={`A sync was found in ${name}`}
        hint="Another computer already syncs here. Should this computer use it?"
      />
      {status.error && <p className="set-note warn">{status.error}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void dispatch(separate ? { type: 'syncCancel' } : { type: 'syncConnect', password })
        }}
      >
        <div className="set-group">
          <h3>What should this computer do?</h3>
          <div className="set-card">
            <label className="set-row set-choice">
              <input type="radio" name="found-sync" checked={!separate} onChange={() => setSeparate(false)} />
              <div className="set-row-text">
                <span className="set-row-title">Use this sync</span>
                <small>This computer shares its history with the computers already syncing here.</small>
              </div>
            </label>
            {!separate && (
              <div className="set-row set-choice-detail">
                <span>The sync password you chose there</span>
                <input className="set-input" type="password" aria-label="Sync password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
              </div>
            )}
            <label className="set-row set-choice">
              <input type="radio" name="found-sync" checked={separate} onChange={() => setSeparate(true)} />
              <div className="set-row-text">
                <span className="set-row-title">Keep this computer separate</span>
                <small>A place holds one sync, so a second sync needs its own place: another folder, or another service.</small>
              </div>
            </label>
          </div>
        </div>
        <div className="set-buttons">
          <button className="set-link" type="button" onClick={() => setStartingOver(true)}>
            Forgot the password?
          </button>
          <button className="btn" type="button" onClick={cancelSetup}>
            Cancel
          </button>
          <button className="btn primary" type="submit">
            {separate ? 'Pick Another Place…' : 'Join and Sync'}
          </button>
        </div>
      </form>
    </>
  )
}

function NearbySetup({ status }: { status: Status<'setup'> }) {
  return (
    <>
      <Steps steps={NEW_SYNC_STEPS} current={1} />
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
        onCancel={cancelSetup}
        secondary={{ label: 'Start a New Sync', onSubmit: (password) => dispatch({ type: 'syncConnect', password, create: true }) }}
      />
    </>
  )
}
