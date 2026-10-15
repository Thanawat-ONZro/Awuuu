// The dog on the desktop: its own small window, wherever the user dropped it.
// Design and what still needs a real Windows desktop: docs/DESKTOP-DOG.md.
//
// The island page runs the life cycle (src/island/desktop-dog.ts): out to its
// spot, home for an alert, back out. It also drives the flights, as a position
// tween through `desktop_dog_set_position`. This file owns the window: where it
// is, which part of it takes the mouse, the drag, and the saved spot.
//
// No polling of its own: the island's low-level mouse hook (island.rs Watch)
// hands every mouse event to `on_mouse`, which costs one atomic load while the
// dog is home.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::settings::DesktopDogPref;

pub const LABEL: &str = "dog";

/// Side of the square window, logical px.
pub const SIZE: f64 = 120.0;
/// Kept between the window and the edges of the work area, logical px.
const MARGIN: f64 = 12.0;
/// The page hears about the cursor only within this distance of the dog, logical px.
pub const NEAR: f64 = 300.0;
/// Where the window waits while the dog is home. It is never hidden: showing
/// a hidden window again (SW_SHOW) may take the focus from the app in use.
const PARKED: (f64, f64) = (-32000.0, -32000.0);
/// Shortest gap between two `dog-cursor` events.
const CURSOR_EVERY: Duration = Duration::from_millis(16);

// ── Pure geometry ─────────────────────────────────────────────────────────────

pub mod logic {
    use crate::settings::{DesktopDogPref, DogSpot};

    /// A rectangle, y down, physical desktop px unless said otherwise.
    #[derive(Clone, Copy, Debug, PartialEq)]
    pub struct Rect {
        pub x: f64,
        pub y: f64,
        pub w: f64,
        pub h: f64,
    }

    impl Rect {
        pub fn contains(&self, p: (f64, f64)) -> bool {
            p.0 >= self.x && p.0 < self.x + self.w && p.1 >= self.y && p.1 < self.y + self.h
        }

        pub fn center(&self) -> (f64, f64) {
            (self.x + self.w / 2.0, self.y + self.h / 2.0)
        }
    }

    /// A connected monitor: a stable key, its whole area, the part windows
    /// may use (no taskbar) and its scale factor.
    #[derive(Clone, Debug, PartialEq)]
    pub struct Display {
        pub key: String,
        pub frame: Rect,
        pub work: Rect,
        pub scale: f64,
    }

    /// The body disc inside the square window, as fractions of its side. The
    /// page draws the dog there (src/mochi/desktop-logic.ts BODY).
    pub const BODY_CX: f64 = 0.5;
    pub const BODY_CY: f64 = 0.62;
    pub const BODY_R: f64 = 0.3;

    /// Hit test of the body inside the window (window-local, logical px).
    pub fn is_over_body(local: (f64, f64), size: f64) -> bool {
        let (dx, dy) = (local.0 - size * BODY_CX, local.1 - size * BODY_CY);
        let r = size * BODY_R;
        dx * dx + dy * dy <= r * r
    }

    /// The cursor is close enough for the dog to watch it (logical px).
    pub fn is_near(local: (f64, f64), size: f64, near: f64) -> bool {
        let (dx, dy) = (local.0 - size * BODY_CX, local.1 - size * BODY_CY);
        dx * dx + dy * dy <= near * near
    }

    /// Keeps a window of side `side` inside `work`, `margin` from each edge.
    /// A work area too small for it pins it to the top-left.
    pub fn clamp_origin(origin: (f64, f64), side: f64, work: Rect, margin: f64) -> (f64, f64) {
        let axis = |v: f64, lo: f64, len: f64| {
            let hi = lo + len - side - margin;
            let lo = lo + margin;
            if hi < lo { lo } else { v.clamp(lo, hi) }
        };
        (axis(origin.0, work.x, work.w), axis(origin.1, work.y, work.h))
    }

    /// The display whose frame holds `p`, else the one whose work area's
    /// centre is closest.
    pub fn display_near(p: (f64, f64), displays: &[Display]) -> Option<usize> {
        displays.iter().position(|d| d.frame.contains(p)).or_else(|| {
            let dist = |d: &Display| {
                let c = d.work.center();
                (p.0 - c.0).powi(2) + (p.1 - c.1).powi(2)
            };
            (0..displays.len()).min_by(|&a, &b| dist(&displays[a]).total_cmp(&dist(&displays[b])))
        })
    }

