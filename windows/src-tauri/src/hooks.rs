// Claude Code hook installation.
//
// The rule from CLAUDE.md is strict and is followed to the letter:
// read %USERPROFILE%\.claude\settings.json, take a dated backup, merge without
// touching anybody else's hooks, show the diff, and write only after an explicit
// click. Uninstall removes Awuuu's entries and nothing else.
//
// The command is only the quoted exe path in forward slashes plus the event name:
// on Windows Claude Code runs hook commands through Git Bash, and anything with
// PowerShell or cmd in it breaks.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager};
use windows::Win32::System::SystemInformation::GetLocalTime;

use crate::settings;

/// Every event the island reacts to, with the hook timeout written to settings.json.
/// PermissionRequest waits for a human, so it gets the decision timeout + 10 s.
pub const HOOK_EVENTS: &[(&str, u64)] = &[
    ("SessionStart", 10),
    ("SessionEnd", 10),
    ("UserPromptSubmit", 10),
    ("PreToolUse", 10),
    ("PostToolUse", 10),
    ("PostToolUseFailure", 10),
    ("PermissionRequest", 120),
    ("Notification", 10),
    ("Stop", 10),
    ("StopFailure", 10),
    ("SubagentStart", 10),
    ("SubagentStop", 10),
];

/// Codex CLI events (~/.codex/hooks.json, same shape as Claude Code's). The
/// event name comes in the payload, so the command carries none.
/// PermissionRequest waits for the island and tells Codex's UI so.
const CODEX_EVENTS: &[(&str, u64)] = &[
    ("SessionStart", 10),
    ("UserPromptSubmit", 10),
    ("PreToolUse", 10),
    ("PermissionRequest", 120),
    ("PostToolUse", 10),
    ("Stop", 10),
    ("SubagentStart", 10),
    ("SubagentStop", 10),
    ("Interrupt", 3),
    ("SessionEnd", 3),
];

/// AGY events and their timeouts. PreToolUse waits for a human in the island.
const AGY_EVENTS: &[(&str, u64)] = &[
    ("PreToolUse", 120),
    ("PostToolUse", 10),
    ("PreInvocation", 10),
    ("PostInvocation", 10),
    ("Stop", 10),
];

/// Our named hook inside AGY's hooks.json.
const AGY_HOOK_NAME: &str = "awuuu";

/// Marker that identifies an Awuuu entry inside settings.json.
const MARKER: &str = "awuuu-hook";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStatus {
    pub installed: bool,
    pub settings_path: String,
    pub hook_path: String,
    pub hook_ready: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookPreview {
    pub diff: String,
    pub backup: String,
    pub settings_path: String,
    /// Identifies the bytes this diff was computed from; handed back to `write`
    /// so we only ever apply what the user actually looked at.
    pub fingerprint: String,
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HookAgent {
    Claude,
    Agy,
    /// Shell hooks in Hermes' config.yaml, between our markers.
    Hermes,
    /// A plugin file of our own in OpenCode's plugin folder.
    OpenCode,
    /// ~/.codex/hooks.json (Experimental: Codex asks to trust new hooks).
    Codex,
}

impl HookAgent {
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "claude" | "claude-code" => Some(Self::Claude),
            "agy" | "antigravity" => Some(Self::Agy),
            "hermes" => Some(Self::Hermes),
            "opencode" => Some(Self::OpenCode),
            "codex" => Some(Self::Codex),
            _ => None,
        }
    }

    pub fn settings_path(&self) -> PathBuf {
        match self {
            Self::Claude => home().join(".claude").join("settings.json"),
            Self::Agy => home().join(".gemini").join("config").join("hooks.json"),
            Self::Hermes => hermes_home().join("config.yaml"),
            Self::OpenCode => home().join(".config").join("opencode").join("plugin").join("awuuu.js"),
            Self::Codex => codex_home().join("hooks.json"),
        }
    }

    /// JSON settings are merged key by key; the others are edited as text.
    fn is_json(&self) -> bool {
        matches!(self, Self::Claude | Self::Agy | Self::Codex)
    }
}

pub fn codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".codex"))
}

/// Hermes keeps its profile in HERMES_HOME; the Windows installer puts it in
/// %LOCALAPPDATA%\hermes, older setups in ~/.hermes.
pub fn hermes_home() -> PathBuf {
    if let Some(h) = std::env::var_os("HERMES_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(h);
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let p = PathBuf::from(local).join("hermes");
        if p.join("config.yaml").exists() {
            return p;
        }
    }
    home().join(".hermes")
}

// ── Hermes: a marked block in config.yaml ─────────────────────────────────────

const YAML_BEGIN: &str = "# >>> awuuu >>>";
const YAML_END: &str = "# <<< awuuu <<<";

/// Hermes shell-hook events the island follows. Every one is fire-and-forget:
/// Hermes' own approval prompt can't be answered by a hook, so the island
/// shows it and says where it is asked.
const HERMES_EVENTS: &[&str] = &[
    "on_session_start",
    "pre_llm_call",
    "pre_tool_call",
    "post_tool_call",
    "post_llm_call",
    "on_session_end",
    "pre_approval_request",
    "post_approval_response",
    "subagent_stop",
];

fn hermes_block() -> String {
    // Hermes splits the command with shlex (no shell): forward slashes, and
    // the path in double quotes inside a single-quoted YAML scalar.
    let exe = settings::hook_exe_path().to_string_lossy().replace('\\', "/");
    let mut out = format!(
        "{YAML_BEGIN}\n# Awuuu shows Hermes sessions in its island. Added and removed from Awuuu's Settings.\nhooks:\n"
    );
    for ev in HERMES_EVENTS {
        out.push_str(&format!("  {ev}:\n    - command: '\"{exe}\" --agent hermes {ev}'\n      timeout: 5\n"));
    }
    out.push_str(YAML_END);
    out.push('\n');
    out
}

