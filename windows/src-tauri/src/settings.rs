// Preferences, stored as plain JSON in %APPDATA%\Awuuu\settings.json.
// No secret ever lands here — API keys live in the Windows Credential Manager.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub sound_enabled: bool,
    pub sound_volume: f64,
    pub auto_close_interval: f64,
    pub active_integrations: Vec<String>,
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    /// The edge the island docks to in "edge" placement: "top", "bottom" (just
    /// above the taskbar), "left" or "right". Missing in older settings.json → top.
    #[serde(default = "default_position")]
    pub position: String,
    /// Where along that edge, 0..1 (left→right on top/bottom, top→bottom on the sides).
    #[serde(default = "half")]
    pub along: f64,
    /// Width of the open island, logical px.
    #[serde(default = "default_island_width")]
    pub island_width: f64,
    /// Height of the Agents hub, logical px.
    #[serde(default = "default_hub_height")]
    pub hub_height: f64,
    /// Agents hub text size, 1.0 = normal.
    #[serde(default = "one")]
    pub hub_scale: f64,
    /// Extra OpenAI-compatible chat providers (OpenAI, OpenRouter, Ollama…).
    /// Their keys live in the Credential Manager as `provider-key:<id>`.
    #[serde(default)]
    pub providers: Vec<ChatProvider>,
    /// Which provider the island chat uses: "" = Hermes / Claude by `model`,
    /// otherwise the id of one of `providers`.
    #[serde(default)]
    pub chat_provider: String,
    /// Hermes chat: model and provider for this turn ("" = Hermes' default)
    /// and reasoning effort ("" = default, "low", "medium", "high").
    #[serde(default)]
    pub hermes_model: String,
    #[serde(default)]
    pub hermes_provider: String,
    #[serde(default)]
    pub reasoning_effort: String,
    /// Mail integration: "gmail" | "outlook" | "icloud" | "yahoo" | host[:port],
    /// and the account. The app password lives in the Credential Manager.
    #[serde(default)]
    pub mail_host: String,
    #[serde(default)]
    pub mail_user: String,
    /// RSS/Atom feeds and sites to watch (not secret).
    #[serde(default)]
    pub rss_feeds: Vec<String>,
    #[serde(default)]
    pub uptime_urls: Vec<String>,
    /// City for the weather.
    #[serde(default)]
    pub weather_city: String,
    /// The Welcome page (what hooks and `aw` are) has been read.
    #[serde(default)]
    pub onboarded: bool,
    /// Log lines kept on screen in the hub (0 = all).
    #[serde(default = "default_log_lines")]
    pub log_lines: u32,
    #[serde(default = "yes")]
    pub show_thinking: bool,
    #[serde(default = "yes")]
    pub show_time: bool,
    pub autostart: bool,
    pub hooks_installed: bool,
    /// Claude model used by the chat. Changeable in the settings window.
    /// Defaulted explicitly so a settings.json written by an older build still loads.
    #[serde(default = "default_model")]
    pub model: String,
    /// Seconds the compact island stays up with nothing going on before it
    /// hides; 0 = never hide. Same default as the front end (state.ts).
    #[serde(default = "default_hide_after")]
    pub hide_after: f64,
    /// Automatic update checks: None = not asked yet (asked once at launch).
    #[serde(default)]
    pub update_check: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatProvider {
    pub id: String,
    pub name: String,
    /// ".../v1" — `/chat/completions` and `/models` are appended.
    pub base_url: String,
    pub model: String,
}

fn default_hide_after() -> f64 {
    5.0
}

fn default_position() -> String {
    "top".into()
}

fn half() -> f64 {
    0.5
}

fn one() -> f64 {
    1.0
}

fn yes() -> bool {
    true
}

fn default_log_lines() -> u32 {
    40
}

pub const ISLAND_WIDTH: (f64, f64, f64) = (520.0, 640.0, 1100.0); // min, default, max
pub const HUB_HEIGHT: (f64, f64, f64) = (220.0, 290.0, 640.0);

fn default_island_width() -> f64 {
    ISLAND_WIDTH.1
}

fn default_hub_height() -> f64 {
    HUB_HEIGHT.1
}

impl Settings {
    /// Size of the window that holds the open island (logical px): the island
    /// plus room for its shadow, never smaller than the classic 720×320.
    pub fn panel_size(&self) -> (f64, f64) {
        let w = self.island_width.clamp(ISLAND_WIDTH.0, ISLAND_WIDTH.2);
        let h = self.hub_height.clamp(HUB_HEIGHT.0, HUB_HEIGHT.2);
        ((w + 80.0).max(720.0), (h + 30.0).max(320.0))
    }
}

fn default_model() -> String {
    crate::claude::DEFAULT_MODEL.to_string()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            sound_enabled: true,
            sound_volume: 0.12,
            auto_close_interval: 15.0,
            active_integrations: vec![
                "integration_resend".into(),
                "integration_n8n".into(),
                "integration_vercel".into(),
                "integration_github".into(),
            ],
            screen: "primary".into(),
            position: default_position(),
            along: 0.5,
            island_width: default_island_width(),
            hub_height: default_hub_height(),
            providers: Vec::new(),
            mail_host: String::new(),
            mail_user: String::new(),
            rss_feeds: Vec::new(),
            uptime_urls: Vec::new(),
            weather_city: String::new(),
            onboarded: false,
            hermes_model: String::new(),
            hermes_provider: String::new(),
            reasoning_effort: String::new(),
            chat_provider: String::new(),
            hub_scale: 1.0,
            log_lines: default_log_lines(),
            show_thinking: true,
            show_time: true,
            autostart: false,
            hooks_installed: false,
            model: default_model(),
            hide_after: default_hide_after(),
            update_check: None,
        }
    }
}

/// %APPDATA%\Awuuu
pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Awuuu")
}

/// %LOCALAPPDATA%\Awuuu — where awuuu-hook.exe and the log live.
pub fn local_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Awuuu")
}

pub fn hook_exe_path() -> PathBuf {
    local_dir().join("bin").join("awuuu-hook.exe")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Settings {
    match std::fs::read(settings_path()) {
        // Notepad and PowerShell like to add a UTF-8 BOM, which serde rejects.
        Ok(bytes) => serde_json::from_slice(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes)).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(settings_path(), json)
}