    /// Where a window dropped with its top-left at `origin` settles: inside
    /// the work area of the display under its centre (or the nearest one).
    pub fn settle(origin: (f64, f64), displays: &[Display], size: f64, margin: f64) -> Option<(usize, (f64, f64))> {
        // The window has the size of the display it is on: try each scale.
        let first = displays.first()?;
        let half = size * first.scale / 2.0;
        let i = display_near((origin.0 + half, origin.1 + half), displays)?;
        let d = &displays[i];
        Some((i, clamp_origin(origin, size * d.scale, d.work, margin * d.scale)))
    }

    /// Top-left as saved: logical px from the work area's top-left. DPI-free,
    /// so the spot survives a scale change of that monitor.
    pub fn spot_of(origin: (f64, f64), d: &Display) -> DogSpot {
        DogSpot { x: (origin.0 - d.work.x) / d.scale, y: (origin.1 - d.work.y) / d.scale }
    }

    /// A saved spot back to physical px on `d`, pulled inside its work area.
    pub fn origin_of(spot: DogSpot, d: &Display, size: f64, margin: f64) -> (f64, f64) {
        let raw = (d.work.x + spot.x * d.scale, d.work.y + spot.y * d.scale);
        clamp_origin(raw, size * d.scale, d.work, margin * d.scale)
    }

    /// First visit to a display: the bottom-right corner of its work area.
    pub fn default_origin(d: &Display, size: f64, margin: f64) -> (f64, f64) {
        let s = size * d.scale;
        let m = margin * d.scale;
        (d.work.x + d.work.w - s - m, d.work.y + d.work.h - s - m)
    }

    /// Where the dog goes when it flies out: its spot on the monitor it sat on
    /// last, when that monitor is still connected; otherwise its spot on (or
    /// the corner of) `fallback`, the island's monitor. Always on a connected
    /// monitor, `None` only when there is none.
    pub fn resolve(
        pref: &DesktopDogPref,
        displays: &[Display],
        fallback: usize,
        size: f64,
        margin: f64,
    ) -> Option<(usize, (f64, f64))> {
        let i = displays
            .iter()
            .position(|d| !pref.last.is_empty() && d.key == pref.last)
            .or_else(|| (!displays.is_empty()).then(|| fallback.min(displays.len() - 1)))?;
        let d = &displays[i];
        let at = match pref.spots.get(&d.key) {
            Some(spot) => origin_of(*spot, d, size, margin),
            None => default_origin(d, size, margin),
        };
        Some((i, at))
    }

    /// Records that the dog now sits at `origin` on `d`.
    pub fn remember(pref: &mut DesktopDogPref, origin: (f64, f64), d: &Display) {
        pref.spots.insert(d.key.clone(), spot_of(origin, d));
        pref.last = d.key.clone();
        pref.on_desktop = true;
    }

    /// Dropping the dog here brings it home: the island window, made easier
    /// to hit (a collapsed island is only a thin strip).
    pub fn home_zone(island: Rect, scale: f64) -> Rect {
        let pad = 48.0 * scale;
        let w = (island.w + 2.0 * pad).max(280.0 * scale);
        let h = (island.h + 2.0 * pad).max(140.0 * scale);
        let (cx, cy) = island.center();
        Rect { x: cx - w / 2.0, y: cy - h / 2.0, w, h }
    }

    /// Top-left of the dog window when it sits in the island: centred on it,
    /// where the flights start and end.
    pub fn island_spot(island: Rect, size: f64, scale: f64) -> (f64, f64) {
        let (cx, cy) = island.center();
        let s = size * scale;
        (cx - s / 2.0, cy - s / 2.0)
    }
}

use logic::{Display, Rect};

// ── State ─────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    /// Dragged out of the island.
    Island,
    /// Picked up where it sat on the desktop.
    Desktop,
}

#[derive(Clone, Copy)]
struct Carry {
    /// Cursor minus the window's top-left at pick-up, physical px.
    grab: (f64, f64),
    from: Source,
}

#[derive(Default)]
struct Inner {
    /// Sitting on the desktop (not flying, not carried).
    landed: bool,
    flying: bool,
    carry: Option<Carry>,
    /// Window top-left, physical px.
    pos: (f64, f64),
    /// Scale of the monitor it is on.
    scale: f64,
    /// The click-through flag last applied (None: decide on the next event).
    ignoring: Option<bool>,
    /// The page is being told about the cursor.
    near: bool,
    cursor_sent: Option<Instant>,
}

