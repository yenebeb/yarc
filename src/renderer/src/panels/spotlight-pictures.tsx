// The pictures on feature spotlight cards (src/shared/spotlights.ts), keyed by spotlight id: small
// CSS/SVG animations, no image files. Draw them with the panel's colors (var(--space), --panel,
// --text, --accent, --line) so they suit light and dark spaces, and build on MiniWindow so every
// picture shows YARC the same way. Animations stop for users who ask for reduced motion (panels.css).
import type { ReactNode } from 'react'
import logo from '../../../../build/icon.svg'

/**
 * A small YARC window: the sidebar with a few tab rows (`active` is highlighted), and the page,
 * where a picture draws what the feature does (`children`, positioned inside the page).
 */
export function MiniWindow({ tabs = 4, active = 0, children }: { tabs?: number; active?: number; children?: ReactNode }) {
  return (
    <div className="mini-window">
      <div className="mini-sidebar">
        {Array.from({ length: tabs }, (_, i) => (
          <i key={i} className={i === active ? 'on' : undefined} />
        ))}
      </div>
      <div className="mini-page">{children}</div>
    </div>
  )
}

const PICTURES: Record<string, () => ReactNode> = {}

export function SpotlightPicture({ id }: { id: string }) {
  const draw = PICTURES[id]
  return (
    <div className="spotlight-picture" aria-hidden="true">
      {draw ? draw() : <img className="logo" src={logo} alt="" />}
    </div>
  )
}
