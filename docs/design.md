# YARC's design

What YARC looks like and where each part of that look lives in the code. Values are as of 2026-11-27; when they change, the CSS is right and this file is behind.

YARC's look is designed here. It is not measured or traced from another app.

## Principles

1. **The space colours the window.** One colour per space, optionally a second for a gradient. Backgrounds, the accent and folder icons are mixed from it in CSS.
2. **The page is a card.** Web content sits 8px in from the window edge with 8px corners (`PAD` in `src/main/core/window.ts`, `setBorderRadius(8)` in `src/main/core/tab.ts`).
3. **The sidebar is the browser.** No tab strip, no toolbar above the page.
4. **Panels float, then leave.** They are drawn in a transparent overlay view that is attached only while something is open.
5. **macOS first.** Vibrancy and inset traffic lights on the Mac; a 32px caption strip and a solid gradient on Windows and Linux.

## Colour

Tokens are CSS custom properties in `src/renderer/src/tokens.css`: light on `:root`, dark on `:root[data-appearance='dark']`. `base.css`, `canvas.css` and `float.css` import it, so every page has the same tokens.

`useSpaceTheme` (`src/renderer/src/api.ts`) writes the space's colours to `--space` and `--space-2`. `applyAppearance` sets `data-appearance` from the space's `appearance`, or from the system when it has none.

| Token | Light | Dark |
|---|---|---|
| `--bg` | space 26% into `#f4f2fb` | space 22% into `#1b1a20` |
| `--bg-2` | space-2 40% into `#e8e4f6` | space-2 34% into `#16151a` |
| `--accent` | space 85% with black | space 70% with white |
| `--space-strong` | space with oklch lightness × 0.67 | same |
| `--text` | `#1d1b22` | `#f1eff6` |
| `--text-2` / `--text-3` | text at 62% / 52% | text at 62% / 40% |
| `--panel` | `#fcfbff` | `#26242c` |
| `--panel-line` | black 8% | white 9% |
| `--line` | text 10% | white 10% |
| `--hover` / `--active` | white 38% / 88% | white 7% / 15% |
| `--field` | white 55% | white 7% |
| `--urlfield` | black 7% | black 18% |
| `--tile` | white 10% | white 7% |
| `--scrim` | `rgb(10 5 25 / 0.28)` | black 35% |

The window background is `linear-gradient(160deg, --bg, --bg-2)`. On macOS it is `linear-gradient(170deg, --vibrant-1, --vibrant-2)` over native vibrancy. Both carry a noise layer at 22%.

The same in light and dark: `--danger` `#d33`, `--warning` `#d97706`, `--success` `#30a46c`, `--disabled-opacity` 0.4, `--float` / `--float-hover` / `--float-text` for dark round controls (Peek buttons, the notice), and `--white` / `--black` for text on a coloured fill, knobs and mixing.

The palette offered for a space is `SPACE_COLORS` in `src/shared/colors.ts`: `#7c6cf2` (default), `#e0607e`, `#3fa7d6`, `#3dbb8a`, `#f2a541`, `#c06cf2`, `#5b7bd6`, `#8a8a8a`, plus any colour from the HSV picker.

Three surfaces keep their own colours:

- Settings adds `--set-*` tokens (`panels/settings.css`).
- The permission prompt uses neutral `--perm-*` greys and ignores the space (`prompt.css`).
- A canvas has the shared tokens but colours itself with its own (`--canvas-accent` `#6d5dfc`, dark `#8b7eff`, `--canvas-line`, `--canvas-hover`) and has its own light/dark switch (`canvas.css`).

## Type

No font is shipped. `--font` is `-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', Inter, system-ui, sans-serif`, at a 13px base.

| Token | Size / weight | Used for |
|---|---|---|
| `--type-4xl` | 26 / 700 | Tour and About titles |
| `--type-3xl` | 20 | Command bar input, Settings section title |
| `--type-2xl` | 16 / 600 | Sheet header |
| `--type-xl` | 15 / 500 | Command bar result, permission prompt |
| `--type-lg` | 14 | Sidebar tab row |
| `--type-md` | 13 | Base: space name, pane bar, notices |
| `--type-sm` | 12 | Secondary lines, pills, small buttons |
| `--type-xs` | 11 / 600 | Eyebrows, key caps, result hints |