/// config.yaml without our block, and nothing else changed.
fn yaml_without_ours(text: &str) -> String {
    let Some(start) = text.find(YAML_BEGIN) else { return text.to_string() };
    let Some(rel) = text[start..].find(YAML_END) else { return text.to_string() };
    let mut end = start + rel + YAML_END.len();
    if text[end..].starts_with("\r\n") {
        end += 2;
    } else if text[end..].starts_with('\n') {
        end += 1;
    }
    let mut head = text[..start].to_string();
    // Drop the blank line we put in front of the block.
    if head.ends_with("\n\n") {
        head.pop();
    }
    head + &text[end..]
}

/// A top-level `hooks:` key outside our block: we must not add a second one.
fn yaml_has_foreign_hooks(text: &str) -> bool {
    yaml_without_ours(text).lines().any(|l| l.starts_with("hooks:"))
}

fn hermes_next(text: &str, install: bool) -> Result<String, String> {
    let base = yaml_without_ours(text);
    if !install {
        return Ok(base);
    }
    if yaml_has_foreign_hooks(text) {
        let block = hermes_block();
        let entries: Vec<&str> = block
            .lines()
            .filter(|l| !l.starts_with('#') && *l != "hooks:")
            .collect();
        return Err(format!(
            "Your config.yaml already has a `hooks:` section, so Awuuu won't add a second one. Add these entries under it yourself:\n\n{}",
            entries.join("\n")
        ));
    }
    let mut out = base;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str(&hermes_block());
    Ok(out)
}

// ── OpenCode: our own plugin file ─────────────────────────────────────────────

const OPENCODE_MARKER: &str = "awuuu-opencode-plugin";

fn opencode_plugin() -> String {
    let exe = settings::hook_exe_path().to_string_lossy().replace('\\', "/");
    include_str!("opencode_plugin.js")
        .replace("__AWUUU_HOOK__", &exe)
        .replace("__MARKER__", OPENCODE_MARKER)
}

/// The file as it should be after installing or removing; `None` = no file.
fn text_next(agent: HookAgent, current: &str, install: bool) -> Result<Option<String>, String> {
    match agent {
        HookAgent::Hermes => hermes_next(current, install).map(Some),
        HookAgent::OpenCode => Ok(install.then(opencode_plugin)),
        _ => Err("JSON settings are merged as JSON".into()),
    }
}

pub fn settings_path() -> PathBuf {
    HookAgent::Claude.settings_path()
}

fn read_settings_path(path: &Path) -> Result<Value, String> {
    match std::fs::read(path) {
        Ok(bytes) => parse_settings(&bytes, &path.display().to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(err) => Err(format!("Can't read {}: {err}", path.display())),
    }
}

fn read_settings_lossy_path(path: &Path) -> Value {
    read_settings_path(path).unwrap_or_else(|_| json!({}))
}

#[allow(dead_code)]
fn read_settings() -> Result<Value, String> {
    read_settings_path(&settings_path())
}

/// The parsing half of `read_settings`, split out so it can be tested without a
/// home directory.
fn parse_settings(bytes: &[u8], path: &str) -> Result<Value, String> {
    // PowerShell writes a UTF-8 BOM with `Set-Content -Encoding utf8`, and
    // serde_json refuses it. Stripping it is safe and well defined; guessing at
    // anything else is not.
    let text = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    if text.iter().all(u8::is_ascii_whitespace) {
        return Ok(json!({}));
    }
    match serde_json::from_slice::<Value>(text) {
        Ok(v) if v.is_object() => Ok(v),
        Ok(_) => Err(format!("{path} isn't a JSON object — Awuuu won't touch it.")),
        Err(err) => Err(format!(
            "{path} isn't valid JSON ({err}). Fix or move it, then try again — Awuuu won't overwrite it."
        )),
    }
}

/// The settings as they are, or an empty object when we cannot tell. Only for
/// read-only paths like `status()`, which must never fail loudly; anything that
/// writes uses `read_settings()` and surfaces the error instead.
#[allow(dead_code)]
fn read_settings_lossy() -> Value {
    read_settings().unwrap_or_else(|_| json!({}))
}

fn hook_command(agent: HookAgent, event: &str) -> String {
    match agent {
        // Written by hermes_block() / the plugin file instead.
        HookAgent::Hermes | HookAgent::OpenCode => String::new(),
        HookAgent::Codex => {
            // Unquoted, forward slashes and no spaces (8.3 name if needed):
            // the same string works whether Codex hands it to cmd, PowerShell
            // or a POSIX shell.
            let exe = settings::hook_exe_path().to_string_lossy().replace('/', "\\");
            let exe = if exe.contains(' ') { short_path(&exe).unwrap_or(exe) } else { exe };
            let _ = event;
            format!("{} --agent codex", exe.replace('\\', "/"))
        }
        HookAgent::Claude => {
            // Claude Code on Windows runs hooks via Git Bash (MSYS2), where forward slashes are required.
            let exe = settings::hook_exe_path().to_string_lossy().replace('\\', "/");
            format!("\"{exe}\" --agent claude {event}")
        }
        HookAgent::Agy => {
            // Antigravity CLI on Windows executes commands via cmd.exe / PowerShell.
            // Native backslashes and standard Windows path formatting are mandatory.
            // AGY runs the command through `cmd /c` and escapes every `"` as
            // `\"` on the way, so a quoted path is never found. Unquoted is
            // fine without spaces; with spaces, the 8.3 short name has none.
            let exe = settings::hook_exe_path().to_string_lossy().replace('/', "\\");
            let exe = if exe.contains(' ') { short_path(&exe).unwrap_or(exe) } else { exe };
            format!("{exe} --agent agy {event}")
        }
    }
}

/// The 8.3 short form of an existing path (no spaces), if the volume has one.
fn short_path(long: &str) -> Option<String> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetShortPathNameW;
    let wide = HSTRING::from(long);
    let mut buf = vec![0u16; 1024];
    let n = unsafe { GetShortPathNameW(&wide, Some(&mut buf)) } as usize;
    (n > 0 && n < buf.len()).then(|| String::from_utf16_lossy(&buf[..n])).filter(|s| !s.contains(' '))
}

