// Adapter registry: agents whose hooks live in a JSON file of their own, each
// described once (id, where the file is, how to merge ours in, how to take ours
// out, how to tell it is there). The merge/remove functions are pure — they get
// the parsed file and return the next one, and never touch the disk — so the
// rules (keep the user's other hooks, idempotent, remove restores the original,
// refuse what is not what we expect) are unit tested. hooks.rs does the
// preview, backup and write for every adapter exactly as it does for Claude Code.
//
// Gemini CLI and Cursor go through here. Copilot CLI is not here: its relay
// side (camelCase payload, fail-closed permissionRequest answer) isn't built.
// Codex and OpenCode have their own, older code in hooks.rs.

use serde_json::{json, Map, Value};

/// One agent whose JSON hooks file Awuuu can edit.
pub struct Adapter {
    pub id: &'static str,
    pub name: &'static str,
    /// Path under the user's profile folder.
    pub file: &'static [&'static str],
    /// The agent's own folder under the profile: its presence means "installed".
    pub home_dir: &'static str,
    /// The command-line tool that proves the agent is on this machine.
    pub exe: &'static str,
    /// `existing` + our hooks; `exe` is the relay's path.
    pub merge: fn(&Value, &str) -> Result<Value, String>,
    /// `existing` without our hooks.
    pub remove: fn(&Value) -> Result<Value, String>,
    pub installed: fn(&Value) -> bool,
}

impl PartialEq for Adapter {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}
impl Eq for Adapter {}
impl std::fmt::Debug for Adapter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Adapter({})", self.id)
    }
}

pub const ADAPTERS: &[Adapter] = &[
    Adapter {
        id: "gemini",
        name: "Gemini CLI",
        file: &[".gemini", "settings.json"],
        home_dir: ".gemini",
        exe: "gemini",
        merge: gemini_merge,
        remove: gemini_remove,
        installed: gemini_installed,
    },
    Adapter {
        id: "cursor",
        name: "Cursor Agent",
        file: &[".cursor", "hooks.json"],
        home_dir: ".cursor",
        exe: "cursor",
        merge: cursor_merge,
        remove: cursor_remove,
        installed: cursor_installed,
    },
];

pub fn find(id: &str) -> Option<&'static Adapter> {
    ADAPTERS.iter().find(|a| a.id.eq_ignore_ascii_case(id))
}

// ── Shared helpers: Claude-style groups ───────────────────────────────────────

const MARKER: &str = "awuuu-hook";

fn unexpected(what: &str) -> String {
    format!("{what} has an unexpected type — Awuuu has not touched it.")
}

fn object_at(root: &Map<String, Value>, key: &str) -> Result<Map<String, Value>, String> {
    match root.get(key) {
        None => Ok(Map::new()),
        Some(Value::Object(m)) => Ok(m.clone()),
        Some(_) => Err(unexpected(&format!("\"{key}\""))),
    }
}

fn list_at(hooks: &Map<String, Value>, event: &str) -> Result<Vec<Value>, String> {
    match hooks.get(event) {
        None => Ok(Vec::new()),
        Some(Value::Array(list)) => Ok(list.clone()),
        Some(_) => Err(unexpected(&format!("\"hooks\".\"{event}\""))),
    }
}

fn is_our_command(command: Option<&Value>, agent: &str) -> bool {
    command
        .and_then(Value::as_str)
        .is_some_and(|c| c.contains(MARKER) && c.contains(&format!("--agent {agent}")))
}

/// Groups (`{"matcher"?, "hooks": [{"command"}]}` or a flat `{"command"}`)
/// without our entries; a group left empty goes, everything else stays as is.
fn without_ours_in_groups(groups: &[Value], agent: &str) -> Vec<Value> {
    groups
        .iter()
        .filter_map(|group| {
            if is_our_command(group.get("command"), agent) {
                return None;
            }
            let Some(inner) = group.get("hooks").and_then(Value::as_array) else {
                return Some(group.clone());
            };
            let kept: Vec<Value> =
                inner.iter().filter(|h| !is_our_command(h.get("command"), agent)).cloned().collect();
            if kept.len() == inner.len() {
                return Some(group.clone());
            }
            if kept.is_empty() {
                return None;
            }
            let mut group = group.clone();
            group["hooks"] = Value::Array(kept);
            Some(group)
        })
        .collect()
}

