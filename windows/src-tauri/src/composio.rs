// Composio (https://composio.dev) as an MCP server for Hermes Agent. Strictly
// opt-in: Composio is a cloud service, so everything the assistant does through
// it passes through their servers. Awuuu only ever edits Hermes' own files after
// the user has seen the diff and clicked confirm, with a dated backup first.
//
// Two small, marked blocks (and nothing else is touched):
//   config.yaml  mcp_servers.composio  { url, headers: x-api-key: ${COMPOSIO_API_KEY} }
//   .env         COMPOSIO_API_KEY=...  (Hermes resolves ${VAR} from ~/.hermes/.env)
// The key is kept in the Windows Credential Manager and goes to the front end
// never; writing it to .env is a separate, explicit step with its own diff.
// Format verified in docs/HERMES-COMPOSIO.md.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::hooks::{backup_path_for, fingerprint, hermes_home, read_text, unified_diff, HookPreview};
use crate::secrets;

pub const KEY_NAME: &str = "composio-api-key";
const ENV_VAR: &str = "COMPOSIO_API_KEY";
const BEGIN: &str = "# >>> awuuu-composio >>>";
const END: &str = "# <<< awuuu-composio <<<";
const MASK: &str = "(hidden)";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Target {
    Config,
    Env,
}

impl Target {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "config" => Some(Self::Config),
            "env" => Some(Self::Env),
            _ => None,
        }
    }
    fn path(self) -> PathBuf {
        match self {
            Self::Config => hermes_home().join("config.yaml"),
            Self::Env => hermes_home().join(".env"),
        }
    }
}

/// The MCP endpoint is pasted from Composio's dashboard. Only a plain https URL
/// goes into the YAML: nothing that could break out of the quoted scalar.
pub fn validate_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    let ok_chars = url.chars().all(|c| !c.is_whitespace() && !c.is_control() && c != '"' && c != '\\' && c != '\'');
    if !url.starts_with("https://") || url.len() < 12 || !ok_chars {
        return Err("Paste the full https:// MCP URL from your Composio dashboard (no spaces or quotes).".into());
    }
    Ok(url.to_string())
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.chars().any(|c| c.is_whitespace() || c.is_control() || c == '#' || c == '"' || c == '\'') {
        return Err("The Composio API key looks malformed (spaces, quotes or '#').".into());
    }
    Ok(())
}

// ── Pure merge / remove ───────────────────────────────────────────────────────

/// `text` without our block, nothing else changed.
fn without_block(text: &str) -> String {
    let Some(start) = text.find(BEGIN) else { return text.to_string() };
    let Some(rel) = text[start..].find(END) else { return text.to_string() };
    let mut end = start + rel + END.len();
    if text[end..].starts_with("\r\n") {
        end += 2;
    } else if text[end..].starts_with('\n') {
        end += 1;
    }
    let mut head = text[..start].to_string();
    if head.ends_with("\n\n") {
        head.pop();
    }
    head + &text[end..]
}

fn append_block(base: String, block: &str) -> String {
    let mut out = base;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str(block);
    out
}

fn config_block(url: &str) -> String {
    format!(
        "{BEGIN}\n# Composio MCP server (cloud service: your app data passes through composio.dev). Added and removed from Awuuu's Integrations page.\nmcp_servers:\n  composio:\n    url: \"{url}\"\n    headers:\n      x-api-key: \"${{{ENV_VAR}}}\"\n{END}\n"
    )
}

/// The entries to paste by hand under an existing `mcp_servers:` section.
pub fn config_entries(url: &str) -> String {
    format!("  composio:\n    url: \"{url}\"\n    headers:\n      x-api-key: \"${{{ENV_VAR}}}\"\n")
}

/// config.yaml after installing (`Some(url)`) or removing (`None`) our block.
pub fn config_next(text: &str, url: Option<&str>) -> Result<String, String> {
    let base = without_block(text);
    let Some(url) = url else { return Ok(base) };
    let url = validate_url(url)?;
    if base.lines().any(|l| l.starts_with("mcp_servers:")) {
        return Err(format!(
            "Your config.yaml already has an `mcp_servers:` section, so Awuuu won't add a second one. Add this under it yourself:\n\n{}",
            config_entries(&url)
        ));
    }
    Ok(append_block(base, &config_block(&url)))
}

/// .env after installing (`Some(key)`) or removing (`None`) our block.
pub fn env_next(text: &str, key: Option<&str>) -> Result<String, String> {
    let base = without_block(text);
    let Some(key) = key else { return Ok(base) };
    validate_key(key)?;
    let prefix = format!("{ENV_VAR}=");
    if base.lines().any(|l| l.trim_start().trim_start_matches("export ").starts_with(&prefix)) {
        return Err(format!("Your .env already sets {ENV_VAR}, so Awuuu leaves it alone. Remove that line or change it yourself."));
    }
    Ok(append_block(base, &format!("{BEGIN}\n{ENV_VAR}={key}\n{END}\n")))
}

/// The URL inside our block, for pre-filling the form.
pub fn installed_url(text: &str) -> Option<String> {
    let start = text.find(BEGIN)?;
    let block = &text[start..start + text[start..].find(END)?];
    block.lines().find_map(|l| {
        let v = l.trim().strip_prefix("url:")?.trim().trim_matches('"');
        (!v.is_empty()).then(|| v.to_string())
    })
}

pub fn has_block(text: &str) -> bool {
    text.find(BEGIN).is_some_and(|s| text[s..].contains(END))
}

