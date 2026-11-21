# YARC — notes for Claude sessions

Open-source Arc-browser replacement (Electron 45 / Chromium 156, React 19, TypeScript 7, electron-vite 6). Arc shuts down 2026-12-22; the goal is a browser that feels familiar to Arc users, with **macOS as the main platform** (most Arc users), Windows second.

## Commands

- `pnpm install` (postinstall downloads the Electron binary) · `pnpm dev` · `pnpm build`
- `pnpm typecheck` · `pnpm test` (unit, `node --test`) · `pnpm test:e2e` (builds, then Playwright drives the real app)
- Icons: edit `build/icon.svg` (and `icon-small.svg` for 16–32px), then `pnpm exec electron scripts/render-icons.mjs` and commit the PNG/ICO it writes.
- `pnpm dist:mac` / `dist:win` → installers in `release/`. Releases are automatic: each merge to `main` gets the next semver tag (patch; PR labels `release:minor` / `release:major` / `release:skip`; no release when the merge only touches `.github/`, `docs/`, `test/` or top-level Markdown), CI builds it and publishes once all platforms pass. The version comes from the tag (`package.json` is `0.0.0-dev`).
- Every PR description needs a `## What's New` section (`.github/pull_request_template.md`, checked by `whats-new.yml`): one line per change in words for users, or `none` for what they won't notice (CI, tests, docs, refactors, logging). That's what What's New and the update card show (`scripts/changelog.mjs`); the title is only for GitHub. No "like Arc" in it. A big feature also gets a spotlight card in What's New, shown once per profile: an entry in `src/shared/spotlights.ts` and its picture in `src/renderer/src/panels/spotlight-pictures.tsx`, in the feature's own PR.

## Architecture (see README "How it works")

- Main process owns all state: `src/main/browser.ts` (controller), persisted in `state.json` via `src/main/store.ts`. Renderers get full snapshots and send typed `Action`s (`src/shared/actions.ts`).
- Window = UI webContents (sidebar) under per-tab `WebContentsView`s, plus a transparent overlay view on top for the command bar/panels (`src/main/window.ts`).
- Several main windows (⌘N) share one `Browser` and its state. Per window (`WindowView` in `state.windows`, restored at launch): space, selected tab per space, splits, sidebar visibility, bounds. The state's `activeSpaceId`/`activeItemId`/`splits`/`sidebarVisible` are always the *current* window's; `use(win)` swaps them (`src/main/window-state.ts`). A tab's view sits in one window; another window selecting it shows a still. Design: `docs/multi-window.md`.
- One session partition per profile (`persist:profile-<id>`): extensions (`extensions.ts`), ad blocking (`adblock.ts`), history (`history.ts`, `node:sqlite`). Spaces map to profiles; favorites belong to profiles.
- Incognito windows (⇧⌘N, Dock, File menu, link context menu) are a second `Browser` per window, constructed with `main`: in-memory `Store` and `History`, non-persistent `incognito-<id>` partitions, no extensions, the main ad blocker and updater; disposed when the window closes. IPC is registered once and routed to the controller that owns `e.sender`.
- YARC's own pages are served from `yarc://ui/` (`src/main/ui-origin.ts`), sandboxed, and can't navigate away. The preload only exposes `window.arc` on that origin, and every UI IPC handler (`handleUi`) refuses other senders. Never load a web page into a UI view or give one the `ui.js` preload.
- Shortcuts are matched in `before-input-event` on every webContents (`src/shared/keymap.ts`, physical key codes). Playwright's synthetic keys bypass this — e2e tests use `wc.sendInputEvent`.
- Research notes in `docs/`: Arc behavior & shortcuts (`arc-reference.md`), Arc's `StorableSidebar.json` format (`arc-data-format.md`), Electron/Google sign-in/packaging gotchas (`electron-notes.md`).

## Code rules

- Fewest lines that stay readable. No comments except a one-line *why* no name can carry (an Electron/Chromium/OS workaround, a security or ordering reason); otherwise extract a function or rename.
- Keep the main process cheap: high-frequency sources (blocked requests, download progress) use `emitSlowly()`, not `emitSoon()`; data only a panel shows (archive, site permissions) reaches the overlay only while that panel is open (`withPanelData`); UI webContents are created on first use, and a child view's webContents is closed with its window (Electron doesn't).
- Several files are CRLF: edit them in place (Edit tool, `perl -pi`), never rewrite them through a text-mode script.
- Unit tests run under `node --experimental-strip-types`: no parameter properties, enums or namespaces in anything they import.
- e2e tests reach `Browser` untyped (`globalThis.arcBrowser`), so after renaming a member grep `test/`. Wait for the page's DOM to show a change before measuring it; main's state alone races.

## Decisions already made (don't re-litigate)

