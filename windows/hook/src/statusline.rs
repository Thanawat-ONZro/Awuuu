//! `awuuu-hook --statusline` — Claude Code's status line command.
//!
//! Claude Code pipes a JSON object to its `statusLine` command and shows what
//! the command prints. That object is the only place the plan limits appear
//! (`rate_limits.five_hour`, `rate_limits.seven_day`), so this mode notes them
//! down in `%APPDATA%\Awuuu\claude-limits.json` for the island, then runs the
//! status line the user had before (kept in `statusline.json` by the installer)
//! and prints its output unchanged. With no previous command it prints a short
//! line of its own.
//!
//! No pipe, no network. Same hard rule as the hooks: exit 0, quickly, always.

use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

/// Claude Code's object is a few kilobytes; anything past this is not it.
const MAX_STDIN: u64 = 1024 * 1024;
/// How long the previous status line may take.
const PREVIOUS_TIMEOUT: Duration = Duration::from_secs(4);
/// Whole-run budget, enforced by the main thread whatever the worker is doing.
const TOTAL_BUDGET: Duration = Duration::from_millis(4800);
/// A status line is one line; a runaway command is cut here.
const MAX_OUTPUT: u64 = 64 * 1024;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const LIMITS_FILE: &str = "claude-limits.json";
const SIDECAR_FILE: &str = "statusline.json";

/// `%APPDATA%\Awuuu`, or `AWUUU_CONFIG_DIR` (tests never touch the real one).
fn config_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("AWUUU_CONFIG_DIR").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    std::env::var_os("APPDATA").filter(|v| !v.is_empty()).map(|base| PathBuf::from(base).join("Awuuu"))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Runs the mode and exits 0. The work happens on a thread the main thread
/// gives up on at the deadline, so a stdin that never closes or a status line
/// that hangs cannot hold Claude Code up.
pub fn run() -> ! {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut raw = Vec::new();
        let _ = std::io::stdin().take(MAX_STDIN).read_to_end(&mut raw);
        let _ = tx.send(work(config_dir().as_deref(), &raw, PREVIOUS_TIMEOUT));
    });
    if let Ok(line) = rx.recv_timeout(TOTAL_BUDGET) {
        let mut out = std::io::stdout();
        let _ = out.write_all(&line);
        let _ = out.flush();
    }
    std::process::exit(0);
}

/// Everything but reading stdin and printing: returns the bytes to print.
fn work(dir: Option<&Path>, raw: &[u8], timeout: Duration) -> Vec<u8> {
    let input = parse_input(raw);
    if let (Some(dir), Some(input)) = (dir, input.as_ref()) {
        let path = dir.join(LIMITS_FILE);
        let before = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok());
        if let Some(snap) = snapshot(input, before.as_ref(), now_ms()) {
            let _ = write_atomic(&path, &snap);
        }
    }
    if let Some(command) = dir.and_then(previous_command) {
        if let Some(out) = run_previous(&command, raw, timeout).filter(|o| !o.is_empty()) {
            return out;
        }
    }
    let mut line = input.as_ref().map(own_line).unwrap_or_default();
    if !line.is_empty() {
        line.push('\n');
    }
    line.into_bytes()
}

fn parse_input(raw: &[u8]) -> Option<Value> {
    let raw = raw.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(raw);
    serde_json::from_slice::<Value>(raw).ok().filter(Value::is_object)
}

fn model_name(input: &Value) -> Option<String> {
    let model = input.get("model")?;
    model
        .get("display_name")
        .or_else(|| model.get("id"))
        .and_then(Value::as_str)
        .or_else(|| model.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
}

/// What goes into claude-limits.json, or None when the input has nothing for
/// it. `rate_limits` only shows up once the session has talked to the API, so
/// a refresh without it keeps the numbers already on file (`rateLimitsAt`
/// says how old those are).
fn snapshot(input: &Value, before: Option<&Value>, now: u64) -> Option<Value> {
    let rate = input.get("rate_limits").filter(|v| v.is_object());
    let context = input.get("context_window").filter(|v| v.is_object());
    if rate.is_none() && context.is_none() {
        return None;
    }
    let (rate_limits, rate_at) = match rate {
        Some(r) => (r.clone(), json!(now)),
        None => {
            let kept = before.and_then(|b| b.get("rate_limits")).filter(|v| v.is_object());
            match kept {
                Some(r) => {
                    let at = before.and_then(|b| b.get("rateLimitsAt").or_else(|| b.get("updatedAt")));
                    (r.clone(), at.cloned().unwrap_or(Value::Null))
                }
                None => (Value::Null, Value::Null),
            }
        }
    };
    Some(json!({
        "rate_limits": rate_limits,
        "context_window": context.cloned().unwrap_or(Value::Null),
        "model": model_name(input),
        "session_id": input.get("session_id").and_then(Value::as_str),
        "updatedAt": now,
        "rateLimitsAt": rate_at,
    }))
}

/// `.tmp` next to the file, then a rename: the island never reads half a file.
fn write_atomic(path: &Path, value: &Value) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // Two sessions can refresh at once: each writes its own temp file.
    let temp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    std::fs::write(&temp, value.to_string())?;
    std::fs::rename(&temp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&temp);
    })
}

