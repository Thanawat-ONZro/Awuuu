// Global shortcuts. The island never takes focus (WS_EX_NOACTIVATE), so it
// can't see key presses; these are system-wide shortcuts instead.
//
// Actions (ids are stored in settings.json and mirrored in src/core/shortcuts.ts):
//   openChat, goToAlert, jumpToTerminal, muteToggle, toggleIsland  — always on
//   approvalAllow, approvalDeny — only while an approval card waits, so the keys
//   belong to other apps the rest of the time.
//   toggleDesktopDog — only while "Dog on desktop" is on (Settings → General).
// settings.shortcuts maps action -> accelerator; a missing entry is the default,
// "" is off. A key another app already owns never crashes anything: the reason
// is kept per action and shown on the Shortcuts page.

use std::collections::BTreeMap;
use std::sync::{Mutex, RwLock};

use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub struct ActionDef {
    pub id: &'static str,
    pub keys: &'static str,
    pub on_by_default: bool,
    pub approval_only: bool,
    /// Registered only while the dog on the desktop is switched on.
    pub desktop_only: bool,
}

const fn action(id: &'static str, keys: &'static str, on: bool, approval_only: bool) -> ActionDef {
    ActionDef { id, keys, on_by_default: on, approval_only, desktop_only: false }
}

/// Same ids, order and defaults as SHORTCUTS in src/core/shortcuts.ts.
pub const ACTIONS: &[ActionDef] = &[
    action("openChat", "Ctrl+Alt+Space", true, false),
    action("goToAlert", "Ctrl+Alt+A", true, false),
    action("jumpToTerminal", "Ctrl+Alt+T", true, false),
    action("muteToggle", "Ctrl+Alt+S", true, false),
    action("toggleIsland", "Ctrl+Alt+I", false, false),
    ActionDef { id: "toggleDesktopDog", keys: "Ctrl+Alt+D", on_by_default: true, approval_only: false, desktop_only: true },
    action("approvalAllow", "Ctrl+Alt+Y", true, true),
    action("approvalDeny", "Ctrl+Alt+N", true, true),
];

// ── Pure part: accelerator parsing and planning ──────────────────────────────

fn key_code(name: &str) -> Option<Code> {
    use Code::*;
    let up = name.to_ascii_uppercase();
    let letters = [
        KeyA, KeyB, KeyC, KeyD, KeyE, KeyF, KeyG, KeyH, KeyI, KeyJ, KeyK, KeyL, KeyM, KeyN, KeyO, KeyP, KeyQ,
        KeyR, KeyS, KeyT, KeyU, KeyV, KeyW, KeyX, KeyY, KeyZ,
    ];
    let digits = [Digit0, Digit1, Digit2, Digit3, Digit4, Digit5, Digit6, Digit7, Digit8, Digit9];
    let fkeys = [
        F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12, F13, F14, F15, F16, F17, F18, F19, F20, F21, F22,
        F23, F24,
    ];
    let b = up.as_bytes();
    if b.len() == 1 && b[0].is_ascii_uppercase() {
        return Some(letters[(b[0] - b'A') as usize]);
    }
    if b.len() == 1 && b[0].is_ascii_digit() {
        return Some(digits[(b[0] - b'0') as usize]);
    }
    if let Some(n) = up.strip_prefix('F').and_then(|n| n.parse::<usize>().ok()) {
        if (1..=24).contains(&n) {
            return Some(fkeys[n - 1]);
        }
    }
    Some(match up.as_str() {
        "SPACE" => Space,
        "ENTER" | "RETURN" => Enter,
        "TAB" => Tab,
        "BACKSPACE" => Backspace,
        "DELETE" | "DEL" => Delete,
        "INSERT" => Insert,
        "HOME" => Home,
        "END" => End,
        "PAGEUP" => PageUp,
        "PAGEDOWN" => PageDown,
        "UP" | "ARROWUP" => ArrowUp,
        "DOWN" | "ARROWDOWN" => ArrowDown,
        "LEFT" | "ARROWLEFT" => ArrowLeft,
        "RIGHT" | "ARROWRIGHT" => ArrowRight,
        "COMMA" | "," => Comma,
        "PERIOD" | "." => Period,
        "SLASH" | "/" => Slash,
        "SEMICOLON" | ";" => Semicolon,
        "QUOTE" | "'" => Quote,
        "BACKQUOTE" | "`" => Backquote,
        "BRACKETLEFT" | "[" => BracketLeft,
        "BRACKETRIGHT" | "]" => BracketRight,
        "BACKSLASH" | "\\" => Backslash,
        "MINUS" | "-" => Minus,
        "EQUAL" | "=" => Equal,
        _ => return None,
    })
}

