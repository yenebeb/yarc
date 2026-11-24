import { useEffect, useState } from 'react'
import { accelLabel, assign, BINDINGS, bindingLabel, canRemap, commandTitle, pressed, RESERVED, usedBy, whyNot, type CommandId, type Shortcuts } from '../../../shared/keymap'
import { cx, dispatch, isMac } from '../api'
import { Icon } from '../icons'
import { Group, patch } from './settings-controls'

function keyCapsOf(shortcutLabel: string): string[] {
  if (!isMac) return shortcutLabel.split(/\+(?=.)/)
  const modifierSymbols = /^[⌘⌃⌥⇧]*/.exec(shortcutLabel)![0]
  return [...Array.from(modifierSymbols), shortcutLabel.slice(modifierSymbols.length)].filter(Boolean)
}

const Keys = ({ label }: { label: string }) => (
  <span className="set-keys">
    {keyCapsOf(label).map((keyCap, position) => (
      <kbd key={position}>{keyCap}</kbd>
    ))}
  </span>
)

type Problem = { text: string; replace?: string }

export function ShortcutSettings({ shortcuts }: { shortcuts: Shortcuts }) {
  const [recording, setRecording] = useState<CommandId>()
  const [held, setHeld] = useState({ accel: '', done: false })
  const [problem, setProblem] = useState<Problem>()
  const record = (id?: CommandId) => {
    setRecording(id)
    setHeld({ accel: '', done: false })
    setProblem(undefined)
    dispatch({ type: 'recordShortcut', on: id !== undefined })
  }
  const save = (next: Shortcuts) => {
    patch({ shortcuts: next })
    record(undefined)
  }
  useEffect(() => () => dispatch({ type: 'recordShortcut', on: false }), [])
  useEffect(() => {
    if (!recording) return
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const keys = pressed({ code: event.code, control: event.ctrlKey, meta: event.metaKey, alt: event.altKey, shift: event.shiftKey })
      if (event.type === 'keyup') return setHeld((previous) => (previous.done ? previous : keys))
      if (event.key === 'Escape') return record(undefined)
      setHeld(keys)
      if (!keys.done) return
      const other = usedBy(keys.accel, recording, isMac, shortcuts)
      const why = whyNot(keys.accel, isMac)
      if (why) setProblem({ text: why })
      else if (other && !canRemap(other)) setProblem({ text: `${commandTitle(other)} uses it, and that can't be changed.` })
      else if (other) setProblem({ text: `${commandTitle(other)} already uses it.`, replace: keys.accel })
      else save(assign(shortcuts, recording, keys.accel, isMac))
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
    }
  }, [recording, shortcuts])

  const reset = (id: CommandId) => patch({ shortcuts: Object.fromEntries(Object.entries(shortcuts).filter(([commandId]) => commandId !== id)) })
  const fixed: { title: string; keys: string }[] = []
  const bound: CommandId[] = []
  const unbound: CommandId[] = []
  for (const binding of BINDINGS) {
    const keys = bindingLabel(binding.id, isMac, shortcuts)
    const numbered = /^(space|tab)(\d)$/.exec(binding.id)
    if (canRemap(binding.id)) (keys || shortcuts[binding.id] ? bound : unbound).push(binding.id)
    else if (numbered?.[2] === '1') fixed.push({ title: numbered[1] === 'space' ? 'Switch to Space 1–9' : 'Go to Tab 1–9', keys: `${keys}–9` })
    else if (keys && !numbered) fixed.push({ title: binding.title, keys })
  }
  for (const [accel, title] of Object.entries(RESERVED[isMac ? 'mac' : 'other'])) fixed.push({ title, keys: accelLabel(accel, isMac) })

  const row = (id: CommandId) => (
    <div key={id} className={cx('set-row set-shortcut', recording === id && 'recording')}>
      <span className="set-row-title">{commandTitle(id)}</span>
      {shortcuts[id] && (
        <button className="icon-btn set-shortcut-reset" title="Reset to default" onClick={() => reset(id)}>
          <Icon name="reset" />
        </button>
      )}
      <button className="set-shortcut-keys" title="Change shortcut" onClick={() => record(recording === id ? undefined : id)}>
        {recording === id ? (
          held.accel ? <Keys label={accelLabel(held.accel, isMac)} /> : <span className="set-shortcut-hint">Press keys…</span>
        ) : bindingLabel(id, isMac, shortcuts) ? (
          <Keys label={bindingLabel(id, isMac, shortcuts)} />
        ) : (
          <span className="set-shortcut-hint">None</span>
        )}
      </button>
      {recording === id && problem && (
        <div className="set-shortcut-problem">
          {problem.text}
          {problem.replace && (
            <>
              <button className="btn" onClick={() => save(assign(shortcuts, id, problem.replace!, isMac))}>
                Replace
              </button>
              <button className="btn" onClick={() => record(undefined)}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
  return (
    <>
      <p className="set-note">
        Click a shortcut, then press the keys you want. Esc cancels.
        {Object.keys(shortcuts).length > 0 && (
          <button className="btn set-shortcut-reset-all" onClick={() => save({})}>
            Reset All
          </button>
        )}
      </p>
      <Group>{bound.map(row)}</Group>
      <Group title="Without a shortcut">{unbound.map(row)}</Group>
      <Group title="Fixed">
        {fixed.map((entry) => (
          <div key={entry.title} className="set-row set-shortcut fixed" title="Can't be changed">
            <span className="set-row-title">{entry.title}</span>
            <Icon name="lock" size={13} />
            <Keys label={entry.keys} />
          </div>
        ))}
      </Group>
    </>
  )
}
