# Electron implementation notes (verified 2026-11-01)

Target stack: **Electron 45.2.1** (Chromium 156.0.8078.75, Node 24.22.1, V8 15.6), TypeScript,
one `WebContentsView` per tab inside a `BaseWindow`/`BrowserWindow`, one persistent session per
profile (`persist:profile-<id>`).

How this was verified: the npm tarballs of `electron-chrome-extensions@4.10.0`,
`electron-chrome-web-store@0.13.0` and `app-builder-lib@26.18.0` were downloaded and their
`dist/` source, typings and READMEs read directly. The official `electron-v45.2.1-win32-x64.zip`
was run with probe scripts. Items marked **[tested]** were run on Electron 45.2.1 / Windows 11.
Items marked **[reported]** come from third-party reports that were not reproduced here.

---

## 1. electron-chrome-extensions@4.10.0

### License: MIT now. Do not pass a `license` option.

Your memory of the license was correct for **4.0.0 through 4.9.0**, but **4.10.0 removed it**.

| Version | License | `license` option |
|---|---|---|
| 3.6.1 (2021) to 3.10.1 | `SEE LICENSE IN LICENSE.md`: dual **GPL-3.0** / **Patron License** (paid GitHub sponsorship) | none (license terms only) |
| 4.0.0 (2024-10-22) to 4.9.0 (2025-07-02) | Same dual GPL-3.0 / Patron License | **Required.** Valid values: `'GPL-3.0'` or `'Patron-License-2020-11-19'` |
| **4.10.0 (2026-10-25)** | **MIT** | **Removed** |

- Commit `62d7a6a8` "chore: switch to MIT license" (2026-10-25) replaced `LICENSE-GPL` and
  `LICENSE-PATRON.md` with MIT. It also removed the `license` bullet from the README, the CLA and
  the `noncompliant.txt` hash list. 4.10.0 (`3817c423`) was published one minute later.
- In the 4.10.0 tarball, `package.json` has `"license": "MIT"` and `LICENSE.md` is MIT. Searching
  `dist/` for "license" finds nothing, so there is no runtime check.
- `ChromeExtensionOptions` no longer declares `license`. Passing `license: 'GPL-3.0'` in an object
  literal is a **TypeScript excess-property error**. At runtime the value is ignored.
- **For a GPL-3 (or any) project: pin `electron-chrome-extensions@^4.10.0` and pass nothing.** If you
  ever pin 4.0 to 4.9, you must pass `license: 'GPL-3.0'`, and your app must then be GPL-3.
- The `CHANGELOG.md` inside the package stops at 4.0.0, so it is not maintained. Use the git log.

Sources: https://github.com/samuelmaddock/electron-browser-shell/commit/62d7a6a8 ·
https://www.npmjs.com/package/electron-chrome-extensions

### Constructor options (from `dist/types/browser/{index,impl}.d.ts`)

```ts
interface ChromeExtensionOptions {
  session?: Electron.Session                 // default: session.defaultSession
  modulePath?: string                        // @deprecated (preload resolution)
  createTab?(details: chrome.tabs.CreateProperties): Promise<[Electron.WebContents, Electron.BaseWindow]>
  selectTab?(tab: Electron.WebContents, window: Electron.BaseWindow): void
  removeTab?(tab: Electron.WebContents, window: Electron.BaseWindow): void
  assignTabDetails?(details: chrome.tabs.Tab, tab: Electron.WebContents): void  // discarded/frozen/groupId etc.
  createWindow?(details: chrome.windows.CreateData): Promise<Electron.BaseWindow>
  removeWindow?(window: Electron.BaseWindow): void
  requestPermissions?(extension: Electron.Extension, permissions: chrome.permissions.Permissions): Promise<boolean>
}
```

The typings use **`BaseWindow`**, while the README still says `BrowserWindow`. A `BaseWindow` with
`WebContentsView` children is supported. `getAllWindows()` in the source merges
`BaseWindow.getAllWindows()` and `BrowserWindow.getAllWindows()`.

Instance API: `addTab(wc, window)`, `removeTab(wc)`, `selectTab(wc)`,
`getContextMenuItems(wc, params)`, `getURLOverrides()`.
Static API: `ElectronChromeExtensions.fromSession(ses)` and
`ElectronChromeExtensions.handleCRXProtocol(ses)`. The instance method `handleCRXProtocol` now throws.
Named export: `setSessionPartitionResolver((partition) => Session)`.
Events: `'browser-action-popup-created'` (PopupView) and `'url-overrides-updated'` (e.g. `{ newtab }`).
For `chrome.tabs.onUpdated` of custom props, emit `'tab-updated'` on the tab's `webContents`.

### Multiple sessions and WebContentsView **[tested]**

- **Multiple sessions work.** Create one instance per session. A module-level `WeakMap` keys the
  instances by session. A second instance for the same session throws
  `Extensions instance already exists for the given session`.
- `addTab`, `removeTab`, `selectTab` and `getContextMenuItems` throw `TypeError('Invalid WebContents
  argument. Its session must match …')` when the tab belongs to another profile. Route each tab to
  its profile's instance.
- On Electron 45.2.1, two `persist:profile-*` sessions each got an instance plus `installChromeWebStore`.
  A `BaseWindow` hosted one `WebContentsView` per profile, and `addTab` and `selectTab` succeeded
  for both.
- The library calls `session.registerPreloadScript` with ids `crx-mv2-preload` (frame) and
  `crx-mv3-preload` (service-worker). The web store adds `electron-chrome-web-store`.
- **Sandbox must stay on** (the default for `WebContentsView`). Service-worker preloads do not run
  with `sandbox: false` or `--no-sandbox`.
- Extensions only load in **persistent** sessions. Incognito-style `fromPartition('temp')` sessions
  get no extensions.
- **Electron 45 sandboxed-preload breaking change.** `require('events'|'timers'|'url')`, `Buffer` and
  `setImmediate` were removed from sandboxed preloads. Checked: the library's preload bundles only
  `require("electron")`, so they are compatible. Your own preloads must be bundled with
  esbuild/Vite and must not rely on those shims.

### Recommended per-profile setup

```ts
// main/profiles.ts
import { app, session, BaseWindow, WebContentsView, Session } from 'electron'
import path from 'node:path'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import { installChromeWebStore, updateExtensions } from 'electron-chrome-web-store'

export interface Profile { id: string; ses: Session; ext: ElectronChromeExtensions }
const profiles = new Map<string, Profile>()

export async function openProfile(id: string, ui: TabHost): Promise<Profile> {
  const existing = profiles.get(id); if (existing) return existing
  const ses = session.fromPartition(`persist:profile-${id}`)
  configureUserAgent(ses)                     // section 3, BEFORE any tab exists in this session

  const ext = new ElectronChromeExtensions({
    session: ses,
    async createTab(details) {
      const tab = ui.createTab(id, { url: details.url, active: details.active ?? true, windowId: details.windowId })
      return [tab.view.webContents, tab.window]           // [WebContents, BaseWindow]
    },
    selectTab: (wc) => ui.activateByWebContents(wc),
    removeTab: (wc) => ui.closeByWebContents(wc),
    async createWindow(details) { return ui.createWindow(id, details).window },
    removeWindow: (win) => win.close(),
    assignTabDetails(details, wc) { details.pinned = ui.isPinned(wc) },
  })
  ext.on('url-overrides-updated', (o) => ui.setNewTabUrl(id, o.newtab))

  await installChromeWebStore({
    session: ses,
    extensionsPath: path.join(app.getPath('userData'), 'Profiles', id, 'Extensions'), // MUST be per profile
    autoUpdate: false,                       // see "auto-update gotcha" in section 2
    beforeInstall: async (d) => ({ action: (await ui.confirmInstall(d)) ? 'allow' : 'deny' }),
  })

  const p = { id, ses, ext }; profiles.set(id, p); return p
}

// When a tab is created or activated:
//   p.ext.addTab(view.webContents, baseWindow); p.ext.selectTab(view.webContents)
// On close: p.ext.removeTab(view.webContents) before view.webContents.close()
// Context menu: view.webContents.on('context-menu', (_e, params) => p.ext.getContextMenuItems(view.webContents, params))
```

