# What's New as a canvas (first version built)

**Decided 2026-11-26, after seeing a generated board (a wall of notes):** a board is made by hand, one per big feature, and changes without one stay a list. Sections 1, 3 and 4 below describe the generated board and are kept for the reasoning; what's built is this:
- **A board per big feature** (`src/main/boards/<spotlight id>.json`, listed in `src/main/whats-new-boards.ts`): a saved canvas scene, shipped in the feature's PR next to its spotlight. `canvas-notes` has the first one. A card whose file id is `releases-still` shows GitHub's releases page and can be played (`src/main/whats-new-releases.png`, its geometry in the board's JSON); an image whose file id is `spotlight-<id>` is drawn from that spotlight's React scene.
- **Nothing opens by itself** (decided 2026-11-26: being taken to a page on an update feels forced; the user always chooses). After an update a quiet **What's New** pill sits in the sidebar, where *Restart to Update* sits; its x hides it until the next update. The pill, like the What's New menu item, opens the What's New card, and there a spotlight that has a board gets a **Try It on a Canvas** button (`openBoard`). Closing the card is the end of it until the user chooses What's New from the menu. Section 2 below, with its board that opens by itself, is superseded by this.
- **The board is a real canvas marked `temporary`** (`PinnedCanvas`), a row among the pinned items. Closing it (⌘W) deletes it, the next launch deletes one that was left, and **Keep This Canvas** in its menu clears the mark.
- A build that isn't a release shows the newest version of the changelog it was built with (`node scripts/changelog.mjs` writes one).

Tried in the built app through `YARC_TEST` on a scratch profile (the board is drawn and its row selected); not with a real mouse, and ▶ on the releases card wasn't pressed.

**Not built yet:** buttons for a spotlight's actions, a checklist that ticks itself, unit and e2e tests. `startupScreen` in `src/main/changelog.ts` is now only used by its tests.

## Making a board

Boards are written by an AI session, as JSON, and checked by looking at them (decided 2026-11-26: nobody designs them by hand in the app). `canvas-notes.json` and `live-folders.json` are the examples.

1. **Decide whether the feature has a board in it.** It needs something to show (a diagram of how it works) or to try (the board is the feature). A feature that is only a statement ("YARC collects nothing") keeps its spotlight card and gets no board.
2. **One idea per board.** `canvas-notes` is the feature itself: notes to tick, edit and drag. `live-folders` is a diagram: sources, arrows, the sidebar they fill. Don't repeat the spotlight's text as a wall of notes; that is what the generated board was.
3. **Write `src/main/boards/<spotlight id>.json`** (`CanvasScene`, `src/shared/canvas.ts`) and add it to `BOARDS` in `src/main/whats-new-boards.ts`. What a board can hold:
   - texts and notes (`card: true`), with `- `, `[ ] `, `# ` at the start of a line (so a plain text can't start with those), links, and a `source` footer for a quote;
   - rectangles, ellipses, arrows and drawings, for zones, flow and emphasis;
   - the feature's own picture: an image with file id `spotlight-<id>`;
   - one card of GitHub's releases page that can be played: a capture with file id `releases-still` and the `source` and `capture` the examples have. Give it a reason to be on the board.
4. **Look at it:** `pnpm build`, then `node scripts/board-preview.mjs <spotlight id> --save-sizes`. It draws the board in the real app, prints where the picture is, says which items weren't drawn, and writes each text's drawn size into the JSON (a text's size is only known once it's drawn). Open the picture. Fix what's off and run it again until nothing overlaps and its outline is one tidy block: a board has no `view`, so it opens scaled to the window and centred, and a ragged outline shows as empty corners.
5. **`pnpm test`** (`test/unit/whats-new-boards.test.ts`): every item can be drawn, texts, cards and pictures don't overlap, the board fits one screen, its pictures exist.
6. **Put the picture in the PR**, so the maintainer judges a picture, not JSON.

Today a new version shows What's New as a small overlay card at startup (`WhatsNew` in `src/renderer/src/panels/Intro.tsx`): spotlight cards, then a plain list of changes. This design replaces that overlay with a canvas: a board YARC builds from the changelog, with the changes as notes, a picture per big feature and one capture the user can play. The board is the demo: whoever reads the release notes has dragged a note, ticked a checkbox and played a live capture before reading a word of instructions.

Two constraints shape it:
- **Releases are daily**, so nothing may open, load or pile up once per release.
- **No page of our own to host.** Everything on the board ships inside the app, except the one live capture, which plays a page GitHub already hosts.

## 1. What the user sees

A tab-like row "What's New" under today's tabs, showing a board:

```
  What's new in YARC                                     Try this board
  Since 0.4.2 · 6 updates                                ┌───────────────────────┐
                                                         │ [ ] Drag this note    │
  ┌──────────────────┐  ┌────────────────────┐           │ [ ] Press N, click,   │
  │                  │  │ # Take notes on a  │           │     write your own    │
  │  (picture of the │  │   canvas           │           │ [ ] ⌘⇧2 on any page   │
  │   big feature)   │  │ Press N on a canvas│           └───────────────────────┘
  │                  │  │ and click for a …  │                 ↘ (drawn arrow)
  └──────────────────┘  │ [ New Canvas ]     │           ┌───────────────────────┐
                        └────────────────────┘           │ YARC releases on      │
  ┌────────────────┐ ┌────────────────┐ ┌─────────────┐  │ GitHub (still)        │
  │ # 0.4.8        │ │ # 0.4.7        │ │ # Earlier   │  │                       │
  │ - Folders …    │ │ - Peek keeps … │ │ - …         │  │ ▶  github.com         │
  │ - Fixed …      │ │ Thanks @name   │ │ - …         │  └───────────────────────┘
  └────────────────┘ └────────────────┘ └─────────────┘   "This is the real page. Press ▶"
```

- **Big features** (the spotlights in `src/shared/spotlights.ts` the user hasn't seen): a picture and a note with the spotlight's title and text, and its actions as buttons under the note.
- **Changes**: one note per version, newest first, with the `## What's New` lines as a list and the thanks under it. From the fourth version on they share one "Earlier" note, so the board keeps the same size however many releases the user skipped.
- **Try this board**: a note with three checkboxes, a drawn arrow and one capture card that plays. Every item kind the canvas has is on the board once, so it shows the feature without a tour.
- It behaves like any canvas: pan, zoom, drag, tick, play. Changes last until the row is closed. **Keep a Copy** (the canvas menu) saves it as a real canvas, pinned in the space.
- ⌘W closes the row. It isn't restored at launch and never reaches the archive.

Nothing on it is written per release by hand. A PR's `## What's New` lines and, for a big feature, its spotlight entry are the only inputs, as today.

## 2. Not bothering people

The current rule opens the overlay at every launch on a newer version that has changes for users, which with daily releases can be daily. New rules:

| What the new version has | What happens at launch |
|---|---|
| Only changes users won't notice | Nothing. |
| Changes for users, no big feature | A quiet **What's New** pill in the sidebar, where *Restart to Update* sits (that one wins when both apply). Click opens the board; it can be hidden. |
| A big feature (an unseen spotlight) | The board opens by itself, once, as the selected row. |

And for all of them:

- **Never mid-session.** Only at the launch after an update; an update is installed on quit, so that's a moment the user chose.
- **The board opens by itself at most once a day** (`whatsNewShownAt`, `WHATS_NEW_OPENS_EVERY`); a second big feature that day gets the pill. Once a day is fine while YARC is this young (decided 2026-11-26); raise it when releases settle. The pill has no limit: it's quiet, and it stays until it's clicked or hidden.
- **Changes add up.** The board lists everything since the version it was last opened on (`whatsNewSeenVersion`), not since the last run. Someone who ignores the pill for two weeks gets one board with two weeks on it.
- **Seen means shown.** Spotlights are marked seen when the board is shown, not when it's chosen (today `showStartupScreen` marks them before the overlay is up).
- The **What's New** command and menu item always open it, with the last `RECENT_VERSIONS` versions and `RECENT_SPOTLIGHTS` spotlights, as today.
- First run keeps the welcome tour. Incognito windows have no canvases and never show it.

What a user who restarts every day sees: the pill on days with changes for users, and the board by itself on a day with a big feature.

## 3. Where the content comes from

**Text: the changelog built into the app** (`__CHANGELOG__`, `scripts/changelog.mjs`), as today. The running app is the new version, so it has its own notes. No request.

**Pictures: files in the app.** The spotlight pictures are React scenes (`spotlight-pictures.tsx`), which a board can't hold. A build step renders each to a PNG, light and dark (an Electron script like `scripts/render-icons.mjs`), into `resources/whats-new/`. Only the `RECENT_SPOTLIGHTS` newest are packaged, so the installer doesn't grow with every feature. The scenes stay the one source; a feature's PR adds its scene as it does now.

**The live capture: a page GitHub hosts.** A playing capture needs a real `http(s)` URL (`isLiveCard`), so it can't be a page inside the app, and release assets can't serve one (GitHub sends them as downloads, and `raw.githubusercontent.com` as plain text). The card plays `https://github.com/yenebeb/yarc/releases`:
- it exists for every release without anyone doing anything;
- it shows what the built-in notes can't: releases newer than the running app;
- its still and capture geometry (`CaptureGeometry`: viewport, rect, scroll) are one PNG and a few numbers in the repo.

It is paused in the built scene. Pressing ▶ is a visit to github.com with the profile's cookies, the same as any capture (`docs/canvas.md` 4.4), and nothing loads before that press. So the board adds no request YARC makes on its own, which keeps "nothing collected" true: the updater's calls stay the only ones.

The weak spot: the crop is by coordinates (selector anchoring, `docs/canvas.md` 4.3, isn't built), so a GitHub redesign can shift what the card shows. It fails soft: a wrong crop of the right page, with the still correct until ▶. Fix by taking the still again.

**If that turns out too fragile: GitHub Pages**, from a folder in this repo. A page we lay out ourselves, so the crop never drifts, and it could be made for the card (a big "what's coming" panel). It costs a Pages site to keep working and a second place where release text lives, so it's the fallback, not the start.

## 4. How it's built

**A built-in canvas, not a stored one.** Main builds the scene; nothing is written under `Profiles/<id>/Canvases/`.

- `src/shared/whats-new-board.ts`: `whatsNewScene(releases, spotlights, appearance): CanvasScene`. Pure, places the items of section 1 on a grid. Unit-tested: every item passes `isBoardItem`, and no two overlap for 1, 3 and 10 releases.
- `Canvases` (`src/main/canvas.ts`) gets a second source next to `canvas-store.ts`: for the built-in canvas, `canvasLoad` returns the built scene, `canvasSave` keeps it in memory until the row closes, and image ids resolve to `resources/whats-new/` (read-only, fixed names, no path from the page).
- **The row**: canvases are `PinnedCanvas` items in `space.pinned` today. This needs a canvas row outside `pinned` that isn't persisted: the one new piece of plumbing in `browser.ts`, and the part to spike first.
- **Buttons**: a spotlight's `actions` run commands, and no board item does that. A new item kind, `action` (`{ label; command: CommandId }`), exists only in built-in scenes: `isBoardItem` rejects it for anything loaded from disk, imported or pasted, and Keep a Copy drops it. Otherwise a board made from web content could carry a button that runs an app command.
- **Keep a Copy**: `Canvases.create()` with the scene and its pictures copied into the new canvas's `images/`.
- **State** (`AppState`): `whatsNewSeenVersion`, `whatsNewShownAt`. `lastSeenVersion` and `seenSpotlights` stay. `startupScreen()` in `src/main/changelog.ts` returns `{ kind: 'whats-new-pill' }` or `{ kind: 'whats-new-board' }` in place of today's `whats-new`, from the rules in section 2; it stays pure and unit-tested.
- **Removed**: `WhatsNew`, `ReleaseList` and the spotlight pager in `Intro.tsx`, the `whats-new` overlay mode.

**Cost in main**: nothing until the board opens. The canvas page's webContents is made on first use, as for any canvas, and no live view exists until ▶.

**The relaunch card stays** (`UpdateReady`, the overlay that asks for a restart after 7 days). It is a question with one button, it shows the *next* version, whose pictures the running app doesn't have, and its notes are fetched from the release. A board there would be text only and would hide the button it exists for.

## 5. Steps

1. **Spike (1–2 days):** a canvas row outside `pinned` with a scene from memory; the releases page as a live card at three window sizes, light and dark.
2. **The board (about 1 week):** `whatsNewScene`, the built-in source, the `action` item, rendered spotlight pictures, Keep a Copy. Opens from the What's New command only; the overlay still does startup.
3. **Startup (2–3 days):** the pill, the rules of section 2, the new state; remove the overlay. e2e: launch with an older `lastSeenVersion` and see the pill, then the board's notes in the canvas page's DOM.
4. **Spotlight for the feature itself**, in the PR of step 3.

## 6. Open questions for the maintainer

1. **Which popup?** This replaces the What's New overlay and keeps the relaunch card. Should the relaunch card go too?
2. **Opening by itself for a big feature**: selected at launch (above), or only the pill, always?
3. **The live card's page**: the releases list (above), the repo's front page (stars and README, more to look at, nothing about releases), or GitHub Pages from the start?
4. **One "Earlier" note from the fourth version on**, or every version its own note, growing to the right?
