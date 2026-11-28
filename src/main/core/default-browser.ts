import { app, shell } from 'electron'

/** False where the user has to pick YARC themselves: Windows doesn't let apps claim the default. */
export function becomeDefaultBrowser(): boolean {
  if (process.platform === 'win32') {
    void shell.openExternal('ms-settings:defaultapps?registeredAppUser=YARC')
    return false
  }
  app.setAsDefaultProtocolClient('http')
  app.setAsDefaultProtocolClient('https')
  return true
}
