// Plan limits of the connected agents, read from files on this PC.
//
// Nothing here talks to the network, and nothing polls: the island asks when it
// wants fresh numbers and the answer is cached for a few seconds.
//
//   Codex:  every `token_count` event in a session rollout
//           (~/.codex/sessions/YYYY/MM/DD/*.jsonl) carries `rate_limits` with a
//           `primary` and a `secondary` window. The newest one wins.
//   Claude: Claude Code hands its limits to the status line command. Once
//           `awuuu-hook --statusline` is that command it leaves them in
//           %APPDATA%\Awuuu\claude-limits.json, which is all we read.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

use crate::{hooks, settings};

/// How many rollouts to look at, newest first.
const MAX_FILES: usize = 12;
/// How far back to go looking for them.
const MAX_DAYS: i64 = 7;
/// Only the end of a rollout is read: the newest numbers are there.
const TAIL_BYTES: u64 = 1024 * 1024;
/// `usage_read` answers from memory for this long.
const CACHE_FOR: Duration = Duration::from_secs(5);

pub const CLAUDE_LIMITS_FILE: &str = "claude-limits.json";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimit {
    /// "5-hour", "Week", "Month"…
    pub label: String,
    /// 0–100.
    pub used_percent: f64,
    /// Epoch ms; None when unknown or already reset.
    pub resets_at: Option<i64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsage {
    pub agent: String,
    pub plan: Option<String>,
    pub limits: Vec<UsageLimit>,
    pub updated_at: Option<i64>,
    /// Set when something must be installed first: "statusline".
    pub setup: Option<String>,
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn mtime_ms(path: &Path) -> Option<i64> {
    let t = std::fs::metadata(path).ok()?.modified().ok()?;
    t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as i64)
}

// ── Normalising ───────────────────────────────────────────────────────────────

/// Days since 1970-01-01 of a calendar date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// "2026-10-02T23:29:33.882Z" → epoch ms. Offsets other than Z are honoured.
fn parse_iso_ms(s: &str) -> Option<i64> {
    let b = s.trim().as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || (b[10] != b'T' && b[10] != b' ') {
        return None;
    }
    let num = |from: usize, to: usize| std::str::from_utf8(&b[from..to]).ok()?.parse::<i64>().ok();
    let (y, mo, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (h, mi, sec) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    let mut i = 19;
    let mut millis = 0i64;
    if b.get(i) == Some(&b'.') {
        i += 1;
        let start = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        let frac = std::str::from_utf8(&b[start..i.min(start + 3)]).ok()?;
        millis = format!("{frac:0<3}").parse().ok()?;
    }
    let mut offset_min = 0i64;
    if let Some(&sign) = b.get(i).filter(|c| **c == b'+' || **c == b'-') {
        let rest = std::str::from_utf8(&b[i + 1..]).ok()?.replace(':', "");
        if rest.len() >= 4 {
            let hh: i64 = rest[..2].parse().ok()?;
            let mm: i64 = rest[2..4].parse().ok()?;
            offset_min = (hh * 60 + mm) * if sign == b'-' { -1 } else { 1 };
        }
    }
    let days = days_from_civil(y, mo, d);
    Some((days * 86_400 + h * 3600 + mi * 60 + sec - offset_min * 60) * 1000 + millis)
}

/// A reset time as the agents write it: epoch seconds, epoch ms or ISO text.
fn time_ms(v: Option<&Value>) -> Option<i64> {
    match v? {
        Value::Number(n) => {
            let f = n.as_f64()?;
            if f <= 0.0 {
                None
            } else if f < 1e12 {
                Some((f * 1000.0) as i64)
            } else {
                Some(f as i64)
            }
        }
        Value::String(s) => match s.trim().parse::<f64>() {
            Ok(f) if f > 0.0 => Some(if f < 1e12 { (f * 1000.0) as i64 } else { f as i64 }),
            Ok(_) => None,
            Err(_) => parse_iso_ms(s),
        },
        _ => None,
    }
}

/// 300 → "5-hour", 1440 → "Day", 10080 → "Week", about 43200 → "Month".
pub fn window_label(minutes: u64) -> String {
    match minutes {
        300 => "5-hour".into(),
        1440 => "Day".into(),
        10_080 => "Week".into(),
        // 28 to 31 days.
        40_320..=44_640 => "Month".into(),
        m if m >= 2880 && m % 1440 == 0 => format!("{}-day", m / 1440),
        m => format!("{}-hour", ((m as f64) / 60.0).round().max(1.0) as u64),
    }
}

/// A window whose reset time has passed is empty again, whatever was written.
fn normalise(label: String, used: f64, resets_at: Option<i64>, now: i64) -> UsageLimit {
    let used = if used.is_finite() { used.clamp(0.0, 100.0) } else { 0.0 };
    match resets_at {
        Some(at) if at <= now => UsageLimit { label, used_percent: 0.0, resets_at: None },
        _ => UsageLimit { label, used_percent: used, resets_at },
    }
}

// ── Codex ─────────────────────────────────────────────────────────────────────

fn is_rate_limits(v: &Value) -> bool {
    v.get("primary").is_some_and(Value::is_object) || v.get("secondary").is_some_and(Value::is_object)
}

/// `payload.rate_limits` where Codex puts it today, else anywhere in the line.
fn find_rate_limits(v: &Value) -> Option<&Value> {
    if let Some(r) = v.get("payload").and_then(|p| p.get("rate_limits")).filter(|r| is_rate_limits(r)) {
        return Some(r);
    }
    match v {
        Value::Object(map) => {
            if let Some(r) = map.get("rate_limits").filter(|r| is_rate_limits(r)) {
                return Some(r);
            }
            map.values().find_map(find_rate_limits)
        }
        Value::Array(items) => items.iter().find_map(find_rate_limits),
        _ => None,
    }
}

fn codex_window(w: Option<&Value>, default_minutes: u64, written: i64, now: i64) -> Option<UsageLimit> {
    let w = w.filter(|w| w.is_object())?;
    let used = w.get("used_percent").and_then(Value::as_f64)?;
    let minutes = w
        .get("window_minutes")
        .and_then(Value::as_f64)
        .filter(|m| *m >= 1.0)
        .map(|m| m as u64)
        .unwrap_or(default_minutes);
    // Older Codex builds wrote how long is left instead of when.
    let resets_at = time_ms(w.get("resets_at")).or_else(|| {
        w.get("resets_in_seconds").and_then(Value::as_f64).map(|s| written + (s * 1000.0) as i64)
    });
    Some(normalise(window_label(minutes), used, resets_at, now))
}

/// One rollout line → Codex's limits, when the line carries them.
fn parse_codex_line(line: &str, fallback_ms: i64, now: i64) -> Option<AgentUsage> {
    if !line.contains("\"rate_limits\"") {
        return None;
    }
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    let limits_json = find_rate_limits(&v)?;
    let written = v.get("timestamp").and_then(Value::as_str).and_then(parse_iso_ms).unwrap_or(fallback_ms);
    let limits: Vec<UsageLimit> = [
        codex_window(limits_json.get("primary"), 300, written, now),
        codex_window(limits_json.get("secondary"), 10_080, written, now),
    ]
    .into_iter()
    .flatten()
    .collect();
    if limits.is_empty() {
        return None;
    }
    Some(AgentUsage {
        agent: "codex".into(),
        plan: limits_json.get("plan_type").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string),
        limits,
        updated_at: Some(written),
        setup: None,
    })
}

/// The newest limits in a piece of rollout: lines are walked backwards.
fn parse_codex_text(text: &str, fallback_ms: i64, now: i64) -> Option<AgentUsage> {
    text.lines().rev().find_map(|line| parse_codex_line(line, fallback_ms, now))
}

fn read_tail(path: &Path) -> Option<String> {
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    if len > TAIL_BYTES {
        file.seek(SeekFrom::Start(len - TAIL_BYTES)).ok()?;
    }
    let mut bytes = Vec::new();
    file.take(TAIL_BYTES).read_to_end(&mut bytes).ok()?;
    // A cut in the middle of a line (or of a character) only spoils that line.
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn numbered_dirs(dir: &Path) -> Vec<(i64, PathBuf)> {
    let mut out: Vec<(i64, PathBuf)> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let n = e.file_name().to_str()?.parse::<i64>().ok()?;
            e.path().is_dir().then(|| (n, e.path()))
        })
        .collect();
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out
}