- Renamed from Arc Shell to YARC on 2026-11-02. Kept on purpose: the `appId` `org.arcshell.browser`, the Windows registry keys and ProgIDs (`ArcShell*`), and an existing `Arc Shell` profile folder (`src/main/profile-dir.ts`). Cookies aren't encrypted (Electron's cookie-encryption fuse is off), so no Keychain key is tied to the old name. The repo moved from `yenebeb/arc-shell` to `yenebeb/yarc` the same day; GitHub redirects the old name (older installed apps poll it for updates), so never create a new repo called `arc-shell` on that account.
- Google sign-in needs Electron's own UA (only the app-name token stripped); a spoofed Chrome UA is rejected. Chrome Sync is impossible for non-Chrome browsers → import instead.
- Built-in ad blocking (Ghostery engine) because Electron has no `declarativeNetRequest`. Uses a custom adapter, not `enableBlockingInSession` (global IPC handlers break with multiple sessions).
- No Apple Developer ID: macOS releases are signed with one self-signed certificate from CI (`MAC_CODESIGN_P12` / `MAC_CODESIGN_P12_PASSWORD` secrets, `scripts/mac-sign.mjs`), so camera/microphone permissions survive updates; ad-hoc (`identity: "-"`) without the secret. Not notarized, so Gatekeeper still needs *Open Anyway*. Never replace the certificate: every Mac would be asked for permissions again (`docs/electron-notes.md` section 9).
- Cookie encryption (Electron's `EnableCookieEncryption` fuse, `scripts/after-pack.mjs`) is on for Windows and Linux only. On macOS, without an Apple team ID, the keychain partition is the cdhash, so every update would ask for the login password; a self-signed certificate doesn't change that (tested, `docs/electron-notes.md` section 8). Once the fuse is on for macOS, never change the app name there: the "<name> Safe Storage" item would change and every cookie would be lost. Windows (DPAPI) is not yet tested on a real machine.
- Hardening (2026-11-19 audit): Electron fuses `RunAsNode`, `NodeOptions`, `NodeCliInspect` and `GrantFileProtocolExtraPrivileges` are off on every platform; app.asar integrity is checked on macOS (`scripts/after-pack.mjs`). macOS builds use the hardened runtime with `build/entitlements.mac.plist`. A packaged build exits on `--remote-debugging-port/pipe`. The Ed25519 update key is only used in release.yml's `sign` job (no dependencies installed, `release-signing` environment); jobs that run dependency code get a read-only token.
- Repository rulesets, with no bypass for anyone: `main` changes only through a PR whose `check` CI job passed (no approval needed, no force-push or deletion), with linear history and verified signatures, so PRs are squash-merged (the only merge method the repo allows) and every commit in a PR must be signed: this repo's git config signs with SSH (`commit.gpgsign`, key `~/.ssh/id_ed25519`, registered on GitHub as a signing key); `v*` tags can be created (the release workflow does) but never moved or deleted. A failed release leaves its tag: fix forward with the next merge.

## Status / next steps

Windows: unit + e2e + installed. macOS (2026-11-01, Apple silicon): unit + e2e pass, `dist:mac --dir` packages and launches. Checked on macOS by driving the app through `YARC_TEST` (no real keyboard/trackpad/screen capture available to the agent):

- Import from Arc with real data: spaces in Arc's order, profile names, favorites, pinned tabs and folders, archive and history all import. Arc's named space icons (`customInfo.iconType.icon`, Ionicons names) are mapped to emoji. Gaps: untitled spaces become "Space N"; spaces without a theme get palette colors.
- Shortcuts from a focused page `<input>` via `sendInputEvent`: Cmd+L/D/S/W/, , Ctrl+2, Ctrl+Tab with Ctrl keyup. Cmd+W never closes the window (the Window menu role has no Close item on macOS).
- Traffic lights: hidden with the sidebar, shown during hover-reveal and back after; no gap in native fullscreen. Links from other apps open a Little Window.

Still needs a human on a Mac:

1. Traffic lights' visual alignment with the top bar; window dragging from the sidebar and from the drag strip when the sidebar is hidden.
2. Two-finger horizontal swipe on the sidebar (direction and sensitivity like Arc).
3. Real keystrokes through the native menu: Cmd+C/V/X/A/Z in pages and the command bar, Cmd+Q, Arc shortcuts not also firing a menu item.
4. Default browser from the installed app; `.html` via `open-file`.
5. Gatekeeper first launch of the DMG from the release; README instructions accurate.
6. Visual polish on macOS still to look at: dark-appearance spaces, hover/active states, split view, Little Window, Peek's look (card size, buttons, backdrop).

Screen captures: with Screen Recording and Accessibility granted to the Claude Code `claude.app` (not Claude.app), `screencapture -R` and System Events work. YARC's own look is designed here, not copied: don't measure or trace another app's UI, binary or files beyond what a user's own data export needs (the importers).

Updates (`src/main/updater.ts`): Windows auto-updates with electron-updater (NSIS, unsigned is fine) from the GitHub release's `latest.yml`, and only installs an installer whose Ed25519 `.sig` matches `UPDATE_PUBLIC_KEY` (`verifyInstaller` in `src/main/update-signature.ts`; electron-updater installs on quit only once that check passes). macOS updates itself without a Developer ID (Squirrel.Mac refuses ad-hoc signatures, so not electron-updater): `src/main/mac-update.ts` polls `releases/latest`, downloads the arch's `-mac.zip` with Node's fetch (no quarantine flag), checks its Ed25519 `.sig` against `UPDATE_PUBLIC_KEY` (`src/main/update-signature.ts`; CI signs with the `MAC_UPDATE_SIGNING_KEY` secret), unzips into the profile's `Update/` folder and swaps the bundle at quit. Tested on macOS 26.5 from a local feed (2026-11-02): no Keychain or App Management prompt; camera/microphone grants survive updates only with the self-signed certificate (`docs/electron-notes.md` sections 8 and 9). If the app's folder isn't writable it falls back to opening the DMG. Linux is notify-only. A downloaded update is quiet, like Arc's: a *Restart to Update* pill in the sidebar and install on quit; the relaunch card (an overlay listing every version since the running one) only opens by itself after 7 days without a restart, then at most daily, or after 1 day when the release's `release.json` names a different Electron than `process.versions.electron` (`src/main/update-escalation.ts`; the wait is kept in `state.json` as `waitingUpdate`). Packaged builds only; not yet tried end to end against a real published release.

Releases: v0.1.2 is the latest manual release; from then on every merge to `main` releases automatically (see Commands). Dependabot patch/minor bumps auto-merge; only Electron's are released at once, the others are labeled `release:skip` and ship with the next real change (`.github/workflows/dependabot-automerge.yml`).