fn entry_is_ours(entry: &Value) -> bool {
    if let Some(cmd) = entry.get("command").and_then(Value::as_str) {
        if cmd.contains(MARKER) || cmd.contains("coucou-hook") /* entries from Coucou-era installs */ {
            return true;
        }
    }
    entry
        .get("hooks")
        .and_then(Value::as_array)
        .map(|hooks| {
            hooks.iter().any(|h| {
                h.get("command")
                    .and_then(Value::as_str)
                    .map(|c| c.contains(MARKER) || c.contains("awuuu-hook"))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}

/// Codex: Claude's shape, Codex's events, one command for all of them.
fn merged_codex(existing: &Value) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let mut hooks = root.get("hooks").and_then(Value::as_object).cloned().unwrap_or_else(Map::new);
    for (event, timeout) in CODEX_EVENTS {
        let mut list = hooks.get(*event).and_then(Value::as_array).cloned().unwrap_or_default();
        list.retain(|entry| !entry_is_ours(entry));
        let mut handler = json!({
            "type": "command",
            "command": hook_command(HookAgent::Codex, event),
            "timeout": timeout,
        });
        if *event == "PermissionRequest" {
            handler["statusMessage"] = json!("Waiting for your answer in Awuuu");
        }
        list.push(json!({ "hooks": [handler] }));
        hooks.insert((*event).to_string(), Value::Array(list));
    }
    root.insert("hooks".into(), Value::Object(hooks));
    Value::Object(root)
}

/// Settings with Awuuu's hooks added; everything else is left untouched.
fn merged(existing: &Value) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let mut hooks = root
        .get("hooks")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_else(Map::new);

    for (event, timeout) in HOOK_EVENTS {
        let mut list = hooks
            .get(*event)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        list.retain(|entry| !entry_is_ours(entry));
        list.push(json!({
            "hooks": [{
                "type": "command",
                "command": hook_command(HookAgent::Claude, event),
                "timeout": timeout,
            }]
        }));
        hooks.insert((*event).to_string(), Value::Array(list));
    }

    root.insert("hooks".into(), Value::Object(hooks));
    Value::Object(root)
}

/// Settings with every Awuuu entry removed, and nothing else changed.
fn without_ours(existing: &Value) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let Some(hooks) = root.get("hooks").and_then(Value::as_object).cloned() else {
        return Value::Object(root);
    };
    let mut out = Map::new();
    for (event, value) in hooks {
        match value.as_array() {
            Some(list) => {
                let kept: Vec<Value> =
                    list.iter().filter(|e| !entry_is_ours(e)).cloned().collect();
                if !kept.is_empty() {
                    out.insert(event, Value::Array(kept));
                }
            }
            None => {
                out.insert(event, value);
            }
        }
    }
    if out.is_empty() {
        root.remove("hooks");
    } else {
        root.insert("hooks".into(), Value::Object(out));
    }
    Value::Object(root)
}

fn pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

/// Down to the second: installing then uninstalling in the same minute must not
/// quietly overwrite the first backup.
fn stamp() -> String {
    let t = unsafe { GetLocalTime() };
    format!(
        "{:04}{:02}{:02}-{:02}{:02}{:02}",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond
    )
}

fn backup_path_for(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("settings.json");
    path.with_file_name(format!("{name}.bak-{}", stamp()))
}

#[allow(dead_code)]
fn backup_path() -> PathBuf {
    backup_path_for(&settings_path())
}

/// Identifies the exact bytes a preview was computed from. FNV-1a is plenty:
/// the question is only "is this still the file I showed the user?".
fn fingerprint(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    format!("{hash:016x}")
}

fn current_fingerprint_path(path: &Path) -> String {
    match std::fs::read(path) {
        Ok(bytes) => fingerprint(&bytes),
        Err(_) => fingerprint(b""),
    }
}

#[allow(dead_code)]
fn current_fingerprint() -> String {
    current_fingerprint_path(&settings_path())
}

fn merged_for_agent(agent: HookAgent, existing: &Value) -> Value {
    match agent {
        HookAgent::Hermes | HookAgent::OpenCode => existing.clone(),
        HookAgent::Codex => merged_codex(existing),
        HookAgent::Claude => merged(existing),
        HookAgent::Agy => {
            // AGY's hooks.json (spec bundled in agy.exe 1.2.14): top-level keys
            // are named hooks, each holding its events. Tool events are grouped
            // under a matcher; the others are a flat list of handlers. Ours is
            // the "awuuu" key, so every other named hook stays untouched.
            let mut root = without_ours_for_agent(HookAgent::Agy, existing)
                .as_object()
                .cloned()
                .unwrap_or_default();
            let handler = |event: &str, timeout: u64| {
                json!({ "type": "command", "command": hook_command(HookAgent::Agy, event), "timeout": timeout })
            };
            let mut ours = Map::new();
            ours.insert("enabled".into(), json!(true));
            for (event, timeout) in AGY_EVENTS {
                let value = if matches!(*event, "PreToolUse" | "PostToolUse") {
                    json!([{ "matcher": "*", "hooks": [handler(event, *timeout)] }])
                } else {
                    json!([handler(event, *timeout)])
                };
                ours.insert((*event).to_string(), value);
            }
            root.insert(AGY_HOOK_NAME.into(), Value::Object(ours));
            Value::Object(root)
        }
    }
}

fn without_ours_for_agent(agent: HookAgent, existing: &Value) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    if agent == HookAgent::Agy {
        root.remove(AGY_HOOK_NAME);
        // Left by builds before 0.3, which wrote the wrong format.
        root.remove(MARKER);
    }
    without_ours(&Value::Object(root))
}

