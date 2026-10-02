// Mouse events without polling.
//
// A low-level mouse hook (WH_MOUSE_LL) runs on its own thread with a message
// loop. Windows calls the hook for every move and click anywhere on the desktop;
// the callback only hands the event to a channel and returns, because a slow
// low-level hook gets silently removed by Windows. Whoever reads the channel
// blocks on it, so with the mouse at rest nothing runs at all.

use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::OnceLock;

use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, HC_ACTION, MSG, MSLLHOOKSTRUCT, WH_MOUSE_LL,
    WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    Move(f64, f64),
    Down(f64, f64),
    Up(f64, f64),
    /// Not from the mouse: state changed on our side (island opened, resized),
    /// so the reader should look at where the cursor is right now.
    Poke,
}

static TX: OnceLock<SyncSender<Event>> = OnceLock::new();

/// Installs the hook and returns the receiving end. Call once.
pub fn start() -> Receiver<Event> {
    // Moves are coalesced by the reader, so a small buffer is plenty; when it is
    // full, dropping a move is harmless. Button events are what must get through.
    let (tx, rx) = sync_channel(256);
    let _ = TX.set(tx);
    std::thread::Builder::new()
        .name("mouse-hook".into())
        .spawn(|| unsafe {
            let module = GetModuleHandleW(None).ok().map(|m| m.into());
            match SetWindowsHookExW(WH_MOUSE_LL, Some(hook_proc), module, 0) {
                Ok(_) => {}
                Err(e) => {
                    crate::log::line(format!("mouse hook failed: {e}"));
                    return;
                }
            }
            // The hook is called on this thread, from inside GetMessageW.
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
        })
        .expect("spawn mouse hook thread");
    rx
}

/// Wakes the reader without a mouse event.
pub fn poke() {
    if let Some(tx) = TX.get() {
        let _ = tx.try_send(Event::Poke);
    }
}

unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        if let Some(tx) = TX.get() {
            let info = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
            let (x, y) = (info.pt.x as f64, info.pt.y as f64);
            let ev = match wparam.0 as u32 {
                WM_MOUSEMOVE => Some(Event::Move(x, y)),
                WM_LBUTTONDOWN => Some(Event::Down(x, y)),
                WM_LBUTTONUP => Some(Event::Up(x, y)),
                _ => None,
            };
            // When the reader is behind, the event is dropped: it catches up
            // from the next one.
            if let Some(ev) = ev {
                let _ = tx.try_send(ev);
            }
        }
    }
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}
