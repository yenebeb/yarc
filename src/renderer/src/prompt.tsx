// The site permission prompt, like Arc's: "Allow meet.google.com to access your camera?"
// with Not Now / Allow, in a popover pointing at the URL field. The main process sizes and places
// this view (prompt-view.ts); the page only draws the popover and reports how tall it came out.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { promptText, siteName, type PermissionPrompt } from '../../shared/permissions'
import { arc } from './api'
import { Icon } from './icons'
import './styles.css'
import './prompt.css'

/** Room around the popover for its shadow and arrow; matches MARGIN in prompt-view.ts. */
const MARGIN = 16

function App() {
  const [prompt, setPrompt] = useState<PermissionPrompt | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const off = arc.onPrompt(setPrompt)
    void arc.prompt({ kind: 'sync' })
    return off
  }, [])

  useLayoutEffect(() => {
    if (!prompt || !box.current) return
    void arc.prompt({ kind: 'size', id: prompt.id, height: box.current.offsetHeight + 2 * MARGIN })
    box.current.focus()
  }, [prompt?.id, prompt?.arrowX])

  useEffect(() => {
    if (!prompt) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      // Escape is Not Now, so a site that asks on every page load doesn't come straight back.
      void arc.prompt({ kind: 'answer', id: prompt.id, answer: 'deny' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [prompt?.id])

  if (!prompt) return null
  const { icon, wants } = promptText(prompt.permission, prompt.mediaTypes)
  const answer = (a: 'allow' | 'deny') => void arc.prompt({ kind: 'answer', id: prompt.id, answer: a })
  const site = siteName(prompt.origin)
  const arrow = prompt.arrowX !== undefined

  return (
    <div
      key={prompt.id}
      ref={box}
      className="perm"
      role="alertdialog"
      aria-label={`Allow ${site} to ${wants}?`}
      tabIndex={-1}
      style={{ transformOrigin: arrow ? `${prompt.arrowX! - MARGIN}px 0` : '0 0' }}
    >
      {arrow ? (
        <svg className="perm-arrow" width="24" height="11" viewBox="0 0 24 11" style={{ left: prompt.arrowX! - MARGIN - 12 }} aria-hidden="true">
          <path className="fill" d="M0 11.5C5 11.5 8 10 10 7L11 5.5Q12 4 13 5.5L14 7C16 10 19 11.5 24 11.5Z" />
          <path className="edge" d="M0 10.75C5 10.75 8 9.5 10 6.5L11 5Q12 3.4 13 5L14 6.5C16 9.5 19 10.75 24 10.75" />
        </svg>
      ) : null}
      <div className="perm-body">
        <span className="perm-icon">
          <Icon name={icon} size={19} stroke={1.8} />
        </span>
        <p className="perm-text">
          Allow {site} to {wants}?
        </p>
      </div>
      <div className="perm-buttons">
        <button onClick={() => answer('deny')}>Not Now</button>
        <button className="primary" onClick={() => answer('allow')}>
          Allow
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
