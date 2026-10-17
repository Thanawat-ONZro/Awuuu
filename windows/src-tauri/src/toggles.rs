// Quick toggles integration for Awuuu's notch dashboard:
// Bluetooth, Wi-Fi, Do-not-disturb, Never sleep.
//
// Rules:
// - Toggles must never lie: read the real state back after a change and show that.
// - Idle = 0 % CPU: polls nothing — reads state on open and on click.
// - No new crate: uses windows::Devices::Radios, SetThreadExecutionState, Registry, and netsh.

use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

use windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};
use windows::Win32::System::Power::{
    SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static NEVER_SLEEP_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Parses output from `netsh wlan show interfaces`.
/// Returns (isEnabled, stateString).
pub fn parse_netsh_wlan_interfaces(output: &str) -> (bool, String) {
    if output.contains("There is no wireless interface") {
        return (false, "none".into());
    }

    let mut state = "none".to_string();
    for line in output.lines() {
        let line = line.trim();
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("state") {
                state = v.trim().to_lowercase();
            }
        }
    }

    let enabled = state != "none" && state != "disabled";
    (enabled, state)
}

fn get_wifi_netsh_state() -> bool {
    let output = Command::new("netsh")
        .args(["wlan", "show", "interfaces"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        let (enabled, _) = parse_netsh_wlan_interfaces(&text);
        enabled
    } else {
        false
    }
}

fn get_radio_state(kind: RadioKind) -> Option<bool> {
    let op = Radio::GetRadiosAsync().ok()?;
    let radios = op.get().ok()?;
    for i in 0..radios.Size().ok()? {
        if let Ok(radio) = radios.GetAt(i) {
            if let Ok(k) = radio.Kind() {
                if k == kind {
                    if let Ok(state) = radio.State() {
                        return Some(state == RadioState::On);
                    }
                }
            }
        }
    }
    None
}

fn set_radio_state(kind: RadioKind, on: bool) -> Result<bool, String> {
    let access_op = Radio::RequestAccessAsync().map_err(|e| e.to_string())?;
    let access = access_op.get().map_err(|e| e.to_string())?;
    if access != RadioAccessStatus::Allowed {
        return Err(format!("Radio access not allowed: {access:?}"));
    }

    let op = Radio::GetRadiosAsync().map_err(|e| e.to_string())?;
    let radios = op.get().map_err(|e| e.to_string())?;
    let target = if on { RadioState::On } else { RadioState::Off };
    let mut found = false;

    for i in 0..radios.Size().map_err(|e| e.to_string())? {
        if let Ok(radio) = radios.GetAt(i) {
            if let Ok(k) = radio.Kind() {
                if k == kind {
                    found = true;
                    let set_op = radio.SetStateAsync(target).map_err(|e| e.to_string())?;
                    let res = set_op.get().map_err(|e| e.to_string())?;
                    if res != RadioAccessStatus::Allowed {
                        return Err(format!("Radio SetState failed with status: {res:?}"));
                    }
                }
            }
        }
    }

    if !found {
        return Err(format!("No radio adapter found for {:?}", kind));
    }

    // Read back the real state
    Ok(get_radio_state(kind).unwrap_or(false))
}

fn get_bluetooth_state() -> bool {
    get_radio_state(RadioKind::Bluetooth).unwrap_or(false)
}

fn set_bluetooth_state(on: bool) -> Result<bool, String> {
    set_radio_state(RadioKind::Bluetooth, on)
}

fn get_wifi_state() -> bool {
    if let Some(state) = get_radio_state(RadioKind::WiFi) {
        state
    } else {
        get_wifi_netsh_state()
    }
}

fn set_wifi_state(on: bool) -> Result<bool, String> {
    // Try Radio API first
    if let Ok(real) = set_radio_state(RadioKind::WiFi, on) {
        return Ok(real);
    }

    // Fallback: netsh interface set interface
    let admin_arg = if on { "admin=ENABLED" } else { "admin=DISABLED" };
    let output = Command::new("netsh")
        .args(["interface", "set", "interface", "name=Wi-Fi", admin_arg])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(format!(
            "netsh set interface failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Read real state back
    Ok(get_wifi_state())
}

// NOTE: Do-Not-Disturb (DND) toggle was removed because writing NOC_GLOBAL_SETTING_TOASTS_ENABLED
// in the registry disables ALL Windows toasts system-wide, writes outside %LOCALAPPDATA%\Awuuu\,
// persists across app restarts, and may require an Explorer restart to take effect.
// Re-adding DND needs an owner decision on proper Focus Assist API integration before it comes back.

struct NeverSleepController {
    tx: std::sync::mpsc::Sender<(bool, std::sync::mpsc::SyncSender<Result<bool, String>>)>,
}

static NEVER_SLEEP_CONTROLLER: std::sync::OnceLock<NeverSleepController> = std::sync::OnceLock::new();

fn get_never_sleep_controller() -> &'static NeverSleepController {
    NEVER_SLEEP_CONTROLLER.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::channel::<(bool, std::sync::mpsc::SyncSender<Result<bool, String>>)>();
        std::thread::Builder::new()
            .name("awuuu-never-sleep".into())
            .spawn(move || {
                while let Ok((on, reply)) = rx.recv() {
                    unsafe {
                        let res = if on {
                            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
                        } else {
                            SetThreadExecutionState(ES_CONTINUOUS)
                        };
                        if res.0 == 0 {
                            let _ = reply.send(Err("SetThreadExecutionState failed".into()));
                        } else {
                            NEVER_SLEEP_ACTIVE.store(on, Ordering::Relaxed);
                            let _ = reply.send(Ok(on));
                        }
                    }
                }
            })
            .expect("failed to spawn never-sleep thread");
        NeverSleepController { tx }
    })
}