fn is_installed_for_agent(agent: HookAgent, current: &Value) -> bool {
    let has_hooks = current
        .get("hooks")
        .and_then(Value::as_object)
        .map(|hooks| {
            hooks
                .values()
                .filter_map(Value::as_array)
                .flatten()
                .any(entry_is_ours)
        })
        .unwrap_or(false);

    match agent {
        HookAgent::Claude | HookAgent::Hermes | HookAgent::OpenCode | HookAgent::Codex => has_hooks,
        // Only the current format counts: an install in the old format never
        // ran, so it shows as "not installed" and gets replaced.
        HookAgent::Agy => current.get(AGY_HOOK_NAME).is_some_and(Value::is_object),
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

pub fn status_for(agent: HookAgent) -> HookStatus {
    let path = agent.settings_path();
    let installed = if agent.is_json() {
        is_installed_for_agent(agent, &read_settings_lossy_path(&path))
    } else {
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        match agent {
            HookAgent::Hermes => text.contains(YAML_BEGIN),
            _ => text.contains(OPENCODE_MARKER),
        }
    };
    let hook_path = settings::hook_exe_path();
    HookStatus {
        installed,
        settings_path: path.to_string_lossy().to_string(),
        hook_ready: hook_path.exists(),
        hook_path: hook_path.to_string_lossy().to_string(),
    }
}

#[cfg(test)]
pub fn status() -> HookStatus {
    status_for(HookAgent::Claude)
}

pub fn preview_for(agent: HookAgent, install: bool) -> Result<HookPreview, String> {
    let path = agent.settings_path();
    if !agent.is_json() {
        let current = read_text(&path)?;
        let next = text_next(agent, &current, install)?.unwrap_or_default();
        return Ok(HookPreview {
            diff: unified_diff(&current, &next),
            backup: backup_path_for(&path).to_string_lossy().to_string(),
            settings_path: path.to_string_lossy().to_string(),
            fingerprint: current_fingerprint_path(&path),
        });
    }
    let current = read_settings_path(&path)?;
    let next = if install {
        merged_for_agent(agent, &current)
    } else {
        without_ours_for_agent(agent, &current)
    };
    Ok(HookPreview {
        diff: unified_diff(&pretty(&current), &pretty(&next)),
        backup: backup_path_for(&path).to_string_lossy().to_string(),
        settings_path: path.to_string_lossy().to_string(),
        fingerprint: current_fingerprint_path(&path),
    })
}

#[cfg(test)]
pub fn preview(install: bool) -> Result<HookPreview, String> {
    preview_for(HookAgent::Claude, install)
}

pub fn stage_hook_binary_if_needed() {
    let dest = settings::hook_exe_path();
    if dest.exists() {
        return;
    }
    if let Some(dir) = dest.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let candidates = [
                parent.join("awuuu-hook.exe"),
                parent.join("../release/awuuu-hook.exe"),
                parent.join("_up_/target/release/awuuu-hook.exe"),
            ];
            for c in &candidates {
                if c.exists() {
                    let _ = std::fs::copy(c, &dest);
                    break;
                }
            }
        }
    }
}

/// Writes the merged (or cleaned) settings after taking a dated backup.
pub fn write_for(agent: HookAgent, install: bool, fingerprint: &str) -> Result<String, String> {
    if install {
        stage_hook_binary_if_needed();
    }
    let path = agent.settings_path();
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    if !agent.is_json() {
        return write_text(agent, &path, install, fingerprint);
    }
    let current = read_settings_path(&path)?;
    if current_fingerprint_path(&path) != fingerprint {
        return Err(format!(
            "{} changed since the preview. Nothing was written — review the new diff.",
            path.display()
        ));
    }

    let backup = backup_path_for(&path);
    if path.exists() {
        std::fs::copy(&path, &backup).map_err(|e| format!("backup failed: {e}"))?;
    }

    let next = if install {
        merged_for_agent(agent, &current)
    } else {
        without_ours_for_agent(agent, &current)
    };
    let mut text = pretty(&next);
    text.push('\n');

    let temp = path.with_extension(format!("json.awuuu-{}", std::process::id()));
    std::fs::write(&temp, text.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
    if let Err(err) = std::fs::rename(&temp, &path) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("write failed: {err}"));
    }
    Ok(backup.to_string_lossy().to_string())
}