#[derive(Default)]
pub struct DesktopDog {
    /// On screen (not parked). Read on every mouse event, so it is atomic.
    shown: AtomicBool,
    inner: Mutex<Inner>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Visible {
    visible: bool,
    flying: bool,
}

#[derive(Serialize, Clone)]
struct DogCursor {
    x: f64,
    y: f64,
    near: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Dropped {
    from: Source,
    home: bool,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// A flight the island page animates: window top-left, physical px.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Flight {
    pub from: Point,
    pub to: Point,
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

fn dog(app: &AppHandle) -> Option<tauri::State<'_, DesktopDog>> {
    app.try_state::<DesktopDog>()
}

// ── Setup ─────────────────────────────────────────────────────────────────────

fn page_url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/dog.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("dog.html".into())
}

/// Created at launch, like the settings window (a WebView2 window created
/// later comes up blank in this app), visible but parked off-screen.
pub fn setup(app: &AppHandle) {
    app.manage(DesktopDog::default());
    let built = WebviewWindowBuilder::new(app, LABEL, page_url(app))
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("Awuuu")
        .inner_size(SIZE, SIZE)
        .position(PARKED.0, PARKED.1)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .disable_drag_drop_handler()
        .visible(true)
        .build();
    match built {
        Ok(win) => {
            crate::island::make_non_activating(&win);
            let _ = win.set_ignore_cursor_events(true);
        }
        Err(err) => crate::log::line(format!("desktop dog window failed: {err}")),
    }
}

// ── Coordinates ───────────────────────────────────────────────────────────────

fn displays(app: &AppHandle) -> Vec<Display> {
    let Ok(monitors) = app.available_monitors() else { return Vec::new() };
    monitors
        .iter()
        .map(|m| {
            let (p, s, wa) = (m.position(), m.size(), m.work_area());
            Display {
                key: m.name().cloned().unwrap_or_else(|| format!("{},{}", p.x, p.y)),
                frame: Rect { x: p.x as f64, y: p.y as f64, w: s.width as f64, h: s.height as f64 },
                work: Rect {
                    x: wa.position.x as f64,
                    y: wa.position.y as f64,
                    w: wa.size.width as f64,
                    h: wa.size.height as f64,
                },
                scale: m.scale_factor(),
            }
        })
        .collect()
}

/// The island window's rect (physical) and scale.
fn island_rect(app: &AppHandle) -> Option<(Rect, f64)> {
    let win = crate::island::window(app)?;
    let p = win.outer_position().ok()?;
    let s = win.outer_size().ok()?;
    let scale = win.scale_factor().unwrap_or(1.0);
    Some((Rect { x: p.x as f64, y: p.y as f64, w: s.width as f64, h: s.height as f64 }, scale))
}

fn scale_at(p: (f64, f64), all: &[Display]) -> f64 {
    logic::display_near(p, all).map(|i| all[i].scale).unwrap_or(1.0)
}

fn pref(app: &AppHandle) -> DesktopDogPref {
    app.try_state::<crate::Shared>()
        .map(|s| s.settings.lock().unwrap().desktop_dog.clone())
        .unwrap_or_default()
}

/// Saves a change to the Rust-owned part of the preference. The pages keep
/// their own copy of `enabled` only; save_settings preserves the rest.
fn remember(app: &AppHandle, change: impl FnOnce(&mut DesktopDogPref)) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let snapshot = {
        let mut s = shared.settings.lock().unwrap();
        change(&mut s.desktop_dog);
        s.clone()
    };
    if let Err(err) = crate::settings::save(&snapshot) {
        crate::log::line(format!("could not save settings: {err}"));
    }
}

fn remember_spot(app: &AppHandle, pos: (f64, f64)) {
    let all = displays(app);
    let Some(i) = logic::display_near((pos.0 + 1.0, pos.1 + 1.0), &all) else { return };
    let d = all[i].clone();
    remember(app, |p| logic::remember(p, pos, &d));
}

// ── Window operations ─────────────────────────────────────────────────────────

fn place(app: &AppHandle, d: &DesktopDog, pos: (f64, f64)) {
    d.inner.lock().unwrap().pos = pos;
    if let Some(win) = window(app) {
        let _ = win.set_position(PhysicalPosition::new(pos.0.round() as i32, pos.1.round() as i32));
    }
}

