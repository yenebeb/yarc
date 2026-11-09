<p align="center"><img src="build/icon.svg" width="160" alt="YARC's icon: a purple A in a pirate hat, bandana and eyepatch"></p>

# YARC: an open-source replacement for the Arc browser

**YARC is a free, open-source replacement for the Arc browser, which shuts down on 22 December 2026.** It works the way Arc did, with a vertical sidebar, Spaces with their own profiles, the command bar, split view, Little Arc and Peek. It imports your Arc spaces, profiles, favorites, pinned tabs, folders, archive and history in one step. It runs on macOS, Windows and Linux (experimental).

**[Download YARC](https://github.com/yenebeb/yarc/releases/latest)** · [Website](https://yenebeb.nl/yarc) · [Moving from Arc](#moving-from-arc)

The Browser Company is shutting Arc down on **22 December 2026**. After that date the app stops working and Arc accounts are deactivated. YARC (*Yet Another Arc Clone*, yarrr!) is meant for people who don't want to switch to Dia or go back to a tab strip. It reproduces Arc's workflow and imports your Arc sidebar, so you can carry on as before.

> YARC is an independent project. It is not affiliated with, endorsed by or connected to The Browser Company. "Arc" is their trademark; this project re-implements the interaction design on top of Chromium (via Electron).

![YARC: sidebar with favorites, pinned tabs, a folder and Today tabs](docs/screenshots/sidebar.png)

## Contents

- [Features](#features)
- [Install](#install)
- [Moving from Arc](#moving-from-arc)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [FAQ](#faq)
- [Where your data lives](#where-your-data-lives)
- [Building from source](#building-from-source)
- [How it works](#how-it-works)
- [Roadmap and known limitations](#roadmap-and-known-limitations)
- [Contributing](#contributing)
- [License](#license)

## Features

### The sidebar

Everything sits in one vertical sidebar, with the page taking up the rest of the window. From top to bottom:

- **Window controls and navigation:** toggle the sidebar, back, forward and reload. On Windows the minimize, maximize and close buttons are here too; on macOS the traffic lights are.
- **URL pill:** shows the current site. Click it, or press `Ctrl/⌘+L`, to edit the URL. Buttons for installed extensions appear on the right of the pill.
- **Favorites:** a grid of icons for the sites you always have open (mail, calendar, chat). A dot shows which ones are loaded.
- **Pinned tabs and folders:** tabs that stay until you remove them. Folders can be nested and collapsed.
- **Today:** everyday tabs below the divider, newest first. "Clear" archives them all at once.
- **Bottom bar:** the Library (archive, history, downloads), your Spaces, and **+** to create a new space.

Hide the sidebar with `Ctrl/⌘+S` for a full-width page. Move the mouse to the left edge of the window and it slides back over the page until you move away.

Everything in the sidebar supports drag and drop. You can drag tabs between Favorites, Pinned, folders and Today, drop a folder inside another folder, or drop a tab on a Space icon to move it there. Right-click any item for its options, such as rename, duplicate, open in split view, mute or move to a Space. Middle-click closes a tab, and double-click renames it.

### Spaces, each with its own profile

![The Work space with its own color theme](docs/screenshots/spaces.png)

A Space is a separate sidebar with its own name, emoji and color. The whole window takes on that color.

- **Every new Space gets its own profile by default.** A profile has its own cookies and logins, site storage, cache, history and Chrome extensions. So you can be signed in to your work Google account in the *Work* space and your personal one in *Personal* at the same time.
- **Spaces can also share a profile**, the same way Arc linked Spaces to profiles. Pick "Share with …" when creating a space.
- **Favorites belong to the profile.** Every space that uses the profile shows the same favorites.
- **Pinned tabs, folders and Today tabs belong to the space.**

Switch spaces by swiping two fingers sideways on the sidebar, by clicking the icons at the bottom, or with `Ctrl+1–9` (macOS) / `Alt+1–9` (Windows) and `⌘⌥←/→` / `Ctrl+Alt+←/→`.

![Creating a new space](docs/screenshots/new-space.png)

### Pinned tabs that act like Arc's

- A pinned tab remembers its **pinned URL**. When you browse away, a `/` appears in front of its title. Hover over its icon and click the arrow to go back to the pinned URL.
- **Closing a pinned tab** (`Ctrl/⌘+W`) only unloads it to free memory. It stays in the sidebar, and clicking it opens the pinned URL again.
- `Ctrl/⌘+D` pins or unpins the current tab.
- **Links to other sites open in Peek.** When you click a link in a pinned tab or a favorite that leads to another website, the page opens in a floating card over your tab, so the pinned page stays where it was. Links within the same site still open in the tab itself.
  - Close Peek with `Esc`, the × button, or a click outside the card.
  - Keep the page with the expand button (or `Ctrl/⌘+O`): it becomes a new Today tab. The split button opens it next to the current tab.
  - Turn this off in Settings: "Open other sites from pinned tabs and favorites in Peek".

### Today tabs archive themselves

Unpinned tabs you haven't looked at for **12 hours** move to the Archive automatically. You can change this to 24 hours, 7 days or 30 days, or turn it off. Tabs that are playing audio, or are part of a split view, are never archived. Closed tabs go to the Archive too. Find them again in the Library, search for them in the command bar, or use `Ctrl/⌘+Shift+T`.

### Command bar

![The command bar searching open tabs](docs/screenshots/command-bar.png)

`Ctrl/⌘+T` opens the command bar, which replaces the new-tab page. Type to:

- **switch to an open tab** in any space ("Switch to Tab" is the top result when the name matches);
- open a URL, or search with your search engine, with live suggestions;
- find pages from your **history** and **archive**;
- run **commands** such as *Toggle Sidebar*, *Copy URL*, *New Space*, *Import from Arc* or *Make YARC the Default Browser*;
- jump to a space by typing its name.

`Shift+Enter` opens the result in split view. `Ctrl/⌘+L` opens the command bar with the current URL, ready to edit.

### Split view

![Split view](docs/screenshots/split-view.png)

Show up to four tabs side by side. There are several ways to start one:

- press `Ctrl+Shift+=` and pick a tab or URL;
- Shift-click a tab in the sidebar;
- choose "Open Link in Split View" from a link's context menu.

Drag the gap between panes to resize them, and double-click it to make them equal again. The focused pane has a colored outline. `Ctrl+Shift+-` closes the split.

### Little Arc

![Little Arc](docs/screenshots/little-arc.png)

A small, minimal window for quick lookups. Open one with `Ctrl+Alt+N` / `⌘⌥N`. When YARC is your default browser, links from other apps (Slack, Discord, email) open here too, so your sidebar stays tidy. If you want to keep the page, click **Open in** *your space*: it moves into your Today tabs as it is, without reloading. The arrow next to it picks another space. If you don't want to keep it, just close the window.

The chip on the left of the address shows which profile the page uses, so which accounts you're signed in with. Click it to open the page with another profile; YARC remembers that choice for the site. The window also remembers the size you give it.

### Built-in ad and tracker blocking

Ads and trackers are blocked out of the box, in every profile, using the same kind of filter lists as uBlock Origin and EasyList (via [Ghostery's open-source engine](https://github.com/ghostery/adblocker)). That includes network blocking, cosmetic filtering that hides empty ad slots, and the scriptlets used against YouTube-style ads. The shield in the URL pill shows how many requests were blocked on the current page. Click it to allow ads on that site, for example if the site breaks, and click again to block them again. The lists update daily. You can turn blocking off completely in Settings.

### Chrome extensions

Install extensions straight from the **Chrome Web Store** by visiting it and clicking *Add to Chrome*, or run the *Get Extensions* command. Extensions are installed **per profile**, so your work space can have different extensions from your personal one. They're kept up to date automatically, and their buttons appear in the URL pill.

### Importing

- **From Arc:** Spaces (with their emoji and colors), profiles, Favorites, pinned tabs, folders, Today tabs, the archive and browsing history. See [Moving from Arc](#moving-from-arc).
- **From Zen:** spaces (with their colors), pinned tabs, folders, Essentials (as Favorites), Today tabs and browsing history. Each container your spaces use becomes a YARC profile, since both keep cookies apart. Run *Import from Zen* from the command bar, the File menu or Settings → Import; pick another profile, or a copied Zen folder, with **Use a Different Copy…**. Quitting Zen first gives the most complete result.
- **From Chrome, Edge or Brave:** browsing history and bookmarks. Bookmarks arrive as a pinned folder.

The source browser's files are never changed: YARC copies them first and reads the copy.

### History sync between your computers

Your history can follow you between computers, like Chrome's sync, without an account or a YARC server: it goes through a folder you already sync, in **iCloud Drive, Dropbox or OneDrive**. In **Settings → Sync**, choose a folder and a sync password. On your other computers, choose the same folder and type the same password; that's all. Profiles are matched by name (renaming one later keeps the link), and each profile has its own on/off switch. Incognito windows never sync.

**YARC never sees your data.** Everything it writes to the folder is encrypted on your computer with a key made from your sync password (scrypt, then AES-256-GCM): no URL, title, profile name or device name is readable there, and even the file names are random IDs. Your cloud provider carries only encrypted files. A wrong password is refused and syncs nothing. If you change the password, your other computers ask for the new one. The password itself is never stored; each computer keeps the key it derived (protected by Windows' DPAPI or the Linux keyring; on macOS in YARC's profile folder, see [Where your data lives](#where-your-data-lives)).

You can leave the password empty, but then anyone who can open the folder can read your history: Settings lists exactly what's exposed. There's no way to recover a forgotten password; turn sync off and start over with a new folder. Details: [docs/history-sync.md](docs/history-sync.md).

### The rest

- **Find in page** (`Ctrl/⌘+F`) shows a match counter.
- **`Ctrl+Tab` switcher** in most-recently-used order. Keep holding Ctrl and press Tab again to go further back.
- **Library** (`Ctrl/⌘+Shift+L`) with tabs for the Archive, History (searchable, grouped by day), Downloads and Spaces.
- **Downloads** save to your Downloads folder automatically, with progress shown in the sidebar.
- **Zoom** per tab, **mute** from the sidebar, **copy URL** (also as Markdown), **duplicate tab**.
- **Open in Chrome** (`Ctrl/⌘+Alt+O`) for the rare site that only works in Google Chrome.
- Permission prompts for the camera, microphone, location and notifications, asked once per site.
- Light, dark or system theme, and a choice of Google, DuckDuckGo, Bing, Kagi or Brave Search.

## Install

Download the latest version from the **[Releases page](https://github.com/yenebeb/yarc/releases/latest)**:

| Platform | File |
| --- | --- |
| macOS, Apple silicon (M1–M5) | `YARC-<version>-arm64.dmg` |
| macOS, Intel | `YARC-<version>-x64.dmg` |
| Windows 10 / 11, x64 | `YARC-Setup-<version>-x64.exe` |
| Windows on ARM | `YARC-Setup-<version>-arm64.exe` |
| Linux, x64 (experimental) | `YARC-<version>-x86_64.AppImage` |

### Windows 10 / 11

1. Download `YARC-Setup-<version>-x64.exe`, or the `-arm64.exe` for Windows on ARM devices such as the Surface Pro X or Snapdragon laptops.
2. Run it. It installs for your user only, needs **no admin rights**, and opens YARC when it finishes.
3. The app isn't code-signed yet, so Windows SmartScreen may say *"Windows protected your PC"*. Click **More info → Run anyway**.

**Make it your default browser:** open the command bar and run *Make YARC the Default Browser*, or go to Windows **Settings → Apps → Default apps → YARC → Set default**.

**Uninstall:** Settings → Apps → Installed apps → YARC → Uninstall. Your profiles stay in `%APPDATA%\YARC` in case you reinstall; delete that folder to remove them.

### macOS 13 or newer

1. Download the `.dmg` for your Mac: **`-arm64.dmg`** for Apple Silicon (M1–M5), **`-x64.dmg`** for Intel.
2. Open it and drag **YARC** to **Applications**.
3. The app isn't notarized by Apple yet, so the first launch is blocked. Open it once, click **Done**, then go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. (On macOS 15 and later, Control-click → Open no longer skips this.) You only do this once: updates install themselves.
   Or, in Terminal: `xattr -dr com.apple.quarantine "/Applications/YARC.app"`
4. To make it your default browser: run *Make YARC the Default Browser* from the command bar, or go to **System Settings → Desktop & Dock → Default web browser**.

### Linux (experimental)

There's an `.AppImage` for x64 on the Releases page. Make it executable (`chmod +x`) and run it. On Ubuntu 24.04+ you may need to allow unprivileged user namespaces for Chromium's sandbox.

### Updating

YARC checks for a new version when it starts and every hour. You can turn that off in **Settings → General → Check for updates automatically**, and check by hand with *Check for Updates…* in the command bar (or the **YARC** menu on macOS).

- **Windows and macOS** update themselves. The new version downloads in the background; then YARC asks you to *Relaunch* to update (your spaces and tabs reopen). If you choose *Later*, it asks again a day later, a *Restart to Update* button stays at the bottom of the sidebar and in the command bar (and the **YARC** menu on macOS), and the update installs the next time you quit anyway. Updates often carry Chromium security fixes, so relaunch soon. Your spaces, tabs and logins are kept.
- **macOS** asks for nothing in Terminal and shows no *Open Anyway* again after an update. Two things to know, both because the builds aren't signed with an Apple Developer ID: macOS may ask again for camera, microphone or screen recording the first time a site uses them after an update, and YARC can only update itself if your user can write to the folder it's in (an admin account can write to **Applications**). If it can't, *Update Available…* downloads the new `.dmg` instead: drag it to **Applications** to replace the old one, then allow it once with **Open Anyway** as above.
- **Linux:** you're told when a new version is out; download the new `.AppImage` and use it instead of the old one.

**Coming from Arc Shell?** YARC is the same app under a new name: it updates from Arc Shell like from any other version and keeps using your Arc Shell profile. On macOS the updated app keeps its file name, **Arc Shell**, in Applications; quit it and rename it to **YARC** in Finder if you like.

## Moving from Arc

> **Do this before 22 December 2026.** After that date Arc no longer opens, but its files stay on disk, so the import keeps working on a copy of the folder.

### On the same computer

1. Install YARC.
2. Press `Ctrl/⌘+T`, type **Import from Arc** and press Enter. You'll also find it under Settings → Import.
3. YARC finds Arc automatically and asks for confirmation. Your spaces, favorites, pinned tabs, folders and history appear in the sidebar.

### From a Mac to a Windows PC (or another computer)

1. On the Mac, copy the folder `~/Library/Application Support/Arc` to a USB stick or cloud drive. In Finder, press `⇧⌘G` and paste that path to get there.
2. On the other computer, run **Import from Arc**, choose **Use a Different Copy…** and select the copied `Arc` folder or the `StorableSidebar.json` file inside it.

### What isn't imported

- **Saved passwords, cookies and logins.** Browsers encrypt these with a key tied to the machine, so you'll need to sign in to your sites again. Before Arc goes away, export your passwords from Arc (`arc://settings/passwords` → ⋮ → Export) and import them into a password manager such as Bitwarden or 1Password. Their extensions work in YARC.
- **Boosts, Easels and Notes.** YARC doesn't have these features yet.
- **Extensions.** Reinstall them from the Chrome Web Store, in each space that needs them.

## Keyboard shortcuts

These are Arc's shortcuts. **Mod** means `⌘` on macOS and `Ctrl` on Windows. The same list is in Settings → Keyboard Shortcuts.

| Action | macOS | Windows |
| --- | --- | --- |
| New tab (command bar) | `⌘T` | `Ctrl+T` |
| Edit URL | `⌘L` | `Ctrl+L` / `Alt+D` |
| Toggle sidebar | `⌘S` | `Ctrl+S` |
| Copy URL | `⌘⇧C` | `Ctrl+Shift+C` |
| Copy URL as Markdown | `⌘⇧⌥C` | `Ctrl+Shift+Alt+C` |
| New Little Arc window | `⌘⌥N` | `Ctrl+Alt+N` |
| Close tab (unload if pinned) | `⌘W` | `Ctrl+W` / `Ctrl+F4` |
| Reopen closed tab | `⌘⇧T` | `Ctrl+Shift+T` |
| Pin / unpin tab | `⌘D` | `Ctrl+D` |
| Clear unpinned (Today) tabs | `⌘⇧K` | `Ctrl+Shift+K` |
| Next / previous tab | `⌘⌥↓` / `⌘⌥↑` | `Ctrl+Alt+↓` / `Ctrl+Alt+↑` |
| Recent-tab switcher | `⌃Tab` / `⌃⇧Tab` | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Next / previous space | `⌘⌥→` / `⌘⌥←` | `Ctrl+Alt+→` / `Ctrl+Alt+←` |
| Switch to space 1–9 | `⌃1–9` | `Alt+1–9` |
| Go to sidebar item 1–8 (9 = last) | `⌘1–9` | `Ctrl+1–9` |
| Add split view | `⌃⇧=` | `Ctrl+Shift+=` |
| Close split view | `⌃⇧-` | `Ctrl+Shift+-` |
| Find in page / next / previous | `⌘F` / `⌘G` / `⌘⇧G` | `Ctrl+F` / `F3` / `Shift+F3` |
| History | `⌘Y` | `Ctrl+Y` |
| Downloads | `⌘⌥L` | `Ctrl+J` |
| Library | `⌘⇧L` | `Ctrl+Shift+L` |
| Developer tools | `⌘⌥I` / `F12` | `Ctrl+Shift+I` / `F12` |
| Reload / hard reload | `⌘R` / `⌘⇧R` | `Ctrl+R` or `F5` / `Ctrl+Shift+R` or `Ctrl+F5` |
| Zoom in / out / reset | `⌘=` / `⌘-` / `⌘0` | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Back / forward | `⌘[` / `⌘]` | `Alt+←` / `Alt+→` |
| Settings | `⌘,` | `Ctrl+,` |
| New folder | `⌘⌥⇧N` | `Ctrl+Alt+Shift+N` |
| Duplicate tab | `⌘⇧D` | `Ctrl+Shift+D` |
| Open in Chrome | `⌘⌥O` | `Ctrl+Alt+O` |

In a Little Arc window: `Mod+O` moves the page into the main window, `Mod+Shift+O` picks the space to move it to, `Mod+W` closes the window, `Mod+Shift+C` copies the URL, and `Mod+[` / `Mod+]` (`Alt+←` / `Alt+→` on Windows) go back and forward.

In Peek: `Esc` or `Mod+W` closes it, and `Mod+O` opens the page as a tab.

## FAQ

**Can I sign in to Google, Gmail, YouTube or Google Workspace?**
Yes. Signing in to Google websites works normally, including company SSO through Google, Microsoft Entra ID, Okta and similar. If your company only allows *managed* Google Chrome (device-trust or "compliant device" policies), that check can't be passed by any other browser. Use **Open in Chrome** for those sites.

**Can it sync my bookmarks and history through my Google account, like Chrome?**
No. Since 2021 Google has only allowed Google Chrome to use Chrome Sync, so no other browser can, whether Chromium-based or not. Use **Import from Chrome** to bring your history and bookmarks over once.

**Does it sync between my computers?**
Not yet. Each install keeps its own data. Syncing is on the [roadmap](#roadmap-and-known-limitations).

**Why Electron?**
Electron is real Chromium, so sites behave as they do in Chrome, and Chrome extensions work. It also let a small project build a fully custom interface without maintaining a fork of Chromium. The trade-off is memory use roughly on par with Chrome. Arc itself was Chromium too.

**Is it private?**
YARC has no account and no telemetry, and sends no data anywhere. Its own network requests are search suggestions (sent to the search engine you chose), Chrome Web Store update checks for installed extensions, a daily download of the ad-blocking filter lists from GitHub, and update checks for YARC itself against its GitHub releases (which you can turn off in Settings). History sync, if you turn it on, only writes encrypted files to a folder you pick; your own cloud service carries them, and YARC has no server that could see them.

**Do I need an ad-blocker extension?**
No. Blocking is built in (see [Built-in ad and tracker blocking](#built-in-ad-and-tracker-blocking)). Ad-blocker *extensions* built on Manifest V3's `declarativeNetRequest`, such as uBlock Origin Lite, install but can't block, because Electron doesn't support that API.

## Where your data lives

| | Windows | macOS |
| --- | --- | --- |
| App data | `%APPDATA%\YARC` | `~/Library/Application Support/YARC` |
| Sidebar, spaces, settings | `state.json` | `state.json` |
| Per-profile history | `Profiles/<id>/history.sqlite` | same |
| Per-profile extensions | `Profiles/<id>/Extensions` | same |
| Ad-blocking filter cache | `adblock/engine.bin` | same |
| History sync: this computer's random ID, and the key derived from your sync password | `Sync/device.json`, `Sync/key.json` (DPAPI-protected) | same (not encrypted, like the cookies and history) |
| Cookies, site storage, cache | `Partitions/profile-<id>` | same |

## Building from source

You need **Node.js 22.12+** (24 recommended), Git and **pnpm** (`corepack enable` picks up the version pinned in `package.json`).

```bash
git clone https://github.com/yenebeb/arc-shell.git
cd arc-shell
pnpm install         # also downloads the Electron binary
pnpm dev             # start with hot reload
```

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the app in development mode, with a separate `YARC (dev)` profile |
| `pnpm build` | Production build into `out/` |
| `pnpm start` | Run the production build |
| `pnpm typecheck` | TypeScript check |
| `pnpm test` | Unit tests: URL handling, shortcuts, sidebar model, Arc parser |
| `pnpm test:e2e` | Build, then drive the real app with Playwright (tabs, spaces, splits, Little Arc, persistence) |
| `pnpm dist:win` | Windows installers in `release/` |
| `pnpm dist:mac` | macOS DMGs in `release/` (run on a Mac) |
| `pnpm dist:dir` | Unpacked app for quick local testing |

### Releasing

Releases are automatic: every pull request merged into `main` becomes a release.

1. The [release workflow](.github/workflows/release.yml) tags the merge commit with the next version: a patch bump by default (`v0.1.2` → `v0.1.3`). Add the PR label `release:minor` or `release:major` for a bigger bump, or `release:skip` (or put `[skip release]` in the commit message) to not release.
2. It builds Windows, macOS and Linux from that tag and uploads them to the release.
3. Once all three builds succeed, the release is published. If one fails, the release stays a draft.

The version lives in git tags; `package.json` says `0.0.0-dev` and CI stamps the tag's version into it at build time. To release by hand, run the workflow from the Actions tab and pick the bump.

Installed copies only see published releases: Windows downloads the update via `latest.yml`, macOS downloads the `-mac.zip` and checks its `.sig`, and Linux gets a notice that links to the new `.AppImage`.

The macOS zips are signed with an Ed25519 key, and the app only installs a zip signed with the key whose public half is `UPDATE_PUBLIC_KEY` in [`src/main/update-signature.ts`](src/main/update-signature.ts). The private key is the `MAC_UPDATE_SIGNING_KEY` repository secret; without it (or with a key that doesn't match) the macOS build fails. To make a new key pair, run `node --experimental-strip-types scripts/sign-update.mts keygen <file>`, put the printed public key in `UPDATE_PUBLIC_KEY`, and the file's contents in the secret. Installed copies only accept updates signed with the key they were built with, so a new key only reaches them through one manual reinstall.

#### Electron security updates

Chromium and V8 security fixes reach YARC only through a newer Electron, so they ship without waiting for anyone:

1. [Dependabot](.github/dependabot.yml) checks npm daily and opens a PR when Electron releases a new version.
2. If that PR is a **patch** or **minor** bump, [dependabot-automerge](.github/workflows/dependabot-automerge.yml) merges it once CI passes and starts the release workflow. This goes for every Dependabot PR, not just Electron; majors wait for a person. Other packages are only proposed once a version has been out for 3 days (Dependabot's cooldown), so a hijacked release is usually pulled before it reaches YARC.
3. Installed copies find the release within the hour. Windows and macOS download it and ask to relaunch; Linux shows a notice with the download.

Details and gaps are in [docs/electron-notes.md](docs/electron-notes.md#6-security-updates-from-an-electron-release-to-users).

## How it works

```
┌───────────────────────── BrowserWindow ─────────────────────────┐
│ UI renderer (React): sidebar, window frame, split handles        │  ← bottom layer
│        ┌──────────────────── WebContentsView ───────────────────┐│
│        │ the web page (one view per open tab, per profile)       ││  ← middle
│        └────────────────────────────────────────────────────────┘│
│ Overlay view (transparent): command bar, find, panels, peek      │  ← top, only when open
└──────────────────────────────────────────────────────────────────┘
```

- The **main process** owns all state (`src/main/browser.ts`). The UI renderers get a full snapshot whenever something changes, and send back typed actions (`src/shared/actions.ts`).
- Every **profile** is an Electron session partition (`persist:profile-<id>`). Each one has its own extension host (`electron-chrome-extensions`, `electron-chrome-web-store`) and its own SQLite history (`node:sqlite`, so there are no native modules).
- Every **sidebar item** can have a live `WebContentsView`. Pages load lazily and unload when closed or archived, which keeps memory down.
- **Shortcuts** are caught in `before-input-event` on every web contents and matched on physical key codes, so they work regardless of keyboard layout or which page has focus.

| Path | Contents |
| --- | --- |
| `src/main/browser.ts` | Controller: spaces, tabs, splits, archive, shortcuts, actions |
| `src/main/window.ts` | Window layout and the overlay |
| `src/main/tab.ts` | A live page attached to a sidebar item |
| `src/main/profiles.ts` | Sessions, permissions, downloads |
| `src/main/extensions.ts` | Chrome extension APIs and the Web Store, per profile |
| `src/main/adblock.ts` | Built-in ad and tracker blocking for every profile |
| `src/main/little.ts` | Little Arc windows |
| `src/main/peek.ts` | Peek: pages from pinned tabs and favorites floating over the current tab |
| `src/main/importers/` | Arc, Zen and Chromium importers |
| `src/main/sync/` | Encrypted history sync through a cloud folder (`docs/history-sync.md`) |
| `src/shared/` | State types, actions, keymap, URL helpers (unit tested) |
| `src/renderer/` | React UI: `index` (sidebar), `overlay` (command bar and panels), `little` |
| `docs/` | Research notes: Arc's behavior and shortcuts, Arc's data format, Electron notes, history sync |

## Roadmap and known limitations

Already done: everything in [Features](#features).

Planned or open for contributions:

- [ ] Peek (a preview window for links from pinned tabs)
- [ ] Boosts (custom CSS/JS per site)
- [ ] Multiple main windows
- [x] History sync between your own computers, through a folder you already sync
- [ ] Syncing more than history (spaces, pinned tabs, favorites)
- [ ] Notes / Easels
- [ ] Code signing and notarization, to remove the install warnings (and keep macOS camera, microphone and screen permissions across updates)

## Contributing

Issues and pull requests are welcome. If you're an Arc user and something doesn't behave the way Arc did, please open an issue describing what Arc did. [docs/arc-reference.md](docs/arc-reference.md) collects what we know about Arc's behavior, and is worth correcting too.

Before opening a PR, run `pnpm typecheck && pnpm test && pnpm test:e2e`. `main` only accepts pull requests whose CI (`check`) passes, and release tags (`v*`) can't be moved or deleted.

## License

[GPL-3.0-or-later](LICENSE). YARC is an independent project and is not affiliated with The Browser Company. "Arc" is a trademark of its respective owner.