### `<browser-action-list>` (toolbar extension icons)

The UI (the sidebar/toolbar renderer that is not a tab) needs three things:

1. **A preload** that injects the custom element. It must be bundled, since the import is ESM:

   ```ts
   // preload/ui.ts (bundled with esbuild, sandboxed)
   import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'
   // Only inject on your own UI page:
   if (location.protocol === 'app:' || location.href.startsWith('file:')) injectBrowserAction()
   ```

   `injectBrowserAction()` defines `<browser-action-list>` and `<browser-action>` in the main world,
   via `contextBridge.executeInMainWorld` when context isolation is on. It also exposes
   `window.browserAction`.

2. **The `crx://` protocol on the UI's session**, for icons:
   `ElectronChromeExtensions.handleCRXProtocol(uiSession)`. Call it once per session that displays
   the element. It is not needed for the profile sessions unless the UI lives in them.

3. **The markup.** Point it at the active profile and tab:

   ```html
   <browser-action-list partition="persist:profile-work" tab="42" alignment="bottom left"></browser-action-list>
   ```

   - `partition` is resolved with `session.fromPartition(partition)` in the main process, over the IPC
     channel `crx-msg-remote` and in the `crx://` handler. Override this with
     `setSessionPartitionResolver(id => …)` if you prefer `partition="work"`.
   - `tab` is `webContents.id` of the active tab. Default: the active tab of the current window.
   - `partition`, `tab` and `alignment` are **observed attributes**. Changing them on profile or tab
     switch re-fetches state, so there is no need to re-create the element.
   - Style it with `::part(action)` and `::part(badge)`.

### Packaging the preloads

They are resolved with `createRequire(__dirname).resolve('electron-chrome-extensions/preload')` and
`'electron-chrome-web-store/preload'`. Ship `node_modules` in the asar, which electron-builder does
by default for `dependencies`. If you bundle the main process, either mark both packages
`external` or copy `dist/chrome-extension-api.preload.js` and `dist/chrome-web-store.preload.js`
next to the bundle. A missing preload logs `Preload file not found at …`.

### Limitations that matter for a daily-driver browser

- **There is no `chrome.declarativeNetRequest` in Electron 45.** It is absent from Electron's supported
  extension API list. MV3 blockers such as **uBlock Origin Lite** will install but not block. The
  web store also refuses MV2 by default (`minimumManifestVersion: 3`). Plan on a main-process
  blocker instead, such as `@ghostery/adblocker-electron` (not evaluated here). Note that any
  **Electron `session.webRequest` listener takes precedence over `chrome.webRequest`** for that
  event, and Electron keeps only **one listener per event per session**.
- No `chrome.commands`, `tabs.move/duplicate/discard/captureVisibleTab`, `action.enable/disable`,
  or `contextMenus.update`. `storage.sync` falls back to local. All background pages are persistent.
- The library warns below Electron 35 (`checkVersion`).

Sources: package tarball `dist/` and README · Electron extension docs at the v45.2.1 tag:
https://github.com/electron/electron/blob/v45.2.1/docs/api/extensions.md ·
reference shell: https://github.com/samuelmaddock/electron-browser-shell/tree/master/packages/shell/browser

---

## 2. electron-chrome-web-store@0.13.0

Published 2025-07-02 and still the latest. MIT, with no `license` option.
Dependencies: `adm-zip`, `pbf`, `debug`.

### `installChromeWebStore(opts)`

```ts
interface ElectronChromeWebStoreOptions {
  session?: Electron.Session          // default: defaultSession
  extensionsPath?: string             // default: path.join(app.getPath('userData'), 'Extensions')  <-- SHARED by default!
  loadExtensions?: boolean            // default true: loadAllExtensions(session, extensionsPath) on startup
  allowUnpackedExtensions?: boolean   // default false
  allowlist?: string[]; denylist?: string[]
  autoUpdate?: boolean                // default true
  minimumManifestVersion?: number     // default 3
  beforeInstall?: (d: { id; localizedName; manifest; icon: NativeImage; browserWindow?: BrowserWindow; frame: WebFrameMain })
                  => Promise<{ action: 'allow' | 'deny' }>
  modulePath?: string                 // @deprecated
}
```

Other exports: `installExtension(id, { session, extensionsPath, loadExtensionOptions })`,
`uninstallExtension(id, { session, extensionsPath })`, `updateExtensions(session)`,
`loadAllExtensions(session, extensionsPath, { allowUnpacked })` and
`downloadExtension(id, dir)`.

- **Storage layout.** Extensions are stored at `<extensionsPath>/<extensionId>/<version>_0/`. Updates
  write next to the old version, then delete the old directory. The updater derives the root from
  `path.join(ext.path, '..', '..')`. **Always pass a per-profile `extensionsPath`.** Otherwise every
  profile loads every profile's extensions.
- **Loading previously installed extensions.** `installChromeWebStore` does this when
  `loadExtensions` is left at `true`. It skips IDs already loaded, keeps the newest version, and
  starts MV3 service workers with `session.serviceWorkers.startWorkerForScope('chrome-extension://<id>')`.
  For a profile where you only want the extensions and not the store, call
  `loadAllExtensions(ses, dir)`.
- **Multi-session IPC.** `ipcMain.handle` is registered once per channel. Each call dispatches on
  `event.sender.session` and checks that the sender origin starts with
  `https://chromewebstore.google.com`, so several sessions coexist **[tested with 2]**.
- **Auto-update gotcha with multiple profiles.** `lastUpdateCheck` is a module-global.
  `maybeCheckForUpdates` skips any check within 3 h of the last one, for **any** session. Each
  `installChromeWebStore({ autoUpdate: true })` also adds its own `app.on('browser-window-focus' |
  'did-become-active')` listener and a 5 h `setInterval`. The result is that only the first profile
  to fire gets updated. It also skips checks while the system has been idle for an hour or more.
  **Recommendation:** `autoUpdate: false`, plus your own scheduler that runs
  `for (const p of profiles) await updateExtensions(p.ses)` at startup and every ~5 h. Updates use
  only `https://clients2.google.com/service/update2/crx` and require `manifest.key` and
  `update_url`.
- **Web store page UA.** The store's preload overrides `navigator.userAgent` on
  chromewebstore.google.com with a fake macOS Chrome UA. Whatever UA your session uses, the page
  shows **"Add to &lt;AppName&gt;"** (it uses your `app.name`). Google's "Switch to Chrome?" banner
  appears but is harmless **[tested on 45.2.1 with both native and cleaned session UA]**.