fn set_ignore(app: &AppHandle, d: &DesktopDog, flag: bool) {
    {
        let mut i = d.inner.lock().unwrap();
        if i.ignoring == Some(flag) {
            return;
        }
        i.ignoring = Some(flag);
    }
    if let Some(win) = window(app) {
        let _ = win.set_ignore_cursor_events(flag);
    }
}

fn tell_page(app: &AppHandle, visible: bool, flying: bool) {
    let _ = app.emit_to(LABEL, "dog-visible", Visible { visible, flying });
}

fn show(app: &AppHandle, d: &DesktopDog, at: (f64, f64), scale: f64, flying: bool) {
    {
        let mut i = d.inner.lock().unwrap();
        i.scale = scale;
        i.flying = flying;
        i.landed = false;
        i.near = false;
    }
    place(app, d, at);
    d.shown.store(true, Ordering::Relaxed);
    if let Some(win) = window(app) {
        let _ = win.set_always_on_top(true);
    }
    tell_page(app, true, flying);
}

fn park(app: &AppHandle, d: &DesktopDog) {
    d.shown.store(false, Ordering::Relaxed);
    {
        let mut i = d.inner.lock().unwrap();
        i.landed = false;
        i.flying = false;
        i.carry = None;
        i.near = false;
    }
    set_ignore(app, d, true);
    place(app, d, PARKED);
    tell_page(app, false, false);
}

/// Sitting at `pos`: the mouse decides click-through from now on.
fn land(app: &AppHandle, d: &DesktopDog, pos: (f64, f64), scale: f64) {
    {
        let mut i = d.inner.lock().unwrap();
        i.landed = true;
        i.flying = false;
        i.carry = None;
        i.scale = scale;
    }
    place(app, d, pos);
    tell_page(app, true, false);
    crate::mouse::poke();
}

/// The drop, wherever it came from: home if over the island, otherwise the
/// nearest good spot on a connected monitor.
fn finish_drop(app: &AppHandle, at: (f64, f64), from: Source) {
    let Some(d) = dog(app) else { return };
    let all = displays(app);
    let scale = scale_at(at, &all);
    let side = SIZE * scale;
    let center = (at.0 + side / 2.0, at.1 + side / 2.0);
    let home = island_rect(app).is_some_and(|(r, s)| logic::home_zone(r, s).contains(center));
    if home {
        park(app, &d);
        remember(app, |p| p.on_desktop = false);
    } else {
        let (i, pos) = logic::settle(at, &all, SIZE, MARGIN).unwrap_or((0, at));
        let scale = all.get(i).map(|d| d.scale).unwrap_or(scale);
        land(app, &d, pos, scale);
        remember_spot(app, pos);
    }
    crate::log::line(format!("desktop dog dropped from {from:?}: {}", if home { "home" } else { "desktop" }));
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "dog-dropped", Dropped { from, home });
}

/// A display was plugged, unplugged or rescaled: keep the dog on one.
pub fn reclamp(app: &AppHandle) {
    let Some(d) = dog(app) else { return };
    if !d.shown.load(Ordering::Relaxed) {
        return;
    }
    let (landed, pos) = {
        let i = d.inner.lock().unwrap();
        (i.landed, i.pos)
    };
    if !landed {
        return;
    }
    let all = displays(app);
    if let Some((i, to)) = logic::settle(pos, &all, SIZE, MARGIN) {
        if to != pos {
            land(app, &d, to, all[i].scale);
            remember_spot(app, to);
        }
    }
}

// ── Mouse (from the island's low-level hook) ──────────────────────────────────

