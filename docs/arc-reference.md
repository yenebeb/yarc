# Arc Browser UX Reference (for YARC)

Researched 2026-11-01. Covers Arc for macOS, the primary platform, and Arc for Windows.

## Status and sourcing

- **Arc is being sunset, not just maintained.** On 2026-10-22, The Browser Company announced that Arc for macOS and Windows stops working on **2026-12-22**: sign-in ends, accounts are deactivated and services are turned off. No new accounts can be created as of 2026-10-22. Users are being moved to Dia (source S1).
- **Most feature articles in the official help center have been removed.** `resources.arc.net` now returns 404 or a sign-in wall for Keyboard Shortcuts, Pinned Tabs, Spaces, Profiles, Little Arc, Peek and similar articles. The release notes are still public. This reference therefore relies on:
  - the official release notes (S2–S6);
  - the official Arc Resources Notion pages, with the macOS shortcut table and the Command Bar action list (S7, S8);
  - `start.arc.net` (S9);
  - search-engine snippets of the deleted help articles;
  - community guides.

### Confidence tags

| Tag | Meaning |
|---|---|
| **[O]** | Verified in an official Arc / The Browser Company source |
| **[C]** | Community source only (guide, cheat sheet, forum) |
| **[U]** | Unverified. Based on recalled or observed behavior; check against a real Arc install before relying on it |

Notation: on macOS, ⌘ = Command, ⌥ = Option, ⌃ = Control, ⇧ = Shift. On Windows, "Ctrl" and "Alt" are literal keys.

---

## 1. Keyboard shortcuts

### 1.1 Rules that apply to every shortcut

- **Ctrl+number on macOS.** On macOS, ⌘ is the tab/browser modifier, and **⌃ (Control) + number switches Spaces**. On Windows, Ctrl takes over ⌘'s role, so Space switching cannot use Ctrl+number there.
- **Remapping.** macOS shortcuts can be remapped in Arc > Settings > Shortcuts, or via ⌘T → "Open Shortcuts". Right-clicking a shortcut there offers "Reset Shortcut to Default" [O]. **Custom shortcuts are not supported on Windows** [O, via search snippet of the help article "How to Set Custom Keyboard Shortcuts on Arc for Desktop"].
- **Conflicts with web pages.** When a web page also binds a key, the page wins first. Pressing the same shortcut again runs Arc's action (2021) [O]. Some shortcuts have a per-shortcut "prefer Arc vs prefer website" option, for example ⌘E. Esc defaults to "Prefers Website" so that it does not accidentally exit full screen [O]. On Windows, when Ctrl+S or Ctrl+Shift+C conflicts with a site, Arc offers to run the Arc shortcut instead [O].
- **Toggle behavior.** Pressing ⌘T or ⌘L a second time while the Command Bar is open dismisses it [O].

### 1.2 Shortcut table

