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
mod extras;
mod oauth;
mod persona;
mod git;
mod win_user;
mod usage;
mod history;

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
    /// What the agents did (history.json), in memory.
    pub history: history::Store,
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

/// The grip (or Alt + press) on the island: the window becomes a full-work-area
/// overlay so the island can be drawn being pulled off its edge. Returns the
/// overlay's logical size and where the island window's top-left is inside it
/// (`w, h, x, y`). `apply: false` only measures — the front end asks first,
/// gets ready, then asks again to switch.
#[tauri::command]
fn island_overlay_begin(app: AppHandle, shared: State<Shared>, apply: Option<bool>) -> Option<(f64, f64, f64, f64)> {
    let pref = shared.settings.lock().unwrap().screen.clone();
    if apply == Some(false) {
        return island::overlay_begin(&app, &pref, false);
    }
    shared.gate.overlay.store(true, Ordering::Relaxed);
    shared.gate.forget_ignore_state();
    let geometry = island::overlay_begin(&app, &pref, true);
    if geometry.is_none() {
        shared.gate.overlay.store(false, Ordering::Relaxed);
    }
    geometry
}

/// Released: dock to `edge` at `along` (the front end already animated the
/// island into place), or just restore when `edge` is empty.
#[tauri::command]
fn island_overlay_end(app: AppHandle, shared: State<Shared>, edge: String, along: f64) {
    shared.gate.overlay.store(false, Ordering::Relaxed);
    let mut settings = shared.settings.lock().unwrap().clone();
    if matches!(edge.as_str(), "top" | "bottom" | "left" | "right") {
        settings.position = edge;
        settings.along = along.clamp(0.0, 1.0);
        log::line(format!("island moved: {} along={:.2}", settings.position, settings.along));
    }
    commit_settings(&app, shared.inner(), settings);
    shared.gate.forget_ignore_state();
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
    aware: Option<String>,
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
    claude::send(&handle, &chat, &model, provider.as_ref(), query, context, aware, &on_delta).await
}

/// Settings → "Check for updates…" (the tray item calls the same thing).
#[tauri::command]
fn update_check_now(app: AppHandle) {
    updater::check_now(&app);
}

/// What git says changed in a project (island/ground.ts diffs two of these).
#[tauri::command]
async fn git_snapshot(cwd: String) -> Option<git::GitSnapshot> {
    tauri::async_runtime::spawn_blocking(move || git::snapshot(&cwd)).await.ok().flatten()
}

/// Sessions → "Ask Hermes" on a test run nothing could read.
#[tauri::command]
async fn judge_tests(command: String, output: String) -> Result<String, String> {
    claude::judge_tests(&command, &output).await.map(str::to_string)
}

/// Settings → "Test connection" for the Hermes gateway.
#[tauri::command]
async fn hermes_status() -> Result<Vec<String>, String> {
    claude::hermes_models().await
}

/// The chat's model picker: Hermes' providers and models.
#[tauri::command]
async fn hermes_model_options() -> Result<hermes::ModelOptions, String> {
    hermes::model_options().await
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

/// A file dropped on the island arrives as its bytes (the page gets no path):
/// the raw IPC body, its name in the `x-file-name` header (URI-encoded).
#[tauri::command]
fn ingest_bytes(request: tauri::ipc::Request<'_>) -> Result<DroppedFile, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected the file's bytes".into());
    };
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(files::uri_decode)
        .unwrap_or_else(|| "file".into());
    files::ingest_bytes(&name, bytes)
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

/// Which integrations are set up (key, link or list saved): their pills show.
#[tauri::command]
fn integrations_configured(app: AppHandle) -> Vec<&'static str> {
    [
        "integration_calendar", "integration_mail", "integration_github", "integration_todoist",
        "integration_uptime", "integration_weather", "integration_feeds", "integration_stripe",
        "integration_vercel", "integration_resend", "integration_n8n", "integration_notion", "integration_calcom",
    ]
    .into_iter()
    .filter(|id| integrations::configured(id) || extras::configured(&app, id))
    .collect()
}

/// Settings → Test on an integration.
#[tauri::command]
async fn integration_test(app: AppHandle, id: String) -> Result<String, String> {
    if matches!(
        id.as_str(),
        "integration_mail" | "integration_calendar" | "integration_feeds" | "integration_uptime" | "integration_weather" | "integration_todoist"
    ) {
        return extras::test(&app, &id).await;
    }
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
        .title("Awuuu")
        .inner_size(1040.0, 720.0)
        .min_inner_size(560.0, 480.0)
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentFound {
    id: &'static str,
    name: &'static str,
    /// The agent is on this machine.
    present: bool,
    hooks_installed: bool,
}

/// Welcome page: which coding agents are on this machine, and whether
/// Awuuu is hooked into each.
#[tauri::command]
fn detect_agents() -> Vec<AgentFound> {
    let local = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from).unwrap_or_default();
    let present = |id: &str| match id {
        "claude" => find_on_path("claude").is_some(),
        "agy" => find_on_path("agy").is_some() || local.join("agy").join("bin").join("agy.exe").exists(),
        "hermes" => find_on_path("hermes").is_some() || hooks::hermes_home().join("config.yaml").exists(),
        "opencode" => {
            find_on_path("opencode").is_some()
                || local.join("Programs").join("@opencode-aidesktop").join("OpenCode.exe").exists()
        }
        "codex" => find_on_path("codex").is_some(),
        _ => false,
    };
    [
        ("claude", "Claude Code"),
        ("agy", "Antigravity CLI"),
        ("hermes", "Hermes Agent"),
        ("opencode", "OpenCode"),
        ("codex", "Codex CLI"),
    ]
    .into_iter()
    .map(|(id, name)| AgentFound {
        id,
        name,
        present: present(id),
        hooks_installed: hooks::HookAgent::parse(id).map(|a| hooks::status_for(a).installed).unwrap_or(false),
    })
    .collect()
}

