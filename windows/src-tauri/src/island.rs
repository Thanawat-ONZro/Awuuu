// Island window: placement on the chosen display, the two window sizes
// (full panel / invisible wake strip), click-through and the mouse watcher.
//
// There is no notch on a PC, so the island is a black shape drawn at the top
// centre of the main display inside a borderless, transparent, always-on-top
// window that never takes focus.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::mouse::Event;

use windows::Win32::Foundation::{HWND, POINT};
use windows::core::BOOL;
use windows::Win32::Foundation::LPARAM;
use windows::Win32::System::Ole::RevokeDragDrop;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_MENU};
use windows::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GetClassNameW};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW,
};

/// Logical size of the subtle notch tab when the island is in hidden/idle state.
pub const STRIP_W: f64 = 140.0;
pub const STRIP_H: f64 = 14.0;

pub const WINDOW_LABEL: &str = "island";

/// Margin around the island that still counts as "on the island", in logical px.
/// Wider than the macOS 6 pt because a click must never be swallowed.
const HIT_MARGIN: f64 = 14.0;

#[derive(Serialize, Clone)]
pub struct CursorPayload {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Clone)]
pub struct ScreenInfo {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

/// The island shape in window-logical coordinates, pushed by the front end.
/// The mouse watcher owns the click-through decision so it is made on the mouse
/// event itself — an IPC round trip here loses clicks.
#[derive(Clone, Copy, Default)]
pub struct IslandRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// What the mouse watcher needs to know about the island. Every change pokes the
/// watcher so it re-applies click-through at once instead of on the next move.
pub struct PollGate {
    active: AtomicBool,
    pub collapsed: AtomicBool,
    rect: Mutex<IslandRect>,
    /// Mirrors the window flag so we only call into Win32 when it changes.
    ignoring: AtomicBool,
    /// The island's grip was pressed: the watcher starts moving the window.
    drag_requested: AtomicBool,
}

impl PollGate {
    pub fn new() -> Self {
        Self {
            active: AtomicBool::new(false),
            collapsed: AtomicBool::new(true),
            rect: Mutex::new(IslandRect::default()),
            ignoring: AtomicBool::new(false),
            drag_requested: AtomicBool::new(false),
        }
    }

    pub fn set_rect(&self, rect: IslandRect) {
        *self.rect.lock().unwrap() = rect;
        crate::mouse::poke();
    }

    /// Forces the flag to be re-applied (after a window resize).
    pub fn forget_ignore_state(&self) {
        self.ignoring.store(false, Ordering::Relaxed);
        crate::mouse::poke();
    }

    pub fn set_active(&self, on: bool) {
        self.active.store(on, Ordering::Relaxed);
        crate::mouse::poke();
    }

    pub fn begin_drag(&self) {
        self.drag_requested.store(true, Ordering::Relaxed);
        crate::mouse::poke();
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::Relaxed)
    }
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

fn cursor_physical() -> Option<(f64, f64)> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p).ok()? };
    Some((p.x as f64, p.y as f64))
}

/// Lets dropped files reach the app again.
///
/// wry installs its drop target by walking the webview's child windows **once**,
/// when the webview is created. WebView2 creates `Chrome_RenderWidgetHostHWND`
/// later and registers its own target on it; being the innermost window, that one
/// wins, and since the page has no HTML5 drop handler it refuses everything — the
/// "no drop" cursor, with nothing reaching Tauri. Revoking it makes OLE fall
/// through to the target wry registered on the parent widget, which is the one
/// that feeds Tauri's drag events.
///
/// Cheap and idempotent, so it is simply re-run whenever a drag might be starting.
pub fn unblock_webview_drops(app: &AppHandle) {
    for label in [WINDOW_LABEL, "settings"] {
        let Some(win) = app.get_webview_window(label) else { continue };
        let Some(hwnd) = hwnd_of(&win) else { continue };
        unsafe {
            let _ = EnumChildWindows(Some(hwnd), Some(revoke_render_widget), LPARAM(0));
        }
    }
}

