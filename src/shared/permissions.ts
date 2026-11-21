export type PromptIcon = 'bell' | 'camera' | 'mic' | 'location' | 'clipboard' | 'screen' | 'device'

export interface PermissionPrompt {
  id: string
  origin: string
  permission: string
  mediaTypes?: ('video' | 'audio')[]
  /** Where the arrow points, in px from the view's left edge; absent = a free-floating prompt without one. */
  arrowX?: number
}

/** Messages from the prompt view: it's ready, how tall it rendered, or the user's answer. */
export type PromptOp =
  | { kind: 'sync' }
  | { kind: 'size'; id: string; height: number }
  | { kind: 'answer'; id: string; answer: 'allow' | 'deny' | 'dismiss' }

/** `quiet` = refused for a while after several Not Nows, until `until`. */
export interface SitePermissionRow {
  origin: string
  /** A key of PERMISSIONS. */
  key: string
  setting: 'allow' | 'block' | 'quiet'
  until?: number
}

interface PromptText {
  icon: PromptIcon
  wants: string
}

const PERMISSIONS: Record<string, PromptText & { label: string }> = {
  notifications: { label: 'Notifications', icon: 'bell', wants: 'send you notifications' },
  'media:video': { label: 'Camera', icon: 'camera', wants: 'access your camera' },
  'media:audio': { label: 'Microphone', icon: 'mic', wants: 'access your microphone' },
  geolocation: { label: 'Location', icon: 'location', wants: 'access your location' },
  'clipboard-read': { label: 'Clipboard', icon: 'clipboard', wants: 'see text and images copied to the clipboard' },
  'display-capture': { label: 'Screen sharing', icon: 'screen', wants: 'share your screen' },
  midi: { label: 'MIDI devices', icon: 'device', wants: 'use your MIDI devices' },
  midiSysex: { label: 'MIDI device control', icon: 'device', wants: 'control and reprogram your MIDI devices' },
  'idle-detection': { label: 'Idle detection', icon: 'device', wants: 'know when you’re actively using this device' },
  hid: { label: 'HID devices', icon: 'device', wants: 'connect to HID devices' },
  serial: { label: 'Serial ports', icon: 'device', wants: 'connect to serial ports' },
  usb: { label: 'USB devices', icon: 'device', wants: 'connect to USB devices' },
  'window-management': { label: 'Window management', icon: 'screen', wants: 'manage windows on all your displays' }
}

export const PERMISSION_KEYS = Object.keys(PERMISSIONS)

/** A page's or extension's origin; anything else (file:, data:, sandboxed frames) gets '' and is refused. */
export function permissionOrigin(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin
    if (u.protocol === 'chrome-extension:' && u.host) return `chrome-extension://${u.host}`
  } catch {}
  return ''
}

/** The site as people know it: "meet.google.com", "localhost:8765"; other origins as they are. */
export function siteName(origin: string): string {
  try {
    const u = new URL(origin)
    return /^https?:$/.test(u.protocol) && u.host ? u.host : origin
  } catch {
    return origin
  }
}

export function permissionLabel(key: string): string {
  return PERMISSIONS[key]?.label ?? key
}

export function promptText(permission: string, mediaTypes?: ('video' | 'audio')[]): PromptText {
  if (permission === 'media') {
    const camera = !mediaTypes?.length || mediaTypes.includes('video')
    const mic = !mediaTypes?.length || mediaTypes.includes('audio')
    if (camera && mic) return { icon: 'camera', wants: 'access your camera, microphone' }
    return promptText(camera ? 'media:video' : 'media:audio')
  }
  const { icon, wants } = PERMISSIONS[permission] ?? { icon: 'device', wants: `use ${permission}` }
  return { icon, wants }
}