/// "Ctrl+Alt+Space" → a Shortcut. None for anything else, and for a key with no
/// Ctrl, Alt or Windows modifier (Shift alone does not make a global shortcut).
pub fn parse(keys: &str) -> Option<Shortcut> {
    if keys.trim().is_empty() {
        return None;
    }
    let tokens: Vec<&str> = keys.split('+').map(str::trim).collect();
    if tokens.iter().any(|t| t.is_empty()) {
        return None;
    }
    let mut mods = Modifiers::empty();
    let mut code = None;
    for (i, token) in tokens.iter().enumerate() {
        let last = i == tokens.len() - 1;
        let m = match token.to_ascii_uppercase().as_str() {
            "CTRL" | "CONTROL" | "COMMANDORCONTROL" | "CMDORCTRL" => Some(Modifiers::CONTROL),
            "ALT" | "OPTION" => Some(Modifiers::ALT),
            "SHIFT" => Some(Modifiers::SHIFT),
            "SUPER" | "META" | "WIN" | "CMD" | "COMMAND" => Some(Modifiers::SUPER),
            _ => None,
        };
        match m {
            Some(m) if !last => mods |= m,
            Some(_) => return None,
            None if last => code = Some(key_code(token)?),
            None => return None,
        }
    }
    let code = code?;
    if !mods.intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER) {
        return None;
    }
    Some(Shortcut::new(Some(mods), code))
}

/// The accelerator in force for `def` ("" = off).
pub fn effective(def: &ActionDef, stored: &BTreeMap<String, String>) -> String {
    match stored.get(def.id) {
        Some(k) => k.trim().to_string(),
        None if def.on_by_default => def.keys.to_string(),
        None => String::new(),
    }
}

/// What to register: the usable shortcuts by action, and why the others are not.
/// A key two actions share goes to the first; the second gets an error.
pub fn plan(
    stored: &BTreeMap<String, String>,
    approval_on: bool,
    desktop_on: bool,
) -> (Vec<(&'static str, Shortcut)>, BTreeMap<String, String>) {
    let mut wanted: Vec<(&'static str, Shortcut)> = Vec::new();
    let mut errors = BTreeMap::new();
    for def in ACTIONS {
        let keys = effective(def, stored);
        if keys.is_empty() {
            continue;
        }
        let Some(sc) = parse(&keys) else {
            errors.insert(def.id.to_string(), format!("“{keys}” is not a valid shortcut."));
            continue;
        };
        if (def.approval_only && !approval_on) || (def.desktop_only && !desktop_on) {
            continue;
        }
        if let Some((other, _)) = wanted.iter().find(|(_, s)| *s == sc) {
            errors.insert(def.id.to_string(), format!("Same keys as “{other}”."));
            continue;
        }
        wanted.push((def.id, sc));
    }
    (wanted, errors)
}

// ── Registration ─────────────────────────────────────────────────────────────

struct Live {
    stored: BTreeMap<String, String>,
    approval_on: bool,
    desktop_on: bool,
    registered: Vec<(&'static str, Shortcut)>,
    errors: BTreeMap<String, String>,
}

static LIVE: Mutex<Live> = Mutex::new(Live {
    stored: BTreeMap::new(),
    approval_on: false,
    desktop_on: false,
    registered: Vec::new(),
    errors: BTreeMap::new(),
});

/// What the key handler reads. Never held while calling into the plugin, so a
/// key press can't wait on a registration in progress.
static LOOKUP: RwLock<Vec<(Shortcut, &'static str)>> = RwLock::new(Vec::new());

fn action_for(shortcut: &Shortcut) -> Option<&'static str> {
    LOOKUP.read().ok()?.iter().find(|(s, _)| s == shortcut).map(|(_, id)| *id)
}

pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            match action_for(shortcut) {
                Some("approvalAllow") => {
                    let _ = app.emit_to(crate::island::WINDOW_LABEL, "approval-key", "allow");
                }
                Some("approvalDeny") => {
                    let _ = app.emit_to(crate::island::WINDOW_LABEL, "approval-key", "deny");
                }
                Some(id) => {
                    let _ = app.emit_to(crate::island::WINDOW_LABEL, "shortcut", id);
                }
                None => {}
            }
        })
        .build()
}