/// Rollouts of the last week, newest day first, until there are enough; then
/// the newest of those by modification time.
fn codex_files(sessions: &Path, today_days: i64) -> Vec<(i64, PathBuf)> {
    let mut found: Vec<(i64, PathBuf)> = Vec::new();
    'days: for (y, ydir) in numbered_dirs(sessions) {
        for (m, mdir) in numbered_dirs(&ydir) {
            for (d, ddir) in numbered_dirs(&mdir) {
                let age = today_days - days_from_civil(y, m, d);
                if age > MAX_DAYS {
                    break 'days;
                }
                for entry in std::fs::read_dir(&ddir).into_iter().flatten().flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                        if let Some(at) = mtime_ms(&path) {
                            found.push((at, path));
                        }
                    }
                }
                if found.len() >= MAX_FILES {
                    break 'days;
                }
            }
        }
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.truncate(MAX_FILES);
    found
}

/// Codex's limits from its session files, or an entry with no limits when no
/// recent session wrote any.
fn codex_usage(sessions: &Path, now: i64) -> AgentUsage {
    // A day of slack covers the time zone: folders are named in local time.
    let today_days = now.div_euclid(86_400_000) + 1;
    codex_files(sessions, today_days)
        .into_iter()
        .filter_map(|(mtime, path)| parse_codex_text(&read_tail(&path)?, mtime, now))
        .max_by_key(|u| u.updated_at)
        .unwrap_or(AgentUsage { agent: "codex".into(), plan: None, limits: Vec::new(), updated_at: None, setup: None })
}