/// Opens the Awuuu window at a page ("sessions", "chat"…) or at one agent's
/// card (`aw setup <agent>`).
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
fn open_settings_window(app: AppHandle, page: Option<String>) {
    // `page`: a page of the Awuuu window ("sessions", "agents", "chat"…).
    open_settings_at(&app, page.as_deref().unwrap_or(""));
}

// ── Usage limits, history ─────────────────────────────────────────────────────

/// Plan limits of the connected agents, from files on this PC (usage.rs).
#[tauri::command]
async fn usage_read() -> Vec<usage::AgentUsage> {
    tauri::async_runtime::spawn_blocking(usage::read).await.unwrap_or_default()
}

#[tauri::command]
fn statusline_status() -> HookStatus {
    hooks::statusline_status()
}

#[tauri::command]
fn statusline_preview(install: bool) -> Result<HookPreview, String> {
    hooks::statusline_preview(install)
}

/// Writes Claude Code's `statusLine` — after a click, and only when the file
/// still matches the preview. Returns the backup path.
#[tauri::command]
fn statusline_apply(install: bool, fingerprint: String) -> Result<String, String> {
    let backup = hooks::statusline_write(install, &fingerprint)?;
    usage::forget_cache();
    Ok(backup)
}

/// The island reports what the agents do; entries are upserted by id.
#[tauri::command]
fn history_append(
    shared: State<Shared>,
    entries: Vec<history::Entry>,
    sessions: std::collections::HashMap<String, history::SessionInfo>,
) {
    let (enabled, days) = {
        let s = shared.settings.lock().unwrap();
        (s.history_enabled, s.history_days)
    };
    if !enabled {
        return;
    }
    shared.history.append(entries, sessions, days, history::now_ms());
    shared.history.schedule_write();
}

#[tauri::command]
fn history_query(shared: State<Shared>, since_ms: Option<f64>) -> history::HistoryData {
    shared.history.query(since_ms.map(|ms| ms as i64))
}

#[tauri::command]
fn history_clear(shared: State<Shared>) -> Result<(), String> {
    shared.history.clear()
}

#[tauri::command]
fn history_info(shared: State<Shared>) -> history::Info {
    shared.history.info()
}

/// Saves `<name>.md` and `<name>.json` in Downloads, never over another file.
#[tauri::command]
fn export_files(app: AppHandle, name: String, markdown: String, json: String) -> Result<Vec<String>, String> {
    let dir = app.path().download_dir().map_err(|e| format!("No Downloads folder: {e}"))?;
    history::export_to(&dir, &name, &markdown, &json)
}

/// Shows a file in Explorer, selected.
#[tauri::command]
fn reveal_file(path: String) {
    // `"` cannot be part of a Windows path; refusing it keeps the quoting honest.
    if path.contains('"') || !std::path::Path::new(&path).exists() {
        return;
    }
    let _ = Command::new("explorer").raw_arg(format!("/select,\"{}\"", path.replace('/', "\\"))).spawn();
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
            history: history::Store::new(settings::config_dir().join("history.json")),
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
            island_overlay_begin,
            island_overlay_end,
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
            hermes_model_options,
            detect_local_providers,
            hermes_status,
            git_snapshot,
            judge_tests,
            update_check_now,
            ingest_file,
            ingest_bytes,
            secret_present,
            secret_set,
            secret_clear,
            refresh_integration,
            integration_test,
            integrations_configured,
            open_n8n,
            open_settings_window,
            aw_path_status,
            detect_agents,
            aw_path_set,
            set_paused,
            usage_read,
            statusline_status,
            statusline_preview,
            statusline_apply,
            history_append,
            history_query,
            history_clear,
            history_info,
            export_files,
            reveal_file,
            oauth::oauth_status,
            oauth::oauth_sign_in,
            oauth::oauth_cancel,
            oauth::oauth_sign_out,
            oauth::github_cli_login,
            oauth::github_device_start,
            oauth::github_device_wait,
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
            // First launch: the Welcome page explains hooks and `aw`.
            if !loaded.onboarded {
                let h = handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(6000)).await;
                    open_settings_at(&h, "welcome");
                });
            }
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
        .build(context)
        .map_err(|err| {
            log::line(format!("tauri run error: {err}"));
            err
        })
        .expect("error while running Awuuu")
        .run(|app, event| {
            // Whatever history is still waiting for its write goes out now.
            if let tauri::RunEvent::Exit = event {
                if let Some(shared) = app.try_state::<Shared>() {
                    shared.history.flush();
                }
            }
        });
}
