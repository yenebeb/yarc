import { useEffect, useId, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { hexToHsv, hsvToHex, SPACE_COLORS, type Hsv } from '../../../shared/colors'
import { cx } from '../api'

const HEX = /^#[0-9a-f]{6}$/i
const clamp = (x: number) => Math.min(1, Math.max(0, x))
const STEPS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }

/** The color row's last swatch: opens a picker for any color. */
export function CustomColor({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const id = `color-picker-${useId().replace(/\W/g, '')}`
  const custom = HEX.test(color) && !SPACE_COLORS.includes(color.toLowerCase())
  const [hsv, setHsv] = useState(() => hexToHsv(HEX.test(color) ? color : SPACE_COLORS[0]))
  const [text, setText] = useState(color)

  // Keeps the hue while saturation or brightness is 0, where the hex alone loses it.
  useEffect(() => {
    if (HEX.test(color) && color.toLowerCase() !== hsvToHex(hsv)) setHsv(hexToHsv(color))
    setText(color)
  }, [color])

  const set = (next: Hsv) => {
    setHsv(next)
    onChange(hsvToHex(next))
  }
  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    set({ ...hsv, s: clamp((e.clientX - r.left) / r.width), v: 1 - clamp((e.clientY - r.top) / r.height) })
  }
  const nudge = (e: KeyboardEvent) => {
    const step = STEPS[e.key]
    if (!step) return
    e.preventDefault()
    const by = e.shiftKey ? 0.1 : 0.02
    set({ ...hsv, s: clamp(hsv.s + step[0] * by), v: clamp(hsv.v + step[1] * by) })
  }

  return (
    <span className="custom-color" style={{ '--anchor': `--${id}` } as CSSProperties}>
      <button
        type="button"
        className={cx('sw custom-sw', custom && 'on')}
        style={custom ? { background: color } : undefined}
        title="Custom color"
        aria-label="Custom color"
        popoverTarget={id}
      />
      <div id={id} className="color-picker" popover="auto">
        <div
          className="cp-area"
          style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h} 100% 50%)` }}
          tabIndex={0}
          aria-label="Saturation and brightness"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            pick(e)
          }}
          onPointerMove={(e) => e.buttons && pick(e)}
          onKeyDown={nudge}
        >
          <span className="cp-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }} />
        </div>
        <input type="range" className="cp-hue" aria-label="Hue" min={0} max={359} value={Math.round(hsv.h)} onChange={(e) => set({ ...hsv, h: Number(e.target.value) })} />
        <div className="cp-row">
          <span className="cp-preview" style={{ background: hsvToHex(hsv) }} />
          <input
            className="text-input cp-hex"
            aria-label="Hex color"
            spellCheck={false}
            value={text}
            onChange={(e) => {
              const t = e.target.value.trim()
              const hex = (t.startsWith('#') ? t : `#${t}`).toLowerCase()
              setText(t)
              if (HEX.test(hex)) onChange(hex)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              e.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()
            }}
          />
        </div>
      </div>
    </span>
  )
}