unsafe extern "system" fn revoke_render_widget(hwnd: HWND, _: LPARAM) -> BOOL {
    let mut name = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd, &mut name) };
    if len > 0 {
        let class = String::from_utf16_lossy(&name[..len as usize]);
        if class == "Chrome_RenderWidgetHostHWND" {
            let _ = unsafe { RevokeDragDrop(hwnd) };
        }
    }
    true.into()
}

/// True while the left mouse button is held — the only signal we get that a
/// drag might be in flight before it reaches the window.
fn left_button_down() -> bool {
    unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 }
}

fn alt_down() -> bool {
    unsafe { (GetAsyncKeyState(VK_MENU.0 as i32) as u16 & 0x8000) != 0 }
}

fn monitor_contains(m: &Monitor, x: f64, y: f64) -> bool {
    let p = m.position();
    let s = m.size();
    x >= p.x as f64
        && x < (p.x + s.width as i32) as f64
        && y >= p.y as f64
        && y < (p.y + s.height as i32) as f64
}

/// The display the island lives on: the primary one, or the one under the cursor.
fn target_monitor(app: &AppHandle, pref: &str) -> Option<Monitor> {
    let monitors = app.available_monitors().ok()?;
    if pref == "cursor" {
        if let Some((cx, cy)) = cursor_physical() {
            if let Some(m) = monitors.iter().find(|m| monitor_contains(m, cx, cy)) {
                return Some(m.clone());
            }
        }
    }
    app.primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.into_iter().next())
}

pub fn screen_info(app: &AppHandle, pref: &str) -> ScreenInfo {
    match target_monitor(app, pref) {
        Some(m) => {
            let scale = m.scale_factor();
            let p = m.position();
            let s = m.size();
            ScreenInfo {
                x: p.x as f64 / scale,
                y: p.y as f64 / scale,
                width: s.width as f64 / scale,
                height: s.height as f64 / scale,
                scale,
            }
        }
        None => ScreenInfo { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale: 1.0 },
    }
}

/// Where the island sits inside its window — sent to the front end, which
/// draws the island there (and pushes back the exact rect for hit testing).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    /// Island centre x in window-logical px (`h == "center"`).
    pub anchor_x: f64,
    /// "center" | "left" | "right"
    pub h: &'static str,
    /// "top" (grows down) | "bottom" (grows up)
    pub v: &'static str,
    /// "top" | "bottom" | "left" | "right" | "free"
    pub edge: String,
    /// The hidden tab stands upright (left/right edges).
    pub vertical: bool,
    /// Window size while open, logical px.
    pub panel_w: f64,
    pub panel_h: f64,
}

/// A rectangle in physical px.
#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Window position/size (physical) and island layout for a placement.
/// `screen` is the monitor, `work` its work area (without the taskbar).
pub fn compute(
    s: &crate::settings::Settings,
    screen: Rect,
    work: Rect,
    scale: f64,
    collapsed: bool,
) -> ((f64, f64, f64, f64), Layout) {
    let (panel_w, panel_h) = s.panel_size();
    let edge = match s.position.as_str() {
        "bottom" | "left" | "right" => s.position.clone(),
        _ => "top".to_string(),
    };
    let vertical = matches!(edge.as_str(), "left" | "right");
    let (lw, lh) = match (collapsed, vertical) {
        (true, true) => (STRIP_H, STRIP_W),
        (true, false) => (STRIP_W, STRIP_H),
        _ => (panel_w, panel_h),
    };
    let (pw, ph) = ((lw * scale).round().max(1.0), (lh * scale).round().max(1.0));
    let clamp_x = |x: f64| x.clamp(screen.x, (screen.x + screen.w - pw).max(screen.x));
    let clamp_y = |y: f64| y.clamp(work.y, (work.y + work.h - ph).max(work.y));
    let along = s.along.clamp(0.0, 1.0);
    // Half the compact island's height: a side-docked island centres on `along`.
    let half_compact = 16.0 * scale;

    let (x, y, h, v) = {
        match edge.as_str() {
            "bottom" => {
                let ax = screen.x + along * screen.w;
                (clamp_x(ax - pw / 2.0), work.y + work.h - ph, "center", "bottom")
            }
            "left" | "right" => {
                let x = if edge == "left" { work.x } else { work.x + work.w - pw };
                let ay = work.y + along * work.h;
                let side = if edge == "left" { "left" } else { "right" };
                if collapsed {
                    (x, clamp_y(ay - ph / 2.0), side, "top")
                } else if along > 0.6 {
                    (x, clamp_y(ay + half_compact - ph), side, "bottom")
                } else {
                    (x, clamp_y(ay - half_compact), side, "top")
                }
            }
            _ => {
                let ax = screen.x + along * screen.w;
                (clamp_x(ax - pw / 2.0), screen.y, "center", "top")
            }
        }
    };
    // Where the island's centre falls inside the window (it may sit off-centre
    // when the window is held back by the screen edge).
    let target_x = screen.x + along * screen.w;
    let anchor_x = ((target_x - x) / scale).clamp(0.0, lw);
    let layout = Layout {
        anchor_x,
        h,
        v,
        edge,
        vertical,
        panel_w,
        panel_h,
    };
    ((x.round(), y.round(), pw, ph), layout)
}

