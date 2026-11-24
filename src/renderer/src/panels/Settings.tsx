import { useState, type CSSProperties, type KeyboardEvent } from 'react'
import logo from '../../../../build/icon.svg'
import { cleanMatch } from '../../../shared/link-routes'
import { permissionLabel, siteName, type SitePermissionRow } from '../../../shared/permissions'
import { SIDEBAR_WIDTH, type AppState, type Profile, type SearchEngine, type Settings as SettingsT, type SettingsSection as Section } from '../../../shared/types'
import { SEARCH_ENGINES } from '../../../shared/url'
import { activeSpace, dispatch } from '../api'
import { Icon, type IconName } from '../icons'
import { Group, HoursSelect, patch, Row, Select, ToggleRow, type HoursOption } from './settings-controls'
import { ShortcutSettings } from './ShortcutSettings'
import './panels.css'
import './settings.css'

const SECTIONS: { id: Section; label: string; icon?: IconName }[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'traffic', label: 'Traffic Control', icon: 'link' },
  { id: 'profiles', label: 'Profiles', icon: 'profile' },
  { id: 'sites', label: 'Site Permissions', icon: 'lock' },
  { id: 'import', label: 'Import & Export', icon: 'download' },
  { id: 'extensions', label: 'Extensions', icon: 'puzzle' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: 'command' },
  { id: 'about', label: 'About' }
]

const ARCHIVE_OPTIONS: HoursOption[] = [
  { hours: 0, label: 'Never' },
  { hours: 12, label: 'After 12 hours' },
  { hours: 24, label: 'After 24 hours' },
  { hours: 168, label: 'After 7 days' },
  { hours: 720, label: 'After 30 days' }
]

const LITTLE_CLOSE_OPTIONS: HoursOption[] = [
  { hours: 1, label: 'After 1 hour' },
  { hours: 6, label: 'After 6 hours' },
  { hours: 12, label: 'After 12 hours' },
  { hours: 0, label: 'Never' }
]

const THEMES: { value: SettingsT['theme']; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

export function Settings({ state, section: initial = 'general', close }: { state: AppState; section?: Section; close: () => void }) {
  const [section, setSection] = useState<Section>(initial)
  const current = SECTIONS.find((entry) => entry.id === section)!
  const onNavKey = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const currentIndex = SECTIONS.findIndex((entry) => entry.id === section)
    const next = SECTIONS[(currentIndex + (event.key === 'ArrowDown' ? 1 : SECTIONS.length - 1)) % SECTIONS.length]
    setSection(next.id)
    document.getElementById(`set-tab-${next.id}`)?.focus()
  }
  return (
    <div className="panel sheet settings">
      <nav className="set-nav" role="tablist" aria-orientation="vertical" aria-label="Settings" onKeyDown={onNavKey}>
        <div className="set-nav-title">Settings</div>
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            id={`set-tab-${entry.id}`}
            role="tab"
            aria-selected={section === entry.id}
            tabIndex={section === entry.id ? 0 : -1}
            className="set-nav-item"
            onClick={() => setSection(entry.id)}
          >
            <span className="set-nav-icon">{entry.icon ? <Icon name={entry.icon} size={15} stroke={2} /> : <img src={logo} alt="" />}</span>
            {entry.label}
          </button>
        ))}
      </nav>
      <section className="set-main" role="tabpanel" aria-labelledby={`set-tab-${section}`}>
        <header className="set-head">
          <h2>{current.label}</h2>
          <button className="icon-btn" title="Close" onClick={close}>
            <Icon name="x" />
          </button>
        </header>
        <div className="set-body" key={section}>
          {section === 'general' && <General state={state} />}
          {section === 'traffic' && <TrafficControl state={state} />}
          {section === 'profiles' && <Profiles state={state} />}
          {section === 'sites' && <SitePermissions state={state} />}
          {section === 'import' && <Import />}
          {section === 'extensions' && <Extensions state={state} />}
          {section === 'shortcuts' && <ShortcutSettings shortcuts={state.settings.shortcuts} />}
          {section === 'about' && <About />}
        </div>
      </section>
    </div>
  )
}