| Action | macOS | Windows | Notes / confidence |
|---|---|---|---|
| **Command bar (new tab / search / actions)** | ⌘T | Ctrl+T | [O] both. ⌘T opens the Command Bar centered over the content. The selected result opens as a new tab in Today. |
| **Edit current URL** (Command Bar prefilled with the current URL) | ⌘L | Ctrl+L, also Alt+D | [O] both. Anchored to the sidebar URL field. ⌘L then Enter reloads the page [O]. |
| New window | ⌘N | Ctrl+N | [O] both. Opens a second full window with your Spaces, on the current window's space, with the command bar open (observed 2026-11-09, see §6 Multiple windows). |
| Blank window (no sidebar Spaces; temporary) | ⌃⌘N | — | [O] mac (2023; still in the File menu, 2026-11-09). Windows: [U] |
| New incognito window | ⇧⌘N | Ctrl+Shift+N | mac [O]; Windows [C]. Incognito windows are black, show an "Incognito" label and have no Spaces [O]. |
| **New Little Arc window** | ⌥⌘N | — (not on Windows) | mac [O]. No Little Arc entry anywhere in the Windows release notes, so treat it as macOS-only [C]. |
| Little Arc → move to main window (current Space) | ⌘O | n/a | [O] (2021) |
| Little Arc → "Open In…" Space menu (keyboard) | ⇧⌘O | n/a | [O] (2022). One community guide says ⌥⌘O [C]. |
| Open link in Little Arc | ⌘⌥+click | n/a | [O] (2022) |
| **Toggle sidebar** | ⌘S, or ⌥⌘B | Ctrl+S | mac [O] (Notion shortcut table lists both); Windows [O] |
| Toggle Toolbar (full URL bar above the content) | ⇧⌘D | [U] | mac [O, search snippet]. Also View > Show Toolbar, or ⌘T "Show Toolbar". |
| **Copy current URL** ("Super Copy": strips tracking parameters) | ⇧⌘C | Ctrl+Shift+C | [O] both. With multiple tabs selected, copies all of their URLs [O]. |
| **Copy URL as Markdown** | ⌥⇧⌘C | Ctrl+Alt+Shift+C | [O] both |
| Paste clipboard URL as new tab | ⌥⌘V | [U] | mac [O] (2023) |
| **Close tab** (unpinned tab = archive it) | ⌘W | Ctrl+W, also Ctrl+F4 | [O]. ⌘W on a pinned tab closes/unloads it but keeps the pin (see §4). With multiple tabs selected, closes all of them [O]. |
| Close window | ⇧⌘W | Alt+F4 | mac [O] (File menu, 2026-11-09); Windows [O] |
| **Reopen last closed tab** | ⇧⌘T (also ⌘Z) | Ctrl+Shift+T | [O]. Also reopens a closed Peek [O]. |
| Undo last sidebar action (archive, move, clear) | ⌘Z | Ctrl+Z | [O] both |
| **Pin / unpin current tab** | ⌘D | Ctrl+D | mac [O]; Windows [C] |
| **Clear unpinned ("Clear Today")** | ⇧⌘K | Ctrl+Shift+K | mac [O]; Windows [O, search snippet of the official table]. One community list says Ctrl+Alt+K, which is likely wrong. |
| **Go to sidebar item N** | ⌘1 … ⌘8 | Ctrl+1 … Ctrl+8 | mac [O]; Windows [C]. Favorites count in the ordering by default; can be turned off with "Include Favorites in Ordering" [O]. |
| Go to last sidebar item | ⌘9 | Ctrl+9 | [O] mac: configurable as "9th tab" or "last tab". Windows: [U] |
| **Next / previous tab in sidebar** | ⌥⌘↓ / ⌥⌘↑ | Ctrl+Alt+↓ / Ctrl+Alt+↑ | mac [O]; Windows [C]. Skips collapsed pinned tabs [O]. |
| **Recent-tab switcher (MRU)** | ⌃Tab | Ctrl+Tab | [O] both. Hold ⌃ and keep tapping Tab to go further back. ⌃⇧Tab or ⌃\` goes backwards [O]. ⌃W while the switcher is held closes the highlighted tab [O]. Overlay uses Space theme colors [O]. **This is not Chrome-style next-tab.** |
| **Switch to Space N** | ⌃1 … ⌃9 | Alt+1 … Alt+9 | mac [O]; Windows [C] (allthings.how). |
| **Next / previous Space** | ⌥⌘→ / ⌥⌘← | Ctrl+Alt+→ / Ctrl+Alt+← | mac [O]; Windows [C] (two independent sources). Also: two-finger horizontal swipe on the sidebar, mouse buttons 4/5 [O both]. |
| New Space | (no default) → ⌘T "New Space" | Ctrl+T "New Space" | [O]. Some community lists claim ⇧⌘N, which conflicts with incognito; treat as wrong. |
| New Folder | (no default) → ⌘T "New Folder" | Ctrl+T "New Folder" | [O]. Multi-selected tabs + "New Folder" pins the selection into a new folder [O]. |
| **Add Split View** | ⌃⇧= (shown as "⌃⇧+") | Ctrl+Shift+= ("Ctrl+Shift++") | [O] both. Maximum 4 panes [C, consistent with "more than four tabs in Split View" edge-case note, O]. |
| Close focused split pane | ⌃⇧- | Ctrl+Shift+- | mac [O]; Windows [U] |
| Focus split pane N | ⌃⇧1, ⌃⇧2 … | [U] | mac [O] |
| Focus next / previous split pane | ⌃⇧] / ⌃⇧[ | [U] | [C] |
| Add Left / Right / Top / Bottom Split | ⌘T "Add Right Split" etc. | Ctrl+T "add top split" etc. | [O] |
| Open link or tab in Split View | ⌥+click a link or tab | [U] | [O] mac. ⌥+click on the *current* tab duplicates it into a Split [O]. ⌥+click on a split tab in the sidebar un-splits it [O]. |
| **Find in page** | ⌘F | Ctrl+F | [O]. With Arc Max on, this becomes "Ask on Page". |
| Find next / previous | ⌘G / ⇧⌘G | Ctrl+G / Ctrl+Shift+G | mac [C]; Windows [C] |
| **History** | ⌘Y | Ctrl+H | mac [O]; Windows [C] |
| **Downloads** (Library › Downloads) | ⇧⌘J | Ctrl+J | mac [C]; Windows [O] |
| Library | ⇧⌘L [C] / ⌘T "Open Library" [O] | [U] | |
| Archive | ⌘T "View Archive" | Ctrl+T "View Archive" | [O] |
| **Developer tools** | ⌥⌘I, also F12 | Ctrl+Shift+I, also F12 | [O] both. ⌥⌘J opens the JS console [C]. Device toolbar: Ctrl+Shift+M (Windows) [O]. |
| View source | ⌥⌘U | Ctrl+U | mac [C]; Windows [O] |
| Developer Mode (Arc's localhost styling) | ⌃D | [U] | [O] mac (2023) |
| **Reload** | ⌘R | Ctrl+R / F5 | mac [O]; Windows [U] (standard Chromium binding). ⌘+click on Reload duplicates the tab [O]. |
| **Hard reload** | ⇧⌘R | Ctrl+Shift+R | mac [O] (2021); Windows [U] |
| Stop loading | ⌘. | Esc [U] | mac [C] |
| **Zoom in / out / reset** | ⌘+ / ⌘- / ⌘0 | Ctrl+ + / Ctrl+ - / Ctrl+0, Ctrl+mouse wheel | [O] both. Windows shows a zoom-percentage toast [O]. |
| **Back / forward** | ⌘[ / ⌘], or ⌘← / ⌘→ | Alt+← / Alt+→ [U] | mac [O]. ⌘+click or middle-click on Back/Forward/Reload opens the result in a new tab (both platforms) [O]. |
| Full screen | ⌃⌘F, also Fn+F | F11 [U] | mac [C] / [O] (Fn+F) |
| Settings | ⌘, | Ctrl+, | [O] both |
| Arc app menu | (macOS menu bar) | Alt+F | [O] Windows |
| Extensions (cycle through pinned extensions) | ⌘E (hold ⌘, tap E to cycle) | [U] | [O] mac (2022/2023) |
| **Capture** (screenshot to Easel) | ⇧⌘2 | n/a | [O] mac. Easels are not on Windows [U]. |
| New Easel | ⌘T "New Easel" | n/a | Keyboard binding is disputed between sources (⌃⇧E vs ⌃⇧L) [C]. |
| New Note (Notes are deprecated; see §6) | ⌃⇧N | n/a | [O] (2023) |
| Join active meeting (Live Calendar) | ⌃⌘J | [U] | [O] mac |
| Print / Save page as | ⌘P / ⇧⌘S | Ctrl+P / [U] | mac [C]; Windows Ctrl+P [O]. On Windows Ctrl+S is taken by the sidebar toggle, so Save As has no Ctrl+S binding [U]. |
| Reader mode | ⌘T "Reader Mode" | [U] | [O] (2021, via command) |
| **Peek → open as full tab** | ⌘O [U] / expand button | Ctrl+O | Windows [O] |
| Peek → close | Esc, click outside, or × | Esc, click outside, or × | [O] |
| Open link in Peek | ⇧+click (setting "Shift-click opens Peek") | ⇧+click | [O] |
| Focus sidebar for arrow-key navigation | ⌘. (2021; later reassigned?) | [U] | [O] 2021 note only; current binding [U] |
| Command Bar: open actions mode | Tab right after ⌘T, or type "/ " | same | [O] |
| Command Bar: delete highlighted suggestion | ⌥⌘⌫ | [U] | [O] |
| Command Bar: Instant Links (open top result directly; Arc Max) | ⇧Enter | [U] | [O] |
| Command Bar: Site Search ("Tab to Search") | type the site (e.g. "youtube") then Tab; see §5.1 | n/a | mac [O]; Windows lacks it [O, S26] |
| Hide / minimize / quit | ⌘H / ⌘M / ⌘Q | — | macOS standard |

**Verified-missing on Windows** [O, absence in the 2023–2026 Windows release notes + community sources]: Little Arc, Easels/Notes/Capture, Boosts [U], Air Traffic Control [U], custom shortcuts.

---

## 2. Sidebar anatomy and behavior

### 2.1 Vertical layout (top to bottom), macOS

| # | Region | Contents / behavior |
|---|---|---|
| 1 | **Top bar row** | macOS traffic lights at the top-left *inside* the sidebar. To their right: sidebar-toggle icon, then Back, Forward, Reload [O: "Narrowing the sidebar keeps your forward and back buttons intact"; animated refresh/back/forward buttons]. Empty sidebar area drags the window [O]. On Windows the min/max/close controls sit at the top-right of the window, next to a Split-View icon and pinned extensions in a thin top toolbar [O]. |
| 2 | **URL / domain field** | A pill showing the **domain only** by default, not the full URL [O: "Toolbar" setting exists for full URLs]. Contains: the Site Control Center button (permissions, extensions, Boosts, PiP toggle) [O], a copy-URL button [O], and a Boost indicator. Page-load progress shows here (2021) [O]; a newer animated loading indicator sits at the top-center of the window (2023) [O]. Clicking the pill = ⌘L. Pinned extensions appear on hover over the URL bar [O]. |
| 3 | **Favorites grid** | Large square icon tiles, **max 12 per Profile** (raised from 8) [O]. They lay out in rows of up to about 4 that wrap ("improved the layout of Favorites when you have more than 4") [O]. Badges: unread counts (Slack, Gmail, …) [O], animated music notes when audible [O], Live Calendar countdown and "Join" button [O]. Double-click resets a Favorite to its pinned URL (Windows) [O]. You can have zero Favorites [O]. |
| 4 | **Space header** | Space icon (emoji) + name. Clicking the name collapses or expands the Pinned section [O: collapsed pinned; header turns bold when collapsed and the last pinned tab is in view]. Hover shows "…" / Edit (theme, name, icon, profile) [O]. Right-clicking the header opens Space options [O]. |
| 5 | **Pinned section** | Pinned tabs and nested **Folders** (colored folder icons, open/close animation [O]). A folder can be collapsed while its active tab stays visible [O]. Splits can be pinned as a single item [O]. Shared folders and GitHub Live Folders also appear here [O]. |
| 6 | **Divider + "Clear" + "+ New Tab"** | A thin horizontal line separates Pinned from Today (introduced in 2022 to replace the "Explore" header) [O]. A "Clear" control (⇧⌘K) sits at the right end of the divider and is visible on hover [O: "hitting 'Clear' above your Unpinned Tabs"]. Directly below is a "+ New Tab" row [O: "A 'New Tab' button in the sidebar"]. The Tidy Tabs broom (Arc Max) appears at the top of Today [O]. |
| 7 | **Today (unpinned) tabs** | Ephemeral tabs. New tabs are inserted at the **top** of the list, just under "+ New Tab" [U]. Auto-archived (see §2.3). Each row shows favicon, title, and an × on hover. Audio icon click toggles mute [O]. |
| 8 | **Media / audio tray** | Appears above the bottom bar when you leave a tab playing audio or video. Controls multiple players [O]. Dismissable [O]. |
| 9 | **Update banner** | Collapsed by default, expands on hover [O]. Strings in Arc 1.x for macOS: title "An update is ready!", description "Click to restart", button "Restart and Update"; after the update, "Update Complete!" with "See What's New" [Arc binary, 2026-11-09]. It can be dismissed (Arc keeps `autoUpdateBannerDismissalCount` in its defaults). Arc downloads with Sparkle in the background and installs on quit; the menu item reads "Update Available" instead of "Check for Updates" while one waits. On this Mac, with an update downloaded three days earlier (`currentUpdateDownloadedSince`) and the banner dismissed, Arc showed no banner and no dialog. YARC: a "Restart to Update" pill above the bottom bar, the relaunch card only after a week (`src/main/update-escalation.ts`). |
| 10 | **Bottom bar** | **Left:** Library button (Archive, Downloads, Media, Easels; called "Archive / Downloads" on Windows) [O: "bottom-leftmost icon"]. A download icon appears while downloads are active [O]. **Center:** Space switcher, one icon per Space (emoji/icon, or a dot when there is no icon). Click to switch; drag to reorder [O]. Right-click a Space icon to edit it [O]. **Right:** "+" menu: New Tab, New Space, New Folder, New Split, New Easel/Note, New Boost, Add files [O]. |

### 2.2 Interactions

- **Space switching.**
  - Two-finger horizontal swipe on the sidebar slides the entire sidebar (Favorites, header, pinned and today) to the adjacent Space [O].
  - Ways to switch: click an icon, ⌃N, ⌥⌘←/→, or mouse buttons 4/5 [O].
  - When the target Space uses a different Profile, the Favorites row changes too [O: "Favorites render more smoothly when swiping between Spaces associated with different Profiles"].
  - The Command Bar suggestions update to the new Space [O].
- **Resizing.** Drag the sidebar's right edge to resize. Double-click the edge to reset to the default width [O]. Dragging it all the way left collapses (hides) it [O]. Min and max widths are enforced [O].
- **Hidden sidebar ("unanchored" or "undocked" mode).**
  - ⌘S, or drag the sidebar to zero width.
  - The content then fills the window edge-to-edge; only a small window margin remains [U].
  - **Hovering the left screen/window edge reveals the sidebar as a floating overlay** with rounded corners and a shadow, over the content [O: Windows notes on "unanchored Sidebar appears on hover", "Sidebar corners become unrounded when undocked" bug].
  - The overlay hides again once the pointer has left it, but not right at its edge: there is some room past the edge (enough to grab it and resize), and a short delay [user report 2026-11-06]. YARC: 32 px past the edge, 300 ms (`PEEK_GRACE`, `PEEK_HIDE_DELAY` in `src/main/browser.ts`); the exact values in Arc are [U]. The edge can be dragged to resize while it is out.
  - When a new tab is created while the sidebar is hidden, a clickable "New Tab Created" toast appears [O].
  - With the sidebar hidden and no Toolbar, the URL is reachable via ⌘L, which opens a centered bar [U].
- **Window focus.** The sidebar dims slightly when the Arc window is not focused [O].
- **Keyboard navigation.** ⌥⌘↑/↓ moves the selection through the sidebar items in order: Favorites, then pinned, then today [O/U].
- **Multi-select.**
  - ⌘+click (non-contiguous) or ⇧+click (range).
  - Right-click actions on a selection: move, pin, new folder, copy URLs, archive [O].
  - Right-click a tab → "Archive Below" archives the tabs under it [O].
- **Sidebar position.** **The sidebar is left-only; Arc never shipped a "sidebar on the right" option.**
  - The CEO said in Nov 2023 that they prototyped it and rejected it on ergonomics (S14).
  - No release note mentions the option.
  - Confidence: [C]. A clone adding a right-side option is a deliberate deviation from Arc.

### 2.3 Auto-archive (Today tabs)

- **Default: 12 hours** of inactivity. Configurable from **12 hours up to 30 days** [O]. The option list is 12 hours / 24 hours / 7 days / 30 days [U]. Whether there is a "Never" option is [U]; probably not.
- The setting is **per Profile** (Arc > Settings > Profiles) [O, 2024] and syncs across devices [O].
- **Tabs playing media are never archived or cleared** [O].
- **Little Arc windows** auto-archive after **6 hours** by default (Arc > Settings > General) [O].
- Downloads are auto-archived the same way as tabs [O].
- **Pinned tabs and Favorites are never auto-archived** [O/C].

### 2.4 Window framing and visual treatment

These values are measured from screenshots and are all [U] unless stated otherwise.

| Element | Value |
|---|---|
| Default sidebar width | ≈ 240–260 px (macOS points). Resizable roughly 180–400 px. |
| Web content frame | Content sits in a **rounded rectangle**, corner radius ≈ 8–10 px, **inset ≈ 8 px** from the window's top, right and bottom edges and from the sidebar. A subtle shadow/border sets it apart. The window background (the Space theme) is visible in the gap [O for rounded corners: "web contents corners become unrounded" bug fix]. |
| Content with sidebar hidden | Same rounded card with ≈ 8 px inset on all sides [U]. |
| Split View | Each pane is its own rounded card with ≈ 8 px gutters. The divider between panes is draggable [O]. Each pane takes on its site's color [O, Windows]. The focused pane has a subtle highlight or outline [U]. |
| Sidebar rows | Row height ≈ 32–36 px, horizontal padding ≈ 8–12 px, corner radius ≈ 6–8 px. The selected tab is a lighter, translucent white "card" with a subtle shadow. Hover is a fainter fill [U]. |
| Favorites tiles | ≈ 48–56 px tall rounded squares (radius ≈ 8–10 px). The selected tile is filled more brightly [U]. |
| Peek | Floating rounded card at roughly 80–90 % of the content area, centered over the dimmed current page. Its controls (×, expand, split) sit to the left/top of the card [U]. Controls order matches across platforms [O]. |
| Status pill (link hover URL) | Bottom-left of the content. Matches the sidebar theme [O]. Moves away when the cursor approaches [O]. |

**Space themes** [O unless noted]:
- Each Space has a theme. It colors the whole window chrome: sidebar, top margin and the gap around the content card.
- Theme editor (paint-brush icon or Edit next to the Space name):
  - pick 1–3 colors to build a **gradient** [U for the exact max count];
  - **intensity** and **grain/noise** sliders;
  - light, dark or auto mode.
- Gradient themes sync between macOS and Windows.
- Dark themes render darker on Windows.
- Text-selection highlight in the sidebar uses the theme color. The Ctrl+Tab switcher and the drop indicators also use it.
- Windows has an "Appearance > Acrylic" translucency option [O].
- Theme CSS variables were exposed to Boosts via `arc.net/colors.html` [O].
- Incognito windows are black [O].

---

## 3. Spaces and Profiles

### 3.1 Definitions

- **Space**: a separate sidebar. Each Space has its own Pinned tabs, Folders and Today tabs, plus its own theme, icon and name. "Each Space is a unique sidebar, filled with its own Pinned tabs, Today's tabs, and Folders" [O, S10].
- **Profile**: a Chromium profile. It scopes **logins, cookies, browsing history** and more "to one or multiple Spaces" [O]. It also holds:
  - **Favorites** [O/C];
  - extensions [C];
  - saved passwords [C];
  - default search engine [O: "Edit your search engine via Arc > Settings > Profiles"];
  - **auto-archive timing** [O];
  - Chromium settings [O].
- A Space belongs to **exactly one Profile**. A Profile can back **many** Spaces. You assign the Profile when you create the Space, or later via Space Edit → Profile [O].

### 3.2 What lives where

| Item | Scope |
|---|---|
| Favorites | **Profile**. Every Space using that Profile shows the same Favorites [C, multiple sources and Lilo importer PR; consistent with the official note about Favorites changing when swiping between Profiles]. |
| Pinned tabs, Folders | **Space** |
| Today tabs | **Space**. Shared across all windows, since they sync across windows (see §7) [O]. |
| Theme, icon, name | Space |
| Cookies, logins, history, extensions, passwords, search engine, archive timing | Profile |
| Command Bar history suggestions | Profile [O: suggestions reset when switching to a Space in a different Profile] |
| Archive | Global list, filterable. Restored tabs return to the Space they came from [O]. |
| Sync (Arc Sync) | Spaces, Folders, tabs and Space order sync across devices and platforms. **History, passwords, extensions, Favorites and Profiles do *not* sync** (Windows note) [O]. |

### 3.3 Switching behavior

- Switching Spaces swaps the whole sidebar below the URL field, with a horizontal slide animation [O/U].
- The Favorites row changes only if the target Space has a different Profile [O].
- Each Space remembers its last-selected tab, which is reselected when you return [U].
- The window theme cross-fades to the new Space's theme [U].
- **Moving a tab to a Space with a different Profile** (right-click → Move to…) shows a confirmation, because the tab will lose its cookies/session [O/C].
- Little Arc remembers which Profile you chose per domain [O].
- Air Traffic Control (Settings > Links) routes URLs to Spaces by domain rules [O].

---

## 4. Pinned tab semantics

| Behavior | Detail |
|---|---|
| **Pinned URL** | Each pinned tab stores the URL it was pinned at, separately from its live URL. Editable via right-click → Pinned URL → Edit Pinned URL… [O]. Command Bar action "Replace Pin with Current Page" [O]. |
| **Navigating away** | You can browse freely inside a pinned tab. Once its live URL differs from the pinned URL: (a) the row shows the favicon, then a **"/" slash**, then the current page title, so it reads as "site / subpage" [C, multiple users]. (b) Hovering the favicon shows the subtitle **"Back to Pinned URL"** [O]. (c) Clicking the favicon resets the tab to the pinned URL [O]. (d) **⌘+click on the favicon** resets the tab *and* opens the previous URL in a new tab [O]. The reset icon visual was updated in 2021 to make "navigated away" clearer [O]. |
| **Links to other domains** | Clicking a link in a pinned tab or Favorite that leads off-site opens it in **Peek** instead of navigating the pinned tab. Can be toggled in Settings [O]. The "different domain" condition is [C]. Meeting links open in a new tab instead [O]. Checked in real Arc (2026-11-01): a pinned example.com tab opened its iana.org link in Peek; typing another example.com URL into the pinned tab navigated it and showed the "/". |
| **Closing** | ⌘W, or the × shown on hover, **closes and unloads** the page but **keeps the pin**. The row stays in the sidebar, visually de-emphasized (no "open" state) [C]. Clicking it again loads the **pinned URL**, not the last URL [C, Firefox/Zen/Re-Arc threads; Arc Command Bar defines "Close Tab: Closes current Pinned tab" separately from "Archive Tab" [O]]. Windows added a close button for pinned tabs [O]. Checked in real Arc (2026-11-01): with a pinned tab active, the File menu item is "Close Tab" (not "Archive Tab"); ⌘W kept the row, removed the "/", reset its URL to the pinned URL and moved to the previously used tab. |
| **Reset actions** | "Reset Tab" resets one pinned tab. "Reset Space" resets all pinned tabs in the Space to their pinned URLs [O]. You can set a shortcut for "Reset Tabs" (none by default) [O]. |
| **Unpin** | ⌘D, or drag the tab below the divider → it becomes a Today tab. |
| **Pin** | ⌘D, drag the tab above the divider, or ⌘T "Pin to [Space]" / "Pin to [Folder]" [O]. Pinning used to open a rename prompt; that was removed in 2024. Rename by double-clicking or right-clicking [O]. Custom tab titles and icons are allowed [O]. |
| **Duplicates** | Arc doesn't prevent pinning the same URL twice [U]. ⌥+drag duplicates a tab [O]. Command Bar "Duplicate Current Tab" [O]. **Tab Handoff**: a given tab has only one live instance, even across windows [O]. |
| **Collapse** | Click the Space name, or ⌘T "Collapse Pinned" / "Expand Pinned" [O]. |
| **Pinned Split** | A Split View can be pinned or favorited as one unit [O]. Making a split by dragging within the Pinned section keeps it pinned [O]. |
| **Drag & drop** | Today → above divider = pin. Pinned → below divider = unpin. Any tab → Favorites area = favorite (drag a tab to the top of the sidebar) [O]. Into a folder; moving a tab into a folder "peeks" the folder open [O]. Onto another tab's left/right side = Split View, and the side sets pane order [O]. Onto a Space icon or sidebar edge = move to that Space [O]. Out of the window = new window [O]. Between windows [O]. Links or files from a page into the sidebar = new tab [O]. Holding ⌥ while dragging = duplicate [O]. |
| **Preloading** | Favorites stay loaded only if used recently [O]. Background tabs that use too much CPU are frozen (Windows) [O]. |

---

## 5. Command Bar

- **Invocation.**
  - ⌘T: centered floating panel over the content; centered in new windows [O].
  - ⌘L: anchored at the sidebar URL field, prefilled with the current URL, text selected [O/U].
  - Clicking the "+ New Tab" row opens the Command Bar [O].
  - Dismiss with Esc, a second ⌘T/⌘L, or a click outside [O]. The sidebar stays clickable while the bar is open [O].
- **Result sources** [O for each source's existence]:
  - URL and search autocomplete (top hit);
  - **open tabs → "Switch to Tab"**, including tabs in other Spaces. Selecting one switches Space and selects that tab instead of opening a duplicate;
  - pinned tabs and Favorites;
  - history;
  - search-engine suggestions;
  - Spaces ("Focus on [Space]");
  - Folders ("Open [Folder]");
  - **Arc actions**;
  - extensions by name;
  - "Paste and Go" when the clipboard holds a URL (top option) [O];
  - Site Search keywords (keyword + Tab) [O], see §5.1.
- **Ordering** [U]:
  1. Top hit.
  2. Clipboard "Paste and Go" when present.
  3. Switch-to-Tab matches.
  4. History and navigation suggestions.
  5. Search suggestions.
  6. Actions, interleaved when the query matches an action name strongly.

  Shortcuts are rendered on the right of action rows [O]. Ranking was retuned several times [O].
- **Actions mode.** Press Tab immediately after ⌘T, or type "/ ", to search actions only [O].
- **Action catalog.** Official list (S8), plus later additions from the release notes:
  - **Navigation:** New Window, Blank Window, New Incognito Window, Little Arc, Toggle Sidebar, Reopen Last Closed Tab, Copy Current URL, Copy URL as Markdown, Clear Today, Reveal Tab in Sidebar, Reset Space, Go Back/Forward, Downloads, Find…, Close Tab (pinned), Archive Tab, Minimize/Close Window, Quit Arc.
  - **Organization:** New Space…, Select Next/Previous Space, Focus On [Space], Pin to [Space], Pin to [Folder], Pin to [New Folder], Unpin Tab, Favorite Tab, Unfavorite Tab, New Folder…, Rename Current Tab…, Rename Space, Duplicate Current Tab, Reset Tab, Replace Pin with Current Page, Move to [Space], Collapse/Expand Pinned, Manage Spaces.
  - **Split:** Add Split View, Add Left/Right/Top/Bottom Split, Remove Split View (closes the split, not its tab), Expand Current Split, New Note in Split View.
  - **Tools:** New Note/Easel, Capture Page / Capture Full Page / Capture in Portrait Mode, Open Library, View Archive, View History, View Source, Join Call, New Notion Page / Google Doc / Figma / Linear issue / Google Meet / Repl…, Create Boost, View Boosts, Share Boost, Share, Paste URL as New Tab, Reader Mode.
  - **Other:** Undo/Redo [Last Action], Save Page As…, Print…, Reload, Zoom In/Out/Actual Size, Switch to Light/Dark Mode, Developer Tools, Enter Full Screen, Restore Data (restores older sidebar versions), Show Toolbar, Release Notes / What's New, Help Center, Contact the Team.
  - **Settings:** Preferences/Settings, Open Shortcuts, Link Preferences, Site Search Settings, Advanced Preferences, Account Preferences, Manage Passwords, Set as Default Browser, Check for Updates, Add/Manage Extensions, [Extension name].
- **Instant Links** (Arc Max): ⇧Enter opens the top search result directly [O].

### 5.1 Site Search ("Tab to Search")

**Flow** [O, S26, S27]: ⌘T, type the site ("youtube", or a custom shortcut such as "yt"), press Tab, type the query, Enter. The results page opens like any Command Bar result. macOS only: the help article says it does not apply to Arc for Windows [O, S26]. Users add or edit sites in the Site Search section of Arc's settings, with a URL where `%s` is the query; Arc suggests one- or two-letter shortcuts for custom ones [O, S26]. The Command Bar action "Site Search Settings" opens that page.

**How it works.** Arc's Command Bar passes a `keyword:` to Chromium's autocomplete (`autocomplete:cursorPosition:preventInlineAutocomplete:startFresh:keyword:` in the Arc binary), so Site Search is Chromium's search-engine keyword mode. Arc seeds the profile's Chromium `keywords` table on first run (`SiteSearchMigrations.swift`). The list below was read from that table in a real Arc profile (`~/Library/Application Support/Arc/User Data/Default/Web Data`, `select short_name, keyword, url, prepopulate_id, is_active from keywords`, 2026-11-03 and 2026-11-04). The 19 sites match the URL and favicon list in `/Applications/Arc.app/Contents/MacOS/Arc`.

| Name | Keyword | Search URL (`%s` = query) |
|---|---|---|
| Google Drive | drive.google.com | `https://drive.google.com/drive/search?q=%s` |
| Gmail | mail.google.com | `https://mail.google.com/mail/ca/u/0/#apps/%s` |
| Google Maps | maps.google.com | `https://www.google.com/maps/search/%s` |
| Google Calendar | calendar.google.com | `https://calendar.google.com/calendar/u/0/r/search?q=%s` |
| Google Docs | docs.google.com | `https://docs.google.com/document/u/0/?q=%s` |
| Dropbox | dropbox.com | `https://www.dropbox.com/search/personal?&query=%s` |
| Amazon | amazon.com | `https://www.amazon.com/s?k=%s` |
| GitHub | github.com | `https://github.com/search?q=%s` |
| Figma | figma.com | `https://www.figma.com/files/search?q=%s` |
| X | x.com | `https://x.com/search?q=%s` |
| X | twitter.com | `https://twitter.com/search?q=%s` |
| YouTube | youtube.com | `https://www.youtube.com/results?search_query=%s` |
| Wikipedia | wikipedia.org | `https://wikipedia.org/w/index.php?search=%s` |
| Reddit | reddit.com | `https://www.reddit.com/search/?q=%s` |
| SoundCloud | soundcloud.com | `https://soundcloud.com/search?q=%s` |
| Asana | asana.com | `https://app.asana.com/0/search?q=%s` |
| LinkedIn | linkedin.com | `https://linkedin.com/search/results/all/?keywords=%s` |
| Apple Music | music.apple.com | `https://music.apple.com/us/search?term=%s` |
| Spotify | spotify.com | `https://open.spotify.com/search/%s` |
| Google | google.com | `https://www.google.com/search?q=%s` |
| Microsoft Bing | bing.com | `https://www.bing.com/search?q=%s` |
| DuckDuckGo | duckduckgo.com | `https://duckduckgo.com/?q=%s` |
| Ecosia | ecosia.org | `https://www.ecosia.org/search?q=%s` |
| Brave | search.brave.com | `https://search.brave.com/search?q=%s` |
| Qwant | qwant.com | `https://www.qwant.com/?q=%s` |
| PrivacyWall | privacywall.org | `https://www.privacywall.org/search/secure/?q=%s` |
| Perplexity | perplexity.ai | `https://www.perplexity.ai/search?q=%s` |

