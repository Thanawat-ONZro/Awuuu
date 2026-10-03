// "Check my setup": every reason Awuuu might stay quiet, each with a fix.
// Settings → About → Check my setup (`aw doctor` opens it).
//
// Read-only: it looks, it never changes anything.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub name: String,
    /// "ok", "warn" (works, could be better) or "fail".
    pub level: &'static str,
    pub detail: String,
    /// What to do about it, when something is wrong.
    pub fix: Option<String>,
}

fn check(name: &str, level: &'static str, detail: impl Into<String>, fix: Option<&str>) -> Check {
    Check { name: name.into(), level, detail: detail.into(), fix: fix.map(str::to_string) }
}

/// The hook relay and each agent's hooks.
fn hooks_checks() -> Vec<Check> {
    use crate::hooks::{status_for, HookAgent};
    let mut out = Vec::new();
    let claude = status_for(HookAgent::Claude);
    out.push(if claude.hook_ready {
        check("Hook relay", "ok", "awuuu-hook.exe is in place", None)
    } else {
        check("Hook relay", "fail", format!("awuuu-hook.exe is missing ({})", claude.hook_path), Some("Restart Awuuu; it copies the relay at launch. Reinstall if that doesn't help."))
    });
    let mut any = false;
    for (agent, name) in [
        (HookAgent::Claude, "Claude Code"),
        (HookAgent::Codex, "Codex"),
        (HookAgent::Agy, "Antigravity"),
        (HookAgent::OpenCode, "OpenCode"),
        (HookAgent::Hermes, "Hermes"),
    ] {
        let s = status_for(agent);
        if s.installed {
            any = true;
            out.push(check(&format!("{name} hooks"), "ok", "connected", None));
        } else if std::path::Path::new(&s.settings_path).parent().is_some_and(|d| d.exists()) {
            // The agent is installed (its folder exists) but not connected.
            out.push(check(&format!("{name} hooks"), "warn", "installed, not connected", Some("Settings → Agents → Connect, or `aw setup` in a terminal")));
        }
    }
    if !any {
        out.push(check("Agents", "fail", "no agent is connected, so the island sees no sessions", Some("Settings → Agents → Connect Claude Code (or another agent)")));
    }
    out
}

fn path_check() -> Check {
    if crate::cli::on_path() {
        check("aw command", "ok", "on your PATH", None)
    } else {
        check("aw command", "warn", "not on your PATH", Some("Settings → Agents → Add aw to PATH, then open a new terminal"))
    }
}

fn git_check() -> Check {
    use std::os::windows::process::CommandExt;
    let found = std::process::Command::new("git")
        .arg("--version")
        .creation_flags(0x0800_0000)
        .output()
        .is_ok_and(|o| o.status.success());
    if found {
        check("git", "ok", "found", None)
    } else {
        check("git", "warn", "not found, so Awuuu can't confirm which files a request changed", Some("Install Git for Windows (git-scm.com)"))
    }
}

async fn hermes_check() -> Check {
    if crate::claude::get_hermes_key().is_none() {
        return check("Hermes", "warn", "no API key found", Some("Set API_SERVER_KEY in %LOCALAPPDATA%\\hermes\\.env, or paste a key in Settings → Chat"));
    }
    match crate::claude::hermes_models().await {
        Ok(_) => check("Hermes", "ok", format!("answering at {}", crate::claude::get_hermes_url()), None),
        Err(e) => check("Hermes", "fail", e, Some("Start Hermes Agent (its gateway listens on :8642), then check again")),
    }
}

pub async fn run() -> Vec<Check> {
    let mut out = hooks_checks();
    out.push(hermes_check().await);
    out.push(path_check());
    out.push(git_check());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_check_carries_its_fix() {
        let c = check("git", "warn", "not found", Some("Install Git"));
        assert_eq!(c.fix.as_deref(), Some("Install Git"));
        assert_eq!(check("Hermes", "ok", "answering", None).fix, None);
    }
}