fn rect_of(m: &Monitor) -> (Rect, Rect) {
    let p = m.position();
    let sz = m.size();
    let wa = m.work_area();
    (
        Rect { x: p.x as f64, y: p.y as f64, w: sz.width as f64, h: sz.height as f64 },
        Rect {
            x: wa.position.x as f64,
            y: wa.position.y as f64,
            w: wa.size.width as f64,
            h: wa.size.height as f64,
        },
    )
}

/// Places and sizes the window for the current placement. `collapsed` picks
/// the wake strip instead of the panel. Tells the island where to draw itself.
pub fn apply_geometry(app: &AppHandle, s: &crate::settings::Settings, collapsed: bool) -> Option<Layout> {
    let win = window(app)?;
    let m = target_monitor(app, &s.screen)?;
    let (screen, work) = rect_of(&m);
    let ((x, y, pw, ph), layout) = compute(s, screen, work, m.scale_factor(), collapsed);
    let size = PhysicalSize::new(pw as u32, ph as u32);
    let _ = win.set_size(size);
    let _ = win.set_position(PhysicalPosition::new(x as i32, y as i32));
    // Moving across displays can rescale the window: re-assert the physical size.
    let _ = win.set_size(size);
    let _ = win.set_always_on_top(true);
    let _ = win.emit("layout", layout.clone());
    Some(layout)
}

/// Where the island should go after being dropped: the dragged island's rect
/// in screen physical px → new placement fields in `s`.
pub fn place_from_drop(s: &mut crate::settings::Settings, island: Rect, screen: Rect, work: Rect, _scale: f64) {
    let cx = island.x + island.w / 2.0;
    let cy = island.y + island.h / 2.0;
    // Edge: the nearest edge wins; slide along it to where it was dropped.
    let d = [
        ("top", (cy - screen.y).abs()),
        ("bottom", (work.y + work.h - cy).abs()),
        ("left", (cx - work.x).abs()),
        ("right", (work.x + work.w - cx).abs()),
    ];
    let edge = d.iter().min_by(|a, b| a.1.total_cmp(&b.1)).map(|e| e.0).unwrap_or("top");
    s.position = edge.to_string();
    s.along = match edge {
        "left" | "right" => ((cy - work.y) / work.h).clamp(0.0, 1.0),
        _ => ((cx - screen.x) / screen.w).clamp(0.0, 1.0),
    };
}

pub fn monitor_rects(app: &AppHandle, pref: &str) -> Option<(Rect, Rect, f64)> {
    let m = target_monitor(app, pref)?;
    let (screen, work) = rect_of(&m);
    Some((screen, work, m.scale_factor()))
}

fn hwnd_of(win: &WebviewWindow) -> Option<HWND> {
    let raw = win.hwnd().ok()?.0 as isize;
    if raw == 0 {
        return None;
    }
    Some(HWND(raw as *mut _))
}

