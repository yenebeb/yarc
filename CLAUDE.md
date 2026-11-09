# YARC — notes for Claude sessions

Open-source Arc-browser replacement (Electron 45 / Chromium 156, React 19, TypeScript 7, electron-vite 6). Arc shuts down 2026-12-22; the goal is to match Arc's behavior as closely as possible, with **macOS as the main platform** (most Arc users), Windows second.

## Commands

- `pnpm install` (postinstall downloads the Electron binary) · `pnpm dev` · `pnpm build`
- `pnpm typecheck` · `pnpm test` (unit, `node --test`) · `pnpm test:e2e` (builds, then Playwright drives the real app)
- Icons: edit `build/icon.svg` (and `icon-small.svg` for 16–32px), then `pnpm exec electron scripts/render-icons.mjs` and commit the PNG/ICO it writes.
- `pnpm dist:mac` / `dist:win` → installers in `release/`. Releases are automatic: each merge to `main` gets the next semver tag (patch; PR labels `release:minor` / `release:major` / `release:skip`), CI builds it and publishes once all platforms pass. The version comes from the tag (`package.json` is `0.0.0-dev`).

## Architecture (see README "How it works")

- Main process owns all state: `src/main/browser.ts` (controller), persisted in `state.json` via `src/main/store.ts`. Renderers get full snapshots and send typed `Action`s (`src/shared/actions.ts`).
- Window = UI webContents (sidebar) under per-tab `WebContentsView`s, plus a transparent overlay view on top for the command bar/panels (`src/main/window.ts`).
- One session partition per profile (`persist:profile-<id>`): extensions (`extensions.ts`), ad blocking (`adblock.ts`), history (`history.ts`, `node:sqlite`). Spaces map to profiles; favorites belong to profiles.
- Incognito windows (⇧⌘N, Dock, File menu, link context menu) are a second `Browser` per window, constructed with `main`: in-memory `Store` and `History`, non-persistent `incognito-<id>` partitions, no extensions, the main ad blocker and updater; disposed when the window closes. IPC is registered once and routed to the controller that owns `e.sender`.
- History sync (`src/main/sync/`, `docs/history-sync.md`): encrypted per-device logs in a folder the user already syncs (iCloud Drive, Dropbox, OneDrive); no server. Only the main controller has a `HistorySync`, so incognito never syncs. The derived key uses `safeStorage` on Windows/Linux but not macOS (keychain prompt per update).
- Shortcuts are matched in `before-input-event` on every webContents (`src/shared/keymap.ts`, physical key codes). Playwright's synthetic keys bypass this — e2e tests use `wc.sendInputEvent`.
- Research notes in `docs/`: Arc behavior & shortcuts (`arc-reference.md`), Arc's `StorableSidebar.json` format (`arc-data-format.md`), Electron/Google sign-in/packaging gotchas (`electron-notes.md`).

## Decisions already made (don't re-litigate)