Sizes are whole pixels and weights are 400, 500, 600 or 700, which every system font has.

On a canvas: title 36/700, heading 24/600, body 16/400, line height 1.25.

## Size and shape

| Thing | Value |
|---|---|
| Sidebar width | 200–480, 260 by default |
| Sidebar padding | 8 top and bottom, 10 outer side, 6 inner side; 6 between sections (`src/shared/sidebar-geometry.ts`, read by both the CSS and the main process) |
| Top bar, pane bar, Windows caption | 32 |
| Address field | 36, radius 10 |
| Tab row | 40, radius 10, 2 between rows |
| Favorite tile | 48 tall, at least 64 wide, radius 10 |
| Bottom bar | 34 |
| Icon button | 28, radius 7 |
| Command bar | 766 wide; field 64, result 50 |
| Sheet | 760 wide, 8vh from the top, at most 84vh |
| Split panes | 6 apart, at most 4 |
| Little Window bar | 47 |

| Token | Radius | Used for |
|---|---|---|
| `--radius-xs` | 4 | Letter tile, key cap |
| `--radius-sm` | 7 | Icon button |
| `--radius-md` | 8 | Page card, buttons, fields |
| `--radius-lg` | 10 | Rows and tiles |
| `--radius-xl` | 12 | Popovers |
| `--radius-2xl` | 14 | Panel |
| `--radius-pill` | 999 | Pills |

Without a token: 3 favicon, 16 Settings sheet, 20 tour panel.

Shadows: `--active-shadow` for a selected row or tab, `--shadow-lg` for every floating panel, `0 1px 3px rgb(0 0 0 / 0.12)` for pills and media cards.

## Motion

Short and eased out (`--ease`): `--duration-fade` 0.12s fades, `--duration-pop` 0.14s panel pop, `--duration-slide` 0.16s floating sidebar, `--duration-toast` 0.18s toast. Without a token: 0.22s tour panel, 0.35s space colour cross-fade. A toast stays 2.2s (`TOAST_MS`).

With Reduce Motion on, every page stops animating except the loading spinner and the progress bar.

## Icons

About 67 line icons as inline paths in `src/renderer/src/icons.tsx`: 24 unit grid, `currentColor`, round caps and joins, drawn at 16px with a 1.8 stroke by default. A site without a favicon gets its first letter on a 16px `--accent` tile.

## States

- Hover: `--hover`.
- Current row, tile or tab: `--active` plus `--active-shadow`.
- Disabled: `--disabled-opacity` (40%).
- Focused field: `--accent` border. Focused button or link: a 2px ring of `--accent` at 60%.
- Drop target: 2px `--accent` line or outline.
- Selected command bar result: `--space-strong` with white text.

## Layers in a window

Native views, bottom to top: the window's UI (sidebar, pane bars, toasts), tab pages, the overlay (only while a panel is open), the Peek page, the permission prompt. CSS `z-index` is hardly used.

## Rules these values follow

- A colour used for a state (danger, warning, success, disabled, scrim) is a token in `tokens.css`, not a literal.
- No hex colour outside `tokens.css`, `canvas.css` and `panels/spotlights.css`; `test/unit/design-tokens.test.ts` fails on one and names the few exceptions.
- A radius, type size or duration that is on a scale uses its token. Spotlight pictures and what is drawn on a canvas keep their own values.
- A size the main process also needs lives in `src/shared/` and reaches the CSS as a custom property (`SIDEBAR_CSS_LENGTHS`, set in `src/renderer/src/api.ts`).
- The canvas's tokens are prefixed `--canvas-`; a spotlight picture placed on a board gets `--accent`, `--line` and `--hover` mapped from them.
- An inner corner is the outer one less the border between them (11 inside a 12 Settings card).
- `--text-3` is about 3.4:1 on a panel: for hints and counts, not for text someone has to read.