/// WS_EX_NOACTIVATE keeps clicks from stealing focus; WS_EX_TOOLWINDOW keeps the
/// island out of Alt-Tab.
pub fn make_non_activating(win: &WebviewWindow) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = ex | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
    }
}

/// Temporarily allow activation so a text field inside the island can be typed in.
pub fn set_activating(win: &WebviewWindow, activating: bool) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = if activating {
            ex & !(WS_EX_NOACTIVATE.0 as isize)
        } else {
            ex | WS_EX_NOACTIVATE.0 as isize
        };
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
    }
}

/// Position, size and scale of the monitor the island lives on. Any change here
/// means the island has to be placed again.
fn current_screen_key(app: &AppHandle) -> Option<(i32, i32, u32, u32, u64)> {
    let pref = app
        .try_state::<crate::Shared>()
        .map(|s| s.settings.lock().unwrap().screen.clone())
        .unwrap_or_else(|| "primary".into());
    let m = target_monitor(app, &pref)?;
    let p = m.position();
    let size = m.size();
    Some((p.x, p.y, size.width, size.height, m.scale_factor().to_bits()))
}

/// Shortest gap between two `cursor` events: the front end only needs 60 a second.
const CURSOR_EVERY: Duration = Duration::from_millis(16);
/// Window geometry is re-read at most this often between pokes.
const GEOMETRY_EVERY: Duration = Duration::from_millis(100);
/// How often a mouse event may also check for a display change.
const SCREEN_EVERY: Duration = Duration::from_millis(500);

/// Watches the mouse through the low-level hook (see `mouse.rs`) and turns it
/// into island behaviour: notch hover/click while collapsed; click-through,
/// click-outside, drag-in and the `cursor` event while open. Sleeps on the
/// channel the rest of the time, so a still mouse costs nothing.
pub fn spawn_mouse_watch(app: AppHandle, gate: Arc<PollGate>) {
    let rx = crate::mouse::start();
    std::thread::Builder::new()
        .name("island-mouse".into())
        .spawn(move || {
            let mut w = Watch::new(app, gate);
            loop {
                // A position held back by the 60/s limit goes out once the mouse rests.
                let first = match w.cursor_due() {
                    Some(wait) => match rx.recv_timeout(wait) {
                        Ok(ev) => ev,
                        Err(RecvTimeoutError::Timeout) => {
                            w.flush_cursor();
                            continue;
                        }
                        Err(RecvTimeoutError::Disconnected) => return,
                    },
                    None => match rx.recv() {
                        Ok(ev) => ev,
                        Err(_) => return,
                    },
                };
                // Take everything queued: button events in order, moves only the
                // latest one between them.
                let mut queued = vec![first];
                queued.extend(rx.try_iter());
                let mut last_move = None;
                for ev in queued {
                    match ev {
                        Event::Move(x, y) => last_move = Some((x, y)),
                        other => {
                            if let Some((x, y)) = last_move.take() {
                                w.handle(Event::Move(x, y));
                            }
                            w.handle(other);
                        }
                    }
                }
                if let Some((x, y)) = last_move {
                    w.handle(Event::Move(x, y));
                }
            }
        })
        .expect("spawn island mouse thread");
}

#[derive(Clone, Copy)]
struct Geometry {
    origin: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    scale: f64,
    at: Instant,
}

struct Watch {
    app: AppHandle,
    gate: Arc<PollGate>,
    down: bool,
    // Where the current left-button press began: outside the panel means it
    // may be a file being dragged in; under the panel (window click-through at
    // that moment) means it belongs to the app beneath until released.
    pressed_outside: bool,
    pressed_under: bool,
    // A press that began off the island, and where: released without moving,
    // it is a click outside, which closes an open island.
    pressed_off_island: bool,
    press_at: (f64, f64),
    hovered_notch: bool,
    /// The current press is a drag from outside that has reached the panel.
    drag_in: bool,
    last: (f64, f64),
    geometry: Option<Geometry>,
    last_screen: Option<(i32, i32, u32, u32, u64)>,
    screen_checked: Instant,
    cursor_sent: Instant,
    cursor_pending: Option<CursorPayload>,
    /// Moving the island: cursor minus window origin (physical px).
    drag: Option<(f64, f64)>,
}

