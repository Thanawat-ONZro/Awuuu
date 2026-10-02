//! awuuu-hook — the relay Claude Code runs on every hook event.
//!
//! Reads the hook JSON on stdin, adds a little terminal context, and hands it to
//! Awuuu over the named pipe `\\.\pipe\awuuu-<sid>`.
//!
//! Hard rule (docs/CLAUDE.md): **never block Claude Code.**
//! * If the pipe does not exist — Awuuu is closed — we exit 0 immediately with
//!   nothing on stdout, and the session carries on untouched.
//! * Every step runs under a deadline enforced by the main thread, so a pipe that
//!   accepts the connection and then stops reading cannot wedge the session
//!   either: we abandon the worker and exit.
//! * Only `PermissionRequest` waits for an answer, because approving from the
//!   island is the whole point. No answer means empty stdout, and Claude Code
//!   asks in the terminal exactly as if Awuuu were not installed.
//!
//! Usage: `awuuu-hook [--agent <claude|agy|hermes|opencode|codex>] <EventName>`
//! (the event name is also read from the JSON). Without `--agent` the caller is
//! Claude Code, which is what installs older than the flag wrote.

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Budget for getting a pipe connection. Beyond this Claude Code wins, always.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(300);
/// Whole-run budget for an event nobody waits on: connect and write, no more.
const FIRE_AND_FORGET_BUDGET: Duration = Duration::from_secs(2);
/// How long a quick question to the island ("anything queued for me?") may take.
const QUERY_BUDGET: Duration = Duration::from_millis(1500);
/// How long a permission prompt may stay on screen before the terminal takes over.
const DECISION_BUDGET: Duration = Duration::from_secs(110);

/// `ERROR_PIPE_BUSY` — every instance is serving someone else right now. This is
/// the one error worth retrying: the server exists and a slot will free up.
const ERROR_PIPE_BUSY: i32 = 231;

/// Fields that are pointless to forward and can be enormous (a whole file read,
/// a full command output). The island never shows them.
const DROPPED_FIELDS: &[&str] = &["tool_response", "transcript_path"];
/// Longest string forwarded for any single field; the island truncates to far
/// less than this anyway.
const MAX_FIELD_LEN: usize = 2_000;

mod win;

/// Set once the island has the event: from then on "no answer" means nobody
/// clicked in time, not that Awuuu is closed.
static REACHED_ISLAND: AtomicBool = AtomicBool::new(false);

/// `\\.\pipe\awuuu-<sid>`. The SID keeps two accounts on the same machine from
/// ever meeting on the same pipe; the name falls back to the user name only if
/// the SID cannot be read at all, which should not happen.
fn pipe_path() -> String {
    let key = win::current_user_sid()
        .unwrap_or_else(|| std::env::var("USERNAME").unwrap_or_else(|_| "user".into()));
    format!(r"\\.\pipe\awuuu-{key}")
}