// ── Claude ────────────────────────────────────────────────────────────────────

fn claude_window(v: Option<&Value>, label: &str, now: i64) -> Option<UsageLimit> {
    let w = v.filter(|w| w.is_object())?;
    let used = w.get("used_percentage").or_else(|| w.get("used_percent")).and_then(Value::as_f64)?;
    Some(normalise(label.into(), used, time_ms(w.get("resets_at")), now))
}

/// What `awuuu-hook --statusline` left in claude-limits.json.
fn parse_claude_limits(text: &str, fallback_ms: Option<i64>, now: i64) -> Option<AgentUsage> {
    let v: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    let rate = v.get("rate_limits");
    let limits: Vec<UsageLimit> = [
        claude_window(rate.and_then(|r| r.get("five_hour")), "5-hour", now),
        claude_window(rate.and_then(|r| r.get("seven_day")), "Week", now),
    ]
    .into_iter()
    .flatten()
    .collect();
    Some(AgentUsage {
        agent: "claude".into(),
        plan: None,
        limits,
        // `rateLimitsAt`: when Claude Code last sent the limits themselves.
        updated_at: time_ms(v.get("rateLimitsAt")).or_else(|| time_ms(v.get("updatedAt"))).or(fallback_ms),
        setup: None,
    })
}

/// Claude's limits. Without the file: `setup: "statusline"` unless the status
/// line is already ours (then Claude Code just hasn't reported limits yet).
fn claude_usage(config_dir: &Path, statusline_installed: bool, now: i64) -> AgentUsage {
    let path = config_dir.join(CLAUDE_LIMITS_FILE);
    let parsed = std::fs::read_to_string(&path).ok().and_then(|t| parse_claude_limits(&t, mtime_ms(&path), now));
    parsed.unwrap_or(AgentUsage {
        agent: "claude".into(),
        plan: None,
        limits: Vec::new(),
        updated_at: None,
        setup: (!statusline_installed).then(|| "statusline".to_string()),
    })
}

// ── Public API ────────────────────────────────────────────────────────────────

static CACHE: Mutex<Option<(Instant, Vec<AgentUsage>)>> = Mutex::new(None);

/// Limits of the agents whose hooks are installed — the connected ones.
pub fn read() -> Vec<AgentUsage> {
    if let Some((at, cached)) = CACHE.lock().unwrap().as_ref() {
        if at.elapsed() < CACHE_FOR {
            return cached.clone();
        }
    }
    let now = now_ms();
    let mut out = Vec::new();
    if hooks::status_for(hooks::HookAgent::Claude).installed {
        out.push(claude_usage(&settings::config_dir(), hooks::statusline_status().installed, now));
    }
    if hooks::status_for(hooks::HookAgent::Codex).installed {
        out.push(codex_usage(&hooks::codex_home().join("sessions"), now));
    }
    *CACHE.lock().unwrap() = Some((Instant::now(), out.clone()));
    out
}