function General({ state }: { state: AppState }) {
  const settings = state.settings
  // Local value so the slider stays smooth while main catches up.
  const [width, setWidth] = useState(settings.sidebarWidth)
  const space = activeSpace(state)
  const spaceProfile = state.profiles.find((profile) => profile.id === space.profileId)
  const pct = ((width - SIDEBAR_WIDTH.min) / (SIDEBAR_WIDTH.max - SIDEBAR_WIDTH.min)) * 100
  return (
    <>
      <Group title="Browsing">
        <Row title="Search engine" hint="Used for searches typed in the command bar.">
          <Select label="Search engine" value={settings.searchEngine} onChange={(engine) => patch({ searchEngine: engine as SearchEngine })}>
            {(Object.keys(SEARCH_ENGINES) as SearchEngine[]).map((engine) => (
              <option key={engine} value={engine}>
                {SEARCH_ENGINES[engine].name}
              </option>
            ))}
          </Select>
        </Row>
        <ToggleRow
          title="Block ads and trackers"
          hint="Built in, using uBlock Origin / EasyList-compatible lists. Turn it off per site from the shield in the URL bar."
          checked={settings.adblock}
          onChange={(on) => patch({ adblock: on })}
        />
        <Row title="Archive unpinned tabs" hint="Tabs in Today that you haven't used for a while move to the Archive.">
          <HoursSelect label="Archive unpinned tabs" value={settings.archiveAfterHours} options={ARCHIVE_OPTIONS} onChange={(hours) => patch({ archiveAfterHours: hours })} />
        </Row>
      </Group>
      <Group title="Appearance">
        <Row title="Theme">
          <div className="set-seg" role="radiogroup" aria-label="Theme">
            {THEMES.map((theme) => (
              <button key={theme.value} role="radio" aria-checked={settings.theme === theme.value} className={settings.theme === theme.value ? 'on' : ''} onClick={() => patch({ theme: theme.value })}>
                {theme.label}
              </button>
            ))}
          </div>
        </Row>
        <Row title="Sidebar width">
          <input
            type="range"
            className="set-range"
            aria-label="Sidebar width"
            style={{ '--pct': `${pct}%` } as CSSProperties}
            min={SIDEBAR_WIDTH.min}
            max={SIDEBAR_WIDTH.max}
            step={2}
            value={width}
            onChange={(event) => {
              const sidebarWidth = Number(event.target.value)
              setWidth(sidebarWidth)
              patch({ sidebarWidth })
            }}
          />
          <span className="set-value">{width}px</span>
        </Row>
        <ToggleRow title="Sidebar on the right" hint="Put the sidebar on the other side of the window." checked={settings.sidebarRight} onChange={(on) => patch({ sidebarRight: on })} />
      </Group>
      <Group title="Little Window and Peek">
        <ToggleRow
          title="Open links from other apps in a Little Window"
          hint="When off, they open as a new tab in the current space."
          checked={settings.littleArcForExternalLinks}
          onChange={(on) => patch({ littleArcForExternalLinks: on })}
        />
        <Row title="Close Little Windows" hint="A Little Window you leave in the background closes after this long. Its page goes to the Archive.">
          <HoursSelect label="Close Little Windows" value={settings.littleCloseAfterHours} options={LITTLE_CLOSE_OPTIONS} onChange={(hours) => patch({ littleCloseAfterHours: hours })} />
        </Row>
        <Row title="Little Window profile" hint="Which logins and history Little Windows use.">
          <Select label="Little Window profile" value={settings.littleArcProfileId} onChange={(profileId) => patch({ littleArcProfileId: profileId })}>
            <option value="">Current space's profile{spaceProfile ? ` (now: ${spaceProfile.name})` : ''}</option>
            {state.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </Select>
        </Row>
        <ToggleRow
          title="Open other sites from pinned tabs in Peek"
          hint="Links from pinned tabs and favorites to another site open in a Peek preview."
          checked={settings.peekPinnedLinks}
          onChange={(on) => patch({ peekPinnedLinks: on })}
        />
        <ToggleRow
          title="Float playing videos when you leave their tab"
          hint="The video keeps playing in a small window in front of your other apps. Move it, resize it, double-click it to go back to the tab."
          checked={settings.floatVideos}
          onChange={(on) => patch({ floatVideos: on })}
        />
      </Group>
      <Group title="Updates">
        <ToggleRow
          title="Check for updates automatically"
          hint={
            state.platform === 'win32'
              ? 'New versions download in the background and install when you restart YARC.'
              : 'You’re told when a new version is out, and install it yourself.'
          }
          checked={settings.autoUpdate}
          onChange={(on) => patch({ autoUpdate: on })}
        />
      </Group>
    </>
  )
}

function TrafficControl({ state }: { state: AppState }) {
  const routes = state.settings.linkRoutes
  const [match, setMatch] = useState('')
  const [spaceId, setSpaceId] = useState(activeSpace(state).id)
  const site = cleanMatch(match)
  const add = () => {
    if (!site) return
    patch({ linkRoutes: [...routes.filter((route) => route.match !== site), { match: site, spaceId }] })
    setMatch('')
  }
  const spaceSelect = (label: string, value: string, onChange: (id: string) => void) => (
    <Select label={label} value={value} onChange={onChange}>
      {state.spaces.map((space) => (
        <option key={space.id} value={space.id}>
          {space.emoji ? `${space.emoji} ` : ''}
          {space.name}
        </option>
      ))}
    </Select>
  )
  return (
    <>
      <p className="set-note">
        Links you open from other apps go to the space of the first rule they match. A site also covers its subdomains; a site with a path (
        <code>github.com/team</code>) only the pages under it. Other links {state.settings.littleArcForExternalLinks ? 'open in a Little Window' : 'open in the current space'}.
      </p>
      <Group>
        {routes.length === 0 && <div className="set-empty">No rules yet.</div>}
        {routes.map((route, index) => (
          <Row key={route.match} title={route.match}>
            {spaceSelect(`Space for ${route.match}`, route.spaceId, (id) => patch({ linkRoutes: routes.map((other, otherIndex) => (otherIndex === index ? { ...other, spaceId: id } : other)) }))}
            <button className="icon-btn" title={`Remove the rule for ${route.match}`} onClick={() => patch({ linkRoutes: routes.filter((_route, otherIndex) => otherIndex !== index) })}>
              <Icon name="x" />
            </button>
          </Row>
        ))}
      </Group>
      <Group title="New rule">
        <div className="set-row">
          <input
            className="set-input"
            aria-label="Site or address"
            placeholder="figma.com"
            spellCheck={false}
            value={match}
            onChange={(event) => setMatch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add()
            }}
          />
          <div className="set-control">
            {spaceSelect('Space for the new rule', spaceId, setSpaceId)}
            <button className="btn primary" disabled={!site} onClick={add}>
              Add
            </button>
          </div>
        </div>
      </Group>
    </>
  )
}