impl Watch {
    fn new(app: AppHandle, gate: Arc<PollGate>) -> Self {
        Self {
            app,
            gate,
            down: false,
            pressed_outside: false,
            pressed_under: false,
            pressed_off_island: false,
            press_at: (0.0, 0.0),
            hovered_notch: false,
            drag_in: false,
            last: (f64::MIN, f64::MIN),
            geometry: None,
            last_screen: None,
            screen_checked: Instant::now(),
            cursor_sent: Instant::now(),
            cursor_pending: None,
            drag: None,
        }
    }

    fn start_drag(&mut self, win: &WebviewWindow, cx: f64, cy: f64) {
        let Ok(o) = win.outer_position() else { return };
        self.drag = Some((cx - o.x as f64, cy - o.y as f64));
        self.pressed_off_island = false;
        let _ = win.emit("island-drag", true);
    }

    /// While moving: the window follows the cursor. Released: dock it.
    fn drag_event(&mut self, win: &WebviewWindow, cx: f64, cy: f64, edge: Option<bool>) {
        let Some((ox, oy)) = self.drag else { return };
        let _ = win.set_position(PhysicalPosition::new((cx - ox).round() as i32, (cy - oy).round() as i32));
        if edge == Some(false) || !left_button_down() {
            self.drag = None;
            self.geometry = None;
            self.end_drag(win, cx - ox, cy - oy);
        }
    }

    fn end_drag(&mut self, win: &WebviewWindow, wx: f64, wy: f64) {
        let _ = win.emit("island-drag", false);
        let Some(shared) = self.app.try_state::<crate::Shared>() else { return };
        let mut settings = shared.settings.lock().unwrap().clone();
        let Some((screen, work, scale)) = monitor_rects(&self.app, &settings.screen) else { return };
        let r = *self.gate.rect.lock().unwrap();
        let island = Rect { x: wx + r.x * scale, y: wy + r.y * scale, w: r.w * scale, h: r.h * scale };
        place_from_drop(&mut settings, island, screen, work, scale);
        crate::log::line(format!(
            "island moved: {} along={:.2}",
            settings.position, settings.along
        ));
        crate::commit_settings(&self.app, shared.inner(), settings);
    }

    fn unblock_drops(&self) {
        let handle = self.app.clone();
        let _ = self.app.run_on_main_thread(move || unblock_webview_drops(&handle));
    }

    fn cursor_due(&self) -> Option<Duration> {
        self.cursor_pending
            .as_ref()
            .map(|_| CURSOR_EVERY.saturating_sub(self.cursor_sent.elapsed()))
    }

    fn flush_cursor(&mut self) {
        if let Some(p) = self.cursor_pending.take() {
            if let Some(win) = window(&self.app) {
                let _ = win.emit("cursor", p);
            }
            self.cursor_sent = Instant::now();
        }
    }

    fn geometry(&mut self, win: &WebviewWindow) -> Option<Geometry> {
        if let Some(g) = self.geometry {
            if g.at.elapsed() < GEOMETRY_EVERY {
                return Some(g);
            }
        }
        let g = Geometry {
            origin: win.outer_position().ok()?,
            size: win.inner_size().ok()?,
            scale: win.scale_factor().unwrap_or(1.0),
            at: Instant::now(),
        };
        self.geometry = Some(g);
        Some(g)
    }