fn read_text(path: &Path) -> Result<String, String> {
    match std::fs::read(path) {
        Ok(bytes) => {
            let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
            String::from_utf8(bytes.to_vec())
                .map_err(|_| format!("{} isn't UTF-8 text — Awuuu won't touch it.", path.display()))
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(format!("Can't read {}: {err}", path.display())),
    }
}

/// Text files (Hermes config.yaml, the OpenCode plugin) follow the same rules:
/// the file must be what the preview showed, a dated backup comes first, then
/// an atomic replace. No text for the plugin removes our file.
fn write_text(agent: HookAgent, path: &Path, install: bool, fingerprint: &str) -> Result<String, String> {
    let current = read_text(path)?;
    if current_fingerprint_path(path) != fingerprint {
        return Err(format!(
            "{} changed since the preview. Nothing was written — review the new diff.",
            path.display()
        ));
    }
    let next = text_next(agent, &current, install)?;
    let backup = backup_path_for(path);
    if path.exists() {
        std::fs::copy(path, &backup).map_err(|e| format!("backup failed: {e}"))?;
    }
    match next {
        None => {
            if path.exists() {
                std::fs::remove_file(path).map_err(|e| format!("remove failed: {e}"))?;
            }
        }
        Some(text) => {
            let temp = path.with_extension(format!("awuuu-{}", std::process::id()));
            std::fs::write(&temp, text.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
            if let Err(err) = std::fs::rename(&temp, path) {
                let _ = std::fs::remove_file(&temp);
                return Err(format!("write failed: {err}"));
            }
        }
    }
    Ok(backup.to_string_lossy().to_string())
}

#[cfg(test)]
pub fn write(install: bool, fingerprint: &str) -> Result<String, String> {
    write_for(HookAgent::Claude, install, fingerprint)
}

/// Copies awuuu-hook.exe into %LOCALAPPDATA%\Awuuu\bin on launch.
/// In a bundled install it comes from the app resources; in `tauri dev` it sits
/// next to awuuu.exe in the workspace target directory.
///
/// Every candidate is tried rather than just the first, because getting this
/// wrong is silent and fatal: `resources` used to be a glob, which made NSIS
/// mirror the source path into `_up_\target\release\`, no candidate matched, and
/// the relay was simply never installed. It only looked healthy on a developer
/// machine, where a leftover copy from `tauri dev` was already sitting in bin/.
pub fn ensure_hook_exe(app: &AppHandle) {
    let dest = settings::hook_exe_path();
    let Some(dir) = dest.parent() else { return };
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = app.path().resolve("awuuu-hook.exe", tauri::path::BaseDirectory::Resource) {
        candidates.push(p);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            // Installed build, then `tauri dev` (target/debug) next to the
            // release hook the pre-build step produces.
            candidates.push(parent.join("awuuu-hook.exe"));
            candidates.push(parent.join("../release/awuuu-hook.exe"));
            // Belt and braces: where the old glob form used to land it.
            candidates.push(parent.join("_up_/target/release/awuuu-hook.exe"));
        }
    }

    let tried: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
    let Some(src) = candidates.into_iter().find(|p| p.exists()) else {
        crate::log::line(format!(
            "awuuu-hook.exe not found — Claude Code hooks cannot work. Looked in: {}",
            tried.join(", ")
        ));
        return;
    };

    let same = match (std::fs::metadata(&src), std::fs::metadata(&dest)) {
        (Ok(a), Ok(b)) => a.len() == b.len() && a.modified().ok() == b.modified().ok(),
        _ => false,
    };
    if same {
        return;
    }
    // A hook may be running right now and hold the file open; keeping the old
    // copy is fine, it is the same relay.
    if let Err(err) = std::fs::copy(&src, &dest) {
        if !dest.exists() {
            crate::log::line(format!("could not install awuuu-hook.exe: {err}"));
        }
    }
}

// ── Claude Code status line (usage limits) ────────────────────────────────────
//
// Claude Code hands its plan limits to the `statusLine` command and to nothing
// else. `awuuu-hook --statusline` notes them down for the island and then runs
// whatever status line was there before, so the terminal looks the same.
// Same rules as the hooks: preview, dated backup, write only what was shown.

/// Next to settings.json in %APPDATA%\Awuuu: `{ "previous": <statusLine|null> }`,
/// read by the relay on every refresh and by uninstall to put things back.
const STATUSLINE_FILE: &str = "statusline.json";

fn statusline_sidecar() -> PathBuf {
    settings::config_dir().join(STATUSLINE_FILE)
}

fn statusline_command() -> String {
    // Git Bash runs it, like the hooks: forward slashes, quoted path.
    let exe = settings::hook_exe_path().to_string_lossy().replace('\\', "/");
    format!("\"{exe}\" --statusline")
}

fn statusline_is_ours(settings: &Value) -> bool {
    settings
        .get("statusLine")
        .and_then(|s| s.get("command"))
        .and_then(Value::as_str)
        .is_some_and(|c| c.contains(MARKER) && c.contains("--statusline"))
}

/// The status line that was there before ours, as kept in statusline.json.
fn statusline_saved_previous(sidecar_text: &str) -> Option<Value> {
    serde_json::from_str::<Value>(sidecar_text.trim_start_matches('\u{feff}'))
        .ok()?
        .get("previous")
        .filter(|p| p.is_object())
        .cloned()
}

/// What to remember when installing: somebody else's status line as it is
/// now, or — reinstalling over ours — what was remembered the first time.
fn statusline_previous_for_install(existing: &Value, saved: Option<&Value>) -> Option<Value> {
    if statusline_is_ours(existing) {
        return saved.cloned();
    }
    existing.get("statusLine").filter(|s| !s.is_null()).cloned()
}

/// Settings with our status line; everything else is left untouched.
fn statusline_merged(existing: &Value) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    let mut ours = json!({ "type": "command", "command": statusline_command() });
    // Keep the spacing the user chose for the line we now stand in for.
    if let Some(padding) = existing.get("statusLine").and_then(|s| s.get("padding")) {
        ours["padding"] = padding.clone();
    }
    root.insert("statusLine".into(), ours);
    Value::Object(root)
}

/// Settings with the previous status line back (or none), and nothing else
/// changed. A status line that isn't ours is somebody's choice: left alone.
fn statusline_removed(existing: &Value, previous: Option<&Value>) -> Value {
    let mut root = existing.as_object().cloned().unwrap_or_default();
    if statusline_is_ours(existing) {
        match previous {
            Some(p) => {
                root.insert("statusLine".into(), p.clone());
            }
            None => {
                root.shift_remove("statusLine");
            }
        }
    }
    Value::Object(root)
}

fn statusline_next(existing: &Value, sidecar: &Path, install: bool) -> Value {
    if install {
        return statusline_merged(existing);
    }
    let saved = statusline_saved_previous(&std::fs::read_to_string(sidecar).unwrap_or_default());
    statusline_removed(existing, saved.as_ref())
}

pub fn statusline_status() -> HookStatus {
    let path = settings_path();
    let hook_path = settings::hook_exe_path();
    HookStatus {
        installed: statusline_is_ours(&read_settings_lossy_path(&path)),
        settings_path: path.to_string_lossy().to_string(),
        hook_ready: hook_path.exists(),
        hook_path: hook_path.to_string_lossy().to_string(),
    }
}

fn statusline_preview_at(path: &Path, sidecar: &Path, install: bool) -> Result<HookPreview, String> {
    let current = read_settings_path(path)?;
    let next = statusline_next(&current, sidecar, install);
    Ok(HookPreview {
        diff: unified_diff(&pretty(&current), &pretty(&next)),
        backup: backup_path_for(path).to_string_lossy().to_string(),
        settings_path: path.to_string_lossy().to_string(),
        fingerprint: current_fingerprint_path(path),
    })
}

pub fn statusline_preview(install: bool) -> Result<HookPreview, String> {
    statusline_preview_at(&settings_path(), &statusline_sidecar(), install)
}