function Profiles({ state }: { state: AppState }) {
  return (
    <>
      <p className="set-note">
        A profile keeps its own logins, cookies, history, favorites and extensions. Each space uses one profile; several spaces can share one. Change a
        space's profile from its Edit sheet.
      </p>
      <Group>
        {state.profiles.map((profile) => (
          <ProfileRow key={profile.id} profile={profile} state={state} />
        ))}
      </Group>
    </>
  )
}

function ProfileRow({ profile, state }: { profile: Profile; state: AppState }) {
  const [draft, setDraft] = useState(profile.name)
  const spaces = state.spaces.filter((space) => space.profileId === profile.id)
  const commit = () => {
    const name = draft.trim()
    if (!name) return setDraft(profile.name)
    if (name !== profile.name) dispatch({ type: 'renameProfile', id: profile.id, name })
  }
  return (
    <div className="set-row set-profile">
      <span className="set-avatar" style={spaces[0] ? ({ '--avatar': spaces[0].color } as CSSProperties) : undefined}>
        {(draft.trim() || profile.name).charAt(0).toUpperCase()}
      </span>
      <input
        className="set-name"
        aria-label="Profile name"
        title="Rename"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <div className="used-by">
        {spaces.length === 0 && <span className="muted">Not used by any space</span>}
        {spaces.map((space) => (
          <span key={space.id} className="chip">
            {space.emoji ? <span>{space.emoji}</span> : <span className="swatch" style={{ background: space.color, width: 8, height: 8 }} />}
            {space.name}
          </span>
        ))}
      </div>
    </div>
  )
}

function SitePermissions({ state }: { state: AppState }) {
  const groups = state.profiles.map((profile) => ({ profile, rows: state.sitePermissions?.[profile.id] ?? [] }))
  const any = groups.some((group) => group.rows.length)
  return (
    <>
      <p className="set-note">
        What you told sites that asked for notifications, your camera, microphone or location. Each profile keeps its own answers. After three Not
        Nows a site isn't asked again for a week. Forget an answer to be asked again.
      </p>
      {!any && (
        <Group>
          <div className="set-empty">No site has asked yet.</div>
        </Group>
      )}
      {groups.map(({ profile, rows }) =>
        rows.length ? (
          <Group key={profile.id} title={state.profiles.length > 1 ? profile.name : undefined}>
            {rows.map((row) => (
              <SitePermissionLine key={`${row.origin}|${row.key}`} profileId={profile.id} row={row} />
            ))}
          </Group>
        ) : null
      )}
    </>
  )
}

