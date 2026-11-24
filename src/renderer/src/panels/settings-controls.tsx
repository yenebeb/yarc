import type { ReactNode } from 'react'
import type { Settings } from '../../../shared/types'
import { dispatch } from '../api'
import { Icon } from '../icons'

export type HoursOption = { hours: number; label: string }

export const patch = (changes: Partial<Settings>) => dispatch({ type: 'settings', patch: changes })

export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="set-group">
      {title && <h3>{title}</h3>}
      <div className="set-card">{children}</div>
    </div>
  )
}

export function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
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

export function ToggleRow({ title, hint, checked, onChange }: { title: string; hint?: ReactNode; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="set-row click">
      <div className="set-row-text">
        <span className="set-row-title">{title}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="set-control">
        <input type="checkbox" role="switch" aria-label={title} className="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      </div>
    </label>
  )
}

export function Select({ label, value, onChange, children }: { label: string; value: string | number; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <span className="set-select">
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
      <Icon name="chevron" size={13} stroke={2.2} />
    </span>
  )
}

export function HoursSelect({ label, value, options, onChange }: { label: string; value: number; options: HoursOption[]; onChange: (hours: number) => void }) {
  return (
    <Select label={label} value={value} onChange={(hours) => onChange(Number(hours))}>
      {!options.some((option) => option.hours === value) && <option value={value}>After {value} hours</option>}
      {options.map((option) => (
        <option key={option.hours} value={option.hours}>
          {option.label}
        </option>
      ))}
    </Select>
  )
}