- **Electron 45 compatibility.** The source uses `session.extensions ?? session`, so it calls the new
  `session.extensions.loadExtension` / `getAllExtensions` / `removeExtension` (since 4.9.0 / 0.13.0,
  in "refactor: avoid deprecated extension APIs"). Both still exist on 45.2.1 **[tested]**. Calling
  the old `session.loadExtension` / `session.removeExtension` prints
  `(electron) 'session.loadExtension' is deprecated and will be removed. Please use
  'session.extensions.loadExtension' instead.` Use `ses.extensions.*` in your own code.
- `getBrowserLogin` returns `''` and `isInIncognitoMode` returns false, so there is no store sign-in
  integration.

Source: tarball `dist/cjs/browser/index.js` and `dist/types/browser/index.d.ts` ·
https://www.npmjs.com/package/electron-chrome-web-store

---

## 3. Google sign-in (accounts.google.com) in 2026

### What Electron 45 actually sends **[tested]**

- Default UA (`app.userAgentFallback` and `session.getUserAgent()`):
  `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) <AppName>/<ver> Chrome/156.0.8078.75 Electron/45.2.1 Safari/537.36`
- **No `Sec-CH-UA*` request headers at all**, over HTTPS to httpbin.org and postman-echo.com, and
  even after a page returns `Accept-CH`. Stock Chrome sends `sec-ch-ua`, `sec-ch-ua-mobile` and
  `sec-ch-ua-platform` on every HTTPS request.
- `navigator.userAgentData.brands` = `[{Not:A-Brand, 8}, {Chromium, 156}]`. There is no
  `"Google Chrome"` brand. `fullVersionList` = `Chromium 156.0.8078.75`, `platformVersion` `19.0.0`,
  and `navigator.webdriver === false`.
- **Gotcha:** `session.setUserAgent()` only affects **webContents created afterwards**. An existing
  tab kept the old UA in both the header and `navigator.userAgent`. Set the session UA before
  creating views, or call `webContents.setUserAgent()` on live tabs.

So a "cleaned" Chrome-shaped UA with no client-hint headers and no Chrome brand is an
**inconsistent fingerprint**, which explains the 2026 reports below.

### What currently works **[reported, Jul–Oct 2026, Electron 43/44]**

The old advice ("strip `Electron/` and the app name") **is now what gets rejected**
(`/v3/signin/rejected`, "This browser or app may not be secure").

- stablyai/orca #11518 (Electron 43.1, Chrome 150): a Chrome-shaped UA was rejected 12/12, and a UA
  with **any extra product token** was rejected 0/12. Forged `sec-ch-ua`, a CDP debugger attached
  and anti-detection scripts made no difference. An untouched UA passed, including a 92-minute
  session. Resolved with a per-profile "keep Electron UA" option.
- stablyai/orca PR #36519 (merged 2026-10-31): untouched Electron UA on `accounts.google.com` and
  `accounts.youtube.com`, keeping Chromium's own client hints, passed 4/4 and 6/6. A cleaned
  Chrome UA was rejected 2/2. **A spoofed Google Chrome UA with full client hints was rejected 2/2.**
  A Firefox UA (header-only) was rejected. A Firefox UA via CDP passed but was rejected as an
  approach.
- Rakosn1cek/Mise-browser PR #19 (merged 2026-10-12, Electron 44): with Electron's own UA, minus the
  app name, Google serves a lighter "embedded" flow and sign-in completes. The global UA override
  was the cause of the rejection.
- Counter-report: QuillDev/nako-portal PR #93 (2026-10-26) got through with a Firefox UA on
  `accounts.google.com` only. This is a minority approach and identity-inconsistent. Not
  recommended.
- Orca #34730 (2026-10-28) shows that a Chrome-shaped default UA gives **intermittent** rejections.
  Treat any spoof as fragile.

### Recommended code (Electron 45)

Keep the `Electron/x` token. Optionally drop only the app-name token. Never forge client hints or a
"Google Chrome" brand. Do not attach a debugger to auth tabs.

```ts
// main/user-agent.ts
import { app, type Session, type WebContents } from 'electron'

/** Electron UA without the "<AppName>/<ver>" token; keeps "Electron/45.x" (needed by Google sign-in in 2026). */
export const browserUA = (ua = app.userAgentFallback) =>
  ua.replace(/\(KHTML, like Gecko\) .*?Chrome\//, '(KHTML, like Gecko) Chrome/')
// → "... (KHTML, like Gecko) Chrome/156.0.8078.75 Electron/45.2.1 Safari/537.36"

/** Fully Chrome-shaped UA: ONLY for an opt-in per-site compat list; never for Google auth hosts. */
export const chromeShapedUA = (ua = app.userAgentFallback) =>
  browserUA(ua).replace(/ Electron\/\S+/, '')

export function configureUserAgent(ses: Session) {
  // Set before the first WebContentsView is created in this session (existing webContents keep their UA).
  ses.setUserAgent(browserUA(), app.getPreferredSystemLanguages().join(','))
}

// Must run before any session is touched:
app.userAgentFallback = browserUA()

const GOOGLE_AUTH = /^(accounts\.google\.[a-z.]+|accounts\.youtube\.com)$/
/** Use if you add a Chrome-shaped compat mode: always fall back to the Electron UA on Google auth. */
export function uaFor(url: string): string {
  const host = new URL(url).hostname
  return GOOGLE_AUTH.test(host) ? browserUA() : (compatHosts.has(host) ? chromeShapedUA() : browserUA())
}
declare const compatHosts: Set<string>
// Apply per tab before navigating: wc.setUserAgent(uaFor(url)); wc.loadURL(url)
// (redirects keep the tab's UA, which is why the safe default is browserUA() everywhere)
```

Other requirements for "Sign in with Google" and OAuth popups:

- Allow `window.open` from sites to Google. Electron has no FedCM, so Google Identity Services
  falls back to a popup that talks back with `window.opener.postMessage`.
  `setWindowOpenHandler(() => ({ action: 'allow' }))` creates a real child window that keeps the
  opener and inherits the parent's `webPreferences`, including the session. Don't convert these
  popups into separate tabs with `action: 'deny'` plus `createTab`, because that breaks `opener`.
- Avoid using the `session.webRequest.onBeforeSendHeaders` route for UA or `sec-ch-ua` rewriting. It
  is one listener per session, it shadows `chrome.webRequest` for extensions, and adding client
  hints did not help in the reports.