fn get_never_sleep_state() -> bool {
    NEVER_SLEEP_ACTIVE.load(Ordering::Relaxed)
}

fn set_never_sleep_state(on: bool) -> Result<bool, String> {
    let controller = get_never_sleep_controller();
    let (reply_tx, reply_rx) = std::sync::mpsc::sync_channel(1);
    controller.tx.send((on, reply_tx)).map_err(|e| e.to_string())?;
    reply_rx.recv().map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn toggle_get(kind: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || match kind.as_str() {
        "bluetooth" => get_bluetooth_state(),
        "wifi" => get_wifi_state(),
        "never_sleep" => get_never_sleep_state(),
        _ => false,
    })
    .await
    .unwrap_or(false)
}

#[tauri::command]
pub async fn toggle_set(kind: String, on: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || match kind.as_str() {
        "bluetooth" => set_bluetooth_state(on),
        "wifi" => set_wifi_state(on),
        "never_sleep" => set_never_sleep_state(on),
        _ => Err(format!("Unknown toggle kind: {kind}")),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_netsh_wlan_connected() {
        let sample = "
            Name                   : Wi-Fi
            Description            : Intel AX200
            State                  : connected
            SSID                   : MyNetwork
        ";
        let (enabled, state) = parse_netsh_wlan_interfaces(sample);
        assert!(enabled);
        assert_eq!(state, "connected");
    }

    #[test]
    fn test_parse_netsh_wlan_disconnected() {
        let sample = "
            Name                   : Wi-Fi
            Description            : Intel AX200
            State                  : disconnected
        ";
        let (enabled, state) = parse_netsh_wlan_interfaces(sample);
        assert!(enabled);
        assert_eq!(state, "disconnected");
    }

    #[test]
    fn test_parse_netsh_wlan_disabled() {
        let sample = "
            Name                   : Wi-Fi
            Description            : Intel AX200
            State                  : disabled
        ";
        let (enabled, state) = parse_netsh_wlan_interfaces(sample);
        assert!(!enabled);
        assert_eq!(state, "disabled");
    }

    #[test]
    fn test_parse_netsh_wlan_no_interface() {
        let sample = "There is no wireless interface on the system.";
        let (enabled, state) = parse_netsh_wlan_interfaces(sample);
        assert!(!enabled);
        assert_eq!(state, "none");
    }
}