The last eight are Chromium's default search engines (`prepopulate_id` set, `is_active = 0`, meaning "unspecified", not off). They work with Tab in Arc too ("bing" → Microsoft Bing, checked by a user on 2026-11-04). This is the EEA choice-screen set from a Dutch install; Chromium picks it per country, and YARC uses this one everywhere. The table also holds the starter packs `@bookmarks` and `@history`, which YARC doesn't have. A second, separate list in the binary (Google, YouTube, Amazon, Wikipedia, Reddit, Twitter, Threads, LinkedIn, Pinterest, TikTok, Spotify, GitHub, Stack Overflow, Goodreads, Netflix, plus image/news/maps/flights) belongs to Arc Max's AI "siteSearch" action (`gptSiteSearchShortcut`), not to Tab.

**Mode details.** Not observed directly (driving Arc's UI from the agent failed on 2026-11-03); YARC follows Chromium's keyword mode [U]:
- Matching: the typed text is a keyword prefix ("you" → youtube.com, "twitter" → twitter.com) or a site name prefix ("gmail", "google m"); `https://` and `www.` are ignored. YARC needs two letters unless one letter is a whole name ("x").
- Hint: while Tab would switch, the field shows "Search YouTube" with a Tab key on the right.
- Mode: a chip with the site's favicon and name sits before the input; the placeholder becomes "Search YouTube…"; the only row is the query, "Search YouTube".
- Leaving: Backspace on an empty query leaves the mode and puts back what was typed; Esc closes the bar. Enter with an empty query opens the site itself (Chromium's behavior).

---

## 6. Feature summaries

### Split View [O unless noted]
- Holds 2–4 panes, horizontal or vertical. Orientation can be flipped with the Split Controls button at the top of the panel.
- Appears in the sidebar as **one item** showing several favicons. It can be pinned, favorited, renamed and moved as a unit.
- Ways to create one:
  - drag a tab from the sidebar into the content area (center or top/bottom for vertical);
  - drag a tab onto another tab's left/right half in the sidebar;
  - ⌥+click a link;
  - ⌃⇧=;
  - ⌘T "Add Split View";
  - the "+" menu;
  - the Peek "Split" button.
- Resize panes by dragging the divider.
- Drop indicators while dragging a tab [U, not yet compared with real Arc; this is what YARC does]:
  - Over the page: the pane under the cursor is cut corner to corner into four triangles. The nearest edge (left, right, top, bottom) is where the tab goes, and a highlighted card shows the half of that pane it would take. On a split page the zones belong to the pane under the cursor. A full split (four tabs) shows no zone.
  - Over a sidebar tab row: the middle half of the row (vertically) means split. The row turns into a preview of the split row, both favicons and titles, the dragged tab on the half the cursor is over. The top and bottom quarters keep reordering.
  - Escape or a drop outside the window cancels the drag and changes nothing.
- The Toolbar shows each pane's URL.
- Right-click a pane for Mute, Duplicate, Share.
- "Remove Split View" closes the pane without closing its tab. "Expand Current Split" turns the focused pane into a standalone tab.

### Multiple windows [observed in Arc 1.x on macOS 26.5, 2026-11-09, unless noted]
Checked by opening File › New Window in real Arc (System Events for the menus and clicks, `screencapture`), and by reading `~/Library/Application Support/Arc/StorableWindows.json` and `StorableSidebar.json`.
- **Menus.** File menu: New Tab… ⌘T, **New Window ⌘N**, Blank Window ⌃⌘N, New Incognito Window ⇧⌘N, New Little Arc Window ⌥⌘N, … Close Window ⇧⌘W (from `AXMenuItemCmdChar`/`AXMenuItemCmdModifiers`). Dock menu: New Window first, then New Incognito Window, then the Little Arc items (from the task brief; not re-read here).
- **⌘N** opens a full window, the same size as the current one, cascaded slightly below it (y + 14 pt). It shows the **space the current window shows**, with **no tab selected** (blank content card) and the **command bar open** for a new tab, the sidebar's "New Tab" row highlighted. The command bar suggests "Switch to Tab" for open tabs.
- **The sidebar is shared.** Both windows list the same favorites, the same pinned tabs and folders and the same space switcher. `StorableSidebar.json` keeps one pinned and one unpinned (Today) container per space, not per window, so Today tabs are shared too [C: from the data file; no Today tab was created to watch it].
- **Per window** (each entry of `StorableWindows.json`'s `windows`): its focused space (`focusedSpaceID`), its selected tab and split view (`contents.splitViewState`: `windowContentIDs`, `focusedContentID`), sidebar width and mode (`sidebarMode`, so a window can hide its sidebar while another shows it; observed), expanded folders (`expandedItems`) and per-item last-active dates. The file also has `lastFocusedSpaceID`.
- **The same tab in two windows.** Selecting a pinned tab in window B that window A already shows: both windows show the page. The focused window has the live page (the text field there has the caret and focus ring); the other keeps showing it without focus. Arc doesn't block it or move the tab out of A's selection.
- **Closing a window** (Close Window ⇧⌘W): the window goes; its tabs stay in the shared sidebar. `StorableWindows.json` drops the window's entry a few seconds later.
- **Quit and relaunch** [C: from the data file, not observed, to leave the user's Arc running]: `StorableWindows.json` keeps one entry per open window, so Arc restores every window that was open at quit, each with its own space, selection and sidebar mode.

### Little Arc [O, macOS only]
- A small floating browser window (narrow, roughly 1/3 of the screen) with a mini top bar: domain, back button, "Open in [Space]" button with a caret to choose the Space [C].
- No extra tabs, but extensions work.
- **Links clicked in other apps open in Little Arc by default** when Arc is the default browser. You can turn this off in Settings > Links; links then go to the main window [O/C].
- ⌥⌘N from any app opens Little Arc with the Command Bar.
- Clicking the same external link again resurfaces the existing window.
- Multiple Little Arc windows are allowed. Little Arc floats above full-screen apps.
- Dock menu: "Show/Hide All Little Arc Windows".
- ⌘O moves the page to the main window. ⇧⌘O picks the Space.
- Closed Little Arc pages go to the Archive (filter "Little Arc"). Auto-archive after 6 h.
- Remembers the Profile per domain.

### Peek [O]
- Floating modal preview over the current tab. Triggered by:
  - links from pinned tabs and Favorites (off-domain [C]);
  - ⇧+click on any link (setting);
  - links to Easels and Notes;
  - Folder "peek".
- Buttons: × close, expand (open as a real tab in Today), open in Split.
- Esc or a click outside closes it. Has an interactive dismiss gesture.
- ⌘Z / ⇧⌘T reopen a closed Peek.
- Can show the Toolbar.
- Follows Air Traffic Control routes.
- Both triggers can be disabled in Settings (Links on mac, General on Windows).

### Boosts [O, macOS]
- Per-site customizations: CSS, JS, "Zap" to hide elements, font and color.
- Ways to create: ⌘T "Boost"/"Create Boost", or "+" → New Boost. The legacy code editor has been deprecated.
- Toggle in the Site Control Center / URL bar.
- Shareable. JS Boosts are not auto-enabled on other devices.
- Theme colors are available to Boost CSS.

### Archive [O]
- Holds closed and auto-archived tabs plus Little Arc pages. Reached via Library → Archive, or ⌘T "View Archive".
- Searchable; filterable (e.g. Little Arc).
- Restore returns the tab to its original Space (with a toast if that is another Space) and follows ATC routes.
- "Clear Archive" (with confirmation) is in the menu bar or on right-click of the Library Archive icon.

### Library [O]
- Bottom-left sidebar button.
- Sections: Archive, Downloads (draggable into pages), Media, Easels & Notes (open in Peek).

### Easels [O, macOS]
- Freeform canvas: text, images, drawings, links.
- **Captures** (⇧⌘2) can be static or "live" (refresh with ⌘R).
- Shareable. Zoom with pinch or ⌘±. Export with ⇧⌘S.

### Notes [O]
- Arc Notes were **fully deprecated in 2024** and are export-only ("Export Arc Notes").
- "New Note" can target Google Docs, Notion or Word instead.

### Other sidebar extras [O]
- Hover previews for pinned Notion/Figma/Linear/Confluence/Calendar tabs.
- Live Calendars.
- Mini Player (auto PiP when you switch away from a playing video).
- Google Meet "Share This Tab Instead".
- Shared Folders/Spaces (share links).
- Tidy Tabs (Arc Max).

### Site permission prompts (checked in Arc on macOS 26, 2026-11-09)
Triggered from a local test page (`Notification.requestPermission()`, `getUserMedia({video, audio})`, `geolocation.getCurrentPosition()`) and screen-captured.
- **Where:** a popover hanging below the sidebar's URL field. Its arrow points at the Site Control Center button (the sliders icon at the right end of the field). It overlaps the page.
- **Look:** an NSPopover in the system appearance: dark in system dark mode even over a light-appearance space. About 236 pt wide, ~15 pt corner radius, translucent. A 32 pt round icon well on the left (bell for notifications, camera for camera/microphone, location arrow for location), the question in 15 pt regular text, then two equal 32 pt buttons, 8 pt apart. **Allow** is the lighter, default-looking one.
- **Words:** "Allow `<origin>` to send you notifications?", "… to access your camera, microphone?", "… to access your location?". The full origin with its scheme (`http://localhost:8765`), not the bare host. The buttons are **Not Now** and **Allow**, not Block / Don't Allow.
- **Keyboard:** Escape dismisses it.
- **Later:** decisions can be changed in the Site Control Center (the sliders button).
- **YARC (2026-11-09):** a prompt view of its own above the page (`src/main/prompt-view.ts`, `src/renderer/src/prompt.tsx`), fed by `PermissionQueue` (`src/main/permission-queue.ts`):
  - **Position and look:** it points 22 px in from the right end of the sidebar's URL field, where Arc's Site Control Center button is. YARC has no such button yet. With the sidebar hidden or a full-screen page, it sits at the page's top-left corner without an arrow. In Little Arc, it hangs under the toolbar's URL pill. It follows YARC's theme (system / light / dark), like Arc's follows the system.
  - **Words:** the host ("Allow meet.google.com to …"), not Arc's full origin: users asked for it (2026-11-10).
  - **Answers (2026-11-10), per profile, in `Profiles/<id>/permissions.json` (`src/main/site-permissions.ts`); incognito keeps them in memory:**
    - Allow sticks across restarts. Camera and microphone are separate answers.
    - Not Now (and Escape) refuses the site for the rest of the run. After three Not Nows across launches, the site isn't asked for a week and is refused meanwhile, like Chrome's embargo.
    - Settings > Site Permissions lists each site's answers. You can switch Allow / Block there, or Forget an answer so the site asks again.
  - **Frames:** like Chrome, a frame from another site can't ask for notifications. Meet inside Gmail used to ask on every launch.
  - **Background tabs:** a request from a tab that isn't on screen waits until the tab is shown.
  - **Hidden for now:** full-window panels (command bar, settings, library) hide the prompt until they close. There's no site-info button by the URL field yet; answers are changed in Settings.

---

## 7. Default behaviors

| Topic | Behavior |
|---|---|
| Links from other apps (macOS) | Open in **Little Arc** by default. Configurable in Settings > Links: Little Arc vs main window; with the main window they go to the default Space [O/C]. Air Traffic Control rules can route by domain to specific Spaces [O]. |
| Links from other apps (Windows) | No Little Arc. They open as a new tab in the active window's current Space, in Today [U]. |
| New tab placement | ⌘T result, + New Tab and ⌘/middle-click links all create a **Today tab at the top of the Today list** [U]. "All new tabs will open in the Today's tabs section by default" [O, S10]. ⌘+click in the background shows a "New Tab Created" toast when the sidebar is hidden [O]. |
| Multiple windows | ⌘N opens a full window showing the same Spaces. Pinned tabs sync across windows. Today tabs: briefly per-window in 2023, **then reverted: Today tabs sync across all windows and devices** (Arc 1.5) [O]. **Tab Handoff**: each tab has one live instance across windows, keeping scroll and form state [O]. Two windows can show different Spaces [U]. New Windows windows open staggered [O]. In full screen, ⌘N opens the new window in full screen [O]. |
| Blank window (⌃⌘N) | Temporary window without your Spaces. A tab dragged out of the sidebar can create one [O]. |
| Incognito | Black window, "Incognito" label, no Spaces, no history. The "+" button opens the Command Bar [O]. |
| Closing a window | macOS: Arc keeps running. The sidebar state persists because it is not tied to the window [U]. Windows: the last window's size, position and maximized state are restored on relaunch [O]. Arc restores a full window, plus the temporary window if that was the last one closed [O]. |
| ⌘W with no tab selected | Closes the window ("Close current tab or window") [O]. |
| Startup | Restores the sidebar (pinned + Today). Today tabs older than the archive threshold are archived [O/U]. |
| Media | Leaving a playing video auto-opens the Mini Player (PiP). Leaving an audio tab adds the sidebar audio tray [O]. |
| Undo | ⌘Z / Ctrl+Z undoes archive, move and clear operations in the sidebar [O]. |

---

## 8. Clone projects (prior art)

Several open-source Arc-clone efforts document the same behaviors and can be cross-checked: Re-Arc (`Re-Arc/re-arc-mac`), Nook (`nook-browser/Nook`), Lilo (`Alexays/Lilo`), plus PRs in `notnaki/vane` and `gabekus/kite`. Zen Browser is also relevant. Their specs agree with this document on the following:
- three sidebar tiers;
- closing a pinned tab unloads it but keeps the pin;
- Favorites are per Profile;
- links from other apps go to a mini window.

---

## Sources

- S1 Arc Sunset: Key Dates — https://resources.arc.net/hc/en-us/articles/44412972248471-Arc-Sunset-Key-Dates-and-What-to-Expect
- S2 Arc for Windows 2023–2026 Release Notes — https://resources.arc.net/hc/en-us/articles/22513842649623-Arc-for-Windows-2023-2026-Release-Notes
- S3 Arc for macOS 2024–2026 Release Notes — https://resources.arc.net/hc/en-us/articles/20498293324823-Arc-for-macOS-2024-2026-Release-Notes
- S4 Arc for macOS 2023 Release Notes — https://resources.arc.net/hc/en-us/articles/20498377604887-Arc-for-macOS-2023-Release-Notes
- S5 Arc for macOS 2022 Release Notes — https://resources.arc.net/hc/en-us/articles/20498417809815-Arc-for-macOS-2022-Release-Notes
- S6 Arc for macOS 2021 Release Notes — https://resources.arc.net/hc/en-us/articles/20498463803799-Arc-for-macOS-2021-Release-Notes
- S7 Arc Resources › Shortcuts (official Notion) — https://browserinc.notion.site/Shortcuts-500ec3b2118b4824986427c32d2aba7e
- S8 Command Bar (⌘T) Actions (official Notion) — https://browserinc.notion.site/Command-Bar-T-Actions-e18b0069b1db45a99db1fc07d9ba4c41 (also https://start.arc.net/command-bar-actions)
- S9 Master your multitasking — https://start.arc.net/master-multitasking
- S10 Arc Cheat Sheet (official Notion) — https://browserinc.notion.site/Cheat-Sheet-1189845a429249a582c5b9d90a13647d
- S11 Getting Started with Arc for Windows — https://browserinc.notion.site/Getting-Started-with-Arc-for-Windows-145ece36acbb40f381ce1817747cb7ca
- S12 Deleted official Keyboard Shortcuts article (search snippets only) — https://resources.arc.net/hc/en-us/articles/20595231349911-Keyboard-Shortcuts
- S13 Deleted "How to Set Custom Keyboard Shortcuts on Arc for Desktop" (snippet) — https://resources.arc.net/hc/en-us/articles/25622899860631-How-to-Set-Custom-Keyboard-Shortcuts-on-Arc-for-Desktop
- S14 Josh Miller on sidebar-on-right (X, Nov 2023) — https://x.com/joshm/status/1724508113208754356
- S15 Hongkiat, 60+ Arc shortcuts — https://www.hongkiat.com/blog/arc-browser-keyboard-shortcuts/
- S16 dev.to, Arc shortcuts (Windows) — https://dev.to/sushmoy/arc-shortcuts-windows-18ec
- S17 allthings.how, Arc shortcuts for Mac — https://allthings.how/arc-keyboard-shortcuts-for-mac
- S18 allthings.how, Manage Spaces on Windows — https://allthings.how/how-to-manage-spaces-in-arc-browser-on-windows/
- S19 allthings.how, How pinned tabs work — https://allthings.how/how-do-pinned-tabs-work-in-arc-browser/
- S20 allthings.how, Little Arc — https://allthings.how/whats-little-arc-in-the-arc-browser-and-how-to-configure-it/
- S21 inputzen Arc shortcuts — https://inputzen.pages.dev/shortcuts/arc
- S22 Re-Arc pinned tabs spec — https://github.com/Re-Arc/re-arc-mac/issues/7
- S23 Arc Spaces & Profiles discussion (MPU Talk) — https://talk.macpowerusers.com/t/arc-browser-spaces-and-profiles/35872
- S24 Lilo PR (favorites per profile on import) — https://github.com/Alexays/Lilo/pull/67
- S25 TidBITS, Arc 1.5 brings back Today tab syncing — https://talk.tidbits.com/t/arc-1-5-brings-back-today-tab-syncing/23922
- S26 Site Search: Directly Search any Website (official help) — https://resources.arc.net/hc/en-us/articles/20855018192791-Site-Search-Directly-Search-any-Website
- S27 Arc update email ("type YouTube, press Tab"; Amazon, Twitter, GitHub work out of the box) — https://reallygoodemails.com/emails/arc-update-your-feedback-our-new-features/text
