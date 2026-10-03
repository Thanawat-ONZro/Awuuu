// Awuuu for Windows — app wiring and the commands the island calls.

mod claude;
mod files;
mod hooks;
mod integrations;
mod island;
mod log;
mod mouse;
mod pipe;
mod secrets;
mod updater;
mod settings;
mod tray;
mod transcript;
mod hermes;
mod cli;
mod win_user;

use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};

use claude::{Chat, ChatContext, ChatReply};
use files::DroppedFile;
use hooks::{HookPreview, HookStatus};
use island::{PollGate, ScreenInfo};
use pipe::Pending;
use settings::Settings;

/// Keeps spawned helpers from flashing a console window.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct Shared {
    pub settings: Mutex<Settings>,
    pub gate: Arc<PollGate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootInfo {
    settings: Settings,
    screen: ScreenInfo,
    version: String,
    hook_path: String,
    layout: Option<island::Layout>,
}

#[tauri::command]
fn boot(app: AppHandle, shared: State<Shared>) -> BootInfo {
    let mut settings = shared.settings.lock().unwrap().clone();
    // The real state of ~/.claude/settings.json wins over whatever we stored.
    settings.hooks_installed = hooks::status_for(hooks::HookAgent::Claude).installed;
    let screen = island::screen_info(&app, &settings.screen);
    let layout = island::monitor_rects(&app, &settings.screen).map(|(screen, work, scale)| {
        island::compute(&settings, screen, work, scale, shared.gate.collapsed.load(Ordering::Relaxed)).1
    });
    BootInfo {
        settings,
        screen,
        layout,
        version: env!("CARGO_PKG_VERSION").to_string(),
        hook_path: settings::hook_exe_path().to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn save_settings(app: AppHandle, shared: State<Shared>, settings: Settings) {
    let (screen_changed, autostart_changed) = {
        let mut current = shared.settings.lock().unwrap();
        let screen_changed = current.screen != settings.screen
            || current.position != settings.position
            || current.along != settings.along
            || current.panel_size() != settings.panel_size();
        let autostart_changed = current.autostart != settings.autostart;
        *current = settings.clone();
        (screen_changed, autostart_changed)
    };
    if let Err(err) = settings::save(&settings) {
        eprintln!("[awuuu] could not save settings: {err}");
    }
    if autostart_changed {
        let manager = app.autolaunch();
        let result = if settings.autostart { manager.enable() } else { manager.disable() };
        if let Err(err) = result {
            eprintln!("[awuuu] autostart: {err}");
        }
    }
    if screen_changed {
        let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
        island::apply_geometry(&app, &settings, collapsed);
    }
    // Keep the other window in step (island ⇄ settings window).
    let _ = app.emit("settings-changed", settings);
}

/// Hidden island → shrink the window to the invisible wake strip and park the
/// cursor poll; anything else → full panel and 60 Hz polling.
#[tauri::command]
fn set_collapsed(app: AppHandle, shared: State<Shared>, collapsed: bool) {
    let settings = shared.settings.lock().unwrap().clone();
    shared.gate.collapsed.store(collapsed, Ordering::Relaxed);
    island::apply_geometry(&app, &settings, collapsed);
    // The wake strip must always take the mouse, and a resize invalidates the flag.
    island::set_ignore_cursor(&app, false);
    shared.gate.forget_ignore_state();
    shared.gate.set_active(!collapsed);
}

/// The front end pushes the island shape; Rust decides click-through from it.
#[tauri::command]
fn set_island_rect(shared: State<Shared>, x: f64, y: f64, width: f64, height: f64) {
    shared.gate.set_rect(island::IslandRect { x, y, w: width, h: height });
}

#[tauri::command]
fn focus_window(app: AppHandle, focused: bool) {
    let Some(win) = island::window(&app) else { return };
    island::set_activating(&win, focused);
    if focused {
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn reposition(app: AppHandle, shared: State<Shared>) {
    let settings = shared.settings.lock().unwrap().clone();
    let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
    island::apply_geometry(&app, &settings, collapsed);
}

/// The grip on the island was pressed: the window follows the mouse until the
/// button is released, then docks (see island.rs `Watch::end_drag`).
#[tauri::command]
fn island_drag_begin(shared: State<Shared>) {
    shared.gate.begin_drag();
}

/// Resizing the island by its corner: the window takes the largest size for
/// the duration, so the island can grow under the cursor. Saving the new size
/// (save_settings) puts the window back to fit.
#[tauri::command]
fn island_resize_mode(app: AppHandle, shared: State<Shared>, on: bool) {
    let mut s = shared.settings.lock().unwrap().clone();
    if on {
        s.island_width = settings::ISLAND_WIDTH.2;
        s.hub_height = settings::HUB_HEIGHT.2;
    }
    island::apply_geometry(&app, &s, false);
}

/// Back to the default spot: top edge, centred.
#[tauri::command]
fn reset_position(app: AppHandle) {
    reset_island_position(&app);
}

pub fn reset_island_position(app: &AppHandle) {
    let Some(shared) = app.try_state::<Shared>() else { return };
    let settings = {
        let mut s = shared.settings.lock().unwrap();
        s.position = "top".into();
        s.along = 0.5;
        s.clone()
    };
    commit_settings(app, shared.inner(), settings);
}


/// Saves settings changed on the Rust side, re-places the island and tells
/// both windows.
pub fn commit_settings(app: &AppHandle, shared: &Shared, settings: Settings) {
    *shared.settings.lock().unwrap() = settings.clone();
    if let Err(err) = settings::save(&settings) {
        log::line(format!("could not save settings: {err}"));
    }
    let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
    island::apply_geometry(app, &settings, collapsed);
    let _ = app.emit("settings-changed", settings);
}

#[tauri::command]
fn open_url(url: String) {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return;
    }
    let _ = Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &url])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

/// Brings the session's own terminal window forward. False = not found, and
/// the island falls back to opening the folder.
#[tauri::command]
fn focus_terminal(hwnd: Option<i64>, pids: Vec<u32>) -> bool {
    let ok = win_user::focus_terminal(hwnd, &pids);
    log::line(format!("focus terminal hwnd={hwnd:?} pids={pids:?} -> {ok}"));
    ok
}

/// "Open terminal" opens the working folder in VS Code when `code` is on PATH,
/// and falls back to Explorer otherwise.
#[tauri::command]
fn open_in_vscode(path: Option<String>) -> bool {
    // No `cmd /C` anywhere near this. The path is a project folder chosen by
    // whoever is using Claude Code, and cmd would happily read `&`, `^` and `%`
    // in a folder name as syntax. Finding the launcher ourselves and handing the
    // path over as a separate argument keeps it a path.
    if let Some(code) = find_on_path("code") {
        let mut cmd = Command::new(code);
        if let Some(p) = path.as_deref().filter(|p| !p.is_empty()) {
            cmd.arg(p);
        }
        if cmd.creation_flags(CREATE_NO_WINDOW).spawn().is_ok() {
            return true;
        }
    }
    if let Some(p) = path.as_deref().filter(|p| !p.is_empty()) {
        let _ = Command::new("explorer").arg(p).spawn();
    }
    false
}

/// Our own `where`: walks %PATH% against %PATHEXT%, no shell involved.
/// Rust quotes arguments correctly for `.cmd`/`.bat` targets since 1.77, so
/// spawning `code.cmd` directly is safe.
fn find_on_path(stem: &str) -> Option<std::path::PathBuf> {
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    let dirs = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&dirs) {
        for ext in exts.split(';').filter(|e| !e.is_empty()) {
            let candidate = dir.join(format!("{stem}{}", ext.to_lowercase()));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Tray → Pause. Paused means paused: the pollers stop talking to the network,
/// not just the island stopping showing things.
#[tauri::command]
fn set_paused(paused: bool) {
    integrations::set_paused(paused);
}

// ── Claude Code hooks ─────────────────────────────────────────────────────────

#[tauri::command]
fn agent_hooks_status(agent: String) -> Result<HookStatus, String> {
    let a = hooks::HookAgent::parse(&agent).ok_or_else(|| format!("Unknown agent '{agent}'"))?;
    Ok(hooks::status_for(a))
}

#[tauri::command]
fn agent_hooks_preview(agent: String, install: bool) -> Result<HookPreview, String> {
    let a = hooks::HookAgent::parse(&agent).ok_or_else(|| format!("Unknown agent '{agent}'"))?;
    hooks::preview_for(a, install)
}

#[tauri::command]
fn agent_hooks_apply(
    app: AppHandle,
    shared: State<Shared>,
    agent: String,
    install: bool,
    fingerprint: String,
) -> Result<String, String> {
    let a = hooks::HookAgent::parse(&agent).ok_or_else(|| format!("Unknown agent '{agent}'"))?;
    let backup = hooks::write_for(a, install, &fingerprint)?;
    if a == hooks::HookAgent::Claude {
        let updated = {
            let mut current = shared.settings.lock().unwrap();
            current.hooks_installed = install;
            let _ = settings::save(&current);
            current.clone()
        };
        let _ = app.emit("settings-changed", updated);
    }
    Ok(backup)
}

#[tauri::command]
fn approval_decision(
    app: AppHandle,
    request_id: String,
    decision: String,
    answers: Option<serde_json::Value>,
    reason: Option<String>,
) {
    if request_id.starts_with(hermes::APPROVAL_PREFIX) {
        // A Hermes run waits on its own approval endpoint, not on a hook.
        tauri::async_runtime::spawn(async move {
            if let Err(e) = hermes::answer(&request_id, &decision).await {
                log::line(format!("hermes approval {request_id}: {e}"));
            }
        });
        return;
    }
    pipe::answer(&app, &request_id, &decision, answers, reason);
}

/// What the agent said or thought since the last look at its transcript.
#[tauri::command]
fn transcript_tail(agent: String, path: String) -> Vec<transcript::Step> {
    transcript::tail(&agent, &path).unwrap_or_default()
}

/// The island has the card on screen, so the long wait for a human may begin.
/// Until this arrives the relay only waits a few hundred milliseconds, which is
/// what stops a paused or unresponsive island from freezing Claude Code.
#[tauri::command]
fn approval_ack(app: AppHandle, request_id: String) {
    if request_id.starts_with(hermes::APPROVAL_PREFIX) {
        return;
    }
    pipe::acknowledge(&app, &request_id);
}

/// Nobody can act on this request — the island is paused, or another card is
/// already up. Claude Code falls back to asking in the terminal immediately.
#[tauri::command]
fn approval_decline(app: AppHandle, request_id: String) {
    if request_id.starts_with(hermes::APPROVAL_PREFIX) {
        return; // the run keeps waiting; Hermes' own UI can still answer
    }
    pipe::decline(&app, &request_id);
}

// ── Chat, files and secrets ───────────────────────────────────────────────────

/// One chat turn. The API key and any file bytes stay on the Rust side; the
/// reply so far is pushed to the island as `chat-delta` while it streams.
#[tauri::command]
async fn chat_send(
    app: AppHandle,
    shared: State<'_, Shared>,
    chat: State<'_, Chat>,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let (model, provider) = {
        let s = shared.settings.lock().unwrap();
        let p = s.providers.iter().find(|p| !s.chat_provider.is_empty() && p.id == s.chat_provider).cloned();
        (s.model.clone(), p)
    };
    let handle = app.clone();
    let on_delta = move |text: &str| {
        let _ = app.emit_to(island::WINDOW_LABEL, "chat-delta", text.to_string());
    };
    claude::send(&handle, &chat, &model, provider.as_ref(), query, context, &on_delta).await
}

/// Settings → "Check for updates…" (the tray item calls the same thing).
#[tauri::command]
fn update_check_now(app: AppHandle) {
    updater::check_now(&app);
}

/// Settings → "Test connection" for the Hermes gateway.
#[tauri::command]
async fn hermes_status() -> Result<Vec<String>, String> {
    claude::hermes_models().await
}

/// Settings → Test on a chat provider: its model list.
#[tauri::command]
async fn provider_models(base_url: String, id: String) -> Result<Vec<String>, String> {
    let key = if id.is_empty() { None } else { secrets::get(&format!("provider-key:{id}")) };
    claude::list_models(&base_url, key).await
}

/// Settings → "Detect local": Ollama and LM Studio on their usual ports.
/// Only when clicked; nothing probes in the background.
#[tauri::command]
async fn detect_local_providers() -> Vec<serde_json::Value> {
    let mut found = Vec::new();
    for (name, base) in [("Ollama", "http://127.0.0.1:11434/v1"), ("LM Studio", "http://127.0.0.1:1234/v1")] {
        if let Ok(models) = claude::list_models(base, None).await {
            found.push(serde_json::json!({ "name": name, "baseUrl": base, "models": models }));
        }
    }
    found
}

#[tauri::command]
fn chat_reset(chat: State<Chat>) {
    chat.reset();
}

/// Copies a dropped file into the inbox and reports its name back.
#[tauri::command]
fn ingest_file(path: String) -> Result<DroppedFile, String> {
    files::ingest(&path)
}

/// The island may only ask whether a key exists — never read it.
#[tauri::command]
fn secret_present(key: String) -> bool {
    secrets::present(&key)
}

#[tauri::command]
fn secret_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    secrets::set(&key, &value)?;
    // The island shows or hides the integration's pill at once.
    let _ = app.emit("secrets-changed", ());
    Ok(())
}

#[tauri::command]
fn secret_clear(app: AppHandle, key: String) -> Result<(), String> {
    secrets::clear(&key)?;
    let _ = app.emit("secrets-changed", ());
    Ok(())
}

/// Settings → Test on an integration.
#[tauri::command]
async fn integration_test(id: String) -> Result<String, String> {
    integrations::test(&id).await
}

/// Opens the configured n8n instance — the URL lives in the Credential Manager.
#[tauri::command]
fn open_n8n() {
    if let Some(url) = secrets::get("n8n-url") {
        open_url(url);
    }
}

/// Refresh buttons in the integration cards.
#[tauri::command]
async fn refresh_integration(app: AppHandle, id: String) {
    integrations::poll_once(app, &id).await;
}

/// Lets the island write to the same log as the Rust side.
#[tauri::command]
fn log_line(message: String) {
    log::line(format!("ui  {message}"));
}

// ── Settings window ───────────────────────────────────────────────────────────

/// WebView2 allows exactly one browser environment per app, and its options are
/// fixed by whichever webview is created first. Every window must therefore ask
/// for the *same* arguments as the island (see `additionalBrowserArgs` in
/// tauri.conf.json) — a mismatch makes the second window come up blank, with no
/// error anywhere.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// In a dev build the pages are served by Vite, so the second window needs the
/// absolute dev URL; a bundled build resolves it inside the app bundle.
fn settings_page_url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/settings.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("settings.html".into())
}

/// The settings window is created hidden at launch and only ever shown and
/// hidden afterwards. A WebView2 window created later — on the main thread or
/// not — silently comes up blank in this app, so the window that works is the
/// one that exists before the island's webview does.
fn create_settings_window(app: &AppHandle) {
    let url = settings_page_url(app);
    match WebviewWindowBuilder::new(app, "settings", url)
        .additional_browser_args(BROWSER_ARGS)
        .title("Settings — Awuuu")
        .inner_size(560.0, 680.0)
        .min_inner_size(460.0, 480.0)
        .resizable(true)
        .visible(false)
        .center()
        .build()
    {
        Ok(win) => {
            // Closing it must only hide it, or it could never be reopened.
            let hidden = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = hidden.hide();
                }
            });
        }
        Err(err) => log::line(format!("settings window failed: {err}")),
    }
}

