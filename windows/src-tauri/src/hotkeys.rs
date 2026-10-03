// Keyboard answers for the approval card: Ctrl+Alt+Y allows, Ctrl+Alt+N denies.
//
// The island never takes focus (WS_EX_NOACTIVATE), so it can't see key
// presses; these are system-wide shortcuts instead. They are registered only
// while a card is waiting and released as soon as it is answered, so the keys
// belong to other apps the rest of the time.

use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn allow() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyY)
}

fn deny() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN)
}

/// "allow" / "deny" for one of our shortcuts.
pub fn decision(shortcut: &Shortcut) -> Option<&'static str> {
    if *shortcut == allow() {
        Some("allow")
    } else if *shortcut == deny() {
        Some("deny")
    } else {
        None
    }
}

pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if let Some(d) = decision(shortcut) {
                let _ = app.emit_to(crate::island::WINDOW_LABEL, "approval-key", d);
            }
        })
        .build()
}

pub fn set_approval_keys(app: &AppHandle, on: bool) {
    let gs = app.global_shortcut();
    for s in [allow(), deny()] {
        let held = gs.is_registered(s);
        // Another app may own the keys; the card still works by mouse.
        if on && !held {
            let _ = gs.register(s);
        } else if !on && held {
            let _ = gs.unregister(s);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_our_two_shortcuts_decide() {
        assert_eq!(decision(&allow()), Some("allow"));
        assert_eq!(decision(&deny()), Some("deny"));
        assert_eq!(decision(&Shortcut::new(Some(Modifiers::CONTROL), Code::KeyY)), None);
    }
}
