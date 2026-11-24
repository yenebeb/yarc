import { useEffect, useState, type FormEvent } from 'react'
import type { AppState } from '../../../shared/types'
import { cx, dispatch, isMac } from '../api'
import { Icon } from '../icons'
import { CustomColor } from './ColorPicker'
import { firstGrapheme, SPACE_COLORS } from './util'
import './panels.css'
import './editors.css'

const EMOJI = [
  '🏠', '💼', '🎨', '🎮', '🎵', '📚', '🧪', '💻', '🛠️', '🚀',
  '🌱', '🌊', '🔥', '⭐', '🌙', '☀️', '❤️', '🍀', '🍕', '☕',
  '✈️', '🏃', '🧘', '🐶', '🐱', '🦊', '📷', '🎬', '📝', '💡',
  '💰', '🛒', '📈', '🎓', '🧠', '⚽', '🏔️', '🎧', '🧩', '🔒'
]

const HEX = /^#[0-9a-f]{6}$/i

export function SpaceEditor({ state, close, spaceId }: { state: AppState; close: () => void; spaceId?: string }) {
  const space = spaceId ? state.spaces.find((s) => s.id === spaceId) : undefined
  const isNew = !space
  const used = new Set(state.spaces.map((s) => s.color))

  const [name, setName] = useState(space?.name ?? '')
  const [emoji, setEmoji] = useState(space?.emoji ?? '')
  const [custom, setCustom] = useState(space?.emoji && !EMOJI.includes(space.emoji) ? space.emoji : '')
  const [color, setColor] = useState(space?.color ?? SPACE_COLORS.find((c) => !used.has(c)) ?? SPACE_COLORS[0])
  const [color2, setColor2] = useState(space?.color2 ?? '')
  const [profileId, setProfileId] = useState<string>(space?.profileId ?? 'new')
  const [profileName, setProfileName] = useState('')

  useEffect(() => {
    if (HEX.test(color)) dispatch({ type: 'previewSpaceColors', spaceId: space?.id, color, color2: HEX.test(color2) ? color2 : undefined })
  }, [color, color2])

  const fallbackName = `Space ${state.spaces.length + 1}`
  const usersOf = (id: string) => state.spaces.filter((s) => s.id !== space?.id && s.profileId === id)
  const profileChanged = !!space && profileId !== space.profileId
  const profileChoices = [
    ...(isNew ? [{ id: 'new', name: 'New profile', detail: 'Its own logins, history and extensions' }] : []),
    ...state.profiles.map((p) => {
      const users = usersOf(p.id).map((s) => s.name).join(', ')
      return { id: p.id, name: p.name, detail: users && `${isNew ? 'Shared with' : 'Also used by'} ${users}` }
    })
  ]

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const n = name.trim() || space?.name || fallbackName
    const c = HEX.test(color) ? color : (space?.color ?? SPACE_COLORS[0])
    const c2 = HEX.test(color2) ? color2 : ''
    if (space) {
      dispatch({ type: 'updateSpace', id: space.id, name: n, emoji, color: c, color2: c2, profileId: profileChanged ? profileId : undefined })
    } else {
      dispatch({
        type: 'createSpace',
        name: n,
        emoji: emoji || undefined,
        color: c,
        color2: c2 || undefined,
        profileId: profileId === 'new' ? 'new' : profileId,
        profileName: profileId === 'new' ? profileName.trim() || n : undefined
      })
    }
    close()
  }

  const remove = () => {
    if (!space) return
    const others = usersOf(space.profileId)
    const profile = state.profiles.find((p) => p.id === space.profileId)
    const msg =
      `Delete the space “${space.name}”? Its pinned and open tabs will be removed.` +
      (others.length === 0
        ? `\n\nNo other space uses the profile “${profile?.name ?? 'this profile'}”, so its logins, cookies, history, favorites and extensions will be deleted too.`
        : `\n\nThe profile “${profile?.name ?? ''}” is kept because ${others.map((s) => s.name).join(', ')} still use${others.length === 1 ? 's' : ''} it.`)
    if (!window.confirm(msg)) return
    dispatch({ type: 'deleteSpace', id: space.id })
    close()
  }

  const pickEmoji = (e: string) => {
    setEmoji(e)
    setCustom('')
  }

  return (
    <div className="panel sheet space-editor">
      <form className="contents" onSubmit={submit}>
        <header>
          <span className="preview-chip">{emoji ? <span>{emoji}</span> : <span className="dot" />}</span>
          <span>{isNew ? 'New Space' : 'Edit Space'}</span>
          <span className="spacer" />
          <button type="button" className="icon-btn" title="Cancel" onClick={close}>
            <Icon name="x" />
          </button>
        </header>
        <div className="body">
          <label className="field">
            <span>Name</span>
            <input
              className="text-input name-input"
              autoFocus
              placeholder={space?.name ?? fallbackName}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>

          <div className="field">
            <span>Icon</span>
            <div className="emoji-grid">
              <button type="button" className={cx('none', !emoji && 'on')} title="No icon" onClick={() => pickEmoji('')}>
                None
              </button>
              {EMOJI.map((e) => (
                <button type="button" key={e} className={emoji === e ? 'on' : ''} onClick={() => pickEmoji(e)}>
                  {e}
                </button>
              ))}
            </div>
            <div className="emoji-custom">
              <span>Or any emoji:</span>
              <input
                className="text-input"
                aria-label="Custom emoji"
                value={custom}
                placeholder="🙂"
                onChange={(e) => {
                  const g = firstGrapheme(e.target.value)
                  setCustom(g)
                  setEmoji(g)
                }}
              />
              <span>{isMac ? 'Ctrl+Cmd+Space' : 'Win+.'} opens the emoji picker.</span>
            </div>
          </div>

          <div className="field">
            <span>Color</span>
            <ColorRow label="Color" value={color} onChange={setColor} />
            {color2 ? (
              <>
                <div className="second-color">
                  <span>Second color</span>
                  <button type="button" className="btn small" onClick={() => setColor2('')}>
                    Remove
                  </button>
                </div>
                <ColorRow label="Second color" value={color2} onChange={setColor2} />
              </>
            ) : (
              <button type="button" className="btn small add-color" onClick={() => setColor2(SPACE_COLORS.find((c) => c !== color.toLowerCase())!)}>
                <Icon name="plus" size={13} /> Second color
              </button>
            )}
          </div>

          <div className="field">
            <span>Profile</span>
            <div className="segmented" role="radiogroup" aria-label="Profile">
              {profileChoices.map((p) => (
                <button type="button" role="radio" aria-checked={profileId === p.id} key={p.id} className={cx(profileId === p.id && 'on')} onClick={() => setProfileId(p.id)}>
                  {p.name}
                  {p.detail && <small>{p.detail}</small>}
                </button>
              ))}
            </div>
          </div>
          {isNew && profileId === 'new' && (
            <label className="field">
              <span>Profile name</span>
              <input className="text-input" placeholder={name.trim() || fallbackName} value={profileName} onChange={(e) => setProfileName(e.target.value)} />
            </label>
          )}
          {isNew && profileId !== 'new' && (
            <p className="note" style={{ margin: 0 }}>
              The new space shares logins, cookies, history, favorites and extensions with the spaces on this profile.
            </p>
          )}
          {profileChanged && (
            <p className="note warn" style={{ margin: 0 }}>
              Open tabs in this space will reload with the other profile's logins and cookies, and the favorites row will change.
            </p>
          )}

          <div className="actions">
            {space && (
              <button type="button" className="btn danger" onClick={remove} disabled={state.spaces.length <= 1} title={state.spaces.length <= 1 ? 'You need at least one space' : undefined}>
                Delete space…
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="btn" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn primary">
              {isNew ? 'Create space' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <div className="color-row" role="group" aria-label={label}>
      {SPACE_COLORS.map((c) => (
        <button
          type="button"
          key={c}
          className={cx('sw', value.toLowerCase() === c && 'on')}
          style={{ background: c }}
          title={c}
          aria-label={`${label} ${c}`}
          onClick={() => onChange(c)}
        />
      ))}
      <CustomColor color={value} onChange={onChange} />
      <span className="hex">{value}</span>
    </div>
  )
}
