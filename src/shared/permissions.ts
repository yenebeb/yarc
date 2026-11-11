// What a site permission prompt says ("Allow meet.google.com to access your camera?"), and how
// Settings lists a profile's answers.

export type PromptIcon = 'bell' | 'camera' | 'mic' | 'location' | 'clipboard' | 'screen' | 'device'

/** What the prompt view draws. */
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

/** A site's answer, as Settings lists it. `quiet` = refused for a while after several Not Nows, until `until`. */
export interface SitePermissionRow {
  origin: string
  /** 'notifications', 'geolocation', 'media:video' (camera), 'media:audio' (microphone), … */
  key: string
  setting: 'allow' | 'block' | 'quiet'
  until?: number
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

/** What Settings calls a stored permission key. */
export function permissionLabel(key: string): string {
  const labels: Record<string, string> = {
    notifications: 'Notifications',
    'media:video': 'Camera',
    'media:audio': 'Microphone',
    geolocation: 'Location',
    'clipboard-read': 'Clipboard',
    'display-capture': 'Screen sharing',
    midi: 'MIDI devices',
    midiSysex: 'MIDI device control',
    'idle-detection': 'Idle detection',
    hid: 'HID devices',
    serial: 'Serial ports',
    usb: 'USB devices'
  }
  return labels[key] ?? key
}

export function promptText(permission: string, mediaTypes?: ('video' | 'audio')[]): { icon: PromptIcon; wants: string } {
  switch (permission) {
    case 'notifications':
      return { icon: 'bell', wants: 'send you notifications' }
    case 'media': {
      const camera = !mediaTypes?.length || mediaTypes.includes('video')
      const mic = !mediaTypes?.length || mediaTypes.includes('audio')
      if (camera && mic) return { icon: 'camera', wants: 'access your camera, microphone' }
      return camera ? { icon: 'camera', wants: 'access your camera' } : { icon: 'mic', wants: 'access your microphone' }
    }
    case 'geolocation':
      return { icon: 'location', wants: 'access your location' }
    case 'clipboard-read':
      return { icon: 'clipboard', wants: 'see text and images copied to the clipboard' }
    case 'display-capture':
      return { icon: 'screen', wants: 'share your screen' }
    case 'midi':
      return { icon: 'device', wants: 'use your MIDI devices' }
    case 'midiSysex':
      return { icon: 'device', wants: 'control and reprogram your MIDI devices' }
    case 'idle-detection':
      return { icon: 'device', wants: 'know when you’re actively using this device' }
    case 'hid':
      return { icon: 'device', wants: 'connect to HID devices' }
    case 'serial':
      return { icon: 'device', wants: 'connect to serial ports' }
    case 'usb':
      return { icon: 'device', wants: 'connect to USB devices' }
    default:
      return { icon: 'device', wants: `use ${permission}` }
  }
}