// ── Files ─────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposioStatus {
    pub config_path: String,
    pub env_path: String,
    pub config_installed: bool,
    pub env_installed: bool,
    pub key_saved: bool,
    pub url: Option<String>,
}

pub fn status() -> ComposioStatus {
    let cfg = read_text(&Target::Config.path()).unwrap_or_default();
    let env = read_text(&Target::Env.path()).unwrap_or_default();
    ComposioStatus {
        config_path: Target::Config.path().to_string_lossy().to_string(),
        env_path: Target::Env.path().to_string_lossy().to_string(),
        config_installed: has_block(&cfg),
        env_installed: has_block(&env),
        key_saved: secrets::present(KEY_NAME),
        url: installed_url(&cfg),
    }
}

fn file_fingerprint(path: &Path) -> String {
    fingerprint(&std::fs::read(path).unwrap_or_default())
}

/// `real` false masks the key, for the diff shown on screen.
fn next_text(target: Target, current: &str, install: bool, url: &str, real: bool) -> Result<String, String> {
    match target {
        Target::Config => config_next(current, install.then_some(url)),
        Target::Env => {
            if !install {
                return env_next(current, None);
            }
            let key = secrets::get(KEY_NAME).ok_or("Save your Composio API key first.")?;
            env_next(current, Some(if real { &key } else { MASK }))
        }
    }
}

pub fn preview(target: Target, install: bool, url: &str) -> Result<HookPreview, String> {
    let path = target.path();
    let current = read_text(&path)?;
    let next = next_text(target, &current, install, url, false)?;
    Ok(HookPreview {
        diff: unified_diff(&current, &next),
        backup: backup_path_for(&path).to_string_lossy().to_string(),
        settings_path: path.to_string_lossy().to_string(),
        fingerprint: file_fingerprint(&path),
    })
}

/// Writes only what `preview` showed: same bytes on disk, dated backup first, atomic replace.
pub fn apply(target: Target, install: bool, url: &str, fp: &str) -> Result<String, String> {
    let path = target.path();
    let current = read_text(&path)?;
    if file_fingerprint(&path) != fp {
        return Err(format!("{} changed since the preview. Nothing was written — review the new diff.", path.display()));
    }
    let next = next_text(target, &current, install, url, true)?;
    let backup = backup_path_for(&path);
    if path.exists() {
        std::fs::copy(&path, &backup).map_err(|e| format!("backup failed: {e}"))?;
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let temp = path.with_extension(format!("awuuu-{}", std::process::id()));
    std::fs::write(&temp, next.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
    if let Err(err) = std::fs::rename(&temp, &path) {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("write failed: {err}"));
    }
    Ok(backup.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const URL: &str = "https://backend.composio.dev/v3/mcp/abc123?user_id=me";

    #[test]
    fn config_install_then_remove_is_lossless() {
        let original = "model: x\nhooks:\n  a: 1\n";
        let with = config_next(original, Some(URL)).unwrap();
        assert!(with.starts_with(original));
        assert!(with.contains("x-api-key: \"${COMPOSIO_API_KEY}\""));
        assert!(with.contains(&format!("url: \"{URL}\"")));
        assert_eq!(config_next(&with, None).unwrap(), original);
        assert_eq!(installed_url(&with).as_deref(), Some(URL));
        assert!(has_block(&with));
    }

    #[test]
    fn config_install_is_idempotent_and_handles_empty() {
        let once = config_next("", Some(URL)).unwrap();
        assert_eq!(config_next(&once, Some(URL)).unwrap(), once);
        assert_eq!(config_next(&once, None).unwrap(), "");
        let no_newline = config_next("a: 1", Some(URL)).unwrap();
        assert!(no_newline.starts_with("a: 1\n\n# >>>"));
    }

    #[test]
    fn config_refuses_second_mcp_servers_section() {
        let err = config_next("mcp_servers:\n  other:\n    url: \"https://x.y\"\n", Some(URL)).unwrap_err();
        assert!(err.contains("already has an `mcp_servers:`"));
        assert!(err.contains("composio:"));
        // Removing never fails and leaves their section alone.
        assert_eq!(config_next("mcp_servers:\n  o: 1\n", None).unwrap(), "mcp_servers:\n  o: 1\n");
    }

    #[test]
    fn url_must_be_plain_https() {
        for bad in ["http://x.example.com/mcp", "https://a b.example/", "https://x.example/\"", "javascript:alert(1)", "", "https://x.example/\nfoo: bar"] {
            assert!(config_next("", Some(bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn env_install_remove_and_foreign_key() {
        let with = env_next("OTHER=1\n", Some("ck_abc")).unwrap();
        assert!(with.contains("COMPOSIO_API_KEY=ck_abc\n"));
        assert_eq!(env_next(&with, None).unwrap(), "OTHER=1\n");
        assert!(env_next("COMPOSIO_API_KEY=mine\n", Some("ck_abc")).is_err());
        assert!(env_next("", Some("bad key")).is_err());
        assert!(env_next("", Some("a#b")).is_err());
    }

    #[test]
    fn crlf_files_survive_removal() {
        let with = config_next("a: 1\r\n", Some(URL)).unwrap();
        assert!(config_next(&with, None).unwrap().starts_with("a: 1\r\n"));
    }

    #[test]
    fn key_name_is_known_to_secrets() {
        assert!(crate::secrets::KNOWN_KEYS.contains(&KEY_NAME));
    }
}