/// The status line that was configured before ours, if the installer kept one.
fn previous_command(dir: &Path) -> Option<String> {
    let bytes = std::fs::read(dir.join(SIDECAR_FILE)).ok()?;
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
    let v: Value = serde_json::from_slice(bytes).ok()?;
    let previous = v.get("previous")?;
    if previous.get("type").and_then(Value::as_str).is_some_and(|t| t != "command") {
        return None;
    }
    let command = previous.get("command").and_then(Value::as_str)?.trim();
    // Running ourselves would go round in circles.
    (!command.is_empty() && !command.contains("awuuu-hook")).then(|| command.to_string())
}

/// Runs the previous status line through `cmd /C` with the same stdin and
/// returns what it printed; None when it cannot start or takes too long.
fn run_previous(command: &str, stdin: &[u8], timeout: Duration) -> Option<Vec<u8>> {
    let mut child = Command::new("cmd")
        // /D: no AutoRun. /S with the outer quotes: the command reaches cmd as written.
        .raw_arg("/D /S /C")
        .raw_arg(format!("\"{command}\""))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .ok()?;

    // Fed and drained on their own threads so neither pipe can fill up and
    // stall the other.
    if let Some(mut pipe) = child.stdin.take() {
        let bytes = stdin.to_vec();
        std::thread::spawn(move || {
            let _ = pipe.write_all(&bytes);
        });
    }
    let stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut out = Vec::new();
        let _ = stdout.take(MAX_OUTPUT).read_to_end(&mut out);
        let _ = tx.send(out);
    });

    match rx.recv_timeout(timeout) {
        Ok(out) => {
            let _ = child.try_wait();
            Some(out)
        }
        Err(_) => {
            let _ = child.kill();
            None
        }
    }
}

fn percent(input: &Value, window: &str) -> Option<i64> {
    let w = input.get("rate_limits")?.get(window)?;
    let used = w.get("used_percentage").or_else(|| w.get("used_percent"))?.as_f64()?;
    used.is_finite().then(|| used.round().clamp(0.0, 100.0) as i64)
}

/// `● Opus · 5h 23% · week 41%`, leaving out whatever Claude Code didn't send.
fn own_line(input: &Value) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(model) = model_name(input) {
        parts.push(model);
    }
    if let Some(p) = percent(input, "five_hour") {
        parts.push(format!("5h {p}%"));
    }
    if let Some(p) = percent(input, "seven_day") {
        parts.push(format!("week {p}%"));
    }
    if parts.is_empty() {
        return String::new();
    }
    format!("● {}", parts.join(" · "))
}

#[cfg(test)]
mod tests {
    use super::*;

