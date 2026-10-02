// Self-update through tauri-plugin-updater.
//
// New versions are signed installers on the GitHub Releases page, described by
// `latest.json` (see scripts/release.mjs). The app only accepts an installer
// signed with the key whose public half is in tauri.conf.json.
//
// GitHub is not a service the user configured, so nothing is fetched until they
// agree: on first launch Awuuu asks once, and the answer lives in settings
// (`updateCheck`). "Check for updates…" in the tray or the settings window is
// an explicit request and always runs.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use windows::core::PCWSTR;
use windows::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, IDYES, MB_ICONINFORMATION, MB_ICONQUESTION, MB_OK, MB_SETFOREGROUND, MB_TOPMOST,
    MB_YESNO,
};

use crate::{log, settings};

/// How often the automatic check runs once the user has said yes.
const EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// Let the launch greeting play before anything pops up.
const FIRST_DELAY: Duration = Duration::from_secs(8);

/// The version already offered by an automatic check this session, so a
/// "Later" isn't followed by the same question six hours on.
static OFFERED: Mutex<Option<String>> = Mutex::new(None);
/// One check at a time (a tray click during the automatic one, say).
static RUNNING: Mutex<bool> = Mutex::new(false);

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Native message box; blocks the calling thread, so never call it on the main one.
fn message(text: &str, yes_no: bool) -> bool {
    let title = wide("Awuuu");
    let body = wide(text);
    let style = if yes_no { MB_YESNO | MB_ICONQUESTION } else { MB_OK | MB_ICONINFORMATION };
    let answer = unsafe {
        MessageBoxW(None, PCWSTR(body.as_ptr()), PCWSTR(title.as_ptr()), style | MB_TOPMOST | MB_SETFOREGROUND)
    };
    answer == IDYES
}

fn auto_check_choice(app: &AppHandle) -> Option<bool> {
    app.try_state::<crate::Shared>()
        .and_then(|s| s.settings.lock().unwrap().update_check)
}

fn store_choice(app: &AppHandle, yes: bool) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let updated = {
        let mut s = shared.settings.lock().unwrap();
        s.update_check = Some(yes);
        let _ = settings::save(&s);
        s.clone()
    };
    let _ = app.emit("settings-changed", updated);
}

/// Background loop: asks once, then checks every six hours while allowed.
/// The setting is re-read each time, so turning it off in Settings takes
/// effect without a restart.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(FIRST_DELAY);
        if auto_check_choice(&app).is_none() {
            let yes = message(
                "Should Awuuu check for new versions automatically?\n\n\
                 It looks at the Awuuu releases on GitHub a few times a day and asks \
                 before installing anything. You can change this in Settings.",
                true,
            );
            store_choice(&app, yes);
        }
        loop {
            if auto_check_choice(&app) == Some(true) {
                check(&app, false);
            }
            std::thread::sleep(EVERY);
        }
    });
}

/// Tray / settings button: check now, on a worker thread, and always report back.
pub fn check_now(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || check(&app, true));
}

/// One check. `interactive` = the user asked, so "up to date" and errors are
/// shown; an automatic check stays silent unless there is something to install.
fn check(app: &AppHandle, interactive: bool) {
    {
        let mut running = RUNNING.lock().unwrap();
        if *running {
            return;
        }
        *running = true;
    }
    run_check(app, interactive);
    *RUNNING.lock().unwrap() = false;
}

fn run_check(app: &AppHandle, interactive: bool) {
    let current = app.package_info().version.to_string();
    let found = tauri::async_runtime::block_on(async {
        let updater = app.updater().map_err(|e| e.to_string())?;
        updater.check().await.map_err(|e| e.to_string())
    });

    let update = match found {
        Ok(Some(update)) => update,
        Ok(None) => {
            log::line(format!("update check: {current} is the latest"));
            if interactive {
                message(&format!("You're on the latest version of Awuuu ({current})."), false);
            }
            return;
        }
        Err(err) => {
            log::line(format!("update check failed: {err}"));
            if interactive {
                message(&format!("Couldn't check for updates.\n\n{err}"), false);
            }
            return;
        }
    };

    let version = update.version.clone();
    if !interactive {
        let mut offered = OFFERED.lock().unwrap();
        if offered.as_deref() == Some(version.as_str()) {
            return;
        }
        *offered = Some(version.clone());
    }
    log::line(format!("update available: {current} → {version}"));

    let notes = update
        .body
        .as_deref()
        .map(str::trim)
        .filter(|b| !b.is_empty())
        .map(|b| format!("\n\nWhat's new:\n{}", b.chars().take(600).collect::<String>()))
        .unwrap_or_default();
    let install = message(
        &format!(
            "Awuuu {version} is available (you have {current}).{notes}\n\n\
             Install it now? Awuuu will restart by itself."
        ),
        true,
    );
    if !install {
        return;
    }

    log::line(format!("installing {version}"));
    let result = tauri::async_runtime::block_on(update.download_and_install(|_, _| {}, || {}));
    match result {
        // On Windows the installer takes over and closes Awuuu before we get
        // here; elsewhere (or if it didn't), restart into the new version.
        Ok(()) => app.restart(),
        Err(err) => {
            log::line(format!("update install failed: {err}"));
            message(&format!("The update couldn't be installed.\n\n{err}"), false);
        }
    }
}
