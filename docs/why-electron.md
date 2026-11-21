# Why Electron

YARC is built on [Electron](https://www.electronjs.org/): Chromium plus Node.js, the same engine as Chrome with an app around it. Electron apps have a reputation for eating memory, so this page explains the choice and shows what we measured.

## What it gives a one-person browser

- **Real Chromium.** Electron 45 is Chromium 156. Sites behave as in Chrome, and Google sign-in works, company SSO included.
- **Chrome Web Store extensions**, installed per profile (`electron-chrome-extensions`, `electron-chrome-web-store`).
- **Security fixes without a fork.** Almost every browser zero-day is in Chromium or V8. Electron ships Chromium's security fixes as patch releases, usually within a day or two of Chrome. YARC merges and releases them automatically, a day after Electron publishes them ([how](electron-notes.md#6-security-updates-from-an-electron-release-to-users)). A Chromium fork would mean rebasing on every Chrome release, with builds that take hours, which isn't realistic for one person.
- **macOS, Windows and Linux from one codebase**, with the interface in React.

## What it costs

- **No Netflix, Disney+ or Spotify web.** Stock Electron has no Widevine module, and adding one needs a licence from Google and a different Electron build.
- **Manifest V3 ad blockers can't block.** Electron has no `declarativeNetRequest`, so uBlock Origin Lite installs but does nothing. YARC blocks ads and trackers itself instead. Manifest V2 extensions aren't supported either.
- **No Chrome Sync.** Google only lets Chrome use it, so YARC imports from Chrome instead.
- **New Chromium features arrive a little later.** Electron takes a new Chromium major every 8 weeks; on 2026-11-21 Electron 45 ran Chromium 156 while Chrome was on 158. Security fixes don't wait for that.

## Memory, measured

Measured on 2026-11-21 on Windows 11: the private working set of every process, summed, with ad blocking off and the same 8 real pages in each browser. "Bare Electron" is a minimal Electron app that shows the pages in `WebContentsView`s with no YARC code, to separate the engine from YARC.

| | 8 pages | No tabs |
| --- | ---: | ---: |
| Chrome 158 | 746 MB | 122 MB |
| Bare Electron 45 | 734 MB | 63 MB |
| YARC | 844 MB | 123 MB |

Electron's engine costs what Chrome's does. YARC's own code adds about 110 MB, roughly one more open page:

| Where YARC's extra memory goes | |
| --- | ---: |
| Sidebar and overlay (command bar, panels) | ~40–50 MB |
| Main process, over bare Electron (of which the ad-block engine ~17 MB) | ~40 MB |
| Preload scripts in pages | ~15–20 MB |

The ad blocker used to parse its filter lists in the main process on first launch and on each daily update, briefly adding about 150 MB. It now does that in a separate process that exits when it's done: on a fresh profile the main process's JavaScript heap went from 98 to 18 MB, and the no-tabs figure from 143 to the 123 MB above. The 8-page figure was measured before that change.

### Measuring it yourself

Watch for these. Each one faked a gap while we measured:

- **Drive the browsers over the DevTools protocol and disconnect before measuring.** While Playwright is connected, every tab reports itself visible, so background tabs aren't trimmed.
- **Check every page's title.** Reddit served Chrome-with-remote-debugging a "Prove your humanity" page, which made Electron look 100 MB worse.
- **Keep the windows uncovered.** Chromium trims windows hidden behind others, so overlapping windows change the numbers.
