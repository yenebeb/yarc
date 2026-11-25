# Canvas: a freeform board with page captures (phase 1 and live view built)

Status (2026-11-21): phase 1 (MVP) is built on our own board (section 2), released in v0.2.0, and was tried in the running app through `YARC_TEST` (captures, Add Image, the Send To list, drawing a rectangle and typing a text with input events, rename, saving); not yet with a real keyboard and trackpad. Phase 2a, the live view (section 4.1), is built; the rest of phase 2 (refresh, anchoring, the memory guard) and more export formats (phase 3) are not started. This doc answers a Windows user who asked for Arc's Easels, which only ever shipped on macOS.

**What phase 1 has** (`src/main/canvas.ts`, `src/main/canvas-store.ts`, `src/renderer/src/canvas.tsx`): canvases as pinned sidebar items (`PinnedCanvas`), shown in the content area by `canvas.html`, a board YARC draws itself (section 2); files per profile with the inbox and trash below; ⌘⇧2 capture with hover-to-pick or drag and a Send To list; Add Image to Canvas; captures as cards whose footer opens the page in Peek; Arrange in Grid; a new canvas opens with its title in the middle and a hint under it, while it holds nothing else, naming ⌘⇧2, Add Image to Canvas and paste or drop (no tutorial or example canvas); PNG export and copy; rename, move to space, delete to trash. The title follows a sidebar rename while it still reads the old name. A focused canvas keeps ⌘D (duplicate) and ⌘± / ⌘0 (zoom) for itself.

**Built differently from below:** main never writes board items. A capture is stored as an image plus an entry in the canvas's `inbox.json`; the canvas page places inbox items when it opens (or at once, if open) and saves. Saving never deletes an image that's still in the inbox.

**What phase 2a has** (`src/main/capture-live.ts`): ▶ in a capture card's footer (cards with capture geometry only) plays the real page in the card's picture box, ⏸ goes back to the still; saved as `CardItem.live`, so a live card plays again when its canvas opens. Section 4.1 says what's built and what's left. Tried in the running app through `YARC_TEST` on a local test page and on vclock.com (the live card matches the still and keeps ticking; zoom, a card half off the board, a click on a link opening Peek, switching to a tab and back, pause); not with a real mouse and trackpad.

**Not in phase 1:** canvases in the command bar's search results, a still of a canvas shown in a second window (the other window shows nothing there), canvases in split view, an undo toast for Delete.

The short answer: an MVP (a board with text, shapes, drawings, images and static captures of a page element or region, saved per profile, exported to PNG) is about **3–4 weeks** of work. The target uses are a moodboard like Arc's "Good Chairs" example (section 1.1) and, with live captures, a dashboard made of pieces of several sites (section 4). Live captures (press play to see the live page in the capture's box, like Arc) add about **3–4 weeks**. More export formats (SVG/PDF/HTML) add about **1 week**. There is no sharing: everything stays on the user's machine. Nothing in the design is macOS-only, so Windows gets the feature at the same time.

The feature name is open (section 7). This doc says **canvas** for the board and **capture** for a cut-out of a page.

---

## 1. What Arc's Easels did

