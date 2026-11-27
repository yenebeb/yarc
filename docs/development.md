# Developing YARC

How to build YARC, how releases and updates work, and how the code is laid out. For using YARC, see the [README](../README.md).

## Building from source

You need **Node.js 22.12+** (24 recommended), Git and **pnpm** (`corepack enable` picks up the version pinned in `package.json`).

```bash
git clone https://github.com/yenebeb/yarc.git
cd yarc
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
| `pnpm test:e2e` | Build, then drive the real app with Playwright (tabs, spaces, splits, Little Window, persistence): one spec file per area in `test/e2e/`, each with its own app and profile (`useApp()` in `test/e2e/app.ts`) |
| `pnpm dist:win` | Windows installers in `release/` |
| `pnpm dist:mac` | macOS DMGs in `release/` (run on a Mac) |
| `pnpm dist:dir` | Unpacked app for quick local testing |

## Releasing

Releases are automatic, once a day: at 04:17 UTC, `main` is released if anything merged since the last release changes the app, so users get at most one update a day. Label a PR `release:now` to release it as soon as it merges (an urgent fix); Electron bumps are released at once too (below).

1. The [release workflow](../.github/workflows/release.yml) tags `main`'s newest commit with the next version: the biggest bump the unreleased PRs ask for, a patch by default (`v0.1.2` → `v0.1.3`), or a minor or major with the PR label `release:minor` or `release:major`. A PR labeled `release:skip` (or with `[skip release]` in its commit message), or one that only changes workflows, docs, tests or top-level Markdown, doesn't count towards a release and ships with the next one.
2. It builds Windows, macOS and Linux from that tag and uploads them to the release, with a `release.json` that names the Electron version, so installed copies can tell a security update from a normal one.
3. Once all three builds succeed, the release is published. If one fails, the release stays a draft.

So a release can't break unnoticed after a merge, every pull request runs the same workflow as a dry run: the three builds, tests and packaging, without a tag, a draft, the signing secrets or an upload. CI's required `check` job also lints every workflow file with [actionlint](https://github.com/rhysd/actionlint), because GitHub only reads a workflow file when it runs.

Each PR's `## What's New` section is also the app's **What's New**: before the builds, [`scripts/changelog.mjs`](../scripts/changelog.mjs) collects those lines from the PRs merged for each release tag into `build/changelog.json`, which the build bakes into the app, so it shows offline. Dependabot PRs, PRs labeled `release:skip` and `none` lines are left out. Local builds have an empty changelog; run `node scripts/changelog.mjs` (needs `gh`) to build one.

The version lives in git tags; `package.json` says `0.0.0-dev` and CI stamps the tag's version into it at build time. To release by hand, run the workflow from the Actions tab: `auto` takes the bump from the unreleased PRs (and releases nothing if none counts), or pick one.

Installed copies only see published releases: Windows downloads the update via `latest.yml` and checks the installer's `.sig`, macOS downloads the `-mac.zip` and checks its `.sig`, and Linux gets a notice that links to the new `.AppImage`.

The macOS zips and the Windows installers are signed with an Ed25519 key, and the app only installs an update signed with the key whose public half is `UPDATE_PUBLIC_KEY` in [`src/main/update-signature.ts`](../src/main/update-signature.ts). The private key is the `MAC_UPDATE_SIGNING_KEY` repository secret (named before Windows used it too); without it (or with a key that doesn't match) the macOS and Windows builds fail. To make a new key pair, run `node --experimental-strip-types scripts/sign-update.mts keygen <file>`, put the printed public key in `UPDATE_PUBLIC_KEY`, and the file's contents in the secret. Installed copies only accept updates signed with the key they were built with, so a new key only reaches them through one manual reinstall.

### Electron security updates

Chromium and V8 security fixes reach YARC only through a newer Electron, so they ship without waiting for anyone:

1. [Dependabot](../.github/dependabot.yml) checks npm daily and opens a PR once a new Electron version has been out for a day.
2. If that PR is a **patch** or **minor** bump, [dependabot-automerge](../.github/workflows/dependabot-automerge.yml) labels it `release:now`, merges it once CI passes and starts the release workflow. Other Dependabot patch and minor bumps merge the same way but get the `release:skip` label and no release of their own: they ship with the next real change, so users aren't asked to update for a dev dependency. Majors wait for a person. Every package, Electron included, is only proposed once a version has been out for a day (Dependabot's cooldown), so a hijacked release is usually pulled before it reaches YARC.
3. Installed copies find the release within the hour. Windows and macOS download it and show *Restart to Update* in the sidebar; because the release's Electron differs from the running one, they ask with the relaunch card if there's no restart within a day. Linux shows *Update Available* with the download.

Details and gaps are in [docs/electron-notes.md](electron-notes.md#6-security-updates-from-an-electron-release-to-users).

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
- **Several windows** share that state; each has its own space, selected tabs, splits and sidebar visibility (`src/main/window-state.ts`, see `docs/multi-window.md`). A page lives in one window at a time.
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
| `src/main/little.ts` | Little Windows |
| `src/main/peek.ts` | Peek: pages from pinned tabs and favorites floating over the current tab |
| `src/main/canvas.ts`, `canvas-store.ts` | Canvases: their pages, capture, and their files in the profile folder (`docs/canvas.md`) |
| `src/main/importers/` | Arc, Zen and Chromium importers |
| `src/main/sync/` | Encrypted history sync through a cloud drive, your own server or a synced folder (`docs/history-sync.md`) |
| `src/shared/` | State types, actions, keymap, URL helpers (unit tested) |
| `src/renderer/` | React UI: `index` (sidebar), `overlay` (command bar and panels), `little`, `canvas` (a canvas: a board YARC draws itself) |
| `docs/` | Research notes: Arc's behavior and shortcuts, Arc's data format, Electron notes |

## Contributing

Before opening a PR, run `pnpm typecheck && pnpm test && pnpm test:e2e`. `main` only accepts pull requests whose CI passes (`check`, and `e2e` on Ubuntu, Windows and macOS), and every PR needs a `## What's New` section. [arc-reference.md](arc-reference.md) collects what we know about Arc's behavior; corrections are welcome.

## README pictures

The GIFs and screenshots in `docs/screenshots` are recorded from the real app, on demo pages in [`scripts/readme-media/site`](../scripts/readme-media/site) served under invented `.test` domains. On a Mac, with Pillow installed (`pip3 install pillow`):

```bash
pnpm build
node scripts/readme-media/record.mjs          # or name some: spaces command split peek canvases hero little floating
python3 scripts/readme-media/make.py
```

Leave the window alone while it records: macOS stops redrawing a covered window.