/// Installing or removing the status line changes what `read` answers.
pub fn forget_cache() {
    *CACHE.lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-10-03T00:00:00Z.
    const NOW: i64 = 1_790_985_600_000;

    /// The line found on this machine (Codex 2026-10, free plan).
    const REAL: &str = r#"{"timestamp":"2026-10-02T23:29:33.882Z","ordinal":10,"type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"limit_id":"codex","limit_name":null,"primary":{"used_percent":4.0,"window_minutes":43200,"resets_at":1792428108},"secondary":null,"credits":{"has_credits":false,"unlimited":false,"balance":null},"individual_limit":null,"spend_control_reached":null,"plan_type":"free","rate_limit_reached_type":null}}}"#;

    #[test]
    fn iso_timestamps_become_epoch_ms() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso_ms("2026-10-03T00:00:00Z"), Some(NOW));
        assert_eq!(parse_iso_ms("2026-10-02T23:29:33.882Z"), Some(NOW - 1_826_118));
        assert_eq!(parse_iso_ms("2026-10-03T07:00:00+07:00"), Some(NOW));
        assert_eq!(parse_iso_ms("2026-10-03T00:00:00.5Z"), Some(NOW + 500));
        assert_eq!(parse_iso_ms("yesterday"), None);
    }

    #[test]
    fn windows_are_named_by_their_length() {
        assert_eq!(window_label(300), "5-hour");
        assert_eq!(window_label(1440), "Day");
        assert_eq!(window_label(10_080), "Week");
        assert_eq!(window_label(43_200), "Month");
        assert_eq!(window_label(44_640), "Month");
        assert_eq!(window_label(180), "3-hour");
        assert_eq!(window_label(4320), "3-day");
        assert_eq!(window_label(2000), "33-hour");
    }

    #[test]
    fn the_real_codex_line_parses() {
        let u = parse_codex_line(REAL, 0, NOW).expect("limits");
        assert_eq!(u.agent, "codex");
        assert_eq!(u.plan.as_deref(), Some("free"));
        assert_eq!(u.updated_at, Some(NOW - 1_826_118));
        assert_eq!(
            u.limits,
            vec![UsageLimit { label: "Month".into(), used_percent: 4.0, resets_at: Some(1_792_428_108_000) }]
        );
    }

    #[test]
    fn both_windows_with_defaults_and_a_passed_reset() {
        let line = r#"{"type":"event_msg","payload":{"rate_limits":{"primary":{"used_percent":61.5,"resets_at":1790989200},"secondary":{"used_percent":88,"resets_at":1790000000},"plan_type":"plus"}}}"#;
        let u = parse_codex_line(line, 42, NOW).unwrap();
        // No timestamp on the line: the file's time stands in.
        assert_eq!(u.updated_at, Some(42));
        assert_eq!(u.plan.as_deref(), Some("plus"));
        assert_eq!(u.limits[0], UsageLimit { label: "5-hour".into(), used_percent: 61.5, resets_at: Some(1_790_989_200_000) });
        // The week already reset: empty again, no time to show.
        assert_eq!(u.limits[1], UsageLimit { label: "Week".into(), used_percent: 0.0, resets_at: None });
    }

    #[test]
    fn rate_limits_are_found_wherever_they_sit() {
        let line = r#"{"timestamp":"2026-10-03T00:00:00Z","msg":{"deep":[{"rate_limits":{"secondary":{"used_percent":12,"window_minutes":10080,"resets_at":1791000000000}}}]}}"#;
        let u = parse_codex_line(line, 0, NOW).unwrap();
        assert_eq!(u.limits, vec![UsageLimit { label: "Week".into(), used_percent: 12.0, resets_at: Some(1_791_000_000_000) }]);
        assert_eq!(u.plan, None);
        // Seconds left instead of a time, as older builds wrote.
        let old = r#"{"timestamp":"2026-10-03T00:00:00Z","payload":{"rate_limits":{"primary":{"used_percent":7,"window_minutes":300,"resets_in_seconds":60}}}}"#;
        assert_eq!(parse_codex_line(old, 0, NOW).unwrap().limits[0].resets_at, Some(NOW + 60_000));
    }

    #[test]
    fn lines_without_usable_limits_are_skipped() {
        assert!(parse_codex_line(r#"{"payload":{"type":"token_count"}}"#, 0, NOW).is_none());
        assert!(parse_codex_line(r#"{"payload":{"rate_limits":{"primary":null,"secondary":null}}}"#, 0, NOW).is_none());
        assert!(parse_codex_line(r#"{"payload":{"rate_limits":null}}"#, 0, NOW).is_none());
        assert!(parse_codex_line(r#"…"rate_limits" cut in half"#, 0, NOW).is_none());
    }

    #[test]
    fn the_last_line_with_limits_wins() {
        let older = REAL.replace("4.0", "1.0");
        let text = format!("{older}\n{REAL}\n{{\"type\":\"response_item\"}}\n");
        assert_eq!(parse_codex_text(&text, 0, NOW).unwrap().limits[0].used_percent, 4.0);
    }

    #[test]
    fn out_of_range_numbers_are_clamped() {
        assert_eq!(normalise("x".into(), 140.0, None, NOW).used_percent, 100.0);
        assert_eq!(normalise("x".into(), -3.0, None, NOW).used_percent, 0.0);
        assert_eq!(normalise("x".into(), f64::NAN, None, NOW).used_percent, 0.0);
    }

    #[test]
    fn claude_limits_file_gives_five_hour_and_week() {
        let text = r#"{"rate_limits":{"five_hour":{"used_percentage":23.5,"resets_at":1790990000},"seven_day":{"used_percentage":41,"resets_at":"2026-10-08T00:00:00Z"}},"context_window":{"used_percentage":8},"model":"Opus","session_id":"s","updatedAt":1790985000000}"#;
        let u = parse_claude_limits(text, None, NOW).unwrap();
        assert_eq!(u.agent, "claude");
        assert_eq!(u.updated_at, Some(1_790_985_000_000));
        assert_eq!(u.setup, None);
        assert_eq!(u.limits[0], UsageLimit { label: "5-hour".into(), used_percent: 23.5, resets_at: Some(1_790_990_000_000) });
        assert_eq!(u.limits[1], UsageLimit { label: "Week".into(), used_percent: 41.0, resets_at: Some(NOW + 5 * 86_400_000) });
        // Only a context window (an API-key session): no limits, no setup step.
        let u = parse_claude_limits(r#"{"context_window":{"used_percentage":8}}"#, Some(7), NOW).unwrap();
        assert!(u.limits.is_empty());
        assert_eq!(u.updated_at, Some(7));
    }

    /// Reads (never writes) this machine's Codex sessions and prints what they
    /// parse to: `cargo test -p awuuu real_codex -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_codex_sessions_parse() {
        let sessions = hooks::codex_home().join("sessions");
        let now = now_ms();
        let files = codex_files(&sessions, now.div_euclid(86_400_000) + 1);
        println!("{} file(s) under {}", files.len(), sessions.display());
        println!("{}", serde_json::to_string_pretty(&codex_usage(&sessions, now)).unwrap());
    }

    #[test]
    fn files_are_read_from_temp_folders() {
        let tmp = std::env::temp_dir().join(format!("awuuu-usage-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);

        // Claude: no file yet.
        std::fs::create_dir_all(&tmp).unwrap();
        let missing = claude_usage(&tmp, false, NOW);
        assert_eq!(missing.setup.as_deref(), Some("statusline"));
        assert!(missing.limits.is_empty());
        assert_eq!(claude_usage(&tmp, true, NOW).setup, None);
        std::fs::write(
            tmp.join(CLAUDE_LIMITS_FILE),
            r#"{"rate_limits":{"five_hour":{"used_percentage":50,"resets_at":1790990000}},"updatedAt":1790985000000}"#,
        )
        .unwrap();
        let got = claude_usage(&tmp, false, NOW);
        assert_eq!(got.setup, None);
        assert_eq!(got.limits[0].used_percent, 50.0);

        // Codex: a recent day is read, a day from long ago is not.
        let sessions = tmp.join("sessions");
        let recent = sessions.join("2026").join("10").join("02");
        let ancient = sessions.join("2026").join("08").join("14");
        std::fs::create_dir_all(&recent).unwrap();
        std::fs::create_dir_all(&ancient).unwrap();
        std::fs::write(ancient.join("rollout-old.jsonl"), REAL.replace("4.0", "99.0")).unwrap();
        assert!(codex_usage(&sessions, NOW).limits.is_empty());
        std::fs::write(recent.join("rollout-a.jsonl"), format!("{{\"type\":\"session_meta\"}}\n{REAL}\n")).unwrap();
        std::fs::write(recent.join("notes.txt"), REAL.replace("4.0", "77.0")).unwrap();
        let codex = codex_usage(&sessions, NOW);
        assert_eq!(codex.plan.as_deref(), Some("free"));
        assert_eq!(codex.limits[0].used_percent, 4.0);
        assert_eq!(codex.limits[0].label, "Month");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
