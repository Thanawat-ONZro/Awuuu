# Dog on the desktop

## Design

1. Feature flag `desktopDog.enabled` (Settings → General → "Dog on desktop", default off). Rust owns the rest of `desktopDog` (`onDesktop`, per-monitor `spots`, `last`); `save_settings` keeps Rust's copy of those so the pages can never overwrite them with a stale one.
2. A second always-on-top, transparent, non-activating tool window (`dog`, 120×120 logical, `dog.html` → `src/dog/main.ts`) is created at launch, parked off-screen at (-32000, -32000) and only ever moved, never shown/hidden (showing a hidden window can take focus). WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW, skip-taskbar, not focusable.
3. Rust (`src-tauri/src/desktop_dog.rs`) owns the window: placement, the per-monitor saved spot (logical offset in the monitor's work area, keyed by monitor name, clamped onto a connected monitor on load), drag carry and drop. The existing low-level mouse hook feeds it (no new polling): over the body the window takes the mouse, elsewhere it is click-through; the cursor is forwarded to the page only while within ~300 px.
4. The island page owns the life cycle (`src/island/desktop-dog.ts` + pure `src/mochi/desktop-logic.ts`): the dog should be *out* when enabled, the user wants it out, and no alert (approval / error / finished) is up; otherwise *home*. A flight is a ~400 ms position tween driven from TS (`desktop_dog_flight_begin` → `desktop_dog_set_position` per tick → `desktop_dog_flight_end`).
5. The dog page draws only while the window is on screen and (cursor near OR a flight/tween/fidget is running); otherwise one 400 ms idle tick, and nothing at all once it dozes off or is parked.
6. Drag out of the open island (press on the dog, move > 8 px) → Rust shows the window under the cursor and carries it; release over the island = home, elsewhere = new spot. Click pokes, double-click or Ctrl+Alt+D (`toggleDesktopDog`, registered only while the feature is on) sends it home / out.
7. All decisions that can be pure are pure and unit-tested: monitor clamping, spot save/restore, home-zone hit test, body hit test (Rust); out/home decision, alert rule, flight easing and waypoints, frame pacing, idle/sleep rule, gaze (TS, vitest).

## Needs testing on Windows

Everything below is compiled and unit-tested on Linux (cross-compiled for Windows, Rust tests under wine), never run on a real Windows desktop.

- Click-through: `set_ignore_cursor_events` toggled from the mouse-hook thread as the cursor crosses the dog's body disc. If it misbehaves, the fallback is to leave the window always taking the mouse (it is only 120 px).
- Drag carry: the window follows the cursor from the mouse hook (`Move` events) and is dropped on `Up`. Releasing a drag that started in the island while the island has gone click-through: check the release does not click the app underneath.
- Moving the window across monitors with different DPI: Windows resizes it on WM_DPICHANGED; check it stays 120 logical px and the body hit test still lines up.
- The parked window (-32000) never appears in Alt-Tab, the taskbar or Task View, and never takes focus when it moves or when it is clicked.
- Flights: ~24 `set_position` calls in 400 ms over IPC; check they are smooth and that the island page's timer is not throttled.
- Monitor unplugged while the dog is out: the spot is re-clamped when the island notices a display change, and on next launch onto a connected monitor.
- Memory: the extra WebView2 window costs some memory for everyone, even with the feature off (it is created at launch because a WebView2 window created later comes up blank in this app — see `create_settings_window`).

## Known gaps

- Pressing on the island's dog to drag it out also counts as a poke (the island's existing mousedown slap) before it leaves.
- Tray → Pause does not bring the dog home; it only stops new drags out of the island.
- No wandering across the desktop: the dog stays on its spot and only fidgets, watches and sleeps.
- A finished task calls the dog home for 2.5 s only when the island's green "done" flash fires for an agent session.