- Renamed from Arc Shell to YARC (Yet Another Arc Clone) on 2026-11-02. Kept on purpose: the `appId` `org.arcshell.browser`, the Windows registry keys and ProgIDs (`ArcShell*`), the GitHub repo name, and an existing `Arc Shell` profile folder (`src/main/profile-dir.ts`). Cookies aren't encrypted (Electron's cookie-encryption fuse is off), so no Keychain key is tied to the old name.
- Google sign-in needs Electron's own UA (only the app-name token stripped); a spoofed Chrome UA is rejected. Chrome Sync is impossible for non-Chrome browsers → import instead.
- Built-in ad blocking (Ghostery engine) because Electron has no `declarativeNetRequest`. Uses a custom adapter, not `enableBlockingInSession` (global IPC handlers break with multiple sessions).
- No Apple Developer ID: macOS releases are signed with one self-signed certificate from CI (`MAC_CODESIGN_P12` / `MAC_CODESIGN_P12_PASSWORD` secrets, `scripts/mac-sign.mjs`), so camera/microphone permissions survive updates; ad-hoc (`identity: "-"`) without the secret. Not notarized, so Gatekeeper still needs *Open Anyway*. Never replace the certificate: every Mac would be asked for permissions again (`docs/electron-notes.md` section 9).
- Cookie encryption (Electron's `EnableCookieEncryption` fuse, `scripts/after-pack.mjs`) is on for Windows and Linux only. On macOS, without an Apple team ID, the keychain partition is the cdhash, so every update would ask for the login password; a self-signed certificate doesn't change that (tested, `docs/electron-notes.md` section 8). Once the fuse is on for macOS, never change the app name there: the "<name> Safe Storage" item would change and every cookie would be lost. Windows (DPAPI) is not yet tested on a real machine.
- Repository rulesets, with no bypass for anyone: `main` changes only through a PR whose `check` CI job passed (no approval needed, no force-push or deletion); `v*` tags can be created (the release workflow does) but never moved or deleted. A failed release leaves its tag: fix forward with the next merge.

## Status / next steps

Windows: unit + e2e + installed. macOS (2026-11-01, Apple silicon): unit + e2e pass, `dist:mac --dir` packages and launches. Checked on macOS by driving the app through `YARC_TEST` (no real keyboard/trackpad/screen capture available to the agent):

- Import from Arc with real data: spaces in Arc's order, profile names, favorites, pinned tabs and folders, archive and history all import. Arc's named space icons (`customInfo.iconType.icon`, Ionicons names) are mapped to emoji. Gaps: untitled spaces become "Space N"; spaces without a theme get palette colors.
- Shortcuts from a focused page `<input>` via `sendInputEvent`: Cmd+L/D/S/W/, , Ctrl+2, Ctrl+Tab with Ctrl keyup. Cmd+W never closes the window (the Window menu role has no Close item on macOS).
- Traffic lights: hidden with the sidebar, shown during hover-peek and back after; no gap in native fullscreen. Links from other apps open Little Arc.
- Fixed: the closed main window (app keeps running on macOS) crashed menu-bar commands, the overlay blur handler, toasts, Little Arc's "Open in YARC" and external links.

Still needs a human on a Mac:

1. Traffic lights' visual alignment with the top bar; window dragging from the sidebar and from the drag strip when the sidebar is hidden.
2. Two-finger horizontal swipe on the sidebar (direction and sensitivity like Arc).
3. Real keystrokes through the native menu: Cmd+C/V/X/A/Z in pages and the command bar, Cmd+Q, Arc shortcuts not also firing a menu item.
4. Default browser from the installed app; `.html` via `open-file`.
5. Gatekeeper first launch of the DMG from the release; README instructions accurate.
6. Visual polish vs. Arc on macOS: matched side by side with Arc (2026-11-01): vibrancy + grain, per-space light/dark appearance, sidebar metrics, Arc favicons, ⌘T command bar (position, colors, inline completion). Still to compare: dark-appearance spaces, hover/active states, split view, Little Arc, Peek's look (card size, buttons, backdrop).

Comparing with real Arc: with Screen Recording and Accessibility granted to the Claude Code `claude.app` (not Claude.app), `screencapture -R` and System Events work. Arc's menu bar (via System Events, `AXMenuItemCmdChar`/`AXMenuItemCmdModifiers`) is the source for its default shortcuts; they aren't stored in any file.

Updates (`src/main/updater.ts`): Windows auto-updates with electron-updater (NSIS, unsigned is fine) from the GitHub release's `latest.yml`. macOS updates itself without a Developer ID (Squirrel.Mac refuses ad-hoc signatures, so not electron-updater): `src/main/mac-update.ts` polls `releases/latest`, downloads the arch's `-mac.zip` with Node's fetch (no quarantine flag), checks its Ed25519 `.sig` against `UPDATE_PUBLIC_KEY` (`src/main/update-signature.ts`; CI signs with the `MAC_UPDATE_SIGNING_KEY` secret), unzips into the profile's `Update/` folder and swaps the bundle at quit. Tested on macOS 26.5 with packaged test builds served from a local feed (2026-11-02): no Keychain prompt (cookies aren't encrypted on macOS, so there is no Safe Storage item), no App Management prompt; camera/microphone grants survive updates when the release is signed with the self-signed certificate, and reset with ad-hoc signing (TCC matches the designated requirement; tested with the microphone: `docs/electron-notes.md` sections 8 and 9). If the app's folder isn't writable it falls back to opening the DMG. Linux is notify-only. Packaged builds only; not yet tried end to end against a real published release.

Releases: v0.1.2 is the latest manual release; from then on every merge to `main` releases automatically (see Commands).
