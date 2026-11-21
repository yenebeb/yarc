# Arc data format: reference for the importer

Status: researched 2026-11-01. Arc is **not** installed on the machine where this was written.
Everything below comes from the source code and test fixtures of open-source projects that
parse Arc's files (listed under [Sources](#sources)). It is not from official documentation,
because The Browser Company has never published any. Each claim carries a confidence marker:

- **[confirmed]**: several independent parsers agree, or a parser says it was checked against a real file.
- **[likely]**: one credible parser, or several that copy each other.
- **[uncertain]**: inferred, or the parsers disagree. Handle defensively.

Synthetic test fixture: [`fixtures/StorableSidebar.sample.json`](fixtures/StorableSidebar.sample.json)
(described [below](#test-fixture)).

---

## 1. File locations

### 1.1 macOS

| What | Path | Confidence |
|---|---|---|
| Sidebar (spaces, pinned, favorites, Today tabs) | `~/Library/Application Support/Arc/StorableSidebar.json` | confirmed |
| Archive (auto-closed/closed tabs) | `~/Library/Application Support/Arc/StorableArchiveItems.json` | likely |
| Window state | `~/Library/Application Support/Arc/StorableWindows.json` | uncertain (only reported on Windows, presumably on mac too) |
| Chromium user data dir | `~/Library/Application Support/Arc/User Data/` | confirmed |
| Profile list / names | `~/Library/Application Support/Arc/User Data/Local State` (`profile.info_cache`) | confirmed |
| Profile dirs | `…/User Data/Default`, `…/User Data/Profile 1`, `…/User Data/Profile 2`, … | confirmed |
| App prefs plist (not needed) | `~/Library/Preferences/company.thebrowser.Browser.plist` | likely |
| Keychain secret (passwords/cookies only) | generic password, service `Arc Safe Storage`, account `Arc` | confirmed (Zen, vane) |

### 1.2 Windows (MSIX/Store package)

Arc for Windows ships as an MSIX package, so its writes to `%LOCALAPPDATA%\…` are redirected into
the package's private `LocalCache`. An ordinary (unpackaged) Electron process must read the
**physical** path:

```
%LOCALAPPDATA%\Packages\TheBrowserCompany.Arc_<publisherHash>\LocalCache\Local\Arc\
    StorableSidebar.json
    StorableArchiveItems.json        (likely, by analogy with macOS)
    StorableWindows.json             (reported by users)
    User Data\
        Local State
        Default\                     History, Bookmarks, Preferences, …
        Profile 1\
        …
```

- The known package family name is `TheBrowserCompany.Arc_ttt1ap7aakyb4` **[confirmed]**: it is
  hard-coded in Zen's `ChromeMigrationUtils` patch, arc2zen, Browser-History and the guides.
  **Glob `TheBrowserCompany.Arc_*`** anyway, as arc-export, arc-sidebar-export and
  arc-to-vivaldi do, and take the first match that contains the file.
- Optional fallback (unverified): `%LOCALAPPDATA%\Arc\` in case of a non-MSIX build.
- The Chromium profile layout under `User Data` is the same as on macOS: `Default`, `Profile N`.

### 1.3 Path resolution (TypeScript sketch)

```ts
import { homedir } from "node:os";
import { join } from "node:path";
import { readdirSync, existsSync } from "node:fs";

export function findArcRoot(): string | null {
  if (process.platform === "darwin") {
    const p = join(homedir(), "Library", "Application Support", "Arc");
    return existsSync(p) ? p : null;
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    const pkgs = join(local, "Packages");
    const candidates = existsSync(pkgs)
      ? readdirSync(pkgs).filter((d) => d.startsWith("TheBrowserCompany.Arc_"))
      : [];
    candidates.sort((a, b) => (a === "TheBrowserCompany.Arc_ttt1ap7aakyb4" ? -1 : b === "TheBrowserCompany.Arc_ttt1ap7aakyb4" ? 1 : 0));
    for (const d of candidates) {
      const p = join(pkgs, d, "LocalCache", "Local", "Arc");
      if (existsSync(join(p, "StorableSidebar.json")) || existsSync(join(p, "User Data"))) return p;
    }
    const fallback = join(local, "Arc"); // unverified
    return existsSync(fallback) ? fallback : null;
  }
  return null; // Arc never shipped for Linux
}
// sidebar  = join(root, "StorableSidebar.json")
// archive  = join(root, "StorableArchiveItems.json")
// userData = join(root, "User Data")
```

> I found **no evidence of a `StorableSpaces.json` or `StorableProfiles.json`**. Space definitions
> live inside `StorableSidebar.json`, and profile display names live in Chromium's `Local State`.

---

## 2. StorableSidebar.json

### 2.1 Encoding convention: Swift `Codable`

Arc is written in Swift, and the JSON is Swift's synthesized `Codable` output. Two patterns recur:

1. **Dictionaries are flat alternating arrays**: `[key0, value0, key1, value1, …]`. This applies to
   `spaces`, `items`, `topAppsContainerIDs`, `containerIDs`, `newContainerIDs`, `spaceModels`, and
   `splitView.itemWidthFactors`. Iterate in steps of 2 **[confirmed]**. Do not assume the array is
   "id-string, object, id-string, object" without checking: some parsers saw stray entries.
   Use `typeof` checks, and use `obj.id` as the key when it is present.
2. **Enums are single-key objects.** A case without a payload is `{"caseName": {}}`, sometimes
   `{"caseName": true}`. A case with a payload is `{"caseName": {"_0": payload}}`. So **test for key
   presence** (`"default" in x`) and never compare values **[confirmed]**.

### 2.2 Top level

```jsonc
{
  "version": 1,                         // integer; only 1 has been observed
  "sidebar": {
    "containers": [
      { "global": {} },                 // [0]: marker container, no useful data
      {                                 // [1]: THE data container
        "spaces":              [ "<spaceId>", { …space… }, … ],
        "items":               [ "<itemId>",  { …item…  }, … ],
        "topAppsContainerIDs": [ { …profileDescriptor… }, "<itemId of topApps container>", … ]
      }
    ]
  },
  "sidebarSyncState":  { … },           // cloud-sync mirror (legacy/alternative layout, §2.10)
  "firebaseSyncState": { … }            // cloud-sync mirror (§2.10)
}
```

Choosing the data container:
- arc-export takes the container right after the one that has a `global` key.
- Most others (Zen, Nook, arc2zen, arc-export-windows) scan for **any container where
  `Array.isArray(items)`** or where `spaces` is present. arc-export-windows picks the one with the
  most items.
- Recommended: collect every container that has array `spaces` and `items`. Use the largest, or
  merge all of them (see §2.11 for the multi-container caveat).

### 2.3 Space object

```jsonc
"<spaceId>",
{
  "id": "235E9467-D8F1-46F0-A855-EB9EC2BFFCB0",       // uppercase UUID; the built-in first space
                                                     // can be "thebrowser.company.defaultPersonalSpaceID"
  "title": "Work",                                   // may be missing → "Space N" (Zen: "Personal" for the default id)
  "profile": { "default": true },                    // or { "custom": { "_0": { "machineID": "…", "directoryBasename": "Profile 1" } } }
  "containerIDs":    [ "pinned", "<pinnedRootId>", "unpinned", "<unpinnedRootId>" ],
  "newContainerIDs": [ { "pinned": {} }, "<pinnedRootId>", { "unpinned": {} }, "<unpinnedRootId>" ],
  "customInfo": {
    "iconType": { "emoji_v2": "💼" },                 // see §2.7
    "windowTheme": { … }                             // see §2.8
  }
}
```

**Pinned vs unpinned roots** **[confirmed]**
- `containerIDs` is a flat dict of **string role → item id**. **The order varies**: both
  `["pinned", A, "unpinned", B]` and `["unpinned", B, "pinned", A]` occur (arc2zen notes this).
  Always look up by role.
- `newContainerIDs` holds the same information with **object markers**: `{"pinned": {}}` /
  `{"unpinned": {}}`, written as `{"pinned": true}` in some fixtures. arc-export, arc-sidebar-export,
  arc2zen (olegfour3) and arc-to-vivaldi read only this field. Zen, Nook, Axo, vane, the rafcabezas
  arc2zen and techdiary read only `containerIDs`.
- Read `containerIDs` first and fall back to `newContainerIDs`. Either may be missing or `[]`: the
  techdiary fixture has `"newContainerIDs": []`. A marker object may carry a payload; only key
  presence matters.
- The "unpinned" container holds Arc's **Today** tabs (open, unpinned tabs).
- Both root containers are themselves entries in `items`, with
  `data.itemContainer.containerType = {"spaceItems": {"_0": "<spaceId>"}}`. **The containerType
  does not tell pinned from unpinned.** Only the space's `containerIDs` does **[confirmed]**:
  Zen, Axo and arcfolderarchiver all show `spaceItems` for both roots.

**Space order** **[likely]**: the order of pairs in `spaces` is the sidebar order. Nook, Zen and
arc-to-vivaldi rely on it. The legacy `sidebarSyncState.container.value.orderedSpaceIDs` (§2.10) is
an explicit order. Prefer it when present and when it agrees with the set of local spaces.

### 2.4 Profile descriptor → Chromium profile directory

| JSON | Chromium dir | Confidence |
|---|---|---|
| `{"default": true}` (also seen as `{"default": {}}`) | `Default` | confirmed |
| `{"custom": {"_0": {"directoryBasename": "Profile 1", "machineID": "<uuid>"}}}` | `Profile 1` | confirmed |
| missing / `null` | treat as `Default` | confirmed (rafcabezas, arc2zen, vane) |

- `machineID` is present in the Axo fixture and is not needed. Other keys may exist inside `_0`.
  arc2zen scans every value of `custom` for a `directoryBasename`.
- Display names: `User Data/Local State` → `profile.info_cache[<dir>].name`
  (for example `{"Default": {"name": "Personal"}, "Profile 1": {"name": "Work"}}`). A name can be `""`.
- Several spaces can share one profile. Arc's Favorites belong to the **profile** and are shown in
  every space that uses that profile.

### 2.5 Favorites ("top apps")

```jsonc
"topAppsContainerIDs": [
  { "default": true }, "6F4D75C2-…",                                                   // Default profile's favorites root
  { "custom": { "_0": { "machineID": "…", "directoryBasename": "Profile 1" } } }, "55BB425B-…"
]
```

- This is a flat dict of **profileDescriptor → item id** of a container item whose
  `childrenIds` are the favorites, in order **[confirmed]** (Nook, Zen, Axo, arc2zen, vane).
- The container item has `data.itemContainer.containerType.topApps`. Its payload is either
  `{"_0": profileDescriptor}` (rafcabezas, arc-export PR #33) or `{}` (Axo fixture). Fallback when
  `topAppsContainerIDs` is missing: scan `items` for `containerType.topApps` and read the profile
  from `topApps._0`. With no profile there, assume `Default`.
- Favorites are normally plain tabs. Zen and arc2zen still recurse and flatten any folder or split
  inside the container.
- Zen imports *all* favorites into one global list, which loses the profile split. Nook, Axo,
  arc2zen and vane keep them per profile, which is what we want.
- rafcabezas notes that the `Default` profile's favorites are often Arc's seeded defaults
  (YouTube, Google Calendar). Import them anyway; at most, offer an opt-out.

### 2.6 Item object (`items` values)

```jsonc
"<itemId>",
{
  "id": "AFEDAF7F-4DE8-49B7-9E57-EE8C7473D2A9",
  "parentID": "DD96DC5E-…",        // null for root containers (space roots, topApps roots)
  "childrenIds": [ "…", "…" ],     // ORDERED; [] for leaves
  "title": "MDN",                  // null | string. Folder name, or the user's custom rename of a tab
  "createdAt": 762510100,          // seconds since 2001-01-01 UTC (Cocoa reference date), float
  "isUnread": false,               // present in real data, not needed
  "originatingDevice": "<uuid>",   // present in real data, not needed
  "data": { /* exactly one key, see below */ }
}
```

`data` variants (exactly one key):

| key | meaning | payload fields seen | action |
|---|---|---|---|
| `tab` | a tab (pinned, favorite, or Today) | `savedURL` (may be `""`), `savedTitle`, `timeLastActiveAt` (Cocoa s), `savedMuteStatus`, `activeTabBeforeCreationID`, `referrerID` | import |
| `list` | a **folder**, named by item `title` | `{}` | recurse into children |
| `splitView` | a split-view group whose children are tabs | `focusItemID`, `layoutOrientation` (`"horizontal"`/`"vertical"`), `timeLastActiveAt`, `itemWidthFactors` (flat id→factor), `customInfo` | flatten children in place (Zen, Nook), or keep as a split group |
| `itemContainer` | a root container | `containerType`: `{"spaceItems":{"_0":spaceId}}` or `{"topApps":{"_0":profile}}` | root only |
| `easel` | an Arc Easel | `easelID` (UUID), `title`, `creatorID`, `shareStatus` (e.g. `"creatorOnly"`), `timeLastActiveAt`; older fixtures show `{}`. No content: that lived on Arc's servers | skip (warn), or match with Arc's own Easel export (`docs/canvas.md` section 5.3) |
| `sharedObject` | an embedded shared folder or space (live link) | `slug`, `sidebarData` (nested items) | skip, or import the nested items (best effort) |
| anything else | future or unknown types (e.g. notes) | | skip (warn) |

Sources: arcfolderarchiver's zod schema (validated against real arc.net share payloads), Zen,
Nook, Axo, techdiary.

**Titles** **[confirmed]**: for a tab, `item.title` is set **only when the user renamed it**
(Nook: `customTitle`) and `data.tab.savedTitle` is the page title. Display
`item.title || savedTitle || url`. Treat `""` like `null`. Zen uses the opposite precedence
(`savedTitle || item.title`), which loses user renames, so do not copy it. For folders,
`item.title` is the folder name; when it is missing use `"Untitled folder"`.

**Ordering** **[confirmed]**: the order of `childrenIds` on the parent is the sidebar's visual order.
The order of the `items` array is **not** the display order: arc-export walks `parentID` and
produces a shuffled order (arc-export issue #30 and the "Pinned tabs appear in different order"
issue; Nook PR #393 measured 125 mismatches before the fix). Fallback (Zen): if a parent's `childrenIds` is empty or missing, collect the items
whose `parentID === parentId`, in array order.

**URL filtering**: Zen keeps only `http:`, `https:`, `file:` and `ftp:`. Vane and Axo keep only
http(s). Non-web pinned items such as `arc://…` and `chrome-extension://…` exist; the Zen test pins
`arc://welcome`. Skip them with a warning, or map them to our own internal pages.

### 2.7 Space icon

| field | type | notes |
|---|---|---|
| `customInfo.iconType.emoji_v2` | string (grapheme, may include ZWJ and variation selectors) | preferred **[confirmed]** |
| `customInfo.iconType.emoji` | integer Unicode scalar | older format: `String.fromCodePoint(n)` in a try/catch **[confirmed by Zen]** |
| `customInfo.iconType.icon` | string | a named icon (Ionicons names): `star`, `bookmark`, `heart`, `bulb`, `planet`, `musicalNote`, `github`, … (61 names, camelCase) **[confirmed in real data]**. We map them to the closest emoji |
| none | | no icon; the space shows its initial |

### 2.8 Space color / theme

All colors are `{ "red": n, "green": n, "blue": n, "alpha": n, "colorSpace": "extendedSRGB" }`
with components nominally in 0–1. **Extended sRGB values can fall below 0 or above 1**, so clamp
before multiplying by 255.

Two locations are used:

1. **`customInfo.windowTheme.primaryColorPalette.midTone`**: the single accent shade that Arc tints the
   space with. Nook, vane and rafcabezas use it as the space color **[confirmed]**. A `tint` color
   also appears in `primaryColorPalette`; other palette keys are unknown.
2. **`customInfo.windowTheme.background.single._0.style.color._0`** (Zen; "likely"): the actual
   background, one of:
   - `blendedSingleColor._0 = { color, modifiers: { intensityFactor, noiseFactor } }`
   - `blendedGradient._0 = { baseColors: [color…], overlayColors: [color…], modifiers: { overlay: "grain", intensityFactor, noiseFactor } }`
   - other or unknown shapes: Zen walks the subtree depth-first and collects every object that has
     `red`/`green`/`blue`.

   Skip colors with `alpha <= 0`, de-duplicate, and keep up to 3. Base colors come before overlays.
   `intensityFactor` (0–1) is the opacity or strength, and `noiseFactor` (0–1) is the grain amount.

Recommended: `color = midTone ?? firstBackgroundColor ?? null`, and also keep `gradient: string[]` from (2).
A space without `windowTheme` has no theme, so use our default color.

### 2.9 Timestamps

`createdAt`, `timeLastActiveAt` and the archive's `archivedAt` are **seconds (float) since
2001-01-01T00:00:00Z** (Cocoa/`NSDate` reference date) **[likely]**. vrag99 and rafcabezas convert
them this way.

```ts
const COCOA_EPOCH_MS = 978_307_200_000;
const cocoaToDate = (s: number) => new Date(COCOA_EPOCH_MS + s * 1000);
// Defensive: if s > 1e11 it is probably already Unix ms (one share-page fixture had 1640995200000).
```

### 2.10 Alternative and legacy layouts (cloud-sync mirrors)

Fall back to these only when `sidebar.containers` yields nothing:

- **`sidebarSyncState`** (Physton/arc-bookmarks, 2023, and arc-export PR #33 for favorites):
  - `items`: flat pairs where each value is **wrapped**: `{ "value": { …item… } }`
  - `spaceModels`: flat pairs of `{ "value": { …space… } }` (has `title`, `containerIDs`, `customInfo`)
  - `container.value.orderedSpaceIDs: string[]`: explicit space order
  - `container.value.topAppsContainerID: string`: **single** favorites root (from before profiles)
- **`firebaseSyncState.syncData`** (rafcabezas): `spaceModels`, `items` and `containerModels` as
  flat pairs of `{ "value": … }`. `containerModels[].value` has `spaceID` and
  `containerType.pinned`/`unpinned`. rafcabezas uses `spaceModels` only as an
  extra source of titles, icons and colors, and says the local `sidebar` data is authoritative
  because the sync cache "may be empty or stale".

Unwrap with `v && typeof v === "object" && "value" in v ? v.value : v`.

### 2.11 Known variants and defensive rules (summary)

| Variant | Who handles it | Rule |
|---|---|---|
| Data container not at index 1, or extra containers | Zen, Nook, arc-export-windows, olegfour3 | Scan all containers; pick or merge those with `items`. olegfour3 treats each data container as a "profile", which is probably a misinterpretation, so prefer the largest container and merge the rest's spaces. |
| `containerIDs` vs `newContainerIDs`, either missing or empty, marker order varies | everyone | Look up by role, try both fields, default to no root. |
| Marker or enum value `{}` vs `true` | Zen vs vane/olegfour3 | Check key presence only. |
| `childrenIds` missing or empty | Zen | Fall back to scanning `parentID`. |
| `childrenIds` pointing at missing items | techdiary, Nook | Skip and warn. |
| Cycles or very deep nesting | Zen (depth 32), techdiary (cycle detection) | Keep a visited set and a depth cap. |
| `title` `null`, `""` or missing | everyone | Treat all three as absent. |
| Space with no title | everyone | `"Space N"`, or `"Personal"` for `thebrowser.company.defaultPersonalSpaceID`. |
| Non-web URL or `savedURL: ""` | Zen, Nook, techdiary | Skip and warn. |
| `splitView` | Zen, Nook, techdiary | Flatten its children in order. |
| `easel`, `sharedObject`, unknown kinds | Axo fixture, arcfolderarchiver | Skip and warn. |
| `spaces` entry that is a string with no object after it | olegfour3, techdiary malformed fixture | Ignore. |
| Windows file with invalid backslash escapes (for example raw `C:\…` inside `file:` URLs) | arc-export-windows (`fix_malformed_urls`) | On `JSON.parse` failure, repair with `text.replace(/\\(?!["\\/bfnrtu])/g, "\\\\")` and retry. `\/` is valid JSON and needs no fix. |
| File being rewritten while Arc runs | (none) | Read, and if parsing fails retry after 250 ms; better, ask the user to quit Arc. |
| `profile` missing | rafcabezas | Use `Default`. |
| `topApps` payload `{}` | Axo | Rely on `topAppsContainerIDs` for the profile. |

---

## 3. StorableArchiveItems.json (Archive)

**[uncertain]**: only one parser (rafcabezas `restore_auto_archived.py`) reads this file.

```jsonc
{
  "items": [
    // Possibly alternating "<id>", {…}. The parser skips non-object entries, so accept both forms.
    {
      "reason": "auto",                    // "auto" = Arc's auto-archive timer; "manual" = user closed it (Cmd+W)
      "archivedAt": 783000000.0,           // Cocoa seconds
      "source": { "space": { "_0": "<spaceId>" } },   // enum: the space it was archived from
      "sidebarItem": {                     // a full item as in §2.6
        "id": "…", "title": null,
        "data": { "tab": { "savedURL": "https://…", "savedTitle": "…", "timeLastActiveAt": 782990000.0 } }
      }
    }
  ]
}
```

Other `source` cases (for example folders or favorites) and archived folders (`data.list`) are
unknown. Import archive entries as **history-like "recently closed"** records rather than tabs.
Vane explicitly leaves Archive out of scope.

---

## 4. Chromium data (per profile, under `User Data/<dir>/`)

Arc is a normal Chromium build, so the history, bookmarks, passwords and cookies importers
are Chrome's (Zen's `ArcProfileMigrator extends ChromeProfileMigrator`, with `_chromeUserDataPathSuffix = "Arc"`).

**Always copy SQLite files to a temp directory before opening them.** Arc holds locks while it
runs. Copy `History` together with its `History-journal` / `-wal` siblings when they exist, and open
the copy read-only.

### 4.1 `Local State` (JSON, in `User Data/`)

`profile.info_cache: { "<dir>": { "name": string, … } }` gives the profile list and display names.
`profile.last_used` gives the last profile used.

### 4.2 `History` (SQLite)

```sql
-- the essentials (more columns exist and vary by Chromium version: select explicitly)
urls(id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR,
     visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER)
visits(id INTEGER PRIMARY KEY, url INTEGER /* → urls.id */, visit_time INTEGER,
       from_visit INTEGER, transition INTEGER, segment_id INTEGER, visit_duration INTEGER /* µs */, …)

SELECT v.visit_time, v.transition, u.url, u.title
FROM visits v JOIN urls u ON u.id = v.url
WHERE u.hidden = 0
ORDER BY v.visit_time;
```

- **Time is WebKit/Chromium time: microseconds since 1601-01-01T00:00:00Z.** Current values are
  about 1.34e16, which is **above `Number.MAX_SAFE_INTEGER`**. Convert in SQL, or read as
  BigInt (`better-sqlite3`: `stmt.safeIntegers(true)`):
  ```sql
  SELECT (visit_time / 1000) - 11644473600000 AS unix_ms FROM visits;
  ```
  ```ts
  const chromeToUnixMs = (t: bigint) => Number(t / 1000n - 11_644_473_600_000n); // 0 → "never"
  ```
- `transition & 0xFF` is the core type: 0 LINK, 1 TYPED, 2 AUTO_BOOKMARK, 3 AUTO_SUBFRAME,
  4 MANUAL_SUBFRAME, 5 GENERATED, 6 AUTO_TOPLEVEL, 7 FORM_SUBMIT, 8 RELOAD, 9 KEYWORD,
  10 KEYWORD_GENERATED. Usually drop 3 and 4 (subframes).
- A cheap import only needs `urls` (`url`, `title`, `visit_count`, `typed_count`, `last_visit_time`).

### 4.3 `Bookmarks` (JSON)

```jsonc
{
  "checksum": "…",                       // MD5 over the tree. Ignore on read; never write back
  "version": 1,
  "roots": {
    "bookmark_bar": { "type": "folder", "name": "Bookmarks bar", "children": [ … ], "id": "1", "guid": "…",
                      "date_added": "13345678901234567", "date_modified": "…" },
    "other":        { "type": "folder", "name": "Other bookmarks",  "children": [ … ] },
    "synced":       { "type": "folder", "name": "Mobile bookmarks", "children": [ … ] }
  }
}
// node: { "type": "url", "name": "…", "url": "https://…", "id": "5", "guid": "…",
//         "date_added": "<µs since 1601 as a STRING>", "date_last_used": "0", "meta_info"?: {…} }
```

Dates are decimal strings in WebKit microseconds, so use `BigInt(str)`. Newer Chromium may also
write `AccountBookmarks` (account-storage bookmarks) next to `Bookmarks`, with the same format;
import both if present. Arc users mostly keep their "bookmarks" in the sidebar, so this file is
often nearly empty.

---

## 5. TypeScript types

### 5.1 Raw Arc JSON (loose, for narrowing at the boundary)

```ts
/** Swift Codable flat dictionary: [k0, v0, k1, v1, …] */
export type FlatPairs<K = unknown, V = unknown> = ReadonlyArray<K | V>;

/** Swift enum-as-object: {"case": {}} | {"case": true} | {"case": {"_0": payload}} */
export type SwiftEnum = Readonly<Record<string, unknown>>;

export interface ArcColor {
  red: number; green: number; blue: number;
  alpha?: number;
  colorSpace?: string; // "extendedSRGB"
}

export type ArcProfileDescriptor =
  | { default: true | Record<string, never> }
  | { custom: { _0: { directoryBasename: string; machineID?: string; [k: string]: unknown } } };

export interface ArcWindowTheme {
  primaryColorPalette?: { midTone?: ArcColor; tint?: ArcColor; [k: string]: unknown };
  background?: {
    single?: {
      _0?: {
        style?: {
          color?: {
            _0?: {
              blendedSingleColor?: { _0?: { color?: ArcColor; modifiers?: ArcThemeModifiers } };
              blendedGradient?: {
                _0?: { baseColors?: ArcColor[]; overlayColors?: ArcColor[]; modifiers?: ArcThemeModifiers };
              };
              [k: string]: unknown;
            };
          };
        };
      };
    };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
export interface ArcThemeModifiers { intensityFactor?: number; noiseFactor?: number; overlay?: string }

export interface ArcSpaceRaw {
  id?: string;
  title?: string | null;
  profile?: ArcProfileDescriptor | null;
  /** ["pinned", id, "unpinned", id]: order varies */
  containerIDs?: FlatPairs<string, string>;
  /** [{pinned:{}}, id, {unpinned:{}}, id] */
  newContainerIDs?: FlatPairs<SwiftEnum, string>;
  customInfo?: {
    iconType?: { emoji_v2?: string; emoji?: number; icon?: string; [k: string]: unknown } | null;
    windowTheme?: ArcWindowTheme | null;
    [k: string]: unknown;
  } | null;
  [k: string]: unknown;
}

export interface ArcTabData {
  savedURL?: string;
  savedTitle?: string;
  timeLastActiveAt?: number; // Cocoa seconds
  savedMuteStatus?: string;
  activeTabBeforeCreationID?: string;
  referrerID?: string;
}

export type ArcItemData =
  | { tab: ArcTabData }
  | { list: Record<string, unknown> }
  | { splitView: { focusItemID?: string | null; layoutOrientation?: "horizontal" | "vertical";
                   timeLastActiveAt?: number; itemWidthFactors?: FlatPairs<string, number>; customInfo?: unknown } }
  | { itemContainer: { containerType: { spaceItems?: { _0: string };
                                        topApps?: { _0?: ArcProfileDescriptor } | Record<string, never>;
                                        [k: string]: unknown } } }
  | { easel: { easelID?: string; title?: string; creatorID?: string; shareStatus?: string; timeLastActiveAt?: number } }
  | { sharedObject: { slug?: string; sidebarData?: unknown } }
  | Record<string, unknown>; // unknown future kinds

export interface ArcItemRaw {
  id: string;
  parentID?: string | null;
  childrenIds?: string[];
  title?: string | null;
  createdAt?: number;          // Cocoa seconds
  isUnread?: boolean;
  originatingDevice?: string;
  data?: ArcItemData;
}

export interface ArcDataContainerRaw {
  spaces?: FlatPairs<string, ArcSpaceRaw>;
  items?: FlatPairs<string, ArcItemRaw>;
  topAppsContainerIDs?: FlatPairs<ArcProfileDescriptor, string>;
  [k: string]: unknown;
}

export interface StorableSidebarRaw {
  version?: number;
  sidebar?: { containers?: Array<ArcDataContainerRaw | { global: unknown } | null> };
  sidebarSyncState?: unknown;  // legacy, §2.10
  firebaseSyncState?: unknown; // legacy, §2.10
}

export interface ArcArchiveItemRaw {
  reason?: "auto" | "manual" | string;
  archivedAt?: number;              // Cocoa seconds
  source?: { space?: { _0?: string } } & Record<string, unknown>;
  sidebarItem?: ArcItemRaw;
}
```

### 5.2 Normalized import model (what YARC consumes)

```ts
export interface ArcImportResult {
  profiles: ImportedProfile[];
  spaces: ImportedSpace[];                       // sidebar order
  favoritesByProfile: Record<string, ImportedTab[]>; // key = ImportedProfile.id
  archive: ImportedArchivedTab[];                // optional, best effort
  warnings: string[];                            // skipped items, unknown kinds, repaired JSON, …
}

export interface ImportedProfile {
  id: string;                 // Chromium dir basename: "Default", "Profile 1", …
  name: string;               // from Local State info_cache, else derived
  isDefault: boolean;
  userDataDir: string | null; // absolute path to User Data/<id>, if it exists
}

export interface ImportedSpace {
  arcId: string;
  name: string;
  emoji: string | null;
  color: { hex: string; rgb: [number, number, number] } | null; // primary/accent
  gradient: string[];          // up to 3 hex colors from the window background
  profileId: string;           // → ImportedProfile.id
  pinned: PinnedNode[];        // tree: folders and tabs, in order
  unpinned: ImportedTab[];     // "Today" tabs, flattened, in order
}

export type PinnedNode = ImportedTab | ImportedFolder;

export interface ImportedTab {
  kind: "tab";
  arcId: string;
  url: string;
  title: string;               // customTitle ?? pageTitle ?? url
  customTitle: string | null;  // user's rename in Arc
  pageTitle: string | null;    // savedTitle
  lastActiveAt: Date | null;
  splitGroupId?: string;       // set when the tab came from a splitView (for optional regrouping)
}

export interface ImportedFolder {
  kind: "folder";
  arcId: string;
  title: string;
  children: PinnedNode[];
}

export interface ImportedArchivedTab {
  url: string; title: string; spaceArcId: string | null;
  reason: string | null; archivedAt: Date | null;
}
```

---

## 6. Conversion algorithm

```text
function importArc(root):
  warnings = []
  raw = readJsonDefensive(root/StorableSidebar.json, warnings)      // §2.11 backslash repair + retry
  localState = tryReadJson(root/"User Data"/"Local State")

  // 1. pick the data container
  dataContainers = raw.sidebar.containers.filter(c => isObj(c) && isArr(c.items))
  if dataContainers is empty: return importLegacy(raw)               // §2.10, else an empty result
  main = the one with the most items  (log a warning if there are more than one; merge spaces/items from the others)

  // 2. index items
  items = Map()
  for (k, v) in pairs(main.items):
      v = unwrapValue(v)                                             // {value:{…}} → {…}
      if isObj(v): items.set(isStr(v.id) ? v.id : k, v)

  childrenOf(id):
      p = items.get(id)
      ids = nonEmptyArray(p?.childrenIds) ?? [ i.id for i in items.values() if i.parentID == id ]   // fallback keeps array order
      return ids.map(items.get).filter(Boolean)        // warn for each missing id

  // 3. tree walk (shared by pinned, unpinned and favorites)
  walk(containerId, depth = 0, visited = Set()):
      if depth > 32 or containerId in visited: warn; return []
      visited.add(containerId)
      out = []
      for item in childrenOf(containerId):
          d = item.data ?? {}
          if "tab" in d:
              url = d.tab.savedURL?.trim()
              if !isImportableUrl(url): warn("skipped non-web url"); continue   // http(s)/file/ftp
              custom = nonEmpty(item.title); page = nonEmpty(d.tab.savedTitle)
              out.push(Tab{ arcId:item.id, url, customTitle:custom, pageTitle:page,
                            title: custom ?? page ?? url, lastActiveAt: cocoa(d.tab.timeLastActiveAt) })
          else if "list" in d:
              out.push(Folder{ arcId:item.id, title: nonEmpty(item.title) ?? "Untitled folder",
                               children: walk(item.id, depth+1, visited) })      // keep empty folders
          else if "splitView" in d:
              for t in walk(item.id, depth+1, visited): t.splitGroupId = item.id; out.push(t)
          else:
              warn("skipped item kind " + firstKey(d))       // easel, sharedObject, itemContainer, unknown
      return out

  // 4. profiles
  profileKey(desc):
      if !isObj(desc) or "default" in desc: return "Default"
      for v in values(desc.custom ?? {}): if isStr(v?.directoryBasename): return v.directoryBasename
      return "Default"
  profileIds = ordered set: "Default"
             ∪ keys(localState?.profile?.info_cache)
             ∪ { profileKey(s.profile) for each space }
             ∪ { profileKey(d) for (d, _) in pairs(main.topAppsContainerIDs) }
  profiles = profileIds.map(id => { id, isDefault: id == "Default",
                                    name: nonEmpty(info_cache[id]?.name) ?? (id == "Default" ? "Personal" : id),
                                    userDataDir: exists(root/"User Data"/id) ? path : null })

  // 5. favorites per profile
  favoritesByProfile = {}
  for (desc, cid) in pairs(main.topAppsContainerIDs):
      if isStr(cid): favoritesByProfile[profileKey(desc)] ??= []; append flatten(walk(cid))   // folders → tabs
  if favoritesByProfile is empty:                                    // fallback
      for item in items.values() where item.data?.itemContainer?.containerType?.topApps:
          key = profileKey(item.data.itemContainer.containerType.topApps._0)   // {} → "Default"
          favoritesByProfile[key] = flatten(walk(item.id))
  // De-duplicate by URL within each profile, keeping the first.

  // 6. spaces (pair order = sidebar order; reorder by legacy orderedSpaceIDs if present)
  spaces = []
  n = 0
  for (k, s) in pairs(main.spaces):
      if !isObj(s): continue
      n++
      roles = {}
      for (r, id) in pairs(s.containerIDs):    if isStr(r) and isStr(id): roles[r] ??= id
      for (m, id) in pairs(s.newContainerIDs): if isObj(m) and isStr(id):
          if "pinned" in m: roles.pinned ??= id  else if "unpinned" in m: roles.unpinned ??= id
      id = s.id ?? k
      spaces.push({
        arcId: id,
        name: nonEmpty(s.title?.trim()) ?? (id == "thebrowser.company.defaultPersonalSpaceID" ? "Personal" : "Space " + n),
        emoji: emojiOf(s.customInfo?.iconType),                    // emoji_v2 → fromCodePoint(emoji) → null
        color: toHex(s.customInfo?.windowTheme?.primaryColorPalette?.midTone)
               ?? toHex(firstBackgroundColor(s.customInfo?.windowTheme)),
        gradient: backgroundColors(s.customInfo?.windowTheme).filter(alpha>0).dedupe().slice(0,3).map(toHex),
        profileId: profileKey(s.profile),
        pinned:   roles.pinned   ? walk(roles.pinned)            : [],
        unpinned: roles.unpinned ? flatten(walk(roles.unpinned)) : [],
      })

  // 7. optional: archive
  archive = for e in arrayOrPairsValues(tryReadJson(root/StorableArchiveItems.json)?.items):
               tab = e.sidebarItem?.data?.tab; if importable(tab?.savedURL):
               { url, title: nonEmpty(e.sidebarItem.title) ?? tab.savedTitle ?? url,
                 spaceArcId: e.source?.space?._0 ?? null, reason: e.reason ?? null, archivedAt: cocoa(e.archivedAt) }

  // 8. Chromium data per profile (History, Bookmarks): copy the files to temp, then read them (§4)
  return { profiles, spaces, favoritesByProfile, archive, warnings }

toHex(c): if !c or any(red/green/blue) not number or c.alpha <= 0: null
          rgb = [c.red, c.green, c.blue].map(v => round(clamp(v, 0, 1) * 255)); return "#" + hex(rgb)
```

Mapping notes for YARC:

- **Profiles → partitions**: one Electron `session.fromPartition("persist:arc-<id>")` per Arc
  profile. Spaces with the same `profileId` share a partition and share
  `favoritesByProfile[profileId]`.
- **Pinned tabs** should start unloaded (title and URL only). Zen creates them as lazy tabs; do the same.
- **Folders** keep nesting. Zen caps the depth at 5 (`zen.folders.max-subfolders`) and flattens
  anything deeper into the parent. Choose our own cap.
- **Idempotent re-import**: key on `arcId` (stable UUIDs), or on (space name, url) as vane does.

---

## 7. Test fixture

`docs/fixtures/StorableSidebar.sample.json` is **synthetic**, hand-written to match the shapes above.
It has real-looking UUIDs, Cocoa timestamps, both `containerIDs` forms, and both theme variants.

| Feature | Where |
|---|---|
| 2 profiles | `Default` (`{"default": true}`), `Profile 1` (`custom._0.directoryBasename`, with `machineID`) |
| 2 spaces | `Personal` (id `thebrowser.company.defaultPersonalSpaceID`, 🏠, gradient theme, **reversed** `containerIDs` order) · `Work` (💼 via both `emoji` int and `emoji_v2`, single-color theme) |
| 3 favorites | Default: Gmail, YouTube · Profile 1: Google Calendar (topApps containers carry `_0` profile payloads) |
| folder + nesting | Personal → `Reading` { MDN (renamed: `title:"MDN"`, page title "MDN Web Docs"), `Recipes` { Serious Eats }, `arc://extensions` (must be skipped) } · Work → `Project X` { Linear, Figma renamed "Designs" } |
| unpinned / Today | Personal: GitHub + a `splitView` (Electron docs \| TS handbook) · Work: Slack |

The algorithm above should produce exactly this (a prototype was run against the fixture):

```text
favoritesByProfile:
  Default:   [Inbox (3) - Gmail, YouTube]
  Profile 1: [Google Calendar - Week of October 26, 2026]
spaces:
  1. Personal 🏠  profile=Default  color≈#55AFFF (midTone, clamped)
     pinned:   Hacker News, 📁 Reading [ MDN, 📁 Recipes [ Serious Eats ] ]     (arc://extensions skipped)
     unpinned: electron/electron…, Introduction | Electron, TypeScript: Handbook…   (split flattened)
  2. Work 💼  profile=Profile 1  color=#336699
     pinned:   📁 Project X [ Project X › Active issues, Designs ], Team Wiki
     unpinned: general (Channel) - Acme - Slack
```

Suggested extra negative tests: the techdiary `malformed_sidebar.json`
(`{"version":1,"sidebar":{"containers":[{"global":{}},{"spaces":["orphan"]}]}}`) returns an empty
result without throwing. `null`, `{}` and `{sidebar:{containers:"nope"}}` return empty
(Zen's garbage test). Add a cycle (`A.childrenIds=[B]`, `B.childrenIds=[A]`).

---

## 8. Open questions and uncertainty

1. **No real file was inspected by us.** The shapes come from parsers and fixtures. Vane's spec
   says it was verified on a real Mac, and Zen and Axo fixtures look derived from real files.
   Before shipping, validate against at least one real macOS file and one real Windows file.
2. Whether the payload of `default` / `pinned` / `unpinned` is `{}` or `true`: parsers disagree, so
   only check key presence.
3. The `windowTheme` structure beyond `primaryColorPalette.midTone`/`tint` and
   `background.single._0.style.color._0.{blendedSingleColor,blendedGradient}` is unknown. Other
   theme kinds (for example image or dynamic backgrounds) may exist. Zen's depth-first color scan
   is a safe fallback.
4. ~~`iconType.icon` meaning unknown~~ — resolved: Ionicons names, see §2.7.
5. The `StorableArchiveItems.json` schema rests on a single parser. `StorableWindows.json` has
   no known schema, and it is not needed.
6. Whether Windows Arc writes exactly the same schema: arc-export-windows and arc-to-vivaldi
   (Windows-first) parse the same keys (`containers[1]`, `spaces`, `items`, `newContainerIDs`),
   so very likely yes, apart from the backslash-escaping bug.
7. Profile **display names** come from `Local State` `info_cache`. Arc may also keep its own
   profile names elsewhere (plist / `Preferences`); unverified.
8. Timestamps: Cocoa seconds is consistent across the parsers, but one share-page fixture
   used Unix ms, so apply the magnitude check.

---

## Sources

Primary code (read for this document):

- Zen Browser, PR #16130 "Allow support to import from Arc & Dia" (merged Oct 2026): https://github.com/zen-browser/desktop/pull/16130
  - `src/zen/migration/ZenMigrationUtils.sys.mjs` (`parseArcSidebar`, theme parsing): https://github.com/zen-browser/desktop/blob/6d14a94aa25e20b9bf2f4b14e7a9dd01b714b8f4/src/zen/migration/ZenMigrationUtils.sys.mjs
  - `src/zen/migration/ZenProfileMigrators.sys.mjs` (sidebar = sibling of `User Data`): https://github.com/zen-browser/desktop/blob/6d14a94aa25e20b9bf2f4b14e7a9dd01b714b8f4/src/zen/migration/ZenProfileMigrators.sys.mjs
  - `src/zen/tests/migration/head.js` (fixture builder) and `browser_arc_sidebar.js`: https://github.com/zen-browser/desktop/tree/6d14a94aa25e20b9bf2f4b14e7a9dd01b714b8f4/src/zen/tests/migration
  - `ChromeMigrationUtils-sys-mjs.patch` (Windows and macOS `User Data` paths): https://github.com/zen-browser/desktop/blob/6d14a94aa25e20b9bf2f4b14e7a9dd01b714b8f4/src/browser/components/migration/ChromeMigrationUtils-sys-mjs.patch
- Nook browser, PR #393 "Arc import: keep order, nested folders, titles, favorites and colors" (`Nook/Managers/ImportManager/Arc.swift`): https://github.com/nook-browser/Nook/pull/393
- Axo browser, PR #20 (`Packages/AxoImport/Tests/AxoImportTests/Fixtures.swift`: two profiles, `machineID`, `topApps`, `easel`): https://github.com/perezstudio/axo-browser/pull/20
- Vane, PR #135 and design spec `docs/superpowers/specs/2026-09-16-arc-import-design.md` ("verified on the user's Mac"): https://github.com/notnaki/vane/pull/135
- ivnvxd/arc-export `main.py` (macOS/Windows paths, `global` anchor, `newContainerIDs`): https://github.com/ivnvxd/arc-export ; favorites PR #33: https://github.com/ivnvxd/arc-export/pull/33 ; PR #29: https://github.com/ivnvxd/arc-export/pull/29
- iamfitsum/arc-export-windows (malformed-escape repair, largest container): https://github.com/iamfitsum/arc-export-windows
- rafcabezas/arc2zen (`src/arc_pinned_tab_extractor.py` profiles/topApps/midTone/order; `restore_auto_archived.py` archive; `src/arc_profile_discovery.py`; `src/arc_history_migrator.py`): https://github.com/rafcabezas/arc2zen
- olegfour3/arc2zen (`core/arc_exporter.py`, `.cursor/DATA_STRUCTURES.md`): https://github.com/olegfour3/arc2zen
- Physton/arc-bookmarks (`sidebarSyncState` legacy layout, `orderedSpaceIDs`, `topAppsContainerID`): https://github.com/Physton/arc-bookmarks
- techdiary/arc-bookmarks-cli (`tests/fixtures/representative_sidebar.json`, `malformed_sidebar.json`, strict parser): https://github.com/techdiary/arc-bookmarks-cli
- spapaseit/arc-to-vivaldi-migration (TypeScript, Windows auto-discovery, `iconType.icon`): https://github.com/spapaseit/arc-to-vivaldi-migration
- vrag99/arc-sidebar-export (`utils/parser.py`, Cocoa timestamp conversion, Windows glob): https://github.com/vrag99/arc-sidebar-export
- flawnn/arcfolderarchiver (`app/external/models/arc.ts`: zod schema of real Arc item/space payloads from arc.net shares): https://github.com/flawnn/arcfolderarchiver
- Garulf/Browser-History PR #21 (Arc Windows `History` path): https://github.com/Garulf/Browser-History/pull/21

Secondary:

- Windows path guide: https://contextbolt.com/blog/export-arc-bookmarks/
- `StorableWindows.json` on Windows (Reddit, via redlib mirror): https://redlib.hbubli.cc/r/ArcBrowser/comments/1ks0b70/my_fix_arc_browser_crash_on_start_jvmdll_bad
- Arc Help Center, Profiles: https://resources.arc.net/hc/en-us/articles/19227964556183
- Chromium time base (µs since 1601) and `History` columns: consistent across Axo `Fixtures.swift` and rafcabezas `arc_history_migrator.py`, and with Chromium's `components/history/core/browser/url_database.cc` / `visit_database.cc`.

Not reviewed: the Raycast Arc extension (which drives Arc through AppleScript and does not parse
these files, as far as I know). anthracite-browser issue #19 returned 404.