/// Every mouse event, physical desktop px. `up`: the left button was released.
pub fn on_mouse(app: &AppHandle, cx: f64, cy: f64, up: bool) {
    let Some(d) = dog(app) else { return };
    if !d.shown.load(Ordering::Relaxed) {
        return;
    }
    let (carry, landed, pos, scale, was_near, sent) = {
        let i = d.inner.lock().unwrap();
        (i.carry, i.landed, i.pos, i.scale, i.near, i.cursor_sent)
    };

    if let Some(c) = carry {
        let at = (cx - c.grab.0, cy - c.grab.1);
        // A lost button-up event must not leave the dog stuck to the cursor.
        if up || !crate::island::left_button_down() {
            d.inner.lock().unwrap().carry = None;
            let app = app.clone();
            std::thread::spawn(move || finish_drop(&app, at, c.from));
        } else if at != pos {
            place(app, &d, at);
        }
        return;
    }
    if !landed {
        return;
    }

    let scale = if scale > 0.0 { scale } else { 1.0 };
    let local = ((cx - pos.0) / scale, (cy - pos.1) / scale);
    set_ignore(app, &d, !logic::is_over_body(local, SIZE));

    let near = logic::is_near(local, SIZE, NEAR);
    let due = sent.is_none_or(|t| t.elapsed() >= CURSOR_EVERY);
    if near != was_near || (near && due) {
        {
            let mut i = d.inner.lock().unwrap();
            i.near = near;
            i.cursor_sent = Some(Instant::now());
        }
        let _ = app.emit_to(LABEL, "dog-cursor", DogCursor { x: local.0, y: local.1, near });
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Dragging the dog out of the island: the window appears under the pointer
/// and the mouse hook carries it until the button goes up.
#[tauri::command]
pub fn desktop_dog_pick_up(app: AppHandle) -> bool {
    let Some(d) = dog(&app) else { return false };
    if !pref(&app).enabled || d.shown.load(Ordering::Relaxed) || window(&app).is_none() {
        return false;
    }
    let Some(cursor) = crate::island::cursor_physical() else { return false };
    let scale = scale_at(cursor, &displays(&app));
    let half = SIZE * scale / 2.0;
    d.inner.lock().unwrap().carry = Some(Carry { grab: (half, half), from: Source::Island });
    show(&app, &d, (cursor.0 - half, cursor.1 - half), scale, false);
    set_ignore(&app, &d, false);
    true
}

/// The page saw a drag start on the dog where it sits.
#[tauri::command]
pub fn desktop_dog_drag_begin(app: AppHandle) -> bool {
    let Some(d) = dog(&app) else { return false };
    let Some(cursor) = crate::island::cursor_physical() else { return false };
    {
        let mut i = d.inner.lock().unwrap();
        if !i.landed || i.carry.is_some() {
            return false;
        }
        i.landed = false;
        i.carry = Some(Carry { grab: (cursor.0 - i.pos.0, cursor.1 - i.pos.1), from: Source::Desktop });
    }
    set_ignore(&app, &d, false);
    true
}

/// Starts a flight: `kind` "out" (island → its spot) or "home" (where it is →
/// island). Returns the end points, or None when there is nothing to fly
/// (already there, being carried, no monitor).
#[tauri::command]
pub fn desktop_dog_flight_begin(app: AppHandle, kind: String) -> Option<Flight> {
    let d = dog(&app)?;
    let (island, iscale) = island_rect(&app)?;
    let all = displays(&app);
    let shown = d.shown.load(Ordering::Relaxed);
    {
        let i = d.inner.lock().unwrap();
        if i.carry.is_some() {
            return None;
        }
    }
    if kind == "out" {
        if shown {
            return None;
        }
        let fallback = logic::display_near(island.center(), &all).unwrap_or(0);
        let (idx, to) = logic::resolve(&pref(&app), &all, fallback, SIZE, MARGIN)?;
        let from = logic::island_spot(island, SIZE, iscale);
        show(&app, &d, from, all[idx].scale, true);
        set_ignore(&app, &d, true);
        return Some(Flight { from: Point { x: from.0, y: from.1 }, to: Point { x: to.0, y: to.1 } });
    }
    if !shown {
        return None;
    }
    let from = {
        let mut i = d.inner.lock().unwrap();
        i.landed = false;
        i.flying = true;
        i.near = false;
        i.pos
    };
    set_ignore(&app, &d, true);
    tell_page(&app, true, true);
    let to = logic::island_spot(island, SIZE, iscale);
    Some(Flight { from: Point { x: from.0, y: from.1 }, to: Point { x: to.0, y: to.1 } })
}

/// One step of a flight (window top-left, physical px).
#[tauri::command]
pub fn desktop_dog_set_position(app: AppHandle, x: f64, y: f64) {
    let Some(d) = dog(&app) else { return };
    let flying = d.inner.lock().unwrap().flying;
    if flying && d.shown.load(Ordering::Relaxed) && x.is_finite() && y.is_finite() {
        place(&app, &d, (x, y));
    }
}

/// The flight is over. Out: it sits at its spot, which is saved. Home: the
/// window is parked; `forget` (the user brought it home) also clears
/// `onDesktop`, without it the dog is only away for an alert.
#[tauri::command]
pub fn desktop_dog_flight_end(app: AppHandle, kind: String, forget: bool) {
    let Some(d) = dog(&app) else { return };
    if !d.inner.lock().unwrap().flying {
        return;
    }
    if kind == "out" {
        let all = displays(&app);
        let pos = d.inner.lock().unwrap().pos;
        let (i, pos) = logic::settle(pos, &all, SIZE, MARGIN).unwrap_or((0, pos));
        let scale = all.get(i).map(|d| d.scale).unwrap_or(1.0);
        land(&app, &d, pos, scale);
        remember_spot(&app, pos);
    } else {
        park(&app, &d);
        if forget {
            remember(&app, |p| p.on_desktop = false);
        }
    }
}

/// The dog stays home from now on (feature switched off while it was home).
#[tauri::command]
pub fn desktop_dog_forget(app: AppHandle) {
    if pref(&app).on_desktop {
        remember(&app, |p| p.on_desktop = false);
    }
}

#[cfg(test)]
mod tests {
    use super::logic::*;
    use crate::settings::{DesktopDogPref, DogSpot};

    fn two_displays() -> Vec<Display> {
        // A 1920×1080 laptop at 100 %, and a 4K monitor at 200 % on its right,
        // physical px; both with a 48 px (logical) taskbar at the bottom.
        let a = Rect { x: 0.0, y: 0.0, w: 1920.0, h: 1080.0 };
        let b = Rect { x: 1920.0, y: -200.0, w: 3840.0, h: 2160.0 };
        vec![
            Display { key: "\\\\.\\DISPLAY1".into(), frame: a, work: Rect { h: 1032.0, ..a }, scale: 1.0 },
            Display { key: "\\\\.\\DISPLAY2".into(), frame: b, work: Rect { h: 2064.0, ..b }, scale: 2.0 },
        ]
    }

    #[test]
    fn body_hit_test() {
        let s = 120.0;
        let (cx, cy, r) = (s * BODY_CX, s * BODY_CY, s * BODY_R);
        assert!(is_over_body((cx, cy), s));
        assert!(is_over_body((cx + r - 0.5, cy), s));
        assert!(!is_over_body((cx + r + 0.5, cy), s));
        assert!(!is_over_body((0.0, 0.0), s), "the transparent corner is click-through");
        assert!(!is_over_body((s - 1.0, 1.0), s));
    }

    #[test]
    fn nearness_is_measured_from_the_body() {
        assert!(is_near((60.0, 74.0), 120.0, 300.0));
        assert!(is_near((60.0 + 299.0, 74.4), 120.0, 300.0));
        assert!(!is_near((60.0 + 301.0, 74.4), 120.0, 300.0));
        assert!(!is_near((-400.0, -400.0), 120.0, 300.0));
    }

    #[test]
    fn clamp_keeps_the_window_inside_the_work_area() {
        let work = Rect { x: 0.0, y: 0.0, w: 1440.0, h: 860.0 };
        assert_eq!(clamp_origin((600.0, 400.0), 120.0, work, 12.0), (600.0, 400.0));
        assert_eq!(clamp_origin((-50.0, 400.0), 120.0, work, 12.0), (12.0, 400.0));
        assert_eq!(clamp_origin((2000.0, 2000.0), 120.0, work, 12.0), (1440.0 - 132.0, 860.0 - 132.0));
        // A work area smaller than the window: pinned, never NaN or inverted.
        let tiny = Rect { x: 10.0, y: 10.0, w: 50.0, h: 50.0 };
        assert_eq!(clamp_origin((500.0, 500.0), 120.0, tiny, 12.0), (22.0, 22.0));
    }

    #[test]
    fn a_drop_settles_on_the_display_under_it() {
        let d = two_displays();
        assert_eq!(settle((1800.0, 500.0), &d, 120.0, 12.0), Some((0, (1920.0 - 132.0, 500.0))));
        // Its centre already over the 200 % monitor: it moves onto that one,
        // margin in that monitor's scale.
        assert_eq!(settle((1870.0, 500.0), &d, 120.0, 12.0), Some((1, (1920.0 + 24.0, 500.0))));
        // In the gap above the laptop: nearest display.
        let (i, (x, y)) = settle((1000.0, -150.0), &d, 120.0, 12.0).unwrap();
        assert_eq!((i, x, y), (0, 1000.0, 12.0));
        assert_eq!(settle((0.0, 0.0), &[], 120.0, 12.0), None);
    }

    #[test]
    fn spots_round_trip_in_logical_px_per_monitor() {
        let d = two_displays();
        let at = (1920.0 + 400.0, -200.0 + 600.0);
        let spot = spot_of(at, &d[1]);
        assert_eq!(spot, DogSpot { x: 200.0, y: 300.0 });
        assert_eq!(origin_of(spot, &d[1], 120.0, 12.0), at);
        // The same monitor at a new scale keeps the same logical spot.
        let mut rescaled = d[1].clone();
        rescaled.scale = 1.5;
        assert_eq!(origin_of(spot, &rescaled, 120.0, 12.0), (1920.0 + 300.0, -200.0 + 450.0));
    }

    #[test]
    fn restore_prefers_the_last_monitor() {
        let d = two_displays();
        let mut pref = DesktopDogPref::default();
        remember(&mut pref, (1920.0 + 400.0, -200.0 + 600.0), &d[1]);
        remember(&mut pref, (100.0, 100.0), &d[0]);
        remember(&mut pref, (1920.0 + 400.0, -200.0 + 600.0), &d[1]);
        assert!(pref.on_desktop);
        assert_eq!(pref.spots.len(), 2, "one spot per monitor");
        assert_eq!(resolve(&pref, &d, 0, 120.0, 12.0), Some((1, (2320.0, 400.0))));
    }

    #[test]
    fn restore_onto_a_monitor_that_is_gone_clamps_onto_the_island_monitor() {
        let d = two_displays();
        let mut pref = DesktopDogPref::default();
        pref.last = "\\\\.\\DISPLAY9".into();
        pref.spots.insert(pref.last.clone(), DogSpot { x: 5000.0, y: 5000.0 });
        // Never on the fallback monitor: its bottom-right corner.
        assert_eq!(resolve(&pref, &d, 0, 120.0, 12.0), Some((0, (1920.0 - 132.0, 1032.0 - 132.0))));
        // A spot saved there before is used, pulled back inside its work area.
        pref.spots.insert("\\\\.\\DISPLAY1".into(), DogSpot { x: 300.0, y: 5000.0 });
        assert_eq!(resolve(&pref, &d, 0, 120.0, 12.0), Some((0, (300.0, 1032.0 - 132.0))));
        // A fallback index past the end still lands on a connected monitor.
        assert_eq!(resolve(&DesktopDogPref::default(), &d, 7, 120.0, 12.0).map(|r| r.0), Some(1));
        assert_eq!(resolve(&pref, &[], 0, 120.0, 12.0), None);
    }

    #[test]
    fn first_visit_is_the_bottom_right_corner() {
        let d = two_displays();
        assert_eq!(default_origin(&d[0], 120.0, 12.0), (1920.0 - 132.0, 1032.0 - 132.0));
        assert_eq!(default_origin(&d[1], 120.0, 12.0), (1920.0 + 3840.0 - 264.0, -200.0 + 2064.0 - 264.0));
    }

    #[test]
    fn the_island_is_home_even_when_it_is_a_thin_strip() {
        // Collapsed island: a 140×14 strip centred at the top, at 150 %.
        let strip = Rect { x: 855.0, y: 0.0, w: 210.0, h: 21.0 };
        let zone = home_zone(strip, 1.5);
        assert!(zone.contains((960.0, 10.0)));
        assert!(zone.contains((960.0, 90.0)), "just under the strip still counts");
        assert!(!zone.contains((960.0, 400.0)));
        assert!(!zone.contains((100.0, 10.0)));
        // The open island's window is home all over.
        let open = Rect { x: 600.0, y: 0.0, w: 720.0, h: 320.0 };
        assert!(home_zone(open, 1.0).contains((610.0, 310.0)));
    }

    #[test]
    fn flights_start_and_end_centred_on_the_island() {
        let strip = Rect { x: 890.0, y: 0.0, w: 140.0, h: 14.0 };
        assert_eq!(island_spot(strip, 120.0, 1.0), (900.0, -53.0));
        assert_eq!(island_spot(strip, 120.0, 2.0), (840.0, -113.0));
    }
}