fn statusline_write_at(path: &Path, sidecar: &Path, install: bool, fingerprint: &str) -> Result<String, String> {
    let current = read_settings_path(path)?;
    if current_fingerprint_path(path) != fingerprint {
        return Err(format!(
            "{} changed since the preview. Nothing was written — review the new diff.",
            path.display()
        ));
    }
    let next = statusline_next(&current, sidecar, install);

    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let backup = backup_path_for(path);
    if path.exists() {
        std::fs::copy(path, &backup).map_err(|e| format!("backup failed: {e}"))?;
    }

    if install {
        // Before settings.json: the relay must find the previous command the
        // first time Claude Code calls it.
        let saved = statusline_saved_previous(&std::fs::read_to_string(sidecar).unwrap_or_default());
        let previous = statusline_previous_for_install(&current, saved.as_ref());
        if let Some(dir) = sidecar.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let mut text = pretty(&json!({ "previous": previous }));
        text.push('\n');
        std::fs::write(sidecar, text).map_err(|e| format!("write failed: {e}"))?;
    }

    let mut text = pretty(&next);
    text.push('\n');
    let temp = path.with_extension(format!("json.awuuu-{}", std::process::id()));
    std::fs::write(&temp, text.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
    if let Err(err) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("write failed: {err}"));
    }
    if !install {
        let _ = std::fs::remove_file(sidecar);
    }
    Ok(backup.to_string_lossy().to_string())
}

/// Sets (or takes back) Claude Code's `statusLine` after a dated backup.
pub fn statusline_write(install: bool, fingerprint: &str) -> Result<String, String> {
    if install {
        stage_hook_binary_if_needed();
    }
    statusline_write_at(&settings_path(), &statusline_sidecar(), install, fingerprint)
}

// ── Minimal unified diff (LCS) ────────────────────────────────────────────────

