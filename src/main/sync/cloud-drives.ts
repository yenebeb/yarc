import type { CloudDrive } from '../../shared/sync.ts'
import { DropboxStore } from './dropbox.ts'
import { GoogleDriveStore } from './google-drive.ts'
import { OAuthSession, type OAuthApp } from './oauth.ts'
import { OneDriveStore } from './onedrive.ts'
import type { RemoteStore } from './remote.ts'

/** Public by design: every installed copy carries them (docs/history-sync.md). A drive whose ID is empty isn't offered. */
const GOOGLE_CLIENT_ID = ''
/** Google calls it a secret but says an installed app's isn't one (it ships inside the app); its token endpoint still asks for it. */
const GOOGLE_CLIENT_SECRET = ''
const MICROSOFT_CLIENT_ID = ''
const DROPBOX_APP_KEY = ''

const APPS: Record<CloudDrive, OAuthApp> = {
  'google-drive': {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    scope: 'openid email https://www.googleapis.com/auth/drive.appdata',
    // A refresh token comes only with offline access, and again on a later sign-in only after consent.
    extra: { access_type: 'offline', prompt: 'consent' }
  },
  onedrive: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    clientId: MICROSOFT_CLIENT_ID,
    scope: 'openid email offline_access Files.ReadWrite.AppFolder',
    extra: { prompt: 'select_account' }
  },
  dropbox: {
    authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    clientId: DROPBOX_APP_KEY,
    scope: 'account_info.read files.metadata.read files.content.read files.content.write',
    extra: { token_access_type: 'offline' }
  }
}

export function availableDrives(): CloudDrive[] {
  return (Object.keys(APPS) as CloudDrive[]).filter((drive) => APPS[drive].clientId)
}

export function driveApp(drive: CloudDrive): OAuthApp {
  return APPS[drive]
}

export function driveStore(drive: CloudDrive, session: OAuthSession): RemoteStore & { email?(): Promise<string | undefined> } {
  if (drive === 'google-drive') return new GoogleDriveStore(session)
  if (drive === 'onedrive') return new OneDriveStore(session)
  return new DropboxStore(session)
}
