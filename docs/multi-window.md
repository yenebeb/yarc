# Several main windows (⌘N)

Arc's behavior is in `arc-reference.md` §6 "Multiple windows". In short: every window shows the same sidebar (spaces, favorites, pinned and Today tabs); each window has its own space, selected tab, split view and sidebar visibility; ⌘N opens a window on the current space with nothing selected and the command bar open; every window comes back after a relaunch.

## Design

**One controller, several windows.** The main `Browser` (`src/main/browser.ts`) keeps owning the store, the profiles, the live tabs and the Little Windows. Each main window is a `WindowSession` (in `browser.ts`): its `MainWindow` (sidebar UI, overlay), the runtime state that used to sit on `Browser` (Peek, sidebar reveal and its watcher, tab drag, Ctrl+Tab switcher, full-screen tab, current layout), and a persisted `WindowView`. Incognito windows stay separate controllers, as before.

**`WindowView`** (`PersistedState.windows`, in `state.json`) holds what is per window: `activeSpaceId`, the selected tab of each space (`selected`), each space's splits (`splits`), `sidebarVisible`, and the window's bounds and maximized state. `window.json` (the old single window's bounds) is read once, for the first window.

**The current window.** The existing code reads `state.activeSpaceId`, `space.activeItemId`, `space.splits` and `settings.sidebarVisible`. Those fields now always hold the *current* window's values: `use(win)` copies them into the old current window's `WindowView` and the new window's values into the state (`captureView` / `applyView` in `src/main/features/window-state.ts`). Everything that acts on "the window" therefore keeps working unchanged. The current window changes when a window gets focus, sends IPC (sidebar or overlay), gets a key press, or when one of its pages (or its Peek) raises an event. Menu commands act on the focused window. Timers (the sidebar-reveal watcher) act on their own window and switch back after.

The UI of every other window gets `stateForView(state, view)`: the same shared state with that window's space, selections, splits and sidebar visibility laid over it, so the renderer needs no change to read it.

**A page lives in one window.** A tab's `WebContentsView` can only be in one window. Like Arc, a tab can be selected in two windows; the window that lays it out (the focused one) takes the view. The other window marks the pane `elsewhere` and shows the page greyed out, as a still that follows it: `capturePage` once, then `Mirror` (`src/main/features/mirror.ts`) subscribes to the page's frames and sends the newest at most every 200 ms on `IPC.still`, so a navigation, a scroll or a call's video shows in both windows. Clicking the still, or focusing that window, takes the page back. When the window that has the page live lets it go (selects another tab, or closes), a window showing a still of it takes it, live, at once: a Meet call keeps running and showing in whichever window still has it selected.

**Closing and quitting.** Closing a window with others still open drops its `WindowView` and keeps its tabs running for the other windows. Closing the last one keeps its `WindowView` (macOS keeps running; the next window, from the Dock or a menu, reopens with that view); on Windows and Linux the app quits as before. On quit (`before-quit`) nothing is dropped, so every open window is restored at the next launch, the last focused one on top.

**New window.** ⌘N / Ctrl+N (`newWindow` in `keymap.ts`), File › New Window, the macOS Dock menu (first item) and the Windows jump list (`--new-window`). The window cascades from the current one, shows the current window's space with no tab selected, the sidebar shown, and opens the command bar. From an incognito window it opens a normal window.

**Not done.** Extensions see a tab in the window it was first created in (`electron-chrome-extensions` keeps the window it got at `addTab`). The Ctrl+Tab recent-tab order is shared by all windows. Arc's per-window sidebar width and expanded folders stay global.