/// settings.json is short, so a plain O(n·m) LCS is the simplest honest diff.
fn unified_diff(before: &str, after: &str) -> String {
    let a: Vec<&str> = before.lines().collect();
    let b: Vec<&str> = after.lines().collect();
    let (n, m) = (a.len(), b.len());

    let mut lcs = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            lcs[i][j] = if a[i] == b[j] {
                lcs[i + 1][j + 1] + 1
            } else {
                lcs[i + 1][j].max(lcs[i][j + 1])
            };
        }
    }

    let mut out: Vec<String> = Vec::new();
    let (mut i, mut j) = (0usize, 0usize);
    while i < n && j < m {
        if a[i] == b[j] {
            out.push(format!("  {}", a[i]));
            i += 1;
            j += 1;
        } else if lcs[i + 1][j] >= lcs[i][j + 1] {
            out.push(format!("- {}", a[i]));
            i += 1;
        } else {
            out.push(format!("+ {}", b[j]));
            j += 1;
        }
    }
    while i < n {
        out.push(format!("- {}", a[i]));
        i += 1;
    }
    while j < m {
        out.push(format!("+ {}", b[j]));
        j += 1;
    }

    // Keep three lines of context around each change so the panel stays readable.
    let changed: Vec<usize> = out
        .iter()
        .enumerate()
        .filter(|(_, l)| l.starts_with('+') || l.starts_with('-'))
        .map(|(i, _)| i)
        .collect();
    if changed.is_empty() {
        return "No change.".into();
    }
    let mut keep = vec![false; out.len()];
    for idx in changed {
        let lo = idx.saturating_sub(3);
        let hi = (idx + 4).min(out.len());
        for k in lo..hi {
            keep[k] = true;
        }
    }
    let mut result = String::new();
    let mut gap = false;
    for (idx, line) in out.iter().enumerate() {
        if keep[idx] {
            result.push_str(line);
            result.push('\n');
            gap = false;
        } else if !gap {
            result.push_str("  …\n");
            gap = true;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    const WHERE: &str = "settings.json";

    #[test]
    fn a_utf8_bom_is_stripped_not_treated_as_corruption() {
        // PowerShell 5's `Set-Content -Encoding utf8` produces exactly this.
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(br#"{"model":"opus","hooks":{}}"#);
        let parsed = parse_settings(&bytes, WHERE).expect("a BOM must not defeat the parser");
        assert_eq!(parsed["model"], "opus");
    }

    #[test]
    fn unreadable_content_is_an_error_never_an_empty_object() {
        // This is the whole bug: returning {} here meant `merged()` produced a
        // file containing nothing but Awuuu's hooks, and the write replaced
        // everything the user had.
        for bad in [&b"{ not json"[..], &b"[1,2,3]"[..], &b"\"a string\""[..]] {
            assert!(
                parse_settings(bad, WHERE).is_err(),
                "content we cannot use must refuse, not come back empty"
            );
        }
    }

    #[test]
    fn empty_and_whitespace_files_start_from_nothing() {
        assert_eq!(parse_settings(b"", WHERE).unwrap(), json!({}));
        assert_eq!(parse_settings(b"  
	 ", WHERE).unwrap(), json!({}));
    }

    #[test]
    fn merging_keeps_every_other_setting_and_every_foreign_hook() {
        let existing = serde_json::json!({
            "model": "claude-opus-5",
            "theme": "dark",
            "enabledPlugins": ["a", "b"],
            "hooks": {
                "PreToolUse": [
                    { "hooks": [{ "type": "command", "command": "someone-elses-tool.exe" }] }
                ],
                "SomeEventWeDoNotTouch": [
                    { "hooks": [{ "type": "command", "command": "keep-me.exe" }] }
                ]
            }
        });

        let after = merged(&existing);
        assert_eq!(after["model"], "claude-opus-5");
        assert_eq!(after["theme"], "dark");
        assert_eq!(after["enabledPlugins"], serde_json::json!(["a", "b"]));

        let pre = after["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(
            pre.iter().any(|e| serde_json::to_string(e).unwrap().contains("someone-elses-tool.exe")),
            "another tool's hook was dropped"
        );
        assert!(pre.iter().any(entry_is_ours), "our own hook was not added");
        assert!(after["hooks"]["SomeEventWeDoNotTouch"].is_array());

        // And removing ours puts it back exactly as it was.
        let cleaned = without_ours(&after);
        assert_eq!(cleaned, existing);
    }

    #[test]
    fn agy_hooks_follow_the_bundled_spec() {
        let existing = json!({
            "lint-checker": { "PostToolUse": [{ "matcher": "run_command", "hooks": [{ "command": "lint.sh" }] }] },
            // What builds before 0.3 wrote.
            "hooks": { "PreToolUse": [{ "command": "\"C:\\x\\awuuu-hook.exe\" PreToolUse", "matcher": ".*" }] }
        });
        let after = merged_for_agent(HookAgent::Agy, &existing);
        let ours = &after["awuuu"];
        assert_eq!(ours["enabled"], true);
        let pre = &ours["PreToolUse"][0];
        assert_eq!(pre["matcher"], "*");
        let cmd = pre["hooks"][0]["command"].as_str().unwrap();
        assert!(cmd.contains("--agent agy PreToolUse"));
        // AGY escapes quotes on the way to cmd.exe, so the command has none.
        assert!(!cmd.contains('"'));
        assert_eq!(pre["hooks"][0]["timeout"], 120);
        // Flat events carry handlers directly.
        assert!(ours["Stop"][0]["command"].as_str().unwrap().contains("--agent agy Stop"));
        assert!(ours["PreInvocation"][0].get("hooks").is_none());
        assert!(ours.get("SessionStart").is_none());
        // Someone else's named hook survives; our old wrong-format entry does not.
        assert_eq!(after["lint-checker"], existing["lint-checker"]);
        assert!(after.get("hooks").is_none());
        assert!(is_installed_for_agent(HookAgent::Agy, &after));
        assert!(!is_installed_for_agent(HookAgent::Agy, &existing));

        let removed = without_ours_for_agent(HookAgent::Agy, &after);
        assert_eq!(removed, json!({ "lint-checker": existing["lint-checker"] }));
    }

    #[test]
    fn a_fingerprint_notices_any_change() {
        assert_eq!(fingerprint(b"{}"), fingerprint(b"{}"));
        assert_ne!(fingerprint(b"{}"), fingerprint(b"{ }"));
        assert_ne!(fingerprint(b""), fingerprint(b"{}"));
    }

    /// Everything filesystem-shaped lives in one test on purpose: it points
    /// USERPROFILE at a temp directory, and that is process-wide.
    #[test]
    fn writing_backs_up_preserves_and_refuses_a_changed_file() {
        let tmp = std::env::temp_dir().join(format!("awuuu-hooks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join(".claude")).unwrap();
        std::env::set_var("USERPROFILE", &tmp);

        let path = settings_path();
        assert!(path.starts_with(&tmp), "the test must not touch the real home");

        // A real-shaped file, written the way PowerShell 5 would: UTF-8 with BOM.
        let original = r#"{"model":"claude-opus-5","theme":"dark","tui":{"x":1},"hooks":{"PreToolUse":[{"hooks":[{"type":"command","command":"other-tool.exe"}]}]}}"#;
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice(original.as_bytes());
        std::fs::write(&path, &bytes).unwrap();

        // Install.
        let plan = preview(true).expect("a BOM must not stop the preview");
        assert!(plan.diff.contains("awuuu-hook") || plan.diff.contains("awuuu-hook"), "the diff must show what changes");
        let backup = write(true, &plan.fingerprint).expect("install should succeed");

        // The backup holds the original bytes, BOM and all.
        assert_eq!(std::fs::read(&backup).unwrap(), bytes);

        // Everything else survived, and so did the other tool's hook.
        let after: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(after["model"], "claude-opus-5");
        assert_eq!(after["theme"], "dark");
        assert_eq!(after["tui"]["x"], 1);
        let pre = after["hooks"]["PreToolUse"].as_array().unwrap();
        assert!(pre.iter().any(|e| serde_json::to_string(e).unwrap().contains("other-tool.exe")));
        assert!(status().installed);

        // A file that moved since the preview is refused, and left alone.
        let stale = preview(false).unwrap();
        std::fs::write(&path, br#"{"model":"someone-else-edited-this"}"#).unwrap();
        let err = write(false, &stale.fingerprint).unwrap_err();
        assert!(err.contains("changed since the preview"), "got: {err}");
        let untouched: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(untouched["model"], "someone-else-edited-this");

        // Content we cannot parse is refused before anything is written.
        std::fs::write(&path, b"{ broken").unwrap();
        assert!(preview(true).is_err());
        assert!(write(true, "whatever").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{ broken");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}

#[cfg(test)]
mod statusline_tests {
    use super::*;

    fn parse(text: &str) -> Value {
        parse_settings(text.as_bytes(), "settings.json").unwrap()
    }

    #[test]
    fn installing_sets_only_the_status_line() {
        let existing = parse(r#"{"model":"opus","hooks":{"Stop":[{"hooks":[{"type":"command","command":"x"}]}]},"theme":"dark"}"#);
        let after = statusline_merged(&existing);
        assert!(statusline_is_ours(&after));
        assert!(!statusline_is_ours(&existing));
        assert_eq!(after["statusLine"]["type"], "command");
        let cmd = after["statusLine"]["command"].as_str().unwrap();
        assert!(cmd.starts_with('"') && cmd.ends_with("awuuu-hook.exe\" --statusline"), "got {cmd}");
        assert!(!cmd.contains('\\'), "Git Bash needs forward slashes");
        assert_eq!(after["model"], "opus");
        assert_eq!(after["hooks"], existing["hooks"]);
        assert_eq!(after["theme"], "dark");
        assert_eq!(statusline_previous_for_install(&existing, None), None);
        // Nothing before: uninstall removes the key and the file is as it was.
        assert_eq!(statusline_removed(&after, None), existing);
        assert_eq!(pretty(&statusline_removed(&after, None)), pretty(&existing));
    }

    #[test]
    fn a_previous_status_line_is_remembered_and_put_back() {
        let existing = parse(r#"{"statusLine":{"type":"command","command":"bash ~/.claude/line.sh","padding":0},"model":"opus"}"#);
        let previous = statusline_previous_for_install(&existing, None).expect("their line");
        assert_eq!(previous["command"], "bash ~/.claude/line.sh");
        let after = statusline_merged(&existing);
        assert!(statusline_is_ours(&after));
        assert_eq!(after["statusLine"]["padding"], 0);
        // The key stays where it was in the file.
        assert_eq!(after.as_object().unwrap().keys().collect::<Vec<_>>(), ["statusLine", "model"]);

        // Reinstalling over ours keeps what was remembered, not our own line.
        assert_eq!(statusline_previous_for_install(&after, Some(&previous)), Some(previous.clone()));
        assert_eq!(statusline_previous_for_install(&after, None), None);
        assert_eq!(statusline_merged(&after), after);

        assert_eq!(statusline_removed(&after, Some(&previous)), existing);
        // Someone replaced our line in the meantime: uninstall leaves theirs.
        assert_eq!(statusline_removed(&existing, Some(&json!({"type":"command","command":"old"}))), existing);
    }

    #[test]
    fn the_sidecar_is_read_leniently() {
        assert_eq!(
            statusline_saved_previous(r#"{"previous":{"type":"command","command":"x"}}"#),
            Some(json!({"type":"command","command":"x"}))
        );
        assert_eq!(statusline_saved_previous(r#"{"previous":null}"#), None);
        assert_eq!(statusline_saved_previous(""), None);
        assert_eq!(statusline_saved_previous("{ broken"), None);
    }

    /// Explicit paths in a temp folder: the real settings.json and the real
    /// %APPDATA%\Awuuu are never involved.
    #[test]
    fn writing_backs_up_remembers_and_restores() {
        let tmp = std::env::temp_dir().join(format!("awuuu-statusline-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("claude")).unwrap();
        let path = tmp.join("claude").join("settings.json");
        let sidecar = tmp.join("awuuu").join(STATUSLINE_FILE);
        let original = r#"{"model":"opus","statusLine":{"type":"command","command":"my-line.cmd"}}"#;
        std::fs::write(&path, original).unwrap();

        let plan = statusline_preview_at(&path, &sidecar, true).unwrap();
        assert!(plan.diff.contains("--statusline"), "{}", plan.diff);
        assert!(plan.diff.contains("-     \"command\": \"my-line.cmd\""), "{}", plan.diff);
        let backup = statusline_write_at(&path, &sidecar, true, &plan.fingerprint).unwrap();
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), original);
        let after = parse(&std::fs::read_to_string(&path).unwrap());
        assert!(statusline_is_ours(&after));
        assert_eq!(after["model"], "opus");
        let saved = statusline_saved_previous(&std::fs::read_to_string(&sidecar).unwrap()).unwrap();
        assert_eq!(saved["command"], "my-line.cmd");

        // Reinstall: the remembered line survives.
        let again = statusline_preview_at(&path, &sidecar, true).unwrap();
        assert_eq!(again.diff, "No change.");
        statusline_write_at(&path, &sidecar, true, &again.fingerprint).unwrap();
        assert_eq!(statusline_saved_previous(&std::fs::read_to_string(&sidecar).unwrap()).unwrap()["command"], "my-line.cmd");

        // A stale preview is refused and nothing moves.
        let stale = statusline_preview_at(&path, &sidecar, false).unwrap();
        let edited = std::fs::read_to_string(&path).unwrap().replace("opus", "sonnet");
        std::fs::write(&path, &edited).unwrap();
        let err = statusline_write_at(&path, &sidecar, false, &stale.fingerprint).unwrap_err();
        assert!(err.contains("changed since the preview"), "got: {err}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), edited);
        assert!(sidecar.exists());

        // Uninstall: their line is back, the sidecar is gone.
        let undo = statusline_preview_at(&path, &sidecar, false).unwrap();
        assert!(undo.diff.contains("+     \"command\": \"my-line.cmd\""), "{}", undo.diff);
        statusline_write_at(&path, &sidecar, false, &undo.fingerprint).unwrap();
        let restored = parse(&std::fs::read_to_string(&path).unwrap());
        assert_eq!(restored, parse(&original.replace("opus", "sonnet")));
        assert!(!sidecar.exists());

        // Unparseable settings are refused before anything is written.
        std::fs::write(&path, b"{ broken").unwrap();
        assert!(statusline_preview_at(&path, &sidecar, true).is_err());
        assert!(statusline_write_at(&path, &sidecar, true, "whatever").is_err());
        assert!(!sidecar.exists());

        let _ = std::fs::remove_dir_all(&tmp);
    }
}

#[cfg(test)]
mod text_tests {
    use super::*;

    #[test]
    fn hermes_block_round_trips_and_leaves_the_rest_alone() {
        let original = "model:\n  default: x\nagent:\n  y: 1\n";
        let installed = hermes_next(original, true).unwrap();
        assert!(installed.starts_with(original));
        assert!(installed.contains("hooks:\n  on_session_start:\n    - command: '\""));
        assert!(installed.contains("--agent hermes pre_tool_call'"));
        assert_eq!(hermes_next(&installed, false).unwrap(), original);
        // Reinstalling replaces our block instead of adding a second one.
        let again = hermes_next(&installed, true).unwrap();
        assert_eq!(again.matches(YAML_BEGIN).count(), 1);
    }

    #[test]
    fn hermes_refuses_a_second_hooks_key() {
        let err = hermes_next("hooks:\n  pre_tool_call: []\n", true).unwrap_err();
        assert!(err.contains("already has a `hooks:` section"));
        assert!(err.contains("--agent hermes on_session_start"));
    }

    #[test]
    fn opencode_plugin_is_filled_in() {
        let js = opencode_plugin();
        assert!(js.contains(OPENCODE_MARKER));
        assert!(!js.contains("__AWUUU_HOOK__"));
        assert!(js.contains("awuuu-hook.exe"));
    }
}

#[cfg(test)]
mod codex_tests {
    use super::*;

    #[test]
    fn codex_hooks_merge_and_come_out_cleanly() {
        let existing = json!({ "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "other-tool" } ] } ] } });
        let merged = merged_codex(&existing);
        let stop = merged["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2, "keeps the other tool's hook");
        let ours = &merged["hooks"]["PermissionRequest"][0]["hooks"][0];
        assert!(ours["command"].as_str().unwrap().ends_with("awuuu-hook.exe --agent codex"));
        assert!(!ours["command"].as_str().unwrap().contains('\\'));
        assert_eq!(ours["timeout"], 120);
        assert!(is_installed_for_agent(HookAgent::Codex, &merged));
        // Reinstall doesn't duplicate; uninstall leaves the other tool alone.
        assert_eq!(merged_codex(&merged)["hooks"]["Stop"].as_array().unwrap().len(), 2);
        assert_eq!(without_ours_for_agent(HookAgent::Codex, &merged), existing);
    }
}
