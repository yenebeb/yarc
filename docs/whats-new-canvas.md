# What's New as a canvas (first version built)

**Decided 2026-11-26, after seeing a generated board (a wall of notes):** a board is made by hand, one per big feature, and changes without one stay a list. Sections 1, 3 and 4 below describe the generated board and are kept for the reasoning; what's built is this:
- **A board per big feature** (`src/main/boards/<spotlight id>.json`, listed in `src/main/whats-new-boards.ts`): a saved canvas scene, shipped in the feature's PR next to its spotlight. `canvas-notes` has the first one. A card whose file id is `releases-still` shows GitHub's releases page and can be played (`src/main/whats-new-releases.png`, its geometry in the board's JSON); an image whose file id is `spotlight-<id>` is drawn from that spotlight's React scene.
- **Only a big feature opens anything by itself** (decided 2026-11-26: being taken to a page on an update feels forced; the user always chooses). When an unseen spotlight waits, the What's New card opens once at launch (a hidden sidebar hides the pill, so a big feature went unnoticed); a board never opens by itself. Otherwise a quiet **What's New** pill sits in the sidebar, where *Restart to Update* sits; its x hides it until the next update. The pill, like the What's New menu item, opens the What's New card, and there a spotlight that has a board gets a **Try It on a Canvas** button (`openBoard`). Pointing at the pill also lists those boards above it, each a click away (`AppState.whatsNew.boards`). Closing the card is the end of it until the user chooses What's New from the menu. Section 2 below, with its board that opens by itself, is superseded by this.
- **The board is a real canvas marked `temporary`** (`PinnedCanvas`), a row among the pinned items. Closing it (⌘W) deletes it, the next launch deletes one that was left, and **Keep This Canvas** in its menu clears the mark.
- A build that isn't a release shows the newest version of the changelog it was built with (`node scripts/changelog.mjs` writes one).

Tried in the built app through `YARC_TEST` on a scratch profile (the board is drawn and its row selected); not with a real mouse, and ▶ on the releases card wasn't pressed.

**Built since (2026-11-27, with the `history-sync` board):** a board's own background colour, several pictures per feature, and a button that runs a spotlight's command. **Not built yet:** a checklist that ticks itself, e2e tests. `startupScreen` in `src/main/changelog.ts` is now only used by its tests.

## Making a board

Boards are written by an AI session, as JSON and React scenes, and checked by looking at them (decided 2026-11-26: nobody designs them by hand in the app). `history-sync` is the example for a big feature (2026-11-27, after five rounds with the maintainer); `canvas-notes` and `live-folders` are the earlier, plainer ones.

1. **Decide whether the feature has a board in it.** It needs something to show (how it works) or to try (the board is the feature). A feature that is only a statement ("YARC collects nothing") keeps its spotlight card and gets no board.
2. **One idea per board, and show it happening.** A diagram of boxes and arrows read as a wall of notes; what worked is the feature played out once, with every step done. Don't repeat the spotlight's text.
3. **Build it from these parts**, top to bottom (`src/main/boards/<spotlight id>.json`, a `CanvasScene`, listed in `BOARDS` in `src/main/whats-new-boards.ts`):
   - **Title, a drawn underline, one line** saying what is new. On a board with a background colour the texts are ink: grey and purple are too faint on the tint.
   - **The big card: the feature's picture, drawn wide.** The spotlight's scene (`spotlight-pictures.tsx`) gets a second layout for a box of 640px or more (`@container` in `spotlights.css`), so the What's New card keeps its small picture and the board gets the full width. It has real words in it and plays the feature once, in reading order, in one loop of about 12 seconds (`hs-readable`, `hs-sealed`, `hs-opened`): each history row runs across the card, readable on this computer, sealed in the place between, readable again on the other. No list of steps along its top: that repeated the card that says how to turn it on. **Only this card moves**; with reduced motion it shows the finished state.
   - **Up to three separate cards under it**, each its own item and its own scene, `spotlight-<id>-<part>` in `PICTURES`: how to turn it on (numbered), the choices (tiles), the promise (who can read it). Static, in the big card's colours, so the board reads as one thing but the cards can still be moved apart. Together with the big card and the releases card they fill one rectangle.
   - **The feature's button, in the card that says how to turn it on**, with the label of the spotlight's own action: a `<button>` with `pointer-events: auto` calling `arc.canvasSpotlightAction(<command>)`. As an item of its own under the cards it hung loose. Main only runs a command some spotlight's own button offers (`runSpotlightAction` in `src/main/canvas.ts`), because a canvas can hold anything pasted into it.
   - **The card of GitHub's releases page, always** (file id `releases-still`, with the `source` and `capture` the examples have), and a line next to it saying it is the real page and can be played. The board check fails without it. Its white frame is drawn 6px outside its box, so it sits 6px in from the cards it lines up with.
   - **No arrows between cards that aren't a sequence**, and no hand-drawn loops or flourishes: they were tried and looked messy.
   - **A background colour** for the whole board (`"background": "purple"`, one of the canvas colours), so it doesn't open on the plain canvas.
   - Plain texts and notes (`card: true`, with `- `, `[ ] `, `# ` at the start of a line) are for a board whose point is the notes themselves, like `canvas-notes`. A big feature's cards are scenes: notes can't be styled, and three white notes under a designed card looked unfinished.
4. **Look at it, twice:** `pnpm build`, then `node scripts/board-preview.mjs <spotlight id> --save-sizes` for the start of the loop and `--wait=9300` for its end. It draws the board in the real app, prints where the picture is, says which items weren't drawn, and writes each text's drawn size into the JSON (a text's size is only known once it's drawn). Open both pictures. Fix what's off and run it again until nothing overlaps or is cut off, and its outline is one tidy block: a board has no `view`, so it opens scaled to the window and centred, and a ragged outline shows as empty corners.
5. **`pnpm test`** (`test/unit/whats-new-boards.test.ts`): every item can be drawn, texts, cards and pictures don't overlap, the board fits one screen, its pictures exist, it has the releases card.
6. **Put both pictures in the PR**, so the maintainer judges pictures, not JSON.

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