function SitePermissionLine({ profileId, row }: { profileId: string; row: SitePermissionRow }) {
  const send = (setting: 'allow' | 'block' | 'reset') => dispatch({ type: 'sitePermission', profileId, origin: row.origin, key: row.key, setting })
  const until = row.until ? new Date(row.until).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''
  const label = `${permissionLabel(row.key)} for ${siteName(row.origin)}`
  return (
    <Row title={siteName(row.origin)} hint={row.setting === 'quiet' ? `${permissionLabel(row.key)} · not asking until ${until}` : permissionLabel(row.key)}>
      <Select label={label} value={row.setting} onChange={(setting) => send(setting as 'allow' | 'block')}>
        {row.setting === 'quiet' && <option value="quiet">Blocked for now</option>}
        <option value="allow">Allow</option>
        <option value="block">Block</option>
      </Select>
      <button className="btn" title="Forget this answer: the site asks again next time" onClick={() => send('reset')}>
        Forget
      </button>
    </Row>
  )
}

function Import() {
  return (
    <>
      <p className="set-note">
        Arc shuts down on 22 Dec 2026. Bring your spaces, pinned tabs, favorites and history over now. You can also pick an Arc folder copied from a Mac
        (<code>~/Library/Application Support/Arc</code>).
      </p>
      <Group>
        <Row title="Arc" hint="Spaces, pinned tabs, folders, favorites and history.">
          <button className="btn primary" onClick={() => dispatch({ type: 'import', source: 'arc' })}>
            Import from Arc…
          </button>
        </Row>
        <Row title="Zen" hint="Spaces, pinned tabs, folders, essentials and history.">
          <button className="btn" onClick={() => dispatch({ type: 'import', source: 'zen' })}>
            Import from Zen…
          </button>
        </Row>
        <Row title="Chromium browsers" hint="History and bookmarks from Chrome, Edge or Brave.">
          <button className="btn" onClick={() => dispatch({ type: 'import', source: 'chrome' })}>
            Import from Chrome / Edge / Brave…
          </button>
        </Row>
      </Group>
      <Group>
        <Row title="Export" hint="Every space's pinned tabs and folders, and your favorites, as a bookmarks file any browser can import.">
          <button className="btn" onClick={() => dispatch({ type: 'exportBookmarks' })}>
            Export as Bookmarks…
          </button>
        </Row>
      </Group>
    </>
  )
}

function Extensions({ state }: { state: AppState }) {
  const space = activeSpace(state)
  const profile = state.profiles.find((profile) => profile.id === space.profileId)
  const list = state.extensions[space.profileId] ?? []
  return (
    <>
      <Group>
        <Row title="Chrome Web Store" hint="Install Chrome extensions into this profile.">
          <button className="btn primary" onClick={() => dispatch({ type: 'extensionsStore' })}>
            Get extensions
          </button>
        </Row>
      </Group>
      <p className="set-note">
        Extensions are installed per profile, so they only show up in spaces that use the same profile. Showing{' '}
        <strong>{profile?.name ?? 'this profile'}</strong> (used by {space.emoji ? `${space.emoji} ` : ''}
        {space.name}).
      </p>
      <Group title="Installed">
        {list.length === 0 && <div className="set-empty">No extensions installed in this profile yet.</div>}
        {list.map((extension) => (
          <div key={extension.id} className="set-row set-ext">
            {extension.icon ? <img className="set-ext-icon" src={extension.icon} alt="" /> : <span className="set-ext-icon"><Icon name="puzzle" /></span>}
            <span className="set-row-title">{extension.name}</span>
            <span className="set-ext-id">{extension.id}</span>
          </div>
        ))}
      </Group>
    </>
  )
}

function About() {
  return (
    <div className="set-about">
      <img className="logo" src={logo} alt="" />
      <h2>YARC</h2>
      <p>Yarrr! An open-source browser for people who liked Arc. Not affiliated with The Browser Company.</p>
    </div>
  )
}