/// Brings the registered keys in line with the settings and whether a card waits.
/// A key that cannot be registered (another app has it) is recorded, not fatal.
fn sync(app: &AppHandle) {
    let (stored, approval_on, desktop_on, old) = {
        let live = LIVE.lock().unwrap_or_else(|e| e.into_inner());
        (live.stored.clone(), live.approval_on, live.desktop_on, live.registered.clone())
    };
    let (wanted, mut errors) = plan(&stored, approval_on, desktop_on);
    let gs = app.global_shortcut();
    // Release what is no longer wanted (or moved to other keys).
    for (id, sc) in &old {
        if !wanted.iter().any(|(wid, wsc)| wid == id && wsc == sc) {
            let _ = gs.unregister(*sc);
        }
    }
    let mut registered = Vec::new();
    for (id, sc) in wanted {
        let ours = old.iter().any(|(oid, osc)| *oid == id && *osc == sc);
        if ours && gs.is_registered(sc) {
            registered.push((id, sc));
            continue;
        }
        match gs.register(sc) {
            Ok(()) => registered.push((id, sc)),
            Err(err) => {
                crate::log::line(format!("shortcut {id}: {err}"));
                errors.insert(
                    id.to_string(),
                    "Another app already uses these keys. Pick other keys.".to_string(),
                );
            }
        }
    }
    if let Ok(mut lookup) = LOOKUP.write() {
        *lookup = registered.iter().map(|(id, sc)| (*sc, *id)).collect();
    }
    let mut live = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    live.registered = registered;
    live.errors = errors;
}

/// Settings changed (or the app started): register the new bindings.
/// `desktop_on`: the dog on the desktop is switched on.
pub fn apply(app: &AppHandle, stored: &BTreeMap<String, String>, desktop_on: bool) {
    {
        let mut live = LIVE.lock().unwrap_or_else(|e| e.into_inner());
        live.stored = stored.clone();
        live.desktop_on = desktop_on;
    }
    sync(app);
}

/// Allow/deny are held only while an approval card waits.
pub fn set_approval_keys(app: &AppHandle, on: bool) {
    {
        let mut live = LIVE.lock().unwrap_or_else(|e| e.into_inner());
        live.approval_on = on;
    }
    sync(app);
}