fn groups_install(
    root: &Value,
    agent: &str,
    events: impl IntoIterator<Item = (String, Value)>,
) -> Result<Map<String, Value>, String> {
    let mut root = root_object(root)?;
    let mut hooks = object_at(&root, "hooks")?;
    for (event, group) in events {
        let mut list = without_ours_in_groups(&list_at(&hooks, &event)?, agent);
        list.push(group);
        hooks.insert(event, Value::Array(list));
    }
    root.insert("hooks".into(), Value::Object(hooks));
    Ok(root)
}

fn groups_uninstall(root: &Value, agent: &str) -> Result<Map<String, Value>, String> {
    let mut root = root_object(root)?;
    if !root.contains_key("hooks") {
        return Ok(root);
    }
    let hooks = object_at(&root, "hooks")?;
    let mut out = Map::new();
    for (event, value) in hooks {
        match value.as_array() {
            Some(list) => {
                let kept = without_ours_in_groups(list, agent);
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
    Ok(root)
}

fn groups_have_ours(root: &Value, agent: &str) -> bool {
    let ours = |group: &Value| {
        is_our_command(group.get("command"), agent)
            || group
                .get("hooks")
                .and_then(Value::as_array)
                .is_some_and(|inner| inner.iter().any(|h| is_our_command(h.get("command"), agent)))
    };
    root.get("hooks")
        .and_then(Value::as_object)
        .is_some_and(|hooks| hooks.values().filter_map(Value::as_array).flatten().any(ours))
}

/// The file's top level as an object; anything else is refused, not replaced.
fn root_object(root: &Value) -> Result<Map<String, Value>, String> {
    match root {
        Value::Object(m) => Ok(m.clone()),
        Value::Null => Ok(Map::new()),
        _ => Err("The file isn't a JSON object — Awuuu has not touched it.".into()),
    }
}

// ── Gemini CLI: ~/.gemini/settings.json ───────────────────────────────────────
//
// Claude-style groups with a `*` matcher and timeouts in milliseconds. Gemini
// CLI runs hook commands with PowerShell, hence `& '<exe>'`. The event the
// island should see goes on the command line (the relay also maps Gemini's own
// names). AfterModel is left out: it fires on every response chunk.

/// (Gemini's event, the island's event, timeout in ms)
const GEMINI_EVENTS: &[(&str, &str, u64)] = &[
    ("SessionStart", "SessionStart", 10000),
    ("SessionEnd", "SessionEnd", 10000),
    ("BeforeTool", "PreToolUse", 5000),
    ("AfterTool", "PostToolUse", 5000),
    ("BeforeAgent", "UserPromptSubmit", 5000),
    ("AfterAgent", "Stop", 5000),
];

fn gemini_command(exe: &str, event: &str) -> String {
    format!("& '{}' --agent gemini {event}", exe.replace('\'', "''"))
}

fn gemini_merge(root: &Value, exe: &str) -> Result<Value, String> {
    let events = GEMINI_EVENTS.iter().map(|(theirs, ours, timeout)| {
        (
            theirs.to_string(),
            json!({
                "matcher": "*",
                "hooks": [{ "type": "command", "command": gemini_command(exe, ours), "timeout": timeout }],
            }),
        )
    });
    groups_install(root, "gemini", events).map(Value::Object)
}

fn gemini_remove(root: &Value) -> Result<Value, String> {
    groups_uninstall(root, "gemini").map(Value::Object)
}

fn gemini_installed(root: &Value) -> bool {
    groups_have_ours(root, "gemini")
}

// ── Cursor Agent: ~/.cursor/hooks.json ────────────────────────────────────────
//
// `{"version": 1, "hooks": {"<event>": [{"command": …}]}}` with camelCase
// events. Cursor doesn't document its shell, so the path is bare when it has
// nothing that needs quoting and double-quoted otherwise. Nothing is ever
// printed back: no permission is given on Cursor's behalf.

/// (Cursor's event, the island's event)
const CURSOR_EVENTS: &[(&str, &str)] = &[
    ("sessionStart", "SessionStart"),
    ("sessionEnd", "SessionEnd"),
    ("beforeSubmitPrompt", "UserPromptSubmit"),
    ("preToolUse", "PreToolUse"),
    ("postToolUse", "PostToolUse"),
    ("postToolUseFailure", "PostToolUseFailure"),
    ("stop", "Stop"),
];

fn cursor_command(exe: &str, event: &str) -> String {
    let plain = !exe.is_empty()
        && exe.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '\\' | '/' | ':' | '.' | '_' | '-'));
    if plain {
        format!("{exe} --agent cursor {event}")
    } else {
        format!("\"{exe}\" --agent cursor {event}")
    }
}

fn cursor_merge(root: &Value, exe: &str) -> Result<Value, String> {
    let events = CURSOR_EVENTS
        .iter()
        .map(|(theirs, ours)| (theirs.to_string(), json!({ "command": cursor_command(exe, ours) })));
    let mut root = groups_install(root, "cursor", events)?;
    root.entry("version").or_insert(json!(1));
    Ok(Value::Object(root))
}

fn cursor_remove(root: &Value) -> Result<Value, String> {
    let mut root = groups_uninstall(root, "cursor")?;
    // The file was ours alone (`version` is all that is left): put it back as empty.
    if root.len() == 1 && root.get("version") == Some(&json!(1)) {
        root.clear();
    }
    Ok(Value::Object(root))
}

fn cursor_installed(root: &Value) -> bool {
    groups_have_ours(root, "cursor")
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXE: &str = r"C:\Users\Me\AppData\Local\Awuuu\bin\awuuu-hook.exe";

    fn users() -> Value {
        json!({
            "theme": "dark",
            "hooks": {
                "BeforeTool": [{ "matcher": "write_file", "hooks": [{ "type": "command", "command": "other-tool.exe --check" }] }],
                "preToolUse": [{ "command": "other-tool.exe" }],
                "Notification": [{ "hooks": [{ "type": "command", "command": "notify.exe" }] }]
            }
        })
    }

    #[test]
    fn merge_keeps_the_users_other_hooks_and_is_idempotent() {
        for a in ADAPTERS {
            let base = users();
            let once = (a.merge)(&base, EXE).unwrap();
            assert!((a.installed)(&once), "{} should read as installed", a.id);
            assert!(!(a.installed)(&base));
            assert_eq!(once["theme"], "dark");
            assert_eq!(once["hooks"]["Notification"], base["hooks"]["Notification"]);
            let text = serde_json::to_string(&once).unwrap();
            assert!(text.contains("other-tool.exe"), "{}: user's hook must survive", a.id);
            // Same input, same output; merging again doesn't pile up entries.
            let twice = (a.merge)(&once, EXE).unwrap();
            assert_eq!(once, twice, "{} merge must be idempotent", a.id);
        }
    }

    #[test]
    fn remove_restores_the_original() {
        for a in ADAPTERS {
            for original in [json!({}), users(), json!({ "theme": "dark" })] {
                let merged = (a.merge)(&original, EXE).unwrap();
                let mut back = (a.remove)(&merged).unwrap();
                // Cursor's `"version": 1` may have been added by us; it is
                // harmless and indistinguishable from the user's own, so it stays.
                if let Some(o) = back.as_object_mut() {
                    if original.get("version").is_none() {
                        o.remove("version");
                    }
                }
                assert_eq!(back, original, "{}: remove must restore", a.id);
                assert!(!(a.installed)(&back));
            }
        }
    }

    #[test]
    fn remove_without_ours_changes_nothing() {
        for a in ADAPTERS {
            assert_eq!((a.remove)(&users()).unwrap(), users());
        }
    }

    #[test]
    fn unexpected_shapes_are_refused_not_replaced() {
        for a in ADAPTERS {
            assert!((a.merge)(&json!({ "hooks": [] }), EXE).is_err());
            assert!((a.merge)(&json!({ "hooks": { "BeforeTool": "x", "preToolUse": "x" } }), EXE).is_err());
            assert!((a.merge)(&json!([1, 2]), EXE).is_err());
            assert!((a.remove)(&json!({ "hooks": "x" })).is_err());
        }
    }

    #[test]
    fn invalid_json_is_refused() {
        // The file is parsed by hooks.rs before any adapter sees it.
        assert!(crate::hooks::parse_settings(b"{ broken", "x").is_err());
        assert!(crate::hooks::parse_settings(b"[1]", "x").is_err());
    }

    #[test]
    fn commands_name_the_agent_and_the_event() {
        let g = gemini_command(EXE, "PreToolUse");
        assert!(g.starts_with("& '") && g.ends_with("--agent gemini PreToolUse"), "{g}");
        assert!(gemini_command(r"C:\it's\awuuu-hook.exe", "Stop").contains("it''s"));
        assert_eq!(cursor_command(EXE, "Stop"), format!("{EXE} --agent cursor Stop"));
        assert!(cursor_command(r"C:\Program Files\A\awuuu-hook.exe", "Stop").starts_with('"'));
    }

    #[test]
    fn cursor_keeps_an_existing_version() {
        let out = cursor_merge(&json!({ "version": 2 }), EXE).unwrap();
        assert_eq!(out["version"], 2);
    }

    #[test]
    fn registry_is_findable() {
        assert!(find("Gemini").is_some() && find("cursor").is_some() && find("nope").is_none());
    }
}