- Never launch with `--remote-debugging-port`. A report (NousResearch/hermes-agent #137774) says it
  sets `navigator.webdriver`, which Google flags.

### Microsoft Teams needs the UA without `Electron/` **[tested 2026-11-06, Electron 45.2.1]**

Teams' server reads `Electron/` as its own desktop app, which is built on Electron. A meeting link
(`https://teams.microsoft.com/meet/<id>?p=<passcode>`) then redirects to
`/statics/evergreen-assets/tabs/meet/<id>`, a path only the desktop app serves. In a browser it is an
empty 404, a blank page. The same link with a Chrome or Edge UA redirects to
`/dl/launcher/launcher.html` ("Continue on this browser"). Only the `Electron/` token decides it:
adding `Edg/` or `Teams/` changes nothing (tested with curl).

The header alone is not enough. With a Chrome-shaped request header but `Electron/` still in
`navigator.userAgent`, the web app at `/v2/` never gets past its loading screen. With both
Chrome-shaped, "Continue on this browser" reaches the pre-join screen (name, camera, microphone).

So YARC gives the hosts in `CHROME_UA_HOSTS` (`src/main/useragent.ts`: teams.microsoft.com,
teams.live.com, teams.cloud.microsoft) the UA without `Electron/`, and everything else keeps
Electron's:

- `did-start-navigation` (main frame) calls `webContents.setUserAgent()` for the destination, in
  `src/main/index.ts`. The committed page's `navigator.userAgent` follows it, but the request that
  started the navigation was already sent with the old UA, and redirects keep it.
- So `session.webRequest.onBeforeSendHeaders`, filtered to those hosts, rewrites the header too
  (`src/main/profiles.ts`). This is the only `onBeforeSendHeaders` listener: none of the
  dependencies register one.

Leaving Teams switches back to Electron's UA for the next page. The first request off Teams still
carries the Chrome-shaped header, which only matters if that request goes straight to Google
sign-in.

### CDP `Emulation.setUserAgentOverride` (for completeness; not recommended)

Params (protocol JSON): `userAgent` (required), `acceptLanguage?`, `platform?`, `userAgentMetadata?`.
`UserAgentMetadata`: `brands?`, `fullVersionList?` (`{brand, version}[]`), `platform`,
`platformVersion`, `architecture`, `model`, `mobile` (required), plus `bitness?`, `wow64?` and
`formFactors?`.

```ts
const dbg = wc.debugger; dbg.attach('1.3')
const full = process.versions.chrome, major = full.split('.')[0]
await dbg.sendCommand('Emulation.setUserAgentOverride', {
  userAgent: wc.getUserAgent(),
  userAgentMetadata: {
    brands: [{ brand: 'Chromium', version: major }, { brand: 'Not:A-Brand', version: '8' }],
    fullVersionList: [{ brand: 'Chromium', version: full }, { brand: 'Not:A-Brand', version: '8.0.0.0' }],
    platform: 'Windows', platformVersion: '19.0.0', architecture: 'x86', bitness: '64', model: '', mobile: false,
  },
})
```

**[tested]** On 45.2.1 this changes `navigator.userAgentData.brands`, and `navigator.webdriver`
stays `false`. It still sends **no** `Sec-CH-UA` headers. It needs a debugger per tab
(`devtools-*` conflicts, and DevTools cannot attach at the same time). Orca measured that it is
not needed for Google.

Sources: https://github.com/stablyai/orca/issues/11518 · https://github.com/stablyai/orca/pull/36519 ·
https://github.com/stablyai/orca/issues/34730 · https://github.com/Rakosn1cek/Mise-browser/pull/19 ·
https://github.com/QuillDev/nako-portal/pull/93 · https://github.com/NousResearch/hermes-agent/issues/137774 ·
https://chromedevtools.github.io/devtools-protocol/tot/Emulation/#method-setUserAgentOverride

---

## 4. Chrome Sync: not available (blocker for "use my Google bookmarks and history")

- **There is no way for a third-party Chromium or Electron app to use Google Chrome Sync.**
  - Google's Chromium blog post "Limiting Private API availability in Chromium" (2021-01-15)
    announced that from **2021-03-15** private Google APIs, **Chrome Sync** and Click to Call among
    them, were restricted to Google Chrome. Existing synced data stayed in the Google account, but
    third-party builds could no longer sign in to sync.
  - The Chromium API-keys page (current) says that **signing in to Chromium is restricted**, because
    the OAuth token grants access to services such as Chrome sync. `chrome.identity.getAuthToken`
    also fails outside Google Chrome. Many Google APIs used by Chrome "are not intended for use in
    derived products".
  - Electron also doesn't compile Chrome's sync engine (`components/sync`) or the profile sign-in
    stack, so there is nothing to switch on even with keys.
- Every other Chromium browser (Edge, Brave, Vivaldi, Opera, Arc) runs **its own** sync service.
- **Practical alternatives:** a one-time or periodic **import from a local Chrome profile**.
  - `…/User Data/<Profile>/Bookmarks` is JSON.
  - `…/History` is SQLite and is locked while Chrome runs, so copy it first, then read it with
    `node:sqlite` (section 5).
  - Paths: Windows `%LOCALAPPDATA%\Google\Chrome\User Data`, macOS
    `~/Library/Application Support/Google/Chrome`.
  - Passwords are not practically importable (DPAPI / app-bound encryption on Windows, Keychain on
    macOS). Ask the user for a CSV export from `chrome://password-manager/settings`.
  - Cross-device sync means building your own: a small backend, or a file in the user's cloud drive.

Sources: https://blog.chromium.org/2021/01/limiting-private-api-availability-in.html ·
https://www.chromium.org/developers/how-tos/api-keys/ ·
https://www.bleepingcomputer.com/news/google/google-to-kill-chrome-sync-feature-in-third-party-browsers

---

## 5. Packaging (electron-builder 26.18.x), default browser, CI, `node:sqlite`

### `node:sqlite` in Electron 45: use it, no native modules needed **[tested]**

- Electron 45.0.0 to 45.2.1 bundles **Node 24.22.x**. 45.2.1 = Node 24.22.1 (releases.electronjs.org).
- `require('node:sqlite')` / `import { DatabaseSync } from 'node:sqlite'` works **unflagged** in the
  main process. The probe created a table, inserted, and selected; `sqlite_version()` = **3.53.4**.
  No `ExperimentalWarning` was emitted.
- Node docs at v24.22.1: unflagged since v22.13 / v23.4, and **"Stability: 1.2 – Release candidate"**
  since v24.15.0. The API is synchronous, so keep large queries off the hot path, or run them in a
  `utilityProcess` (which also has Node).
- It is not available in sandboxed renderers or preloads. Expose data over IPC.
- Use WAL for a browser DB. Run it once on open:
  `db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;')`.
- This lets you drop `better-sqlite3`, along with `electron-rebuild` / `@electron/rebuild`, `asarUnpack`
  for `.node` files, and per-arch rebuilds in CI.

### Other Electron 42–45 changes that affect packaging and CI

- **Electron 42+: the `electron` npm package no longer downloads its binary in `postinstall`.** It
  downloads on the first `npx electron` run. `ELECTRON_SKIP_BINARY_DOWNLOAD` is gone, and
  `npx install-electron --no` pre-fetches. electron-builder downloads its own Electron zip for
  packaging, so `npm ci` (even with `--ignore-scripts`) and then `electron-builder` is fine.
- Electron 44 removed **macOS 12** support (the minimum is macOS 13) and **Windows ia32**.
- Electron 45 deprecated the synchronous `safeStorage.encryptString`, `decryptString` and
  `isEncryptionAvailable` (removal in 46). Use `encryptStringAsync`, `decryptStringAsync` and
  `isAsyncEncryptionAvailable`.

### `electron-builder.yml`

```yaml
appId: dev.yenebeb.arcshell
productName: YARC
executableName: arc-shell
directories: { output: release, buildResources: build }
files: ["out/**", "package.json"]          # electron-chrome-extensions/web-store stay in node_modules (preloads resolved there)
asar: true

# macOS: CFBundleURLTypes / CFBundleDocumentTypes (needed to appear in "Default web browser" list)
protocols:
  - name: Web URL
    schemes: [http, https]
    role: Viewer
fileAssociations:
  - ext: [html, htm, xhtml, shtml]
    name: HTML Document
    mimeType: text/html
    role: Viewer
    rank: Default                         # LSHandlerRank (macOS)

win:
  target: [{ target: nsis, arch: [x64] }]  # add arm64 if needed (one installer containing both)
  icon: build/icon.ico
nsis:
  oneClick: true                          # default
  perMachine: false                       # default -> %LOCALAPPDATA%\Programs\YARC, no UAC
  allowElevation: false                   # never prompt for admin
  include: build/installer.nsh            # registers as a browser (below)
  deleteAppDataOnUninstall: false
  createDesktopShortcut: true

mac:
  category: public.app-category.productivity
  target:
    - { target: dmg, arch: [arm64, x64] } # 2 smaller DMGs; use [universal] for one ~2x-size DMG
    - { target: zip, arch: [arm64, x64] } # needed later if you add electron-updater (Squirrel.Mac)
  identity: "-"                           # explicit ad-hoc signing (26.x: unset + no cert = NOT signed at all)
  hardenedRuntime: false                  # or keep true AND add com.apple.security.cs.disable-library-validation
  notarize: false
  gatekeeperAssess: false
  minimumSystemVersion: "13.0"            # Electron 44+ floor

publish:
  provider: github
  releaseType: draft
```

The `identity` behavior is taken from the `app-builder-lib@26.18.0` `macOptions.d.ts` doc comment.
"Not set" means electron-builder searches the keychain. If it finds nothing, it **skips signing,
with no automatic ad-hoc fallback**. `null` skips signing. `"-"` signs ad-hoc. An arm64 bundle
whose signature was invalidated (electron-builder edits `Info.plist`) and not re-signed shows
**"is damaged and can't be opened"**, with no Open Anyway button. That is why `"-"` matters.

### Windows: register as a browser (per-user, no admin)

electron-builder's NSIS templates register `fileAssociations`, under `SHELL_CONTEXT`, which is HKCU
for per-user installs. They **do not handle `protocols` on Windows** (no protocol code in
`templates/nsis` or `NsisTarget`). They also do not create the `StartMenuInternet` /
`RegisteredApplications` entries that put you in Settings → Default apps. Add `build/installer.nsh`:

```nsis
; build/installer.nsh  — $appExe and SHELL_CONTEXT are provided by electron-builder's templates
!define BROWSER_KEY "Software\Clients\StartMenuInternet\ArcShell"

!macro customInstall
  ; ProgIDs
  WriteRegStr SHELL_CONTEXT "Software\Classes\ArcShellURL" "" "YARC URL"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ArcShellURL" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\ArcShellURL\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ArcShellURL\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\ArcShellHTML" "" "YARC HTML Document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ArcShellHTML\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\ArcShellHTML\shell\open\command" "" '"$appExe" "%1"'
  ; Browser client + capabilities
  WriteRegStr SHELL_CONTEXT "${BROWSER_KEY}" "" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${BROWSER_KEY}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "${BROWSER_KEY}\shell\open\command" "" '"$appExe"'
  WriteRegStr SHELL_CONTEXT "${BROWSER_KEY}\Capabilities" "ApplicationName" "${PRODUCT_NAME}"
  WriteRegStr SHELL_CONTEXT "${BROWSER_KEY}\Capabilities" "ApplicationDescription" "${PRODUCT_NAME} web browser"
  WriteRegStr SHELL_CONTEXT "${BROWSER_KEY}\Capabilities" "ApplicationIcon" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "${BROWSER_KEY}\Capabilities\StartMenu" "StartMenuInternet" "ArcShell"
  WriteRegStr SHELL_CONTEXT "${BROWSER_KEY}\Capabilities\URLAssociations" "http" "ArcShellURL"
  WriteRegStr SHELL_CONTEXT "${BROWSER_KEY}\Capabilities\URLAssociations" "https" "ArcShellURL"
  WriteRegStr SHELL_CONTEXT "${BROWSER_KEY}\Capabilities\FileAssociations" ".html" "ArcShellHTML"
  WriteRegStr SHELL_CONTEXT "${BROWSER_KEY}\Capabilities\FileAssociations" ".htm" "ArcShellHTML"
  WriteRegStr SHELL_CONTEXT "${BROWSER_KEY}\Capabilities\FileAssociations" ".xhtml" "ArcShellHTML"
  WriteRegStr SHELL_CONTEXT "Software\RegisteredApplications" "${PRODUCT_NAME}" "${BROWSER_KEY}\Capabilities"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'   ; SHCNE_ASSOCCHANGED
!macroend

!macro customUnInstall
  DeleteRegKey SHELL_CONTEXT "Software\Classes\ArcShellURL"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\ArcShellHTML"
  DeleteRegKey SHELL_CONTEXT "${BROWSER_KEY}"
  DeleteRegValue SHELL_CONTEXT "Software\RegisteredApplications" "${PRODUCT_NAME}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
```

This is the same layout Firefox and Chrome per-user installs use: HKCU `StartMenuInternet`,
`Capabilities` and `RegisteredApplications`.

- **Windows 10/11 do not let an app make itself default.** The `UserChoice` hash is protected.
  Don't use `app.setAsDefaultProtocolClient('http')` on Windows: it writes
  `HKCU\Software\Classes\http`, which is ignored and clobbers the class. Instead, open the app's
  page in Default Apps:
  `shell.openExternal('ms-settings:defaultapps?registeredAppUser=' + encodeURIComponent('YARC'))`.
  The value must equal the `RegisteredApplications` value name. Microsoft documents it for Windows
  11 21H2/22H2 with the 2023-04 CU and later. Use `registeredAppMachine=` for per-machine installs.
- **macOS:** `app.setAsDefaultProtocolClient('http')` and then `('https')` trigger the system's
  "change default web browser?" confirmation. Check with `app.isDefaultProtocolClient('https')`.

Handle the incoming URLs and files:

```ts
if (!app.requestSingleInstanceLock()) app.quit()
const openTarget = (arg?: string) => { if (arg && /^(https?:|file:)|\.(x?html?|shtml)$/i.test(arg)) ui.openInActiveProfile(arg) }
openTarget(process.argv.find((a, i) => i > 0 && !a.startsWith('-')))       // Windows cold start
app.on('second-instance', (_e, argv) => openTarget(argv.at(-1)))           // Windows warm start
app.on('open-url', (e, url) => { e.preventDefault(); openTarget(url) })   // macOS (register BEFORE 'ready')
app.on('open-file', (e, p) => { e.preventDefault(); openTarget(require('node:url').pathToFileURL(p).href) })
```

### What friends must do (unsigned builds)

- **macOS 15 Sequoia and macOS 26.** Apple removed the **Control-click → Open** Gatekeeper
  override in Sequoia (Apple Developer News, 2024-08-06). Steps:
  1. Open the DMG and drag the app to Applications.
  2. Double-click it. A dialog says Apple could not verify it; click **Done**.
  3. Go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**.
     Third-party guides report that this button is only shown for about an hour after the blocked
     launch.
  4. Confirm with your password or Touch ID, then click **Open**.

  Terminal alternative: `xattr -dr com.apple.quarantine "/Applications/YARC.app"`. Third-party
  guides claim Tahoe (26) tightened this further, but no Apple source was found. Real fix: Apple
  Developer ID ($99/yr) plus notarization.
- **Windows:** the unsigned NSIS installer shows SmartScreen "Windows protected your PC". Click
  **More info → Run anyway**. The per-user install needs no admin.

### GitHub Actions: build both on tag push

Action versions as of 2026-11-01:
- `actions/checkout` v7.0.1
- `actions/setup-node` v7.1.0
- `macos-latest` = macOS 26 arm64 (it builds x64 too)
- `windows-latest` = Server 2025

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ['v*']          # tag must equal "v" + package.json version (electron-builder publishes to that draft release)
permissions:
  contents: write
jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run build                         # tsc/vite -> out/
      - name: Package & publish (draft release)
        run: npx electron-builder ${{ matrix.os == 'macos-latest' && '--mac' || '--win' }} --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_IDENTITY_AUTO_DISCOVERY: "false"     # belt-and-braces: never pick up a random keychain cert
```

Afterwards, review the draft release and publish it. It holds the `.exe`, `-arm64.dmg`, `-x64.dmg`,
the zips, and `latest*.yml` (useful if you add `electron-updater`).

---

## 6. Security updates: from an Electron release to users

Almost every browser zero-day is in Chromium or V8, and the only way YARC gets the fix is a
newer `electron`. Electron ships Chromium security fixes as patch releases on every supported
major, usually within a day or two of Chrome's. They often have **no GHSA on the `electron` npm
package**, so Dependabot *alerts* and *security updates* alone miss them; daily *version* updates
are what catch them.

1. **Electron publishes** a patch, e.g. `45.2.2`.
2. **Dependabot** (`.github/dependabot.yml`) checks npm daily and opens a PR for it. `electron` is
   in its own group, so its PR never waits on another package's.
3. **CI** (`ci.yml`, the `check` job) typechecks, tests and builds the PR.
4. **Auto-merge** (`.github/workflows/dependabot-automerge.yml`): if the PR is Dependabot's and a
   semver *patch* or *minor* (`dependabot/fetch-metadata`; for a group, its biggest bump), it runs
   `gh pr merge --auto --merge`, so the PR merges once `check` passes. This covers every package,
   not just `electron`, but only `electron` bumps are released (step 5); the others get the
   `release:skip` label and ship with the next real change. Majors wait for a person, because CI
   doesn't run the e2e tests. Against
   supply-chain attacks, Dependabot only proposes a new version of any package, `electron`
   included, once it has been out for a day (`cooldown` in `.github/dependabot.yml`; security
   updates skip it). That also matches pnpm, which refuses packages published less than a day ago
   (its default `minimumReleaseAge`): proposed sooner, an Electron PR fails `check` with
   `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` and the auto-merge job gives up. Needs the repo
   setting `allow_auto_merge`.
5. **Release**: GitHub starts no workflows for a push made with `GITHUB_TOKEN`, so the auto-merge
   doesn't trigger `release.yml` on its own. The auto-merge job waits for the merge and then runs
   `gh workflow run release.yml -f bump=patch` (dispatch is the exception to that rule). The
   release builds Windows, macOS and Linux and publishes once all three pass. The Linux job also
   uploads `release.json` (`{ "electron": "<version>" }`).
6. **Users**: installed copies check GitHub every hour (`CHECK_EVERY` in `src/main/updater.ts`).
   - Windows downloads the update in the background (electron-updater, `latest.yml`) and installs
     it on the next quit. Meanwhile the sidebar shows a *Restart to Update* pill (also in the
     command bar and menu). The relaunch card (listing what's new) only opens by itself once the
     update has waited without a restart: 1 day when its `release.json` names a different
     Electron than `process.versions.electron`, else 7 days (Chrome's escalation); *Later* keeps
     it away a day (`src/main/update-escalation.ts`). The
     start of the wait is kept in `state.json` (`waitingUpdate`), so a restart that didn't install
     doesn't reset it. While an update is ready, no newer release is downloaded, so a newer one
     never causes a second notice; it arrives with the next check after the restart.
   - macOS does the same with its own updater (section 7), since Squirrel.Mac refuses ad-hoc
     signatures.
   - Linux only gets a notice and a download link; users replace the AppImage by hand.

Gaps:
- Once Electron has a newer major, Dependabot proposes that major instead of the next patch on
  ours, and majors aren't auto-merged. Merge the major (by hand, after a look) to get patch
  auto-merges back.
- If `check` fails on a Dependabot PR, nothing ships until someone fixes it.
- Dependabot alerts and security updates are on too, for advisories on other packages.

---

## 7. macOS self-update without a Developer ID **[tested 2026-11-02, macOS 26.5.1 arm64]**

Squirrel.Mac (electron-updater's `MacUpdater`) checks that the new app satisfies the running
app's designated requirement. An ad-hoc signature's requirement is its own cdhash
(`codesign -d -r-` prints `designated => cdhash H"…"`), which changes with every build, so
Squirrel.Mac refuses every update. `src/main/mac-update.ts` does the job itself:

1. Poll `releases/latest` (as before); pick `YARC-<version>-<arch>-mac.zip` and its `.sig`
   (`pickMacUpdate` in `release.ts`). electron-builder's `zip` mac target keeps the framework
   symlinks (14 symlink entries; `codesign --verify --deep --strict` passes after unzipping).
2. Download both with **Node's `fetch`**, not Chromium's download manager. Chromium sets
   `com.apple.quarantine` on its downloads; files written with Node's `fs` don't get it (Electron's
   Info.plist has no `LSFileQuarantineEnabled`). Unpacked with `ditto -x -k --noqtn`. Verified: no
   quarantine xattr anywhere in the unpacked app (only `com.apple.provenance`), so Gatekeeper never
   assesses the new version and there's no second *Open Anyway*.
3. Check the Ed25519 signature before writing anything (`update-signature.ts`). Signed message:
   `arc-shell-update\n<zip name>\n<sha512 hex>\n`, so an older or other-arch zip renamed to the new
   name fails (tested: 0.0.5's zip and signature served as 0.0.6 were rejected). CI signs in
   `release.yml` with `scripts/sign-update.mts` and the `MAC_UPDATE_SIGNING_KEY` secret; the script
   refuses a key that doesn't match `UPDATE_PUBLIC_KEY`.
4. Unzip to `<userData>/Update/new`, check bundle id, `CFBundleShortVersionString` and
   `codesign --verify --deep --strict`.
5. Ask *Relaunch to update* (shared with Windows). The swap happens in `will-quit`, both for
   *Relaunch* (`app.relaunch()` + `app.quit()`) and for a plain quit after *Later*: rename the
   running bundle to `<userData>/Update/replaced.app`, rename the new one into place, roll back if
   the second rename fails. Not swapping earlier matters: Chromium starts helper processes from the
   bundle path, and a helper from the new version would not match the running browser. Node has no
   `renamex_np(RENAME_SWAP)`, so it's two renames, not one atomic call. The next start removes
   `Update/` with `/bin/rm -rf`: **Electron's patched `fs.rm` treats `app.asar` as a folder and
   leaves it behind**, which then made the next update's cleanup fail.
6. If anything fails, it logs, falls back to the old notice (*Update Available…* opens the DMG) and
   doesn't retry that version every hour.

Tested with packaged test builds (`productName` "Arc Shell Update Test", own appId and profile)
installed in `/Applications`, started with `open`, updating from a local feed: 0.0.3 → 0.0.4 on
quit, 0.0.4 → 0.0.5 with *Relaunch*. Results for the risks:

- **Keychain "Arc Shell Safe Storage": no prompt, because the item doesn't exist.** Electron's
  `EnableCookieEncryption` fuse is off by default, so cookies are stored in plain text (checked
  in the Cookies database: `value` set, `encrypted_value` empty) and nothing calls `safeStorage`.
  Turning cookie encryption on makes macOS ask for the login password after every update, which is
  why it stays off on macOS (section 8).
- **App Management (macOS 13+): no prompt and no failure.** Renaming the app's own bundle in
  `/Applications` worked, and `log show` had no tccd `SystemPolicyAppBundles` entry for it. Tested with an app
  that had no quarantine flag (like an install fixed with `xattr -dr`, and the current real
  install on this Mac). Not tested: a first install approved with *Open Anyway*.
- **Camera, microphone, screen recording: macOS asks again after each update** (tested with the
  microphone in section 8). TCC stores the designated requirement, which for an ad-hoc signature
  is the cdhash and differs per build. Same as the old DMG route. A self-signed certificate keeps
  the grant (section 8), so releases are signed with one now (section 9).
- If the user can't write to the app's folder (standard account, `/Applications`), or the app is
  translocated (run from the DMG or Downloads), it falls back to the DMG notice.

---

## 8. Cookie encryption: Windows and Linux only **[tested 2026-11-02, macOS 26.5.1 arm64]**

Electron stores cookies in plain text unless the `EnableCookieEncryption` fuse is on: the Cookies
SQLite file in each profile partition has `value` set and `encrypted_value` empty, so any process
running as the user can read every login. With the fuse on, Chromium encrypts them like Chrome
(`encrypted_value` starts with `v10`) with a key it keeps per OS:

- **Windows:** a random key in the profile's `Local State` (`os_crypt.encrypted_key`), wrapped
  with DPAPI for the Windows user. Nothing is tied to the binary, so NSIS updates (and the YARC
  rename, which keeps the profile folder) keep it. **Not tested on Windows:** no Windows machine
  in this session. To check: install a build, log in somewhere, quit, open the Cookies file with
  sqlite3 (`select name, length(value), hex(substr(encrypted_value,1,3)) from cookies`: empty
  value, `763130`), install the next version over it, check you're still logged in.
- **Linux:** the Secret Service (GNOME Keyring, KWallet); without one, Chromium's fixed fallback
  key, which is obfuscation, not protection.
- **macOS:** a generic password `<app name> Safe Storage` / account `<app name> Key` in the login
  keychain. **This is why the fuse is off on macOS** (below).

**How it's turned on:** `scripts/after-pack.mjs`, electron-builder's `afterPack` hook, calls
`packager.addElectronFuses` for every platform but `darwin`. The `electronFuses` option
(electron-builder 26.18 has it) can't do that: it's top-level only and applies to all platforms.
afterPack runs at the same point (before signing). Checked by packaging `--dir` for all three on a
Mac: `@electron/fuses read` says Enabled for `Arc Shell.exe` and `arc-shell`, Disabled for the app.

**Existing cookies [tested on macOS with the fuse on]:** 0.0.1 without the fuse set two cookies
(plain text), the self-updater installed 0.0.2 with the fuse, and both were still sent
(`old=plain1; old2=plain2`): Chromium reads `value` when `encrypted_value` is empty. A new cookie
and a re-set one were stored encrypted. A cookie the site never sets again stays plain text until
it expires. Nobody is logged out. The same os_crypt cookie code runs on Windows and Linux.

### Why not macOS: a password prompt after every update

Tested with packaged builds that have their own productName and appId, updated through
`mac-update.ts` from a local feed (section 7):

1. **Ad-hoc (as released):** the first start with the fuse creates the item without asking. After
   the update to the next build, SecurityAgent asks for the **login keychain password** ("… wants
   to use your confidential information stored in "… Safe Storage" in your keychain"), and the
   app waits for the answer before it can read cookies. *Deny* means every encrypted cookie is
   unreadable: logged out everywhere.
2. **One self-signed certificate for every build:** the designated requirement becomes stable
   (`identifier "…" and certificate leaf = H"06fa…"`, checked on two builds), so the item's access
   list matches. **It still asks** ("… wants to access key …"). securityd's log:
   `ACL partition mismatch: client cdhash:5888… ACL ("cdhash:95d5…")`. Since macOS 10.12 a
   keychain item also has a partition list. An app signed by an Apple-issued certificate gets
   `teamid:<team>`; anything else gets `cdhash:<its cdhash>`, which changes with every build.
   *Always Allow* (with the password) adds the new cdhash, so it asks again on the next update.

So without an Apple Developer ID (team ID), cookie encryption on macOS costs a login-password
prompt per update. The alternatives were worse: the `--use-mock-keychain` switch uses a fixed key
(no protection), and an item any app may read (`security add-generic-password -A`) doesn't stop
"any process running as the user". Revisit with a Developer ID.

**Keychain item name vs. the YARC rename.** The service name comes from the app name. A Mac whose
cookies were encrypted under "Arc Shell Safe Storage" would, after the rename, look for "YARC Safe
Storage", create a new key and fail to decrypt every cookie. Turning the fuse on for macOS later is
fine (only new names are involved), but **never rename the app on macOS once the fuse is on**
there, unless the old item is migrated. Windows keeps the key in `Local State`, so the rename (and
the fuse being on already) is safe there.

### Self-signed certificate and TCC (camera, microphone) [tested]

TCC (privacy permissions) checks the designated requirement, not the keychain partition, so a
stable requirement does help there. Two pairs of builds (fuse off, so no keychain prompts), each
granted the microphone by a person, then updated with `mac-update.ts`:

- **Self-signed** (one certificate, `certificate leaf = H"…"`), 0.0.3 → 0.0.4: tccd answered
  `kTCCServiceMicrophone authValue=2 authReason=2` (allowed, user consent), no prompt, and
  `getUserMedia` worked.
- **Ad-hoc**, 0.1.0 → 0.1.1: tccd logged `Failed to match existing code requirement for subject …
  and service kTCCServiceMicrophone` and asked again.

Not tested: the camera (same check), and screen recording (pages can't ask for it yet: no
`setDisplayMediaRequestHandler`). Switching from ad-hoc to a certificate re-asks once, because
existing grants name the old cdhash.

Release builds are signed this way now: section 9.

---

## 9. macOS release signing with one self-signed certificate

Every macOS release is signed with the same self-signed code-signing certificate, so the
designated requirement is `identifier "org.arcshell.browser" and certificate leaf = H"<SHA-1>"`
for every version and camera/microphone permissions survive updates (section 8). It doesn't help
the keychain (section 8) or Gatekeeper: macOS doesn't trust the certificate, so the first launch
still needs *Open Anyway*, as with ad-hoc. Not tested: the first launch of a quarantined
self-signed DMG.

**How it's wired:**

- `electron-builder.yml` keeps `identity: "-"` and sets `mac.sign: ./scripts/mac-sign.mjs`.
  electron-builder only signs with identities `security find-identity -v` calls valid, which an
  untrusted self-signed one isn't. With `"-"` it gets as far as signing, and the hook calls
  `@electron/osx-sign`'s `signAsync` with the certificate's SHA-1 in place of `"-"` (the same
  options otherwise; electron-builder already passes `identityValidation: false`). Without
  `MAC_CODESIGN_IDENTITY` it signs ad-hoc, as before: local builds, forks, and releases while
  the secret is missing.
- `release.yml` (macOS job) runs `scripts/import-mac-certificate.sh` when the `MAC_CODESIGN_P12`
  secret is set. It imports the .p12 into a keychain of its own, adds it to the user's keychain
  search list (codesign doesn't find the identity with `--keychain` alone: "no identity found"),
  and exports `MAC_CODESIGN_IDENTITY` / `MAC_CODESIGN_KEYCHAIN`. Without the secret it warns
  and signs ad-hoc.
- After packaging, `release.yml` runs `codesign --verify --deep --strict` on both apps (what
  `mac-update.ts` checks before installing). When a certificate was imported, it also fails the
  build if the requirement has no `certificate leaf`.

**Tested on this Mac [2026-11-02]:**

- A .p12 made with the commands below, run through `import-mac-certificate.sh` with a fake
  `RUNNER_TEMP`/`GITHUB_ENV`. The arm64 zip and the x64 app both got the certificate requirement
  and pass `codesign --verify --deep --strict`. The unzipped update has the right bundle id and no
  quarantine flag.
- A real self-update with `mac-update.ts` from an ad-hoc build (0.1.1) to a self-signed one
  (0.1.2): downloaded, verified, swapped at quit, and 0.1.2 started.
- Self-signed → self-signed updates (0.0.1 → 0.0.2, 0.0.3 → 0.0.4) through the updater: the
  microphone grant was kept.
- Not run in GitHub Actions yet; the release workflow only runs on main.

**Making the certificate** (once, on a Mac; the user does this, never CI or an agent). Use Apple's
`/usr/bin/openssl` (LibreSSL): `security import` reads its .p12 encryption. OpenSSL 3 needs `-legacy`.

```bash
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 7300 \
  -subj "/CN=YARC Release Signing" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" \
  -keyout codesign-key.pem -out codesign-cert.pem
/usr/bin/openssl pkcs12 -export -inkey codesign-key.pem -in codesign-cert.pem \
  -name "YARC Release Signing" -out codesign.p12   # asks for the .p12 password
base64 -i codesign.p12 | gh secret set MAC_CODESIGN_P12 --repo yenebeb/yarc
gh secret set MAC_CODESIGN_P12_PASSWORD --repo yenebeb/yarc   # asks for the same password
```

Keep `codesign.p12` and its password somewhere safe (a password manager), then delete the
`.pem` files. **The certificate must never change**: the requirement is the certificate's hash,
so a new certificate (or a release without the secret) makes every Mac ask for the camera and
microphone again, once. The first signed release does that once too (existing grants name the
old cdhash). Whether macOS minds an expired self-signed certificate wasn't tested; 7300 days
(20 years) keeps that question away.

## 10. Logins across a restart: session cookies **[tested 2026-11-10, macOS 26.5.1 arm64, Electron 45.2.3]**

Users were logged out of many sites after every restart. Cause: **Electron never writes session
cookies (no `Expires`/`Max-Age`) to the Cookies database**, and drops them at quit. Chrome and Arc
keep them when they reopen the previous tabs (Chromium's `persist_session_cookies` and
`restore_old_session_cookies` network-context options); Electron has no API for either. Many
logins depend on them: Microsoft/Entra (`ESTSAUTH` without "Stay signed in", so Teams, Outlook,
Azure), most company portals and SSO pages, banks.

Found with the built app, a temporary `YARC_USER_DATA` and a local page that sets a session cookie
(`HttpOnly`), a persistent one (`Max-Age`), a `__Host-` cookie and a `sessionStorage` token:

| End of the run | Session cookie | Persistent cookie | `sessionStorage` |
|---|---|---|---|
| Before the fix, `app.quit()` | lost | kept | lost |
| After, `app.quit()`, Quit menu / ⌘Q (`terminate:`), last window closed then quit | kept | kept | lost |
| After, `SIGKILL` 3 s after login | kept | **lost** | lost |
| After, login in an incognito window | not saved | not saved | lost |

The Cookies file had no row at all for the session cookie. Ruled out: the cookie store isn't
wiped at quit (persistent cookies of the user's real profile go back to the first day), the UA
doesn't change between launches, and incognito's `dispose()` clears only its own `incognito-<id>`
partitions. The persistent cookie lost on `SIGKILL` is Chromium's own write delay (it flushes the
Cookies database about every 30 s and at a normal quit); Chrome does the same.

**Fix (`src/main/session-cookies.ts`):** per profile, a mirror of the session cookies kept from
`session.cookies` `changed` events, written to `Profiles/<id>/session-cookies.json` (mode 600)
2 s after a change and at quit (`Profiles.closeAll()`, synchronous, from `before-quit`). At launch
`Browser.restoreSessions()` sets them again with `cookies.set` before `start()` opens any window
(at most 1 s, so a broken file never holds the launch up). Host-only cookies are set without a
`domain` (so `__Host-` cookies stay valid); `HttpOnly`, `Secure` and `SameSite` are kept. Each
restored cookie is a session cookie again, so a site's sign-out removes it from the file too.
Not for incognito profiles. The file is encrypted with `safeStorage` where the Cookies database
is (Windows, Linux); plain text on macOS like the Cookies database (section 8: the Keychain would
ask for the password after every update). Cookie partitions (CHIPS) aren't in Electron's `Cookie`
object, so a partitioned session cookie comes back unpartitioned; logins don't use those.

**`sessionStorage` is not restored.** It belongs to a tab (a session-storage namespace), and
Chromium only restores it through its own session restore, which Electron doesn't have. Doing it
ourselves would mean reading every frame's storage at quit (async, so holding up the quit, which
also runs the macOS update swap) and writing it back before the page's scripts run (a preload or
`Page.addScriptToEvaluateOnNewDocument` through the debugger in every tab). Not worth it for
logins: apps that keep tokens there, like MSAL's default `sessionStorage` cache, sign in again
silently from the identity provider's cookies, which are now kept.

---

## Summary of choices

| Topic | Choice |
|---|---|
| Extensions lib | `electron-chrome-extensions@^4.10.0` (MIT, **no `license` option**), one instance per profile session, `addTab(view.webContents, baseWindow)` |
| Web store | `electron-chrome-web-store@0.13.0`, **per-profile `extensionsPath`**, `autoUpdate: false` + own `updateExtensions(ses)` loop |
| Extension APIs | Use `ses.extensions.*`, because `ses.loadExtension` is deprecated in 45 |
| Ad blocking | MV3 DNR is unsupported in Electron 45, so uBO Lite won't block. Needs a main-process blocker |
| UA | Keep `Electron/45.x`, strip only the app-name token, set it before creating views, no client-hint forging, no CDP, no webRequest UA rewriting |
| Chrome Sync | Impossible. Offer import from the local Chrome profile instead |
| Storage | `node:sqlite` (Node 24.22.1, SQLite 3.53.4, unflagged, RC); no native modules |
| Packaging | NSIS oneClick per-user + `installer.nsh` browser registration; mac dmg + zip arm64+x64, `identity: "-"` + `mac.sign` hook (self-signed certificate from CI, else ad-hoc), `hardenedRuntime: false` |
| macOS updates | Own updater (`mac-update.ts`): Node download (no quarantine), Ed25519-signed zip, swap at quit; not Squirrel.Mac |
| Cookie encryption | `EnableCookieEncryption` fuse on Windows and Linux (`scripts/after-pack.mjs`); off on macOS until a Developer ID, because the keychain partition is the cdhash and every update would ask for the login password |
| Session cookies | Saved per profile at change/quit, restored before the first window (`session-cookies.ts`); `sessionStorage` not restored |
