// Settings window: a section list on the left, grouped cards of options on the right.
import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import logo from '../../../../build/icon.svg'
import { BINDINGS, bindingLabel } from '../../../shared/keymap'
import { permissionLabel, siteName, type SitePermissionRow } from '../../../shared/permissions'
import { SIDEBAR_WIDTH, type AppState, type Profile, type SearchEngine, type Settings as SettingsT } from '../../../shared/types'
import { SEARCH_ENGINES } from '../../../shared/url'
import { activeSpace, dispatch, isMac } from '../api'
import { Icon, type IconName } from '../icons'
import './panels.css'
import './settings.css'

type Section = 'general' | 'profiles' | 'sites' | 'import' | 'extensions' | 'shortcuts' | 'about'

const SECTIONS: { id: Section; label: string; icon?: IconName }[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'profiles', label: 'Profiles', icon: 'profile' },
  { id: 'sites', label: 'Site Permissions', icon: 'lock' },
  { id: 'import', label: 'Import', icon: 'download' },
  { id: 'extensions', label: 'Extensions', icon: 'puzzle' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: 'command' },
  { id: 'about', label: 'About' }
]

const ARCHIVE_OPTIONS: { hours: number; label: string }[] = [
  { hours: 0, label: 'Never' },
  { hours: 12, label: 'After 12 hours' },
  { hours: 24, label: 'After 24 hours' },
  { hours: 168, label: 'After 7 days' },
  { hours: 720, label: 'After 30 days' }
]

const THEMES: { value: SettingsT['theme']; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const patch = (p: Partial<SettingsT>) => dispatch({ type: 'settings', patch: p })

export function Settings({ state, close }: { state: AppState; close: () => void }) {
  const [section, setSection] = useState<Section>('general')
  const current = SECTIONS.find((s) => s.id === section)!
  // Up/down arrows move through the section list, like a native sidebar.
  const onNavKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = SECTIONS.findIndex((s) => s.id === section)
    const next = SECTIONS[(i + (e.key === 'ArrowDown' ? 1 : SECTIONS.length - 1)) % SECTIONS.length]
    setSection(next.id)
    document.getElementById(`set-tab-${next.id}`)?.focus()
  }
  return (
    <div className="panel sheet settings">
      <nav className="set-nav" role="tablist" aria-orientation="vertical" aria-label="Settings" onKeyDown={onNavKey}>
        <div className="set-nav-title">Settings</div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            id={`set-tab-${s.id}`}
            role="tab"
            aria-selected={section === s.id}
            tabIndex={section === s.id ? 0 : -1}
            className="set-nav-item"
            onClick={() => setSection(s.id)}
          >
            <span className="set-nav-icon">{s.icon ? <Icon name={s.icon} size={15} stroke={2} /> : <img src={logo} alt="" />}</span>
            {s.label}
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
          {section === 'profiles' && <Profiles state={state} />}
          {section === 'sites' && <SitePermissions state={state} />}
          {section === 'import' && <Import />}
          {section === 'extensions' && <Extensions state={state} />}
          {section === 'shortcuts' && <Shortcuts />}
          {section === 'about' && <About />}
        </div>
      </section>
    </div>
  )
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="set-group">
      {title && <h3>{title}</h3>}
      <div className="set-card">{children}</div>
    </div>
  )
}

function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        <span className="set-row-title">{title}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  )
}

/** A row whose whole area flips its switch. */
function ToggleRow({ title, hint, checked, onChange }: { title: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="set-row click">
      <div className="set-row-text">
        <span className="set-row-title">{title}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="set-control">
        <input type="checkbox" role="switch" aria-label={title} className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </div>
    </label>
  )
}

function Select({ label, value, onChange, children }: { label: string; value: string | number; onChange: (v: string) => void; children: ReactNode }) {
  return (
    <span className="set-select">
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
      <Icon name="chevron" size={13} stroke={2.2} />
    </span>
  )
}