    /// Monitors get plugged in, unplugged, rearranged and rescaled, and an
    /// island pinned to coordinates that no longer exist is an island nobody can
    /// reach.
    fn check_screen(&mut self, force: bool) {
        if !force && self.screen_checked.elapsed() < SCREEN_EVERY {
            return;
        }
        self.screen_checked = Instant::now();
        let now = current_screen_key(&self.app);
        if now.is_some() && now != self.last_screen {
            let first = self.last_screen.is_none();
            self.last_screen = now;
            if !first {
                crate::log::line("display layout changed — repositioning".to_string());
                let _ = self.app.emit_to(WINDOW_LABEL, "screen-changed", ());
            }
        }
    }

    fn handle(&mut self, ev: Event) {
        let (cx, cy, edge, force) = match ev {
            Event::Move(x, y) => (x, y, None, false),
            Event::Down(x, y) => {
                self.down = true;
                (x, y, Some(true), false)
            }
            Event::Up(x, y) => {
                self.down = false;
                (x, y, Some(false), false)
            }
            Event::Poke => {
                // State changed on our side: start from what is true right now.
                self.geometry = None;
                self.down = left_button_down();
                if self.gate.is_active() {
                    self.check_screen(true);
                    // The island opened mid-drag (a file dragged onto the notch):
                    // the drop target has to be ours before the file arrives.
                    if self.down {
                        self.unblock_drops();
                    }
                }
                let Some((x, y)) = cursor_physical() else { return };
                (x, y, None, true)
            }
        };
        let Some(win) = window(&self.app) else { return };
        if self.gate.drag_requested.swap(false, Ordering::Relaxed) && left_button_down() && self.drag.is_none() {
            self.start_drag(&win, cx, cy);
        }
        if self.drag.is_some() {
            self.drag_event(&win, cx, cy, edge);
            return;
        }
        let Some(g) = self.geometry(&win) else { return };
        let active = self.gate.is_active();

        let x = (cx - g.origin.x as f64) / g.scale;
        let y = (cy - g.origin.y as f64) / g.scale;
        let size = (g.size.width as f64 / g.scale, g.size.height as f64 / g.scale);
        let in_window = x >= 0.0 && x <= size.0 && y >= 0.0 && y <= size.1;

        // Click-through: the window only takes the mouse over the island shape.
        // A small entry margin means the flag is already off by the time a
        // moving cursor reaches a button.
        let r = *self.gate.rect.lock().unwrap();
        let on_island = r.w > 0.0
            && x >= r.x - HIT_MARGIN
            && x <= r.x + r.w + HIT_MARGIN
            && y >= r.y - HIT_MARGIN
            && y <= r.y + r.h + HIT_MARGIN;

        // A press may be the start of a drag: make sure the drop target is ours
        // before the file arrives. Recorded while collapsed too — a file is
        // usually picked up while the island sleeps, then dragged onto the notch.
        // Alt + drag anywhere on the open island moves it.
        if edge == Some(true) && active && on_island && alt_down() {
            self.start_drag(&win, cx, cy);
            return;
        }
        if edge == Some(true) {
            self.pressed_outside = !in_window;
            self.pressed_under = active && in_window && self.gate.ignoring.load(Ordering::Relaxed);
            self.pressed_off_island = active && !on_island;
            self.press_at = (cx, cy);
            self.drag_in = false;
            self.unblock_drops();
        }

        if !active {
            self.collapsed_event(&win, g, cx, cy, edge);
            return;
        }
        self.hovered_notch = false;
        self.check_screen(false);
        // The click itself still lands on whatever is beneath: the window is
        // click-through there. This only tells the island about it.
        if edge == Some(false)
            && self.pressed_off_island
            && (cx - self.press_at.0).abs() < 6.0
            && (cy - self.press_at.1).abs() < 6.0
        {
            let _ = win.emit("click-outside", ());
        }

        if edge.is_none() && !force && (x - self.last.0).abs() < 1.0 && (y - self.last.1).abs() < 1.0 {
            return;
        }
        self.last = (x, y);

        // A file being dragged has to be able to find us. WS_EX_TRANSPARENT —
        // what click-through is on Windows — hides the window from
        // WindowFromPoint, so OLE finds no drop target and shows the "no drop"
        // cursor. macOS has no such problem: AppKit delivers drags to registered
        // destinations whatever ignoresMouseEvents says. So while a drag that
        // *came from outside* is over the panel, the whole panel takes the mouse,
        // which also makes the drop zone as forgiving as the Mac's. A press that
        // starts under the panel — selecting text, moving a window, dragging a
        // browser tab — is never captured: it belongs to whatever sits beneath
        // the island.
        let dragging = self.down && self.pressed_outside && in_window;
        if dragging && !self.drag_in {
            self.drag_in = true;
            crate::log::line("file drag reached the island".to_string());
        }

        // A press that went to the app beneath keeps going there, even if the
        // drag then crosses the island.
        let accept = !(self.down && self.pressed_under) && (on_island || dragging);
        if self.gate.ignoring.load(Ordering::Relaxed) == accept {
            self.gate.ignoring.store(!accept, Ordering::Relaxed);
            let _ = win.set_ignore_cursor_events(!accept);
        }

        self.cursor_pending = Some(CursorPayload { x, y });
        if self.cursor_sent.elapsed() >= CURSOR_EVERY {
            self.flush_cursor();
        }
    }