/// action -> why it is not registered ("" never appears: only failures).
pub fn errors() -> BTreeMap<String, String> {
    LIVE.lock().unwrap_or_else(|e| e.into_inner()).errors.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ca(code: Code) -> Shortcut {
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), code)
    }

    #[test]
    fn parses_accelerators() {
        assert_eq!(parse("Ctrl+Alt+Space"), Some(ca(Code::Space)));
        assert_eq!(parse("control+option+y"), Some(ca(Code::KeyY)));
        assert_eq!(parse("Ctrl+Alt+Left"), Some(ca(Code::ArrowLeft)));
        assert_eq!(parse("Ctrl+Alt+F12"), Some(ca(Code::F12)));
        assert_eq!(parse("Ctrl+Alt+Comma"), Some(ca(Code::Comma)));
        assert_eq!(parse("Ctrl+Alt+5"), Some(ca(Code::Digit5)));
        assert_eq!(
            parse("Super+Shift+K"),
            Some(Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyK))
        );
    }

    #[test]
    fn rejects_bare_and_junk() {
        for bad in ["", "Y", "F5", "Shift+Y", "Ctrl+", "Ctrl+Alt", "Ctrl+Y+Alt", "Ctrl+Nope", "Ctrl+F25", "+Y"] {
            assert_eq!(parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn every_default_parses_and_is_distinct() {
        let mut seen = Vec::new();
        for a in ACTIONS {
            let sc = parse(a.keys).unwrap_or_else(|| panic!("{}", a.id));
            assert!(!seen.contains(&sc), "{} duplicates a default", a.id);
            seen.push(sc);
        }
    }

    #[test]
    fn default_plan_skips_approval_keys_and_island_toggle() {
        let (w, e) = plan(&BTreeMap::new(), false, false);
        let ids: Vec<_> = w.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids, ["openChat", "goToAlert", "jumpToTerminal", "muteToggle"]);
        assert!(e.is_empty());
        let (w, _) = plan(&BTreeMap::new(), true, false);
        assert!(w.iter().any(|(id, sc)| *id == "approvalAllow" && *sc == ca(Code::KeyY)));
        assert!(w.iter().any(|(id, sc)| *id == "approvalDeny" && *sc == ca(Code::KeyN)));
    }

    #[test]
    fn user_bindings_override_disable_and_enable() {
        let mut s = BTreeMap::new();
        s.insert("openChat".to_string(), "Ctrl+Alt+K".to_string());
        s.insert("muteToggle".to_string(), String::new());
        s.insert("toggleIsland".to_string(), "Ctrl+Alt+I".to_string());
        let (w, e) = plan(&s, false, false);
        assert!(w.iter().any(|(id, sc)| *id == "openChat" && *sc == ca(Code::KeyK)));
        assert!(!w.iter().any(|(id, _)| *id == "muteToggle"));
        assert!(w.iter().any(|(id, _)| *id == "toggleIsland"));
        assert!(e.is_empty());
    }

    #[test]
    fn duplicate_and_invalid_keys_are_reported_not_registered() {
        let mut s = BTreeMap::new();
        s.insert("muteToggle".to_string(), "Ctrl+Alt+A".to_string()); // goToAlert's
        s.insert("jumpToTerminal".to_string(), "T".to_string()); // bare key
        let (w, e) = plan(&s, false, false);
        assert!(!w.iter().any(|(id, _)| *id == "muteToggle" || *id == "jumpToTerminal"));
        assert!(e.contains_key("muteToggle"));
        assert!(e.contains_key("jumpToTerminal"));
    }

    #[test]
    fn desktop_dog_key_only_while_the_dog_feature_is_on() {
        let (w, _) = plan(&BTreeMap::new(), false, false);
        assert!(!w.iter().any(|(id, _)| *id == "toggleDesktopDog"), "off by default: Ctrl+Alt+D stays free");
        let (w, _) = plan(&BTreeMap::new(), false, true);
        assert!(w.iter().any(|(id, sc)| *id == "toggleDesktopDog" && *sc == ca(Code::KeyD)));
        let mut s = BTreeMap::new();
        s.insert("toggleDesktopDog".to_string(), String::new());
        let (w, _) = plan(&s, false, true);
        assert!(!w.iter().any(|(id, _)| *id == "toggleDesktopDog"), "the user can switch it off");
    }
}