function General({ state }: { state: AppState }) {
  const s = state.settings
  // Local value so the slider stays smooth while main catches up.
  const [width, setWidth] = useState(s.sidebarWidth)
  const space = activeSpace(state)
  const spaceProfile = state.profiles.find((p) => p.id === space.profileId)
  const archiveKnown = ARCHIVE_OPTIONS.some((o) => o.hours === s.archiveAfterHours)
  const pct = ((width - SIDEBAR_WIDTH.min) / (SIDEBAR_WIDTH.max - SIDEBAR_WIDTH.min)) * 100
  return (
    <>
      <Group title="Browsing">
        <Row title="Search engine" hint="Used for searches typed in the command bar.">
          <Select label="Search engine" value={s.searchEngine} onChange={(v) => dispatch({ type: 'searchEngine', engine: v as SearchEngine })}>
            {(Object.keys(SEARCH_ENGINES) as SearchEngine[]).map((k) => (
              <option key={k} value={k}>
                {SEARCH_ENGINES[k].name}
              </option>
            ))}
          </Select>
        </Row>
        <ToggleRow
          title="Block ads and trackers"
          hint="Built in, using uBlock Origin / EasyList-compatible lists. Turn it off per site from the shield in the URL bar."
          checked={s.adblock}
          onChange={(v) => patch({ adblock: v })}
        />
        <Row title="Archive unpinned tabs" hint="Tabs in Today that you haven't used for a while move to the Archive.">
          <Select label="Archive unpinned tabs" value={s.archiveAfterHours} onChange={(v) => patch({ archiveAfterHours: Number(v) })}>
            {!archiveKnown && <option value={s.archiveAfterHours}>After {s.archiveAfterHours} hours</option>}
            {ARCHIVE_OPTIONS.map((o) => (
              <option key={o.hours} value={o.hours}>
                {o.label}
              </option>
            ))}
          </Select>
        </Row>
      </Group>
      <Group title="Appearance">
        <Row title="Theme">
          <div className="set-seg" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.value} role="radio" aria-checked={s.theme === t.value} className={s.theme === t.value ? 'on' : ''} onClick={() => patch({ theme: t.value })}>
                {t.label}
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
            onChange={(e) => {
              const v = Number(e.target.value)
              setWidth(v)
              patch({ sidebarWidth: v })
            }}
          />
          <span className="set-value">{width}px</span>
        </Row>
        <ToggleRow title="Sidebar on the right" hint="Arc never had this." checked={s.sidebarRight} onChange={(v) => patch({ sidebarRight: v })} />
      </Group>
      <Group title="Little Arc and Peek">
        <ToggleRow
          title="Open links from other apps in Little Arc"
          hint="When off, they open as a new tab in the current space."
          checked={s.littleArcForExternalLinks}
          onChange={(v) => patch({ littleArcForExternalLinks: v })}
        />
        <Row title="Little Arc profile" hint="Which logins and history Little Arc windows use.">
          <Select label="Little Arc profile" value={s.littleArcProfileId} onChange={(v) => patch({ littleArcProfileId: v })}>
            <option value="">Current space's profile{spaceProfile ? ` (now: ${spaceProfile.name})` : ''}</option>
            {state.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Row>
        <ToggleRow
          title="Open other sites from pinned tabs in Peek"
          hint="Links from pinned tabs and favorites to another site open in a Peek preview, like Arc."
          checked={s.peekPinnedLinks}
          onChange={(v) => patch({ peekPinnedLinks: v })}
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
          checked={s.autoUpdate}
          onChange={(v) => patch({ autoUpdate: v })}
        />
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
        {state.profiles.map((p) => (
          <ProfileRow key={p.id} profile={p} state={state} />
        ))}
      </Group>
    </>
  )
}

function ProfileRow({ profile, state }: { profile: Profile; state: AppState }) {
  const [draft, setDraft] = useState(profile.name)
  const spaces = state.spaces.filter((s) => s.profileId === profile.id)
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
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
      />
      <div className="used-by">
        {spaces.length === 0 && <span className="muted">Not used by any space</span>}
        {spaces.map((s) => (
          <span key={s.id} className="chip">
            {s.emoji ? <span>{s.emoji}</span> : <span className="swatch" style={{ background: s.color, width: 8, height: 8 }} />}
            {s.name}
          </span>
        ))}
      </div>
    </div>
  )
}

function SitePermissions({ state }: { state: AppState }) {
  const groups = state.profiles.map((p) => ({ profile: p, rows: state.sitePermissions?.[p.id] ?? [] }))
  const any = groups.some((g) => g.rows.length)
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
      <Select label={label} value={row.setting} onChange={(v) => send(v as 'allow' | 'block')}>
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
    </>
  )
}

function Extensions({ state }: { state: AppState }) {
  const space = activeSpace(state)
  const profile = state.profiles.find((p) => p.id === space.profileId)
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
        {list.map((x) => (
          <div key={x.id} className="set-row set-ext">
            {x.icon ? <img className="set-ext-icon" src={x.icon} alt="" /> : <span className="set-ext-icon"><Icon name="puzzle" /></span>}
            <span className="set-row-title">{x.name}</span>
            <span className="set-ext-id">{x.id}</span>
          </div>
        ))}
      </Group>
    </>
  )
}

/** Splits a shortcut label into keycaps: "Ctrl+Shift+T" or "⌘⇧T". */
function keyCaps(label: string): string[] {
  if (!isMac) return label.split(/\+(?=.)/)
  const mods = /^[⌘⌃⌥⇧]*/.exec(label)![0]
  return [...Array.from(mods), label.slice(mods.length)]
}

function Shortcuts() {
  const rows: { title: string; keys: string }[] = []
  for (const b of BINDINGS) {
    const m = /^(space|tab)(\d)$/.exec(b.id)
    if (m && m[2] !== '1') continue
    const keys = bindingLabel(b.id, isMac)
    if (!keys) continue
    if (m) rows.push({ title: m[1] === 'space' ? 'Switch to Space 1–9' : 'Go to Tab 1–9', keys: `${keys}–9` })
    else rows.push({ title: b.title, keys })
  }
  return (
    <>
      <p className="set-note">Shortcuts follow Arc's defaults{isMac ? '' : ' on Windows'}. They can't be changed yet.</p>
      <Group>
        {rows.map((r) => (
          <div key={r.title} className="set-row set-shortcut">
            <span className="set-row-title">{r.title}</span>
            <span className="set-keys">
              {keyCaps(r.keys).map((k, i) => (
                <kbd key={i}>{k}</kbd>
              ))}
            </span>
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
      <p>Yarrr! Yet Another Arc Clone: an open-source, Arc-style browser. Not affiliated with The Browser Company.</p>
    </div>
  )
}