    /// Collapsed: the window is only the small notch tab. Hovering it or
    /// pressing on it wakes the island.
    fn collapsed_event(&mut self, win: &WebviewWindow, g: Geometry, cx: f64, cy: f64, edge: Option<bool>) {
        self.cursor_pending = None;
        let margin = (6.0 * g.scale).round() as i32;
        let (cx, cy) = (cx as i32, cy as i32);
        let in_notch = cx >= g.origin.x - margin
            && cx <= g.origin.x + g.size.width as i32 + margin
            && cy >= g.origin.y
            && cy <= g.origin.y + g.size.height as i32 + margin;

        if in_notch && edge == Some(true) {
            let _ = win.emit("notch-click", ());
        }
        if in_notch {
            if !self.hovered_notch {
                self.hovered_notch = true;
                let _ = win.emit("notch-hover", ());
            }
        } else {
            self.hovered_notch = false;
        }
    }
}

pub fn set_ignore_cursor(app: &AppHandle, ignore: bool) {
    if let Some(win) = window(app) {
        let _ = win.set_ignore_cursor_events(ignore);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Settings;

    const SCREEN: Rect = Rect { x: 0.0, y: 0.0, w: 1920.0, h: 1080.0 };
    const WORK: Rect = Rect { x: 0.0, y: 0.0, w: 1920.0, h: 1032.0 };

    #[test]
    fn default_is_top_centre() {
        let ((x, y, w, _), l) = compute(&Settings::default(), SCREEN, WORK, 1.0, false);
        assert_eq!((x, y, w), (600.0, 0.0, 720.0));
        assert_eq!((l.h, l.v, l.anchor_x), ("center", "top", 360.0));
    }

    #[test]
    fn slid_to_the_right_end_stays_on_screen() {
        let s = Settings { along: 1.0, ..Settings::default() };
        let ((x, _, w, _), l) = compute(&s, SCREEN, WORK, 1.0, false);
        assert_eq!(x + w, 1920.0);
        assert_eq!(l.anchor_x, 720.0); // the front end keeps the island inside
    }

    #[test]
    fn right_edge_is_vertical_and_hangs_from_the_side() {
        let s = Settings { position: "right".into(), along: 0.5, ..Settings::default() };
        let ((x, _, w, h), l) = compute(&s, SCREEN, WORK, 1.0, true);
        assert_eq!((x + w, w, h), (1920.0, STRIP_H, STRIP_W));
        assert!(l.vertical);
        assert_eq!(l.h, "right");
    }

    #[test]
    fn dropping_near_the_left_side_docks_left() {
        let mut s = Settings::default();
        place_from_drop(&mut s, Rect { x: 5.0, y: 600.0, w: 288.0, h: 32.0 }, SCREEN, WORK, 1.0);
        // Centre x = 149 is nearer the left side (149) than the top (616).
        assert_eq!(s.position, "left");
        assert!((s.along - 616.0 / 1032.0).abs() < 1e-6);
    }

}
