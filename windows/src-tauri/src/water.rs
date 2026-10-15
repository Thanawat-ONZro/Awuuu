// The water behind a carried island (water.html): a display-sized, transparent,
// click-through window created at launch and parked off-screen, like the dog's.
// While the island is carried Rust moves it over the display and feeds it the
// drop's position (island.rs carry_step); it draws the water that rises from the
// nearest edge to meet the drop. The drop itself stays in the island's own
// small window, so nothing is ever resized under it.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOSIZE};

const LABEL: &str = "water";
const PARKED: (f64, f64) = (-32000.0, -32000.0);

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

fn page_url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/water.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("water.html".into())
}

pub fn setup(app: &AppHandle) {
    let built = WebviewWindowBuilder::new(app, LABEL, page_url(app))
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("Awuuu")
        .inner_size(200.0, 200.0)
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
        Err(err) => crate::log::line(format!("water window failed: {err}")),
    }
}

/// Over the display's work area (physical px), above everything but the island.
pub fn show(app: &AppHandle, x: f64, y: f64, w: f64, h: f64) {
    let Some(win) = window(app) else { return };
    let Some(hwnd) = crate::island::hwnd_of(&win) else { return };
    unsafe {
        let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), x as i32, y as i32, w as i32, h as i32, SWP_NOACTIVATE);
    }
}

/// The island's window goes back on top of the water.
pub fn raise_island(app: &AppHandle) {
    let Some(win) = crate::island::window(app) else { return };
    let Some(hwnd) = crate::island::hwnd_of(&win) else { return };
    unsafe {
        let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOSIZE | windows::Win32::UI::WindowsAndMessaging::SWP_NOMOVE);
    }
}

pub fn hide(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    let _ = win.emit("water-end", ());
    let Some(hwnd) = crate::island::hwnd_of(&win) else { return };
    unsafe {
        let _ = SetWindowPos(hwnd, None, PARKED.0 as i32, PARKED.1 as i32, 0, 0, SWP_NOACTIVATE | SWP_NOSIZE | windows::Win32::UI::WindowsAndMessaging::SWP_NOZORDER);
    }
}

/// The drop's centre inside the water window, logical px, and its radius.
pub fn ball(app: &AppHandle, x: f64, y: f64, r: f64) {
    if let Some(win) = window(app) {
        let _ = win.emit("water-ball", [x, y, r]);
    }
}