From `arc-reference.md` (Library, Easels, shortcuts) and a few third-party guides ([allthings.how](https://allthings.how/whats-easel-in-arc-browser-and-how-to-use-it), Arc's [Paint with the internet](https://start.arc.net/paint-the-internet) page). Arc's own help article on Easels refused automated reads, so details below are from those sources only.

- **A freeform canvas** with text boxes, rectangles, circles, arrows, freehand drawing and images uploaded from disk. Select to recolor, Delete to remove, ⌘Z to undo. Zoom with pinch or ⌘±.
- **Captures.** ⇧⌘2, the ⌘T command "Capture", or the Site Control button → "Capture a portion of this page": drag a rectangle over the page, then pick a new or existing Easel. The command bar also had "Capture Full Page" and "Capture in Portrait Mode". Each capture links back to its source page.
- **Live captures.** A capture had a play button; the first use asked to "Make it Live". A live capture showed an up-to-date, interactive version of the site; pause went back to the still. ⌘R on an Easel refreshed all live captures. Users kept "dashboard" Easels whose captures all reloaded when opened; Clive Thompson called this Arc's most powerful feature, a "custom dashboard of the web" ([Medium, 2022-12-31](https://clivethompson.medium.com/the-most-powerful-and-unusual-feature-in-the-new-arc-browser-2552bb7848ce); the rest is member-only and wasn't read). Guides called it experimental: some sites didn't work.
- **Where they lived.** As sidebar items (pinned in a space) and in Library → "Easels & Notes", opening in Peek.
- **Sharing.** A share button, private by default. View-only or editable links. Arc users could edit; anyone with a browser could view. PNG export came through the share menu (⇧⌘S).
- **Platforms.** Create and edit on macOS only. Arc for Windows never had Easels; the iOS companion could view Easels pinned in a space.

### 1.1 An example: "Good Chairs"

The maintainer pointed to a shared Easel as the reference for what to aim at ([arc.net/e/52770389-…](https://arc.net/e/52770389-65B7-4F8F-ABC7-1D8F2E7FF18C), looked at 2026-11-20). It's a **moodboard**: a large title with a freehand underline, then six captures of chair photos from Pinterest, Google image search and a design blog, in a loose grid with small gaps on a dark background. Each capture is cropped tightly to one photo. Hovering a capture shows a chip with the source's favicon and page title and a ↗ to open it. No shapes, arrows or notes.

What YARC takes from it (the use, not the look; YARC's look is designed here):
- **Capturing one thing matters more than a free rectangle.** People capture a photo, a chart, a card. Hover-to-pick an element, with drag as the fallback (section 3).
- **Images from pages are the main content.** "Add image to canvas" on an image's context menu saves the image itself at full resolution, not a screenshot of it.
- **The source belongs to the capture.** A favicon + title chip on hover, one click to open the page (in Peek).
- **Tidy without effort.** Snapping while dragging, and "Arrange in grid" for a selection, so a moodboard looks like the one above without nudging pixels.
- **A title.** A canvas starts with its name as a heading, which the user can edit or delete.

How Arc rendered a live capture in a *shared* Easel (whose cookies, what the viewer saw) is not documented anywhere I could read. Section 4 doesn't depend on it.

---

## 2. The board: our own, not a library

**Decided 2026-11-21: YARC draws the board itself**, as plain HTML in a container that pans and zooms, with SVG for shapes, arrows and drawings. No canvas library.

Phase 1 was first built on Excalidraw 0.18.1 (MIT). Trying it in the running app settled it:
- **It's a sketching whiteboard, and looks like one.** Its toolbar, Library, hints and fonts (25 MB) are its own; YARC's look would be a layer of overrides on top.
- **A capture can't be a card.** Excalidraw has no custom elements, so a capture's frame, its footer (site icon, title, ▶, ↗) and later its live view would all be separate layers kept in line with the board on every pan and zoom.
- **Fonts fought the UI page's CSP.** Excalidraw always lists a CDN as a second font source (about 460 blocked-font errors per launch), and it measures text before its font has loaded without measuring again, which cut off a new canvas's title.

tldraw was ruled out earlier: its SDK needs a license key in production, stops drawing after 5 seconds without one, and its license isn't GPL-compatible.

Why our own is reasonable: an Easel is mostly cards, text, a few shapes and arrows, and freehand lines. As HTML, a card is an ordinary element with its footer inside it, text measures itself, a live view (section 4.1) sits on the card's own box, and dark mode is CSS. What a library gave for free and we build: selection (click, Shift-click, marquee), move, resize, front/back order, undo/redo, snapping with guides, copy/paste, zoom and pan, and PNG export (drawn onto a 2D canvas by the page).

### 2.1 What Arc's Easels had, to compare against

From the user's own Arc (its translator notes and type names, read for the feature list only; nothing of Arc's code, assets or measurements is used), and screenshots the maintainer shared. **Now** is phase 1; the rest is later.

| Area | Arc's Easels | YARC canvas |
|---|---|---|
| Tools | pointer, image, text, rectangle, ellipse, triangle, line, arrow, freehand, zoom | **Now:** select, image (from a file), text, rectangle, ellipse, arrow, freehand, hand, zoom. Later: triangle, plain line. |
| Objects | text, rich text, shapes, images, web cards (captures), embedded live pages, link cards, video | **Now:** text (title, heading, body), shapes, arrows, drawings, images, captures as cards. Later: live captures (phase 2), link cards, rich text. Not planned: video, embedded pages. |
| Capture card | a framed card; on hover or selection a footer with the site's icon, page title, ▶ live view and ↗ open | **Now:** card with footer (icon, title, ▶ live view, ↗ opens Peek). |
| Object menu | cut, copy, paste, duplicate, delete, bring to front, send to back, make the title, alignment guides on/off, image description, copy or open a capture's URL, set as thumbnail | **Now:** cut, copy, paste, duplicate, delete, bring to front, send to back, make the title, snapping on/off, open page, copy page address. Later: image description (alt text), thumbnail. |
| Styles | a named palette (black, white, grey, red, pink, yellow, two greens, two blues, purple), fill styles, fonts, text styles | **Now:** an 8-color palette, fill on/off for shapes, three text sizes. |
| After a capture | "Send To…": a search field, saved to Library, Copy, Save…, share, Edit, Retake, New Easel, recent Easels, See Older | **Now:** filter field, Copy, Save…, Retake, New Canvas, canvases most recent first, five shown with "Show all". Not planned: a captures library, sharing. |
| Capture | click or drag a part of the page, full-page capture, portrait mode | **Now:** click (scroll for a bigger part) or drag. Phase 2: full page. Not planned: portrait mode. |
| Canvas | title, empty state, save as image, save as web page, export all, delete with confirmation | **Now:** title, empty-canvas hint, PNG export and copy, delete to trash. Phase 3: other formats. |

Behaviours to check against Arc when testing: a capture lands next to the previous one, top-aligned; the card footer shows on hover and selection; the title is an ordinary text object marked as the title; Retake goes back to picking without closing; the most recently used canvas is first in Send To.

---

## 3. Region capture

YARC already captures pages: `webContents.capturePage()` in `Browser.lend` and the frame subscription in `Mirror` (`src/main/mirror.ts`), with `stillOf` turning a `NativeImage` into a JPEG data URL capped at 1600 px wide. `Tab.sampleBarColor` captures a 2 px strip with `capturePage({ x, y, width, height })`. A capture is the same call with the rectangle the user drew.

**Flow:**
1. ⇧⌘2 / Ctrl+Shift+2 (a new `keymap.ts` entry), the command bar's "Capture", or a sidebar canvas's camera button.
2. The overlay view (already above the page, `src/main/window.ts`) opens a new overlay kind, `{ kind: 'capture' }` and the page dims. Escape cancels. Two ways to pick, in the same mode:
   - **Hover and click** (the default, from 1.1): the element under the pointer is outlined, and a click captures its box. The overlay sits on top, so the page gets no mouse events; main asks the page (an isolated-world script, throttled to a frame) for `document.elementsFromPoint(x, y)` and outlines the first image, video, canvas, figure or element with a visible box of a sensible size. Scroll wheel / ↑↓ go to the parent or child element.
   - **Drag** a free rectangle, as in Arc.

   Coordinates are in the page's CSS pixels (overlay and page share the content bounds).
3. Main calls `tab.wc.capturePage(rect)`. The image comes back at device pixels (2× on Retina), so keep it at full resolution. Don't reuse `stillOf`: it shrinks and re-encodes as JPEG, which suits live mirrors but blurs text in a capture. Store PNG (or lossless WebP if size becomes a problem).
4. At the same time, record where the capture came from (section 4): URL, title, viewport size, scroll position, the rectangle, and a selector for the element under it.
5. A small picker (overlay) asks "New canvas" or one of the space's canvases, like Arc. The capture lands in the canvas's visible center, or next to the last capture so a series lines up.
6. Keep the tab's favicon and title with the capture, for the source chip (1.1).

**Add image to canvas.** The page context menu on an image gets "Add Image to Canvas…". Main downloads the image's URL with the tab's session (`session.fetch`, so images behind a login work), keeps the original bytes (PNG, JPEG, WebP, GIF and AVIF; not SVG, which could carry scripts), and records the page URL as the source. Better than a screenshot for moodboards: full resolution, no page chrome around it. Not live.

**The source chip.** On hover, a capture shows its source's favicon and title and a ↗ button that opens the page in Peek. It's drawn in YARC's layer above the canvas (section 2), not as canvas elements, so it never ends up in an export.

**Full-page capture** (Arc's "Capture Full Page") doesn't work with `capturePage`, which only sees the viewport. It needs CDP `Page.captureScreenshot` with `captureBeyondViewport: true` through `wc.debugger`. That's in-process, so the packaged build's refusal of `--remote-debugging-*` doesn't affect it. Check in the spike how it behaves while DevTools is open on the same tab. Phase 2, not MVP.

**Edge cases:** pages that block screenshots don't exist at this level (Chromium captures the compositor output, DRM video comes out black). A capture of an incognito tab goes to an incognito canvas only (section 5).

---

## 4. Live captures

Like Arc, a capture has a **play** button. Playing turns the picture into the live page, cropped to the capture and interactive: scroll it, click a button, watch a chart or a video update in place. **Pause** turns it back into a picture (the last frame). The first play asks once, like Arc's "Make it Live" ("Loads this page with your <profile> sign-in").

A capture stays playing until paused, and that is saved. Opening a canvas loads its playing captures again, which gives the "dashboard" use: a canvas of playing captures is current within seconds of opening it.

Two mechanisms do this:
- **Live view** (4.1): a real page in the capture's box. Used for playing captures that are on screen.
- **Refresh** (4.2): load the page hidden, capture the region again, store the picture. Used for playing captures that can't have a live view right now (scrolled off screen, too small to read, or closed by the memory guard), for the picture a capture shows while its live view loads, and for "Refresh picture" on a paused capture.

### 4.1 Live view (play)

**Built (phase 2a), and how it differs from the plan below.** The canvas page sends main every live card's picture box on screen (board coordinates × zoom + pan, in the page's CSS pixels), the board's rect, its zoom, `devicePixelRatio` and whether it's hidden, each time that changes (`canvasLive`, fire-and-forget). The window shows a canvas as `CanvasPage.stage`, a plain `View` holding the canvas page and, above it, one `WebContentsView` per live card (`LiveCapture`); a web page's own child views are drawn under it on macOS, and no view clips its children there, so each live view is only the part of the card's box inside the board. The page is laid out as the tab was at capture time and cropped to the captured rect with DevTools' `Emulation.setDeviceMetricsOverride` (`width`/`height` = `capture.viewport`, `viewport` = the rect in the document, in device pixels, with `scale` = box width / rect width), through `webContents.debugger`. The page can't see that crop, so pages that place things with script (vclock.com) keep their layout; a CSS `translate` on the root was tried and such a page partly undid it. Input doesn't follow the crop either: every mouse event is stopped in `before-mouse-event` and sent again at the point it's drawn over (the page reads it in its own viewport's CSS pixels). The page is scrolled to `capture.scroll` and held there, since the crop is in document coordinates and the page only draws near its viewport; a wheel over a live card does nothing. The profile's session, the tab's web preferences, muted, shortcuts through `before-input-event`, new windows and links clicked after load in Peek, page pinch-zoom off. It shows once the page has loaded and scrolled, plus 400 ms; until then the still is visible. A live card always shows its footer, so it can be dragged by it. Hidden (the view stays loaded): smaller than 80 × 60 on screen, off the board, or while a canvas menu is open. Closed: on pause, when the card is deleted, while the canvas is out of every window (main tells the page with `canvasShown`, since taking a view out of a window doesn't hide its document), and with the canvas page.

Not yet: the first-play explanation, the board panning on a wheel over a live card, clicks reaching cross-site frames inside the crop (events are sent to the main frame), swapping to a still during pans, selection, drags and resizes (the view follows the card instead, and covers the selection handles), the live view drawing over the toolbars when a card sits under them, pause saving the last frame (the capture-time still comes back), closing rather than hiding a view that's off screen or too small, "Back to region", ⌘R, unmuting, live views on a canvas whose window closed, and the guards in 4.4. Refresh (4.2), selector anchoring (4.3) and the memory guard (rule 3 below) come later.

The plan:

1. Create a `WebContentsView` in the profile's session (`Profiles.partition(profileId)`), so the page sees the user's logins and the profile's ad blocker and extensions apply. Sandboxed, no preload, muted until the user unmutes it from the source chip. It is not a `Tab`: no history entry, no archive, no sidebar row.
2. Add it as a child of the window, above the canvas page, with its bounds set to the capture's box on screen. The canvas page sends the card's box on screen (its element's `getBoundingClientRect()`) to main whenever it changes.
3. Keep the page's layout as it was at capture time, although the box is smaller than the original window: `wc.enableDeviceEmulation({ viewSize: <capture-time viewport>, scale: <canvas zoom>, … })` lays the page out at the original width and draws it scaled. Then scroll the page so the region (found as in 4.3) sits at the box's top-left corner.
4. Show the last picture until the page has painted (no new frames for ~500 ms), then swap to the view, so playing never flashes white.
5. Pause: `capturePage` the box, save it as the capture's picture, destroy the view.

The page is interactive inside the box:
- The wheel scrolls the page, like an iframe. A "Back to region" button on the chip scrolls it back. Pinch and ⌘± zoom the canvas, not the page (`setVisualZoomLevelLimits(1, 1)`).
- Links that leave the page open in Peek; new windows open as tabs. The live view itself stays on its page.
- Keyboard shortcuts work as on any page (`before-input-event`); ⌘R in a focused live view reloads it.

What makes it hard, and the answers:
- **Native views draw above the canvas.** Anything the canvas draws over a playing capture (another item, a selection box, a menu) is hidden behind it. While a playing capture is selected, dragged or resized, or a canvas menu overlaps it, the live view is swapped for its latest frame (a `capturePage` still, like a window that has a tab elsewhere, `docs/multi-window.md`), and comes back when the gesture ends.
- **Panning and zooming.** Moving a native view on every frame of a pan lags behind the canvas. During a pan or zoom, show the still; move the view and set its scale when the canvas has been still for ~150 ms.
- **Cost.** Each live view is a full page with its own renderer process (typically 100–300 MB, more for heavy dashboards), running scripts and repainting while visible. There is **no fixed limit**, as there is none on tabs; a dashboard canvas should be fully live. The cost is bounded by these rules instead:
  1. **Every playing capture that is on screen and readable gets a live view.** Scrolled off screen, or smaller than about 80 × 60 px on screen (zoomed far out), it shows its last frame and its view is closed.
  2. **Live only while the canvas is shown.** Switching the window to a tab, or closing the canvas, closes its live views and leaves their last frames, so a canvas costs nothing in the background.
  3. **A memory guard instead of a count.** Main checks free system memory (`process.getSystemMemoryInfo()`) and the views' own use (`app.getAppMetrics()`) every few seconds while live views exist. Under pressure, it closes the live views furthest from the center of the screen first, as Chrome discards background tabs, and they show their last frame with a "Paused to save memory" note on the chip. Thresholds come from the spike.

Unknowns for the spike: whether `enableDeviceEmulation` with `viewSize` keeps the page's layout width independent of the view's bounds in Electron 45, and whether scaling with it keeps text sharp. If not: show live views only at 100 % canvas zoom and size the box to the region, with the page laid out at the box width (worse for responsive pages).

### 4.2 Refresh (hidden load)

1. Create a `WebContentsView` that is never attached to a window, in the profile's session. Settings: `offscreen: true` (Chromium renders without a window, which works the same on macOS and Windows), `backgroundThrottling: false`, sandboxed, no preload, `audioMuted`.
2. Size it to the viewport recorded at capture time (`setBounds`), so responsive layouts match.
3. `loadURL(sourceUrl)`. Wait for `did-finish-load`, then for paint to settle (no new frames for ~500 ms, capped at 10 s), because many pages fill in after load.
4. Find the region (4.3), scroll it into view in the hidden page, and `capturePage(rect)`.
5. Replace the capture's image file, keep the old one until the new one is written, update `refreshedAt`. Destroy the view.

Refresh views live in a separate, small class (`src/main/capture-refresher.ts`) with a queue: at most 2 loads at once, 20 s timeout each. Live views (4.1) are another class, `src/main/capture-live.ts`; both share the guards in 4.4.

### 4.3 Anchoring: coordinates or a CSS selector

At capture time, run a script in an isolated world (`wc.executeJavaScript` in a separate world, so page scripts can't see it) that looks at `document.elementsFromPoint` inside the rectangle and picks the smallest element that contains it. With hover-to-pick (section 3) that element is already known. Build a selector for it: an `id` if it's unique and not auto-generated, else `data-testid`/`aria-label`, else an `nth-of-type` path from the nearest element with a stable id. Store the selector and the rectangle's offset from the element's box.

| | Coordinates (scroll position + rectangle) | CSS selector (+ offset) |
|---|---|---|
| Works when | The page's layout is fixed: a dashboard, a chart at a fixed spot, the top of a page. | Content above the region changes height: a news list, a feed, a weather widget lower on a page. |
| Breaks when | Anything above it grows or shrinks; banners, cookie notices and A/B tests shift it. | The site changes its markup or uses generated class names; the element is repeated and the path points at the wrong one; the content moved to a different element. |
| Cost | None. | A script at capture time; a `querySelector` at refresh. |
| Failure is visible? | No: it silently captures the wrong area. | Yes: "not found" is detectable. |

**Use both:** try the selector; if it finds exactly one element of roughly the stored size (±30 %), anchor to it. Otherwise fall back to coordinates and mark the capture "may have moved" with a small badge, plus a "Re-pick region" action that opens the page in Peek with the capture overlay. Let the user switch a capture to "fixed position" when they know the page doesn't move. The same anchor places the live view (4.1) and the refresh (4.2).

### 4.4 Privacy of loading pages from a canvas

Playing a capture is a real visit with the user's cookies, and so is a refresh. That's the point (a logged-in dashboard), but it has effects the user may not expect from a picture on a board:
- The site logs a visit: "last seen", read receipts, notifications or unread counts cleared, view counters, analytics and ad trackers (less with ad blocking on).
- A GET can change state on badly built sites (one-time links, "mark as read" URLs). Warn before playing a capture whose URL looks like a one-time token (`token=`, `code=`, `magic`, `otp` in the query).
- It uses the network and battery, maybe on a metered connection.

Rules:
- **Play is opt-in per capture**, with the one-line explanation on first play.
- **Never from incognito.** Incognito canvases have no play button.
- **No side doors:** live and refresh views deny permission requests (camera, microphone, location, notifications; no prompt), cancel downloads, suppress `beforeunload`, block navigation to non-http(s) schemes. Refresh views also deny new windows and suppress dialogs; live views send new windows to tabs, as in 4.1.
- **Signed out:** if the final URL is on another site (an identity provider) or differs from the source in host, keep the old picture and show "Sign in needed", with a button that opens the page in Peek.
- **Never in exports:** an exported canvas has the last picture only; whoever opens the file never loads the source with anyone's cookies (section 6).

### 4.5 When pages load

- **Paused captures never load on their own.** They change only on "Refresh picture".
- **Playing captures load when their canvas is shown in a window and they're on screen** (live view, or a refresh if it's too small or the memory guard closed its view), and when they're scrolled into view later. Nothing loads for a canvas that isn't shown: a browser fetching logged-in pages in the background on a timer is surprising and hard to explain.
- ⌘R / Ctrl+R on the canvas (not in a live view) reloads every playing capture on it (Arc's binding).
- Showing the canvas again within 5 minutes doesn't reload refreshed pictures that are younger than that.
- No refreshes on battery saver / low power mode or offline (`powerMonitor`, `net.isOnline()`); live views still work if the user presses play.
- The chip shows the picture's age ("2 h ago") on paused captures, and the error if the last load failed.

---

## 5. Storage, sidebar item and import

### 5.1 Files, not state.json

`state.json` is rewritten as a whole on every change and sent to every renderer as a snapshot. Canvases hold images and change on every stroke, so they stay out of it. Each canvas is a folder in its profile:

```
Profiles/<profileId>/Canvases/<canvasId>/
  canvas.json        the board: its items in front-to-back order and where it was panned and zoomed, no images
  images/<sha256>.png captures and pasted images, named by content hash (deduplicates)
```

- `canvas.json` is written the way `store.ts` writes `state.json`: temp file, fsync, rename. Save 1 s after the last change and on close.
- Image data is not kept in the JSON. The canvas page gets the images with the canvas (`IPC`, as data URLs) and sends new ones (pasted, dropped, picked) with the next save. Orphaned images are deleted when a canvas is saved.
- Capture metadata lives on the image element: `customData.yarc = { sourceUrl, title, favicon?, imageUrl?, viewport, rect, scroll, selector?, offset?, playing, muted, refreshedAt, status }`. `imageUrl` is set for "Add image to canvas"; `favicon` is a small data URL.
- Deleting a canvas moves its folder to `Canvases/.trash/` for 30 days (undo with a toast), like closed tabs going to the archive.
- `Profiles.remove(id)` already deletes the profile folder, so canvases go with their profile.
- Incognito: an in-memory canvas only, gone when the window closes. Simplest is to not offer canvases in incognito at all in the MVP.

### 5.2 A new sidebar item kind

A canvas is a pinned item. Add to `src/shared/types.ts`:

```ts
export interface PinnedCanvas {
  kind: 'canvas'
  id: ID          // also the folder name under Canvases/
  name: string
  lastActive: number
}

export type PinnedNode = PinnedTab | PinnedFolder | PinnedCanvas
```

- It lives in `Space.pinned`, so it can sit in folders and be dragged like a pinned tab. Not in Today: a canvas is something you keep, and Today's auto-archive would throw it away.
- The canvas's folder is in the space's profile. Moving a canvas to a space with another profile moves its folder (and live captures then load with the other profile's cookies; say so in the move).
- Code that switches on `kind` today: `src/shared/tree.ts` (6 places), `Sidebar.tsx` and `overlay.tsx` (3 each), `browser.ts` (2), `panels/util.ts` and both importers (1 each). TypeScript's exhaustiveness checks will list them.
- Library gets a "Canvases" section next to Archive and History, listing every canvas of the profile.
- The command bar gets "New Canvas", "Capture" and the canvases by name.

**Showing a canvas.** A new UI page, `canvas.html` from `yarc://ui/`, in a `WebContentsView` laid out where a tab's page goes, with the `ui.js` preload (it's YARC's own page, never a web page). It gets its own renderer entry, so the board's code stays out of the sidebar and overlay bundles. Selecting the sidebar item shows it like selecting a tab. A canvas can be in one window at a time, like a tab (`docs/multi-window.md`); the other window shows the still. Splits with a canvas pane: later.

### 5.3 Importing Arc's Easels: from Arc's own export

The sidebar alone isn't enough. In a real `StorableSidebar.json` (checked 2026-11-21) an `easel` item carries `easelID`, `title`, `creatorID`, `shareStatus` and `timeLastActiveAt`, but no content (`docs/arc-data-format.md`); the content lived on Arc's servers (Firestore).

**But Arc can export every Easel to files**, and an importer can read that. Found 2026-11-21 in Arc for macOS (the maintainer allowed looking inside `Arc.app` for this; its `ARC_EaselUI.bundle` ships the export's README and viewer, and the binary has the strings): the **Library card has a button that exports every Easel as web pages**, and a single Easel can be exported too. The export is a folder:

```
index.html                 list of all Easels
<Easel name>/index.html    one Easel, data inlined, opens offline
<Easel name>/easel.json    the same data as JSON ("for anything you want to build")
<Easel name>/images/       images, favicons and link thumbnails that could be saved
EaselExportViewer.js/.css, fonts/
```

`easel.json`, as the bundled viewer reads it:

- `palette` (e.g. `"chill"`), `objects[]`.
- Each object: `frame` `{ x, y, width, height }` as **fractions of the Easel's width** (an Easel is 1000 points wide, so multiply by 1000 for points), `zIndex`, and `content` with a `type`:
  - `text`: `string`, `fontFamily` (`clean`, `hip`, `fancy`, `mono`), `paragraphStyle` (`ultra`, `h0`, `h1`, `h2`, `body`).
  - `richText`: `text` plus `formats[]` ranges (`location`, `length`, `type`: `bold`, `italic`, `underline`, `strikethrough`, `link` with `url`, and blocks `h1`–`h3`, `unorderedList`, `orderedList` with `level`).
  - `shape`: `kind` (`rectangle`, `circle`, `arrow` with `arrow`, `freehand` with `points[]` as fractions of the frame), `color` (a palette name).
  - `image`: `src` (a path in `images/`), `altText`.
  - `webCard`: a **capture**: `url`, `title`, `image.src`, `favicon.src`. Arc could switch a web card to a live web card after a confirmation dialog (strings `liveWebCard`, `easel.useLiveWebCard`): the play button.
  - `browser`: a live page embedded in the Easel: `url` only.
  - `link`: `source`, `title`, `description`, `image.src`; a video link has `video.url` and `video.size`.

**Importer** (about 3–4 days): **Import Easels** picks the export folder (or its `easel.json` files) and makes one canvas per Easel, in the space whose sidebar had an Easel with that title (else the current space). Mapping to board items, with 1 Easel point = 1 board pixel: `text` → text (sizes from the style: `ultra` 80, `h0` 60, `h1` 44, `h2` 24, `body` 15–18); `richText` → text, formatting dropped, links kept as the element's link; `shape` → rectangle, ellipse, arrow or drawing (triangle and line once the board has them); `image` → image; `webCard` → a capture card (and live once phase 2 exists); `link` → its thumbnail as an image with the link, or a text card; `browser` → a capture placeholder with the URL. Colors map from the palette names to the board's palette.

**Tell users now:** export your Easels from Arc's Library before Arc's servers shut down (2026-12-22); without the export there is nothing to import. The README says so.

---

## 6. Sharing: none, everything stays local

Decided 2026-11-20: no sharing for now. Arc's shared Easels lived on Arc's servers and opened at a public URL. YARC has no server and no accounts, and won't add them for this: no share links, no uploads, no collaborative editing. A canvas leaves the machine only when the user exports it to a file and sends that file themselves.

### Export to a local file

| Format | How | Notes |
|---|---|---|
| PNG | `exportToBlob`, then save dialog or clipboard. | Same as Arc's export. 2× scale by default. |
| SVG | `exportToSvg`. | Captures are embedded as images. Add each capture's source link as an `<a>` around it (post-process with `customData.yarc.sourceUrl`). |
| PDF | Render the SVG in a hidden window and `printToPDF` with a page size fitted to the canvas. | Text stays selectable, links clickable. |
| HTML | One self-contained file: the SVG inline, images as data URLs, a little CSS for pan/zoom. | Opens in any browser, offline. |

Every export is a file the user saves; nothing is uploaded. Every export uses the last captured images, and none loads a source page.

---

## 7. Name

Since PR #76 YARC doesn't use Arc's product terms (Little Arc became Little Window). "Easel" is out. The name should say what it is to someone who never used Arc.

| Name | For | Against |
|---|---|---|
| **Canvas** (recommended) | Plain, says "freeform space". Users of Figma, Miro, Slack and Obsidian know the word. "New Canvas", "Capture to canvas" read well. | Generic; also an HTML element (only developers will notice). |
| Board | Short; "pinboard"/"moodboard" sense. | Vague; "Board" alone sounds like a kanban board. |
| Scrapbook | Fits "cut bits out of pages and stick them down". Friendly. | Sounds like a static collection; long in a sidebar. |
| Chart | Fits YARC's pirate theme ("Yarrr!"): a sea chart you pin things to. | Everyone will read it as a bar chart. |

For the cut-out: **Capture** is a plain verb, not Arc's product term, and matches the command users will look for. Keep it. Live captures: "Live capture" / "Keep up to date".

---

## 8. Phased plan

Sizes are for one person who knows the codebase, including unit and e2e tests, and the macOS + Windows check.

### Phase 0: spike (2–3 days)
- Offscreen `WebContentsView` in a profile session: does `capturePage(rect)` work without attaching it to a window, on macOS and Windows? (If not: `BrowserWindow({ show: false, webPreferences: { offscreen: true } })` and its `paint` event.)
- A live view over the canvas (4.1): a `WebContentsView` above the canvas page, emulating the capture's viewport. Does the page keep its capture-time layout in a smaller box, is scaled text sharp, and does moving the view after a pan keep up?
- Outcome decides sections 4.1 and 4.2.

### Phase 1: MVP (about 3–4 weeks)
- `PinnedCanvas` kind, sidebar row, drag, folders, delete to trash, Library section, command bar entries.
- `canvas.html`, our own board (section 2): title, text, shapes, arrows, freehand, pasted and dropped images, captures as cards; the tools and object menu marked **Now** in 2.1. YARC's theme. Snapping with guides; "Arrange in Grid" for a selection.
- Storage per profile (5.1), atomic saves, image dedupe.
- Capture: hover-to-pick an element or drag a rectangle, full-resolution PNG, the Send To list (2.1), card footer (favicon, title, ↗ → Peek).
- "Add Image to Canvas…" in the page context menu.
- Export PNG and copy to clipboard.
- Not in MVP: live captures, full-page capture, other exports, canvas in a split, incognito canvases.

### Phase 1b: import Arc's Easel export (about 3–4 days)
- **Import Easels** reads the folder Arc's Library exports (`easel.json` per Easel, section 5.3) into canvases. Do this before 2026-12-22 so users know to export.

### Phase 2: live captures (about 3–4 weeks)
- **Phase 2a (built):** play / pause with live views placed over the card, as described at the top of 4.1.
- Play / pause with live views (4.1): placement over the canvas, swap to a still during gestures and menus, closing views off screen and under memory pressure (measure 10 live dashboards on an 8 GB machine to set the thresholds), mute, links to Peek.
- Selector anchoring (4.3), `capture-refresher.ts` with the queue, the guards in 4.4.
- Load on show, ⌘R, "Refresh picture", age on the chip, "Sign in needed", "may have moved", "Re-pick region".
- Full-page capture through CDP.
- Most of the time goes into testing against real sites (logged-in dashboards, feeds, single-page apps) and tuning the "settled" heuristic.

### Phase 3: more export formats (about 1 week)
- SVG with links, PDF, single-file HTML, all saved as local files (section 6).
- No sharing: no server, uploads or share links.

### Phase N: notes on the board (decided 2026-11-25, step 1 of 9.4 built)

A canvas should also be a good place to write. Fixes that came first: PR #132 (text saved as it's typed, paste, undo) and PR #133 (`canvas.tsx` split by responsibility). Section 9 has the design.

### Open questions for the maintainer
1. Canvases in incognito: none (simplest), or in-memory?
2. Should a canvas be allowed in Today, or pinned only?

---

## 9. Notes on the board

Decided with the maintainer on 2026-11-25. The board stays freeform; text becomes good enough to take notes with. What was wrong before: a text was one endless line (a pasted paragraph came out 1359 px wide on a 1280 px board), and nothing in a text had structure.

### 9.1 Decisions

- **Plain text, not rich text.** A text stays a string. Line prefixes are drawn when it isn't being edited; while editing, the raw text shows. No bold or italic. Copying a note gives Markdown-like text. Arc's `richText` Easel objects (5.3) import without their formatting.
- **One item kind.** A note is a `TextItem` with two more optional fields, not a new kind:

  ```ts
  export interface TextItem extends ItemBox {
    kind: 'text'
    text: string
    size: TextSize
    color: Color
    title?: boolean
    /** Lines wrap at this width; without it the text is as wide as its longest line (titles, labels). */
    wrapWidth?: number
    /** Drawn on a card: a note. */
    card?: boolean
  }
  ```

  The two are independent: a wrapped text without a card is a paragraph on the board. `isBoardItem` accepts both. An older build drops nothing: it ignores fields it doesn't know.

### 9.2 Behaviour

- **Width.** A selected text gets a handle on its left and right side; dragging one sets `wrapWidth` (a text without one gets it on the first drag). Height follows the text. A pasted text with a line longer than about 60 characters gets `wrapWidth: 420`.
- **Note tool (N).** A click places a note (`card`, `wrapWidth: 280`) and starts typing. The text tool (T) keeps making a plain label; dragging with it makes a wrapped text of the dragged width.
- **Lines**, drawn when not editing:
  - `- ` or `* ` at the start: a bullet.
  - `[ ] ` and `[x] `: a checkbox. A click on it toggles it (one undo step) without starting an edit.
  - `# `: a heading inside the note (heavier, one size up).
  - A URL: a link. ⌘-click (Ctrl-click) opens it in Peek; a plain click selects the note as usual.
- **Keys while typing.** Enter continues a list or checklist; Enter on an empty list line ends it. Tab and Shift+Tab indent a list line (Tab already inserts a tab elsewhere).
- **PNG export** draws wrapped lines, bullets and checkboxes itself (`canvas-png.ts` breaks lines with `measureText`).

### 9.3 Look

Built (2026-11-25):
- The style bar sits beside the selection: above it, below it when there's no room above, never out of the window (`placeBarBy`). With nothing selected it shows what the chosen tool will draw with, above the toolbar. Text sizes read Body, Heading and Title.
- Toolbar groups: select and hand, text, shapes, image.
- A faint dot grid on the board, so panning an empty part shows movement; zoomed far out, every fourth dot is left.
- The empty hint also says "Double-click anywhere to write".
- A light/dark button beside the menu button gives a board its own look, saved with the canvas (`appearance` in the scene); without it the board follows its space.

Built with the notes: the Note tool in the text group. Not built yet: list, checkbox and link buttons on the style bar.

### 9.4 Order

1. Wrapping text, the Note tool, lines, the keys, export, the grid and the hint (one PR, with a spotlight card). Built: the line rules are in `src/shared/canvas-notes.ts`.
2. "Add Selection to Canvas" in a page's context menu: a quote note with the same source footer as a capture card, through the inbox. ⌘F on a canvas finds in its text and pans to each match (today it does nothing). Built (2026-11-25): canvases by name in the command bar: typing a canvas's name offers it, ranked like an open tab (a canvas of the space you're in first; a name that starts with what was typed is a top hit), and Enter opens it, switching space if it lives in another. Shown with the canvas icon and the hint Open Canvas.
3. A canvas as a split pane, to write next to the page being read. Biggest piece: splits only hold tabs today. Planned in section 10: about 2½ weeks.

### 9.5 Open

- Whether split view (step 3) is in scope. Section 10 has the design, a size and its own open questions.
- Spellcheck is off for every UI page (`uiWebPreferences`). On macOS it's free; on Windows Electron downloads dictionaries from Google's servers, which may not fit "nothing collected".
- An item the board can't draw is dropped at load and gone after the next save. That matters only if an older build opens a canvas with a newer item kind.

---

## 10. A canvas in a split pane

Planned 2026-11-25, not decided (9.5): step 3 of 9.4. The use is reading a page with a canvas beside it to write notes, capture parts of the page and drop them where they belong, without switching back and forth.

### 10.1 Recommendation: a canvas is a pane like a tab

A split pane holds an item id (`SplitPane.itemId`), and a canvas id is an item id in the same space. So a canvas becomes something a split can hold, next to tabs, with everything splits already do: drag to split, the drop zones, resize, flip, move, Separate, Close Split, the pane bar, one split per window per space, restored after a relaunch.

Options considered:

- **A canvas as a split pane (recommended).** Reuses the split layout, its persistence and its menus; a Mac user who split Easels with tabs in Arc finds it where they expect it. Costs: every place that assumes a pane is a `LiveTab` has to accept a canvas (10.3, 10.4).
- **A notes drawer per window**: a canvas docked to one side that stays while you switch tabs. Better for notes across several pages, but it's a second layout system beside splits (its own resize, persistence in `WindowView`, drop zones, how it combines with a split, Peek and full screen) for one feature. If people want notes to stay across tabs, the split can learn that instead (question 1 in 10.7).
- **The canvas in Peek or a Little Window.** Nothing new to lay out, but Peek dims and covers the page, and a Little Window is a separate OS window to arrange. Neither is "beside".

### 10.2 What the user does

In:
- Drag a canvas's sidebar row onto the page's split drop zones, as with a tab.
- **Open Canvas Beside ▸** in a tab's context menu and the pane bar's split menu: the space's canvases, most recently used first, then New Canvas. A new canvas opens beside with its name being edited, as from the sidebar.
- The command bar's split target (⌃⇧= today) lists canvases by name once 9.4 step 2 puts them in the command bar.

Out:
- Separate from Split or Close Split, as for tabs. The canvas stays pinned and keeps its board.
- ⌘W in the canvas pane takes the canvas out of the split and leaves the tab; ⌘W in the tab pane closes the tab, and the canvas is shown alone (`nextActiveAfter` picks the split partner already).
- Deleting the canvas or moving it to another space takes it out of every split, as closing or moving a tab does.

At most one canvas per split. Two boards side by side have no use we know of, and a capture from the split's page then has one obvious target (10.5).

### 10.3 State, persistence and layout

**State.** No new fields. `Space.splits` and `WindowView.splits` already store pane ids; a canvas id fits. What changes is the code that checks a pane is a tab: `selectedIn` and `splitsIn` in `window-state.ts` drop ids that aren't in `spaceItems` (tabs only), so they need the space's canvases too. The selection half of that is a bug today: a selected canvas is dropped whenever another window is focused, and at relaunch. `splitWith`, `placeInSplit` and the layout use `findItem` and need the same.

**Older builds.** An older build opening a `state.json` with a canvas pane drops that pane in `splitsIn` and the split with it, since it has one tab left. Nothing breaks and no migration is needed.

**Layout.** `layout()` has three branches today (full screen, a canvas, tabs or a split). It becomes two: full screen, or the panes of the active item's split (one pane when there's none), where a pane's view is the tab's view or the canvas's `stage`. A canvas pane gets the pane bar like a tab: the canvas's name and icon, the split menu, the board's background color instead of a sampled page color.

**The canvas page in a pane.** `CanvasPage.stage` is already a plain `View` that sizes the page to its own bounds, and the live cards are its children, so it goes into a pane rect as it goes into the whole content rect. What a pane changes:
- **Live cards' clipping.** A live view is the card's box cut to the board's rect (`intersect` in `capture-live.ts`), both in the stage's coordinates, so a narrower pane clips them correctly already. A view doesn't clip its children on macOS, which is why that cut matters; it has to be checked with a card half off the pane's edge, on both platforms.
- **Resizing.** Dragging the divider resizes the stage on every frame. The board keeps its pan (its top-left stays put), so items don't slide while the divider moves; the page sends the live cards' boxes again as it already does on resize.
- **Narrow panes.** The toolbar and the style bar need about 360 px. A canvas pane gets that as its minimum width (`dragBorder` has 15 % of the split today); below that the toolbar can't fit.
- **Toolbars under live cards.** A live view drawn over the toolbars is a known gap (4.1). A narrow pane makes it more likely, so it's fixed in this work: the page cuts the toolbars' rects out of a live card's clip.

### 10.4 Focus and shortcuts

- Clicking into the canvas pane makes it the split's active item, as `onTabFocus` does for a tab; the canvas page's webContents gets the same `focus` handler.
- Shortcuts reach the canvas through its `before-input-event` as today, and it keeps ⌘D and ⌘± for itself (`CANVAS_KEYS`).
- Commands that need a page (⌘R, ⌘[ / ⌘], ⌘⇧C, ⌘L to edit the URL) act on the split's tab while the canvas pane is focused: the canvas has no URL or history of its own, and the user means the page beside it.
- ⌘F finds in whichever pane is focused (9.4 step 2 gives a canvas its own find).

### 10.5 What needs care

**Capturing into the canvas beside.** Capture (⌘⇧2) captures the split's tab even when the canvas pane is focused (`startCapture` uses the active tab today, which would be the canvas). The Send To list puts the canvas beside first. A capture or an "Add Selection to Canvas" (9.4 step 2) that goes to the canvas beside lands where the user can see it: at the middle of the board's visible part, selected, without the "Added to" toast. Dragging an image or a link from the page pane onto the canvas pane is a normal OS drop between two views; it should work already and needs testing.

**A second window showing the same split.** A canvas is in one window at a time, as a tab is (5.2). The focused window takes the stage; the other window marks the pane `elsewhere` and shows a still, as for a tab: `lend()` and `Mirror` look up `LiveTab`s today and need to accept the canvas page's webContents. The still is the page without its live cards (they are other webContents), so live cards show their last picture there. Clicking the still or focusing that window takes the canvas back, and its live cards load again (`setShown`).

**Incognito.** No. An incognito window has no canvases (Open Canvas Beside isn't shown, and a canvas row dragged from a normal window's sidebar onto an incognito page does nothing), because a capture from an incognito page beside a canvas would write that page to disk.

**Profiles.** A split's tab may be a favorite of the space's profile; the canvas loads its live cards with the space's profile (5.2), so both panes use the same sign-ins. Nothing new.

**Cost.** A split with a canvas keeps the canvas page and its live views alive while the split is shown. That is what showing the canvas alone does today; rule 2 of 4.1 still closes them when the split isn't shown.

### 10.6 Steps and size

Sizes as in section 8: one person who knows the codebase, with unit and e2e tests and the macOS + Windows check.

1. **A canvas id in a split** (3–4 days): `window-state.ts`, `splitWith` / `placeInSplit`, one layout path for tabs and the canvas stage, the canvas pane bar, the 360 px minimum, out of splits on delete and move. Fixes the canvas selection being dropped (10.3) on the way. Unit tests for `window-state.ts` and `split.ts`; e2e: a canvas beside a tab survives a window switch and a relaunch.
2. **Ways in and out** (2–3 days): drag a canvas row onto the drop zones, Open Canvas Beside ▸, ⌘W in each pane, the sidebar's split row drawing a canvas next to a tab, the command bar's split target once 9.4 step 2 is in.
3. **Focus, shortcuts and capture** (2–3 days): focus switching, page commands going to the tab, Capture and Add Selection targeting the canvas beside and landing in view.
4. **Second window** (1–2 days): `lend()` and `Mirror` for the canvas page, live cards coming back when the canvas does.
5. **Narrow panes and polish** (2 days): toolbars cut out of live cards' clips, live-card clipping checked on macOS and Windows, the drag-and-drop check, a spotlight card.

Total: 10–14 days, about 2½ weeks. Steps 1 and 2 together are usable on their own; 3 is what makes it a note-taking tool.

### 10.7 Open questions for the maintainer

1. Selecting another tab in the sidebar leaves the split today. With a canvas in the split, should it instead replace the split's tab, so the notes stay while reading several pages? It's what makes the split feel like a notes drawer (10.1), and costs about 2 days more.
2. Is one canvas per split the right limit?
3. Should page commands (⌘R, ⌘L, back and forward) go to the split's tab when the canvas pane is focused (10.4), or do nothing there?
4. Which side does Open Canvas Beside put the canvas on: always the right, or the side away from the sidebar (`sidebarRight`)?