/// Opens the pipe. Retries only while the server is busy: any other error means
/// there is nothing to talk to, and waiting would only delay Claude Code.
fn connect() -> Option<std::fs::File> {
    use std::os::windows::io::AsRawHandle;
    let path = pipe_path();
    let deadline = Instant::now() + CONNECT_TIMEOUT;
    loop {
        match std::fs::OpenOptions::new().read(true).write(true).open(&path) {
            Ok(file) => {
                let handle = windows::Win32::Foundation::HANDLE(file.as_raw_handle());
                // Somebody else's server on our pipe name gets nothing from us.
                return win::pipe_server_is_same_user(handle).then_some(file);
            }
            Err(err) => {
                if err.raw_os_error() != Some(ERROR_PIPE_BUSY) || Instant::now() >= deadline {
                    return None;
                }
                std::thread::sleep(Duration::from_millis(15));
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Agent {
    Claude,
    Agy,
    Hermes,
    OpenCode,
    Codex,
}

impl Agent {
    fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "claude" => Some(Self::Claude),
            "agy" => Some(Self::Agy),
            "hermes" => Some(Self::Hermes),
            "opencode" => Some(Self::OpenCode),
            "codex" => Some(Self::Codex),
            _ => None,
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Agy => "agy",
            Self::Hermes => "hermes",
            Self::OpenCode => "opencode",
            Self::Codex => "codex",
        }
    }

    /// What the agent waits for on this event.
    fn waits_on(self, event: &str) -> Wait {
        match (self, event) {
            (Self::Agy, "PreToolUse") => Wait::Decision,
            // Prompts typed in the island while AGY works are handed over here.
            (Self::Agy, "PreInvocation" | "Stop") => Wait::Query,
            (Self::Agy, _) => Wait::Nothing,
            (_, "PermissionRequest") => Wait::Decision,
            _ => Wait::Nothing,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Wait {
    /// Fire and forget.
    Nothing,
    /// A human decides in the island (allow / deny / answers).
    Decision,
    /// The island answers at once with JSON to print as-is (queued prompts).
    Query,
}

/// `--agent <id>` and the event name, in any order.
struct Args {
    agent: Option<Agent>,
    event: String,
}

fn parse_args(args: impl IntoIterator<Item = String>) -> Args {
    let mut agent = None;
    let mut event = String::new();
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        if a == "--agent" {
            agent = it.next().as_deref().and_then(Agent::parse);
        } else if let Some(v) = a.strip_prefix("--agent=") {
            agent = Agent::parse(v);
        } else if event.is_empty() && !a.starts_with("--") {
            event = a;
        }
    }
    Args { agent, event }
}

struct HookEvent {
    payload: String,
    event: String,
    agent: Agent,
    /// The tool input as the agent sent it, before truncation: answers go back
    /// as an edited copy of it.
    tool_input: Option<serde_json::Value>,
}

/// What the island decided, as sent over the pipe.
#[derive(Debug, Default, PartialEq)]
struct Answer {
    allow: bool,
    /// Answers to an agent's questions, keyed by question text.
    answers: Option<serde_json::Map<String, serde_json::Value>>,
    reason: Option<String>,
}

/// The island sends a JSON line; builds before 0.3 sent a bare word.
fn parse_answer(line: &str) -> Option<Answer> {
    let line = line.trim();
    let (word, answers, reason) = match serde_json::from_str::<serde_json::Value>(line) {
        Ok(serde_json::Value::Object(o)) => (
            o.get("decision").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
            o.get("answers").and_then(|v| v.as_object()).cloned().filter(|m| !m.is_empty()),
            o.get("reason").and_then(|v| v.as_str()).map(str::to_string).filter(|r| !r.is_empty()),
        ),
        Ok(_) => return None,
        Err(_) => (line.to_string(), None, None),
    };
    let allow = match word.as_str() {
        "allow" | "always" => true,
        "deny" => false,
        _ => return None,
    };
    Some(Answer { allow, answers, reason })
}

fn main() {
    let args = parse_args(std::env::args().skip(1));
    let Some(ev) = read_event(&args) else { std::process::exit(0) };

    let wait = ev.agent.waits_on(&ev.event);
    let waits_for_answer = wait != Wait::Nothing;
    let budget = match wait {
        Wait::Decision => DECISION_BUDGET,
        Wait::Query => QUERY_BUDGET,
        Wait::Nothing => FIRE_AND_FORGET_BUDGET,
    };

    let (tx, rx) = mpsc::channel::<Option<String>>();
    let payload = ev.payload;
    std::thread::spawn(move || {
        let _ = tx.send(talk(&payload, waits_for_answer));
    });

    let reply = rx.recv_timeout(budget).ok().flatten();
    let json = if wait == Wait::Query {
        // Printed as the island wrote it, as long as it is a JSON object.
        Some(
            reply
                .filter(|r| serde_json::from_str::<serde_json::Value>(r).is_ok_and(|v| v.is_object()))
                .unwrap_or_else(|| "{}".to_string()),
        )
    } else if wait == Wait::Decision {
        let answer = reply.as_deref().and_then(parse_answer);
        let shown = REACHED_ISLAND.load(Ordering::Relaxed);
        output_json(ev.agent, answer.as_ref(), ev.tool_input.as_ref(), shown)
    } else if ev.agent == Agent::Agy {
        // AGY parses every hook's stdout as JSON; an empty object changes nothing.
        Some("{}".to_string())
    } else {
        None
    };
    if let Some(json) = json {
        let mut out = std::io::stdout();
        let _ = writeln!(out, "{json}");
        let _ = out.flush();
    }
    std::process::exit(0);
}

/// What the agent reads on stdout. `None` prints nothing: the agent asks in its
/// own UI exactly as if Awuuu were not installed.
fn output_json(
    agent: Agent,
    answer: Option<&Answer>,
    tool_input: Option<&serde_json::Value>,
    shown_in_island: bool,
) -> Option<String> {
    use serde_json::json;
    if agent == Agent::Agy {
        // AGY's hook spec wants a decision every time. With no answer, "ask"
        // hands the call back to AGY's own rules — which in always-proceed
        // mode means it just runs. So when the card *was* on screen and nobody
        // clicked (or "Answer in terminal" was pressed), "force_ask" makes AGY
        // prompt in the terminal instead. Awuuu closed: plain "ask".
        let v = match answer {
            // ask_question has no field for an answer: deny it and tell the
            // agent what the user picked, which it then works from.
            Some(a) if a.allow && a.answers.is_some() => json!({
                "decision": "deny",
                "reason": answers_reason(a.answers.as_ref().unwrap()),
            }),
            Some(a) if a.allow => json!({"decision": "allow"}),
            Some(a) => json!({
                "decision": "deny",
                "reason": a.reason.clone().unwrap_or_else(|| "Denied from Awuuu".into()),
            }),
            None if shown_in_island => json!({"decision": "force_ask"}),
            None => json!({"decision": "ask"}),
        };
        return Some(v.to_string());
    }

    let a = answer?;
    let decision = if a.allow {
        match (&a.answers, tool_input) {
            // AskUserQuestion takes the answers as part of its input, keyed by
            // question text — what Claude Code's own dialog fills in.
            (Some(answers), Some(serde_json::Value::Object(input))) => {
                let mut input = input.clone();
                input.insert("answers".into(), serde_json::Value::Object(answers.clone()));
                json!({"behavior": "allow", "updatedInput": input})
            }
            _ => json!({"behavior": "allow"}),
        }
    } else {
        json!({
            "behavior": "deny",
            "message": a.reason.clone().unwrap_or_else(|| "Denied from Awuuu".into()),
        })
    };
    Some(json!({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": decision}}).to_string())
}

fn answers_reason(answers: &serde_json::Map<String, serde_json::Value>) -> String {
    let lines: Vec<String> = answers
        .iter()
        .map(|(q, a)| format!("{q}: {}", a.as_str().map(str::to_string).unwrap_or_else(|| a.to_string())))
        .collect();
    format!(
        "The user already answered this question in Awuuu (do not ask it again). {}",
        lines.join("; ")
    )
}

/// Reads stdin and returns the payload to forward plus the event name.
fn read_event(args: &Args) -> Option<HookEvent> {
    let mut raw = Vec::new();
    if std::io::stdin().read_to_end(&mut raw).is_err() || raw.is_empty() {
        return None;
    }
    // Some shells hand us a UTF-8 BOM; serde_json would choke on it.
    if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        raw.drain(..3);
    }

    let mut payload = serde_json::from_slice::<serde_json::Value>(&raw).ok()?;
    let map = payload.as_object_mut()?;

    // The installer says who is calling. Old installs don't: their AGY payloads
    // are still recognisable by shape, and everything else was Claude Code.
    let agent = args.agent.unwrap_or_else(|| {
        if map.contains_key("conversationId") || map.contains_key("toolCall") {
            Agent::Agy
        } else {
            Agent::Claude
        }
    });
    map.insert("agent_source".into(), serde_json::Value::String(agent.id().into()));
    if agent == Agent::Agy {
        if let Some(cid) = map.get("conversationId").and_then(|v| v.as_str()) {
            if !map.contains_key("session_id") {
                map.insert("session_id".into(), serde_json::Value::String(cid.into()));
            }
        }
        if let Some(paths) = map.get("workspacePaths").and_then(|v| v.as_array()) {
            if let Some(first) = paths.first().and_then(|v| v.as_str()) {
                if !map.contains_key("cwd") {
                    map.insert("cwd".into(), serde_json::Value::String(first.into()));
                }
            }
        }
        // Gather tool metadata as owned values first (the borrow into `map`
                // must not outlive the `insert`s below — that would trip E0502).
                let (tool_name, tool_input) = {
                    let obj = map.get("toolCall").and_then(|v| v.as_object());
                    match obj {
                        Some(o) => (
                            o.get("name").and_then(|v| v.as_str()).map(str::to_owned),
                            o.get("args").cloned(),
                        ),
                        None => (None, None),
                    }
                };
                if let Some(name) = tool_name {
                    if !map.contains_key("tool_name") {
                        map.insert("tool_name".into(), serde_json::Value::String(name));
                    }
                }
                if let Some(args) = tool_input {
                    if !map.contains_key("tool_input") {
                        map.insert("tool_input".into(), args);
                    }
                }
    }

    // The event name is passed on the command line by the hook command; the JSON
    // usually carries it too. Trust the command line when the JSON is missing it.
    let arg_event = args.event.clone();
    let event = map
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or(arg_event);
    map.insert("hook_event_name".into(), serde_json::Value::String(event.clone()));

    for field in DROPPED_FIELDS {
        map.remove(*field);
    }

    let cwd_missing = map
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(str::is_empty)
        .unwrap_or(true);
    if cwd_missing {
        if let Ok(cwd) = std::env::current_dir() {
            map.insert(
                "cwd".into(),
                serde_json::Value::String(cwd.to_string_lossy().to_string()),
            );
        }
    }

    // Which terminal the session runs in. Unlike macOS, Awuuu on Windows accepts
    // events from every terminal, so this is context only — never a filter.
    for (key, var) in [
        ("term_program", "TERM_PROGRAM"),
        ("wt_session", "WT_SESSION"),
        ("term_session_id", "TERM_SESSION_ID"),
        ("vscode_pid", "VSCODE_PID"),
        ("session_pid", "CLAUDE_CODE_SSE_PORT"),
    ] {
        if !map.contains_key(key) {
            let value = std::env::var(var).unwrap_or_default();
            map.insert(key.into(), serde_json::Value::String(value));
        }
    }

    let tool_input = map.get("tool_input").cloned();

    truncate_strings(&mut payload);

    let mut line = payload.to_string();
    line.push('\n');
    Some(HookEvent { payload: line, event, agent, tool_input })
}

/// Caps every string in the payload. A single Write can carry a whole file.
fn truncate_strings(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(s) => {
            if s.len() > MAX_FIELD_LEN {
                // Cut on a char boundary; a lone byte index can split UTF-8.
                let mut end = MAX_FIELD_LEN;
                while end > 0 && !s.is_char_boundary(end) {
                    end -= 1;
                }
                s.truncate(end);
                s.push('…');
            }
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(truncate_strings),
        serde_json::Value::Object(map) => map.values_mut().for_each(truncate_strings),
        _ => {}
    }
}

/// Connect, send, and — for a permission request — wait for the island's word.
fn talk(payload: &str, waits_for_answer: bool) -> Option<String> {
    let mut pipe = connect()?;

    if pipe.write_all(payload.as_bytes()).is_err() {
        return None;
    }
    let _ = pipe.flush();
    REACHED_ISLAND.store(true, Ordering::Relaxed);

    if !waits_for_answer {
        return None;
    }

    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        match pipe.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.contains(&b'\n') {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let answer = String::from_utf8_lossy(&buf).trim().to_string();
    (!answer.is_empty()).then_some(answer)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out(agent: Agent, line: &str, input: Option<serde_json::Value>) -> Option<String> {
        output_json(agent, parse_answer(line).as_ref(), input.as_ref(), true)
    }

    fn val(s: &str) -> serde_json::Value {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn claude_decisions_match_the_documented_shape() {
        assert_eq!(
            val(&out(Agent::Claude, "allow", None).unwrap()),
            serde_json::json!({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}})
        );
        assert_eq!(
            val(&out(Agent::Claude, r#"{"decision":"deny"}"#, None).unwrap()),
            serde_json::json!({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "deny", "message": "Denied from Awuuu"}}})
        );
        // "always" is an island concept; Claude Code just gets an allow.
        assert!(out(Agent::Claude, "always", None).unwrap().contains(r#""behavior":"allow""#));
    }

    #[test]
    fn answers_go_back_inside_the_tool_input() {
        let input = serde_json::json!({"questions": [{"question": "Which?", "options": []}]});
        let json = out(
            Agent::Claude,
            r#"{"decision":"allow","answers":{"Which?":"Blue"}}"#,
            Some(input),
        )
        .unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        let d = &v["hookSpecificOutput"]["decision"];
        assert_eq!(d["behavior"], "allow");
        assert_eq!(d["updatedInput"]["answers"]["Which?"], "Blue");
        assert_eq!(d["updatedInput"]["questions"][0]["question"], "Which?");
    }

    #[test]
    fn agy_always_gets_a_decision() {
        assert_eq!(out(Agent::Agy, "allow", None).unwrap(), r#"{"decision":"allow"}"#);
        assert_eq!(
            val(&out(Agent::Agy, r#"{"decision":"deny","reason":"no"}"#, None).unwrap()),
            serde_json::json!({"decision": "deny", "reason": "no"})
        );
        // Awuuu closed: AGY's own rules. On screen but unanswered: AGY must ask.
        assert_eq!(output_json(Agent::Agy, None, None, false).unwrap(), r#"{"decision":"ask"}"#);
        assert_eq!(output_json(Agent::Agy, None, None, true).unwrap(), r#"{"decision":"force_ask"}"#);
        // Answers to ask_question go back as the reason of a deny.
        let v = val(&out(Agent::Agy, r#"{"decision":"allow","answers":{"Which color?":"Red"}}"#, None).unwrap());
        assert_eq!(v["decision"], "deny");
        assert!(v["reason"].as_str().unwrap().ends_with("Which color?: Red"));
    }

    #[test]
    fn anything_unrecognised_prints_nothing() {
        assert!(out(Agent::Claude, "", None).is_none());
        assert!(out(Agent::Claude, "maybe", None).is_none());
        // The shape the app used to send must not be mistaken for a decision.
        assert!(out(Agent::Claude, r#"{"permissionDecision":"allow"}"#, None).is_none());
    }

    #[test]
    fn agent_flag_in_any_position() {
        let a = parse_args(["--agent".into(), "agy".into(), "PreToolUse".into()]);
        assert_eq!((a.agent, a.event.as_str()), (Some(Agent::Agy), "PreToolUse"));
        let a = parse_args(["Stop".into(), "--agent=hermes".into()]);
        assert_eq!((a.agent, a.event.as_str()), (Some(Agent::Hermes), "Stop"));
        let a = parse_args(["SessionStart".into()]);
        assert_eq!((a.agent, a.event.as_str()), (None, "SessionStart"));
    }

    #[test]
    fn long_strings_are_cut_on_a_char_boundary() {
        let mut v = serde_json::json!({ "tool_input": { "content": "é".repeat(4000) } });
        truncate_strings(&mut v);
        let s = v["tool_input"]["content"].as_str().unwrap();
        assert!(s.len() <= MAX_FIELD_LEN + 4);
        assert!(s.ends_with('…'));
    }
}
