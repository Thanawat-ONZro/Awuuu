// Talking to an agent session from the island: the prompt box on a session
// card in the Agents hub. Each agent has its own way in; only AGY for now.
//
// AGY: `agy agentapi send-message` only works from inside a running agy (it
// needs the language-server address agy gives its own tools), so instead:
//   * while the session works, the prompt is queued here and handed over by
//     awuuu-hook at the next PreInvocation (as a user message) or at Stop (as a
//     reason to continue) — see pipe.rs;
//   * while it is idle, `agy --conversation <id> -p <text>` resumes the same
//     conversation headless in its folder; its hooks show the progress.

use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static QUEUE: Mutex<Option<HashMap<String, Vec<String>>>> = Mutex::new(None);

/// What happened to a prompt.
#[derive(serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Sent {
    /// The session is busy: delivered at its next step.
    Queued,
    /// The session was idle: resumed with this prompt.
    Started,
}

/// Holds a prompt for a busy AGY session until its next step.
fn queue(session: &str, text: &str) -> Sent {
    let mut q = QUEUE.lock().unwrap();
    q.get_or_insert_with(HashMap::new)
        .entry(session.to_string())
        .or_default()
        .push(text.to_string());
    crate::log::line(format!("queued a prompt for agy {session}"));
    Sent::Queued
}

/// Sends `text` to the conversation `session` of `agent`.
pub fn send(app: &tauri::AppHandle, agent: &str, session: &str, text: &str, cwd: Option<&str>, busy: bool) -> Result<Sent, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("Nothing to send.".into());
    }
    match agent {
        // Hermes: a run in that session (the Runs API loads its history); the
        // run's steps and answer come back through the island's hook events.
        "hermes" => {
            let (app, session, text) = (app.clone(), session.to_string(), text.to_string());
            tauri::async_runtime::spawn(async move {
                let on_delta = |_: &str| {};
                match crate::hermes::run_turn(&app, &session, &text, None, &on_delta).await {
                    Ok(_) => {}
                    Err(crate::hermes::RunError::Failed(e)) => crate::log::line(format!("hermes send {session}: {e}")),
                    Err(crate::hermes::RunError::Unsupported) => {
                        crate::log::line("hermes send: this Hermes has no Runs API".to_string())
                    }
                }
            });
            Ok(Sent::Started)
        }
        "agy" => {
            if busy {
                return Ok(queue(session, text));
            }
            let exe = agy_exe().ok_or("Antigravity CLI (agy) is not installed.")?;
            let mut cmd = Command::new(exe);
            cmd.args(["--conversation", session, "-p", text])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW);
            if let Some(dir) = cwd.filter(|d| std::path::Path::new(d).is_dir()) {
                cmd.current_dir(dir);
            }
            let mut child = cmd.spawn().map_err(|e| format!("Can't run agy: {e}"))?;
            crate::log::line(format!("resumed agy {session} with a prompt"));
            // Reap it so it does not linger as a zombie handle.
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            Ok(Sent::Started)
        }
        other => Err(format!("Sending prompts to {other} is not supported yet.")),
    }
}

/// Everything queued for `session`, joined, and forgets it.
pub fn take_queued(session: &str) -> Option<String> {
    let mut q = QUEUE.lock().unwrap();
    let list = q.as_mut()?.remove(session)?;
    (!list.is_empty()).then(|| list.join("\n\n"))
}

/// The installer puts agy in %LOCALAPPDATA%\agy\bin; fall back to PATH.
fn agy_exe() -> Option<PathBuf> {
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let p = PathBuf::from(local).join("agy").join("bin").join("agy.exe");
        if p.exists() {
            return Some(p);
        }
    }
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path)
            .map(|d| d.join("agy.exe"))
            .find(|p| p.exists())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_prompts_are_handed_over_once() {
        assert!(matches!(queue("s1", "first"), Sent::Queued));
        assert!(matches!(queue("s1", "second"), Sent::Queued));
        assert_eq!(take_queued("s1").as_deref(), Some("first\n\nsecond"));
        assert_eq!(take_queued("s1"), None);
    }
}