    const INPUT: &str = r#"{"session_id":"abc","model":{"id":"claude-opus-5","display_name":"Opus"},"workspace":{"current_dir":"C:\\p"},"context_window":{"used_percentage":8.2,"context_window_size":200000},"rate_limits":{"five_hour":{"used_percentage":23.4,"resets_at":1790990000},"seven_day":{"used_percentage":41.2,"resets_at":1791400000}}}"#;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("awuuu-statusline-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn val(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn the_line_leaves_out_what_is_missing() {
        assert_eq!(own_line(&val(INPUT)), "● Opus · 5h 23% · week 41%");
        assert_eq!(own_line(&val(r#"{"model":{"display_name":"Sonnet"}}"#)), "● Sonnet");
        assert_eq!(
            own_line(&val(r#"{"model":{"id":"claude-x"},"rate_limits":{"seven_day":{"used_percentage":99.6}}}"#)),
            "● claude-x · week 100%"
        );
        assert_eq!(own_line(&val(r#"{"rate_limits":{"five_hour":{"used_percentage":"lots"}}}"#)), "");
        assert_eq!(own_line(&val("{}")), "");
    }

    #[test]
    fn the_snapshot_keeps_just_what_the_island_reads() {
        let snap = snapshot(&val(INPUT), None, 1234).unwrap();
        assert_eq!(snap["rate_limits"]["five_hour"]["used_percentage"], 23.4);
        assert_eq!(snap["context_window"]["context_window_size"], 200000);
        assert_eq!(snap["model"], "Opus");
        assert_eq!(snap["session_id"], "abc");
        assert_eq!(snap["updatedAt"], 1234);
        assert_eq!(snap["rateLimitsAt"], 1234);
        assert!(snap.get("workspace").is_none());
        // Nothing to note down: no file is written.
        assert!(snapshot(&val(r#"{"model":{"display_name":"Opus"}}"#), Some(&snap), 9).is_none());
    }

    #[test]
    fn a_refresh_without_limits_keeps_the_ones_on_file() {
        let first = snapshot(&val(INPUT), None, 1000).unwrap();
        let fresh_session = val(r#"{"session_id":"new","context_window":{"used_percentage":0}}"#);
        let second = snapshot(&fresh_session, Some(&first), 2000).unwrap();
        assert_eq!(second["rate_limits"], first["rate_limits"]);
        assert_eq!(second["rateLimitsAt"], 1000);
        assert_eq!(second["updatedAt"], 2000);
        assert_eq!(second["session_id"], "new");
        assert_eq!(second["model"], Value::Null);
        // Nothing on file either: no limits, and that is said plainly.
        let alone = snapshot(&fresh_session, None, 2000).unwrap();
        assert_eq!(alone["rate_limits"], Value::Null);
        assert_eq!(alone["rateLimitsAt"], Value::Null);
    }

    #[test]
    fn the_previous_command_comes_from_the_sidecar() {
        let dir = temp("sidecar");
        assert_eq!(previous_command(&dir), None);
        let write = |text: &str| std::fs::write(dir.join(SIDECAR_FILE), text).unwrap();
        write(r#"{"previous":{"type":"command","command":" my-line.cmd --x "}}"#);
        assert_eq!(previous_command(&dir).as_deref(), Some("my-line.cmd --x"));
        write(r#"{"previous":null}"#);
        assert_eq!(previous_command(&dir), None);
        write(r#"{"previous":{"type":"command","command":"\"C:/x/awuuu-hook.exe\" --statusline"}}"#);
        assert_eq!(previous_command(&dir), None, "never ourselves");
        write(r#"{"previous":{"type":"static","command":"x"}}"#);
        assert_eq!(previous_command(&dir), None);
        write("{ broken");
        assert_eq!(previous_command(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn limits_are_written_and_our_line_printed() {
        let dir = temp("write");
        let out = work(Some(&dir), INPUT.as_bytes(), Duration::from_secs(4));
        assert_eq!(String::from_utf8(out).unwrap(), "● Opus · 5h 23% · week 41%\n");
        let saved = val(&std::fs::read_to_string(dir.join(LIMITS_FILE)).unwrap());
        assert_eq!(saved["rate_limits"]["seven_day"]["resets_at"], 1791400000);
        assert!(saved["updatedAt"].as_u64().unwrap() > 1_700_000_000_000);
        // No temp file left behind, and a second refresh replaces the first.
        let names: Vec<String> =
            std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        assert_eq!(names, [LIMITS_FILE]);
        work(Some(&dir), INPUT.replace("23.4", "60").as_bytes(), Duration::from_secs(4));
        assert_eq!(val(&std::fs::read_to_string(dir.join(LIMITS_FILE)).unwrap())["rate_limits"]["five_hour"]["used_percentage"], 60);

        // Garbage and emptiness print nothing and leave the file alone.
        assert!(work(Some(&dir), b"not json", Duration::from_secs(4)).is_empty());
        assert!(work(Some(&dir), b"", Duration::from_secs(4)).is_empty());
        assert!(work(None, b"[1,2]", Duration::from_secs(4)).is_empty());
        assert_eq!(val(&std::fs::read_to_string(dir.join(LIMITS_FILE)).unwrap())["rate_limits"]["five_hour"]["used_percentage"], 60);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_previous_status_line_gets_the_same_stdin_and_its_output_is_printed() {
        let dir = temp("previous");
        // `findstr` echoes the stdin lines that match: proof the input got there.
        std::fs::write(
            dir.join(SIDECAR_FILE),
            r#"{"previous":{"type":"command","command":"echo mine & findstr /C:\"display_name\""}}"#,
        )
        .unwrap();
        let out = String::from_utf8(work(Some(&dir), INPUT.as_bytes(), Duration::from_secs(4))).unwrap();
        assert!(out.starts_with("mine"), "got {out:?}");
        assert!(out.contains(r#""display_name":"Opus""#), "got {out:?}");
        assert!(dir.join(LIMITS_FILE).exists(), "limits are noted down either way");

        // A command that prints nothing, or cannot be found: our own line.
        std::fs::write(dir.join(SIDECAR_FILE), r#"{"previous":{"type":"command","command":"awuuu-no-such-command-xyz"}}"#).unwrap();
        let out = String::from_utf8(work(Some(&dir), INPUT.as_bytes(), Duration::from_secs(4))).unwrap();
        assert_eq!(out, "● Opus · 5h 23% · week 41%\n");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_previous_status_line_that_hangs_is_given_up_on() {
        let started = std::time::Instant::now();
        // Waits five seconds for a signal nobody sends.
        let out = run_previous("waitfor /T 5 AwuuuNeverSent", b"{}", Duration::from_millis(300));
        assert_eq!(out, None);
        assert!(started.elapsed() < Duration::from_secs(3), "took {:?}", started.elapsed());
    }
}
