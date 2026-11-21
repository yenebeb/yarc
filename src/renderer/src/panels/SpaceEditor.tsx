import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AppState } from '../../../shared/types'
import { activeSpace, cx, dispatch, isMac } from '../api'
import { Icon } from '../icons'
import { firstGrapheme, SPACE_COLORS } from './util'
import './panels.css'

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
  const [profileId, setProfileId] = useState<string>(space?.profileId ?? 'new')
  const [profileName, setProfileName] = useState('')

  // Live-preview the color; on unmount fall back to whatever the active space is by then.
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })
  useEffect(() => {
    if (HEX.test(color)) document.documentElement.style.setProperty('--space', color)
  }, [color])
  useEffect(
    () => () => {
      const s = stateRef.current
      document.documentElement.style.setProperty('--space', activeSpace(s).color)
    },
    []
  )

  const fallbackName = `Space ${state.spaces.length + 1}`
  const usersOf = (id: string) => state.spaces.filter((s) => s.id !== space?.id && s.profileId === id)
  const profileChanged = !!space && profileId !== space.profileId

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const n = name.trim() || space?.name || fallbackName
    const c = HEX.test(color) ? color : (space?.color ?? SPACE_COLORS[0])
    if (space) {
      dispatch({ type: 'updateSpace', id: space.id, name: n, emoji, color: c, profileId: profileChanged ? profileId : undefined })
    } else {
      dispatch({
        type: 'createSpace',
        name: n,
        emoji: emoji || undefined,
        color: c,
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
            <div className="color-row">
              {SPACE_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={cx('sw', color.toLowerCase() === c && 'on')}
                  style={{ background: c }}
                  title={c}
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                />
              ))}
              <input type="color" aria-label="Custom color" title="Custom color" value={HEX.test(color) ? color : '#7c6cf2'} onChange={(e) => setColor(e.target.value)} />
              <span className="hex">{color}</span>
            </div>
          </div>

          <label className="field">
            <span>Profile</span>
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              {isNew && <option value="new">New profile (separate logins, history &amp; extensions)</option>}
              {state.profiles.map((p) => {
                const users = usersOf(p.id)
                const by = users.length ? ` — used by ${users.map((s) => s.name).join(', ')}` : ''
                return (
                  <option key={p.id} value={p.id}>
                    {isNew ? `Share with: ${p.name}${by}` : `${p.name}${by}`}
                  </option>
                )
              })}
            </select>
          </label>
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