pub fn show_settings_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("settings") else {
        log::line("settings window missing");
        return;
    };
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

/// Opens Settings scrolled to one agent's section (`aw setup <agent>`).
pub fn open_settings_at(app: &AppHandle, agent: &str) {
    show_settings_window(app);
    if !agent.is_empty() {
        let _ = app.emit_to("settings", "settings-focus", agent.to_string());
    }
}

/// Settings → "aw on PATH".
#[tauri::command]
fn aw_path_status() -> bool {
    cli::on_path()
}

#[tauri::command]
fn aw_path_set(on: bool) -> Result<bool, String> {
    cli::set_on_path(on)?;
    Ok(cli::on_path())
}

#[tauri::command]
fn open_settings_window(app: AppHandle) {
    show_settings_window(&app);
}

pub fn run() {
    // Release builds abort on panic with no console: leave the reason in awuuu.log.
    std::panic::set_hook(Box::new(|info| log::line(format!("PANIC: {info}"))));
    let loaded = settings::load();
    let gate = Arc::new(PollGate::new());

    let context = tauri::generate_context!();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // `aw setup <agent>` starts awuuu.exe --settings=<agent>; when Awuuu
            // already runs, that lands here.
            if let Some(agent) = cli::settings_arg(&argv) {
                open_settings_at(app, &agent);
            } else {
                let _ = app.emit_to(island::WINDOW_LABEL, "tray", "open".to_string());
            }
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Shared {
            settings: Mutex::new(loaded.clone()),
            gate: gate.clone(),
        })
        .manage(Pending::default())
        .manage(Chat::default())
        .invoke_handler(tauri::generate_handler![
            boot,
            save_settings,
            set_collapsed,
            set_island_rect,
            focus_window,
            reposition,
            island_drag_begin,
            reset_position,
            island_resize_mode,
            open_url,
            open_in_vscode,
            focus_terminal,
            quit_app,
            agent_hooks_status,
            agent_hooks_preview,
            agent_hooks_apply,
            approval_decision,
            transcript_tail,
            approval_ack,
            approval_decline,
            log_line,
            chat_send,
            chat_reset,
            provider_models,
            detect_local_providers,
            hermes_status,
            update_check_now,
            ingest_file,
            secret_present,
            secret_set,
            secret_clear,
            refresh_integration,
            integration_test,
            open_n8n,
            open_settings_window,
            aw_path_status,
            aw_path_set,
            set_paused,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            if let Err(err) = tray::build(&handle) {
                log::line(format!("tray::build error: {err}"));
                return Err(Box::new(err));
            }
            // Before the island: see create_settings_window.
            create_settings_window(&handle);

            if let Some(win) = island::window(&handle) {
                island::make_non_activating(&win);
                island::apply_geometry(&handle, &loaded, false);
                let _ = win.show();
            } else {
                log::line("WARNING: island window not found by label");
            }
            gate.collapsed.store(false, Ordering::Relaxed);
            gate.set_active(true);
            island::spawn_mouse_watch(handle.clone(), gate.clone());

            log::line(format!("--- Awuuu {} started ---", env!("CARGO_PKG_VERSION")));
            hooks::ensure_hook_exe(&handle);
            cli::ensure_aw_cmd(&handle);
            // Started by `aw setup <agent>`.
            if let Some(agent) = cli::settings_arg(&std::env::args().collect::<Vec<_>>()) {
                let h = handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    open_settings_at(&h, &agent);
                });
            }
            pipe::start(handle.clone());
            integrations::start(handle.clone());
            updater::start(handle.clone());
            Ok(())
        })
        .run(context)
        .map_err(|err| {
            log::line(format!("tauri run error: {err}"));
            err
        })
        .expect("error while running Awuuu");
}
