// 24x24 grid, stroke = currentColor.
import { useState, type ReactNode } from 'react'
import { displayHost, faviconFor } from './api'

const paths: Record<string, ReactNode> = {
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
    </>
  ),
  back: <path d="M19 12H5M11 18l-6-6 6-6" />,
  forward: <path d="M5 12h14M13 6l6 6-6 6" />,
  reload: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  liveFolder: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M6.5 13.5h2.5l1.5-3 2 5 1.5-2h3.5" />
    </>
  ),
  canvas: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <rect x="6.5" y="7.5" width="6" height="5" rx="1" />
      <path d="M14.5 15.5c1-1.5 2-1.5 3 0M7 16.5h5" />
    </>
  ),
  capture: <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />,
  pointer: <path d="M6 4l12 7-5.5 1.5L10 18z" />,
  hand: <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5a1.5 1.5 0 0 1 3 0V11m0-4a1.5 1.5 0 0 1 3 0V15a5 5 0 0 1-5 5h-1.5a5 5 0 0 1-3.9-1.9L4.8 15a1.5 1.5 0 0 1 2.3-1.9L8 14" />,
  text: <path d="M5 7V5h14v2M12 5v14M9 19h6" />,
  rectangle: <rect x="4" y="6" width="16" height="12" rx="2" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />,
  arrow: <path d="M5 19L19 5M10 5h9v9" />,
  pen: <path d="M4 20c2-1 3-4 5-4s1.5 3 4 3 3-6 7-9M15 5l4 4" />,
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M20.5 15.5l-5-4.5-8 8" />
    </>
  ),
  more: <path d="M5.5 12h.01M12 12h.01M18.5 12h.01" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  speaker: (
    <>
      <path d="M11 5L6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </>
  ),
  muted: (
    <>
      <path d="M11 5L6 9H3v6h3l5 4z" />
      <path d="M22 9l-6 6M16 9l6 6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  download: <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14" />,
  archive: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1.5" />
      <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
    </>
  ),
  split: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M12 4v16" />
    </>
  ),
  reset: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  command: <path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />,
  up: <path d="M6 15l6-6 6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a1 1 0 0 1 1-1h10" />
    </>
  ),
  expand: <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  puzzle: <path d="M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v4h-4v-2a2 2 0 1 0-4 0v2H6v-4h2a2 2 0 1 0 0-4H6V6h4z" />,
  pin: <path d="M12 17v5M8 3h8l-1 6 3 4H6l3-4z" />,
  shield: <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z" />,
  profile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5v1M14.5 9.5v1M8.5 14a4.5 4.5 0 0 0 7 0" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3l1.5-2h5.4l1.5 2h2.3A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  location: <path d="M20 4L4 11l7 2 2 7z" />,
  clipboard: (
    <>
      <rect x="5" y="5" width="14" height="16" rx="2" />
      <path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M9 11h6M9 15h4" />
    </>
  ),
  screen: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  device: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 17.5h2" />
    </>
  )
,
  play: <path d="M8 5.5v13a.6.6 0 0 0 .9.5l10.4-6.5a.6.6 0 0 0 0-1L8.9 5a.6.6 0 0 0-.9.5z" fill="currentColor" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" />
    </>
  ),
  minus: <path d="M6 12h12" />,
  skipBack: (
    <>
      <path d="M4.5 13a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M6 3.5v4.5h4.5" />
    </>
  ),
  skipAhead: (
    <>
      <path d="M19.5 13a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M18 3.5v4.5h-4.5" />
    </>
  ),
  pip: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <rect x="11.5" y="11.5" width="6.5" height="4.5" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  toTab: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M15 9l-6 6M9 10v5h5" />
    </>
  )
}

export type IconName = keyof typeof paths

export function Icon({ name, size = 16, stroke = 1.8 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

export function Favicon({ url, favicon, className = 'fav-img' }: { url: string; favicon?: string; className?: string }) {
  const src = faviconFor(favicon)
  const [failed, setFailed] = useState<string>()
  if (src && failed !== src) {
    return <img className={className} src={src} alt="" draggable={false} onError={() => setFailed(src)} />
  }
  const letter = (displayHost(url).replace(/^[^a-z0-9]+/i, '')[0] ?? '•').toUpperCase()
  return (
    <span className={className === 'fav-img' ? 'letter' : `${className} letter`} aria-hidden="true">
      {letter}
    </span>
  )
}
