// What the agents did, kept on this PC for the dashboard.
//
// %APPDATA%\Awuuu\history.json: { "version": 1, "entries": [...], "sessions": {...} }.
// The island reports entries as hook events arrive; they live in memory and are
// written two seconds after the last change by a single task that ends once
// the file is up to date — nothing runs while nothing happens.
//
// Turned off in Settings (`historyEnabled`), nothing is recorded or written;
// a file that is already there stays until "Clear" removes it.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Deserializer, Serialize};

/// Never more entries than this; the oldest go first.
const MAX_ENTRIES: usize = 5000;
/// Longest `detail` kept, in characters (head and tail survive).
const MAX_DETAIL: usize = 3000;
const DETAIL_HEAD: usize = 2000;
/// How long after the last change the file is written.
const WRITE_AFTER: Duration = Duration::from_secs(2);
const DAY_MS: i64 = 86_400_000;

/// JavaScript sends whole numbers, but nothing stops it from sending 12.0.
fn de_int<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    Ok(f64::deserialize(d)?.round() as i64)
}

fn de_opt_int<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
    Ok(Option::<f64>::deserialize(d)?.map(|f| f.round() as i64))
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct FileRef {
    pub path: String,
    /// "read" | "edit" | "write" | "delete"
    pub change: String,
}

/// One thing an agent did (bridge.ts `HistoryEntry`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Entry {
    pub id: String,
    #[serde(default)]
    pub session: String,
    #[serde(default)]
    pub agent: String,
    /// Epoch ms.
    #[serde(deserialize_with = "de_int")]
    pub at: i64,
    pub kind: String,
    #[serde(default)]
    pub tool: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<FileRef>>,
    pub status: String,
    #[serde(default, deserialize_with = "de_opt_int", skip_serializing_if = "Option::is_none")]
    pub ms: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct SessionInfo {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// What `history_query` answers.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct HistoryData {
    #[serde(default)]
    pub entries: Vec<Entry>,
    #[serde(default)]
    pub sessions: HashMap<String, SessionInfo>,
}

#[derive(Serialize, Deserialize)]
struct OnDisk {
    version: u32,
    #[serde(flatten)]
    data: HistoryData,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Info {
    pub path: String,
    pub bytes: u64,
    pub entries: usize,
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Keeps the start and the end of a long text: a command's output says what it
/// was at the top and how it went at the bottom.
fn clip_detail(text: &str) -> String {
    let count = text.chars().count();
    if count <= MAX_DETAIL {
        return text.to_string();
    }
    const GAP: &str = "\n…\n";
    let tail = MAX_DETAIL - DETAIL_HEAD - GAP.chars().count();
    let head: String = text.chars().take(DETAIL_HEAD).collect();
    let end: String = text.chars().skip(count - tail).collect();
    format!("{head}{GAP}{end}")
}

fn settled(status: &str) -> bool {
    matches!(status, "ok" | "failed")
}

/// A later report of the same thing lands on top of the earlier one. What the
/// later one leaves empty keeps its earlier value, the entry keeps the time it
/// started at, and a result is never turned back into "running".
fn merge(old: &mut Entry, new: Entry) {
    if !(settled(&old.status) && matches!(new.status.as_str(), "running" | "waiting")) {
        old.status = new.status;
    }
    old.at = old.at.min(new.at);
    old.kind = new.kind;
    for (slot, value) in [
        (&mut old.session, new.session),
        (&mut old.agent, new.agent),
        (&mut old.tool, new.tool),
        (&mut old.title, new.title),
    ] {
        if !value.is_empty() {
            *slot = value;
        }
    }
    if new.detail.is_some() {
        old.detail = new.detail;
    }
    if new.files.is_some() {
        old.files = new.files;
    }
    if new.ms.is_some() {
        old.ms = new.ms;
    }
}

fn upsert(data: &mut HistoryData, mut entry: Entry) {
    if entry.id.is_empty() {
        return;
    }
    entry.detail = entry.detail.filter(|d| !d.is_empty()).map(|d| clip_detail(&d));
    // The entry being updated is nearly always one of the last.
    match data.entries.iter().rposition(|e| e.id == entry.id) {
        Some(i) => merge(&mut data.entries[i], entry),
        None => data.entries.push(entry),
    }
}

/// Retention: nothing older than `days`, never more than the cap, and no
/// session left that no entry talks about. True when something went.
fn prune(data: &mut HistoryData, days: u32, now: i64) -> bool {
    let before = (data.entries.len(), data.sessions.len());
    let cutoff = now - days.clamp(1, 90) as i64 * DAY_MS;
    data.entries.retain(|e| e.at >= cutoff);
    if data.entries.len() > MAX_ENTRIES {
        data.entries.sort_by_key(|e| e.at);
        let extra = data.entries.len() - MAX_ENTRIES;
        data.entries.drain(..extra);
    }
    let used: HashSet<&str> = data.entries.iter().map(|e| e.session.as_str()).collect();
    data.sessions.retain(|id, _| used.contains(id.as_str()));
    before != (data.entries.len(), data.sessions.len())
}

/// Whatever was still going when Awuuu last closed never got its result.
fn fix_up_loaded(data: &mut HistoryData) {
    for e in &mut data.entries {
        if matches!(e.status.as_str(), "running" | "waiting") {
            e.status = "stopped".into();
        }
    }
}

fn load(path: &Path) -> HistoryData {
    let Ok(bytes) = std::fs::read(path) else { return HistoryData::default() };
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    let mut data = serde_json::from_slice::<OnDisk>(bytes).map(|d| d.data).unwrap_or_default();
    fix_up_loaded(&mut data);
    data
}

fn write_atomic(path: &Path, data: &HistoryData) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec(&OnDisk { version: 1, data: data.clone() })
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, json)?;
    std::fs::rename(&temp, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&temp);
    })
}

struct Inner {
    path: PathBuf,
    data: HistoryData,
    loaded: bool,
    dirty: bool,
    /// When the pending write is due (pushed back by every change).
    due: Instant,
    writer_running: bool,
}

impl Inner {
    fn ensure_loaded(&mut self) {
        if !self.loaded {
            self.data = load(&self.path);
            self.loaded = true;
        }
    }
}

/// The history, in memory. Lives in `Shared`.
pub struct Store {
    inner: Arc<Mutex<Inner>>,
}

impl Store {
    pub fn new(path: PathBuf) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                path,
                data: HistoryData::default(),
                loaded: false,
                dirty: false,
                due: Instant::now(),
                writer_running: false,
            })),
        }
    }

    /// Takes what the island reports. `days` is the retention from Settings.
    /// Nothing is written here: see `schedule_write`.
    pub fn append(&self, entries: Vec<Entry>, sessions: HashMap<String, SessionInfo>, days: u32, now: i64) {
        let mut inner = self.inner.lock().unwrap();
        inner.ensure_loaded();
        for entry in entries {
            upsert(&mut inner.data, entry);
        }
        for (id, info) in sessions {
            let slot = inner.data.sessions.entry(id).or_default();
            if info.cwd.as_deref().is_some_and(|s| !s.is_empty()) {
                slot.cwd = info.cwd;
            }
            if info.name.as_deref().is_some_and(|s| !s.is_empty()) {
                slot.name = info.name;
            }
        }
        prune(&mut inner.data, days, now);
        inner.dirty = true;
        inner.due = Instant::now() + WRITE_AFTER;
    }

    /// Oldest first; `since_ms` keeps only entries at or after it.
    pub fn query(&self, since_ms: Option<i64>) -> HistoryData {
        let mut inner = self.inner.lock().unwrap();
        inner.ensure_loaded();
        let mut entries: Vec<Entry> =
            inner.data.entries.iter().filter(|e| since_ms.is_none_or(|s| e.at >= s)).cloned().collect();
        entries.sort_by_key(|e| e.at);
        let used: HashSet<&str> = entries.iter().map(|e| e.session.as_str()).collect();
        let sessions =
            inner.data.sessions.iter().filter(|(id, _)| used.contains(id.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect();
        HistoryData { entries, sessions }
    }

    /// Forgets everything and deletes the file.
    pub fn clear(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().unwrap();
        inner.data = HistoryData::default();
        inner.loaded = true;
        inner.dirty = false;
        match std::fs::remove_file(&inner.path) {
            Ok(()) => Ok(()),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(err) => Err(format!("Can't delete {}: {err}", inner.path.display())),
        }
    }

    pub fn info(&self) -> Info {
        let mut inner = self.inner.lock().unwrap();
        inner.ensure_loaded();
        Info {
            path: inner.path.to_string_lossy().to_string(),
            bytes: std::fs::metadata(&inner.path).map(|m| m.len()).unwrap_or(0),
            entries: inner.data.entries.len(),
        }
    }

    /// Writes now if anything changed since the last write (also on exit).
    pub fn flush(&self) {
        flush(&self.inner);
    }

    /// Makes sure one task is waiting to write. It sleeps until two seconds
    /// after the last change, writes once and ends.
    pub fn schedule_write(&self) {
        {
            let mut inner = self.inner.lock().unwrap();
            if !inner.dirty || inner.writer_running {
                return;
            }
            inner.writer_running = true;
        }
        let shared = self.inner.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let due = shared.lock().unwrap().due;
                let wait = due.saturating_duration_since(Instant::now());
                if wait.is_zero() {
                    break;
                }
                tokio::time::sleep(wait).await;
            }
            shared.lock().unwrap().writer_running = false;
            flush(&shared);
        });
    }
}

fn flush(inner: &Mutex<Inner>) {
    let mut inner = inner.lock().unwrap();
    if !inner.dirty {
        return;
    }
    inner.dirty = false;
    if let Err(err) = write_atomic(&inner.path, &inner.data) {
        crate::log::line(format!("history: could not write {}: {err}", inner.path.display()));
    }
}

// ── Export ────────────────────────────────────────────────────────────────────

/// A file name Windows accepts, whatever the page asked for.
fn sanitise_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect();
    let cleaned: String = cleaned.trim_matches(|c: char| c == '.' || c.is_whitespace()).chars().take(80).collect();
    let cleaned = cleaned.trim_end_matches(|c: char| c == '.' || c.is_whitespace()).to_string();
    if cleaned.is_empty() {
        return "awuuu-export".into();
    }
    let stem = cleaned.split('.').next().unwrap_or_default().to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (stem.len() == 4 && (stem.starts_with("COM") || stem.starts_with("LPT")) && stem.as_bytes()[3].is_ascii_digit());
    if reserved { format!("_{cleaned}") } else { cleaned }
}

/// Writes `<name>.md` and `<name>.json` into `dir` without ever replacing a
/// file: a taken name becomes "name (2)", "name (3)"… for both files alike.
pub fn export_to(dir: &Path, name: &str, markdown: &str, json: &str) -> Result<Vec<String>, String> {
    use std::io::Write;
    std::fs::create_dir_all(dir).map_err(|e| format!("Can't create {}: {e}", dir.display()))?;
    let base = sanitise_name(name);
    for n in 1..1000 {
        let stem = if n == 1 { base.clone() } else { format!("{base} ({n})") };
        let md = dir.join(format!("{stem}.md"));
        let js = dir.join(format!("{stem}.json"));
        if md.exists() || js.exists() {
            continue;
        }
        for (path, text) in [(&md, markdown), (&js, json)] {
            // create_new: lose the race against another writer rather than overwrite.
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)
                .map_err(|e| format!("Can't write {}: {e}", path.display()))?;
            file.write_all(text.as_bytes()).map_err(|e| format!("Can't write {}: {e}", path.display()))?;
        }
        return Ok(vec![md.to_string_lossy().to_string(), js.to_string_lossy().to_string()]);
    }
    Err(format!("Too many files named {base} in {}", dir.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_790_985_600_000;

    fn entry(id: &str, at: i64, status: &str) -> Entry {
        Entry {
            id: id.into(),
            session: "s1".into(),
            agent: "claude".into(),
            at,
            kind: "run".into(),
            tool: "Bash".into(),
            title: "npm test".into(),
            detail: None,
            files: None,
            status: status.into(),
            ms: None,
        }
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("awuuu-history-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_result_merges_over_its_start() {
        let mut data = HistoryData::default();
        upsert(&mut data, entry("s1:t1", NOW, "running"));
        let mut done = entry("s1:t1", NOW + 900, "ok");
        done.title = String::new();
        done.detail = Some("3 passed".into());
        done.ms = Some(900);
        upsert(&mut data, done);
        assert_eq!(data.entries.len(), 1);
        let e = &data.entries[0];
        assert_eq!((e.status.as_str(), e.at, e.ms), ("ok", NOW, Some(900)));
        assert_eq!(e.title, "npm test", "an empty title keeps the earlier one");
        assert_eq!(e.detail.as_deref(), Some("3 passed"));

        // A late "running" (the same call reported again) changes nothing.
        upsert(&mut data, entry("s1:t1", NOW + 2000, "running"));
        assert_eq!(data.entries[0].status, "ok");
        upsert(&mut data, entry("s1:t1", NOW + 2000, "waiting"));
        assert_eq!(data.entries[0].status, "ok");
        // But a failure after an ok is a newer fact.
        upsert(&mut data, entry("s1:t1", NOW + 3000, "failed"));
        assert_eq!(data.entries[0].status, "failed");
        // waiting → running → ok is the normal road.
        upsert(&mut data, entry("s1:t2", NOW, "waiting"));
        upsert(&mut data, entry("s1:t2", NOW + 1, "running"));
        assert_eq!(data.entries[1].status, "running");
        // No id: nothing to file it under.
        upsert(&mut data, entry("", NOW, "ok"));
        assert_eq!(data.entries.len(), 2);
    }

    #[test]
    fn long_detail_keeps_its_head_and_tail() {
        let text = format!("HEAD{}TAIL", "é".repeat(5000));
        let clipped = clip_detail(&text);
        assert_eq!(clipped.chars().count(), MAX_DETAIL);
        assert!(clipped.starts_with("HEADé"));
        assert!(clipped.ends_with("éTAIL"));
        assert!(clipped.contains("\n…\n"));
        assert_eq!(clip_detail("short"), "short");

        let mut data = HistoryData::default();
        let mut e = entry("a", NOW, "ok");
        e.detail = Some("x".repeat(10_000));
        upsert(&mut data, e);
        assert_eq!(data.entries[0].detail.as_ref().unwrap().chars().count(), MAX_DETAIL);
    }

    #[test]
    fn old_entries_and_their_sessions_are_dropped() {
        let mut data = HistoryData::default();
        let mut old = entry("old", NOW - 8 * DAY_MS, "ok");
        old.session = "gone".into();
        upsert(&mut data, old);
        upsert(&mut data, entry("new", NOW - 6 * DAY_MS, "ok"));
        data.sessions.insert("gone".into(), SessionInfo { cwd: Some("C:\\a".into()), name: None });
        data.sessions.insert("s1".into(), SessionInfo { cwd: Some("C:\\b".into()), name: None });
        assert!(prune(&mut data, 7, NOW));
        assert_eq!(data.entries.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), ["new"]);
        assert_eq!(data.sessions.keys().collect::<Vec<_>>(), ["s1"]);
        assert!(!prune(&mut data, 7, NOW));
        // The setting is clamped to 1–90 days.
        assert!(!prune(&mut data, 500, NOW + 80 * DAY_MS));
        assert!(prune(&mut data, 0, NOW));
    }

    #[test]
    fn the_cap_drops_the_oldest() {
        let mut data = HistoryData::default();
        for i in 0..(MAX_ENTRIES as i64 + 25) {
            data.entries.push(entry(&format!("e{i}"), NOW - 10_000 + i, "ok"));
        }
        assert!(prune(&mut data, 7, NOW));
        assert_eq!(data.entries.len(), MAX_ENTRIES);
        assert_eq!(data.entries[0].id, "e25");
        assert_eq!(data.entries.last().unwrap().id, format!("e{}", MAX_ENTRIES + 24));
    }

    #[test]
    fn the_store_round_trips_through_its_file() {
        let dir = temp("store");
        let path = dir.join("history.json");
        let store = Store::new(path.clone());
        let sessions = HashMap::from([("s1".to_string(), SessionInfo { cwd: Some("C:\\p".into()), name: Some("p".into()) })]);
        store.append(vec![entry("s1:1", NOW, "ok"), entry("s1:2", NOW + 5, "running"), entry("s1:3", NOW + 9, "waiting")], sessions, 7, NOW + 10);
        assert!(!path.exists(), "appending alone writes nothing");
        assert_eq!(store.info(), Info { path: path.to_string_lossy().to_string(), bytes: 0, entries: 3 });
        store.flush();
        assert!(path.exists());
        assert!(!dir.join("history.json.tmp").exists());
        let raw: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(raw["version"], 1);
        assert_eq!(raw["entries"].as_array().unwrap().len(), 3);
        assert_eq!(raw["sessions"]["s1"]["name"], "p");
        assert!(store.info().bytes > 0);

        // A new launch: what was still going is marked stopped.
        let again = Store::new(path.clone());
        let got = again.query(None);
        assert_eq!(got.entries.iter().map(|e| e.status.as_str()).collect::<Vec<_>>(), ["ok", "stopped", "stopped"]);
        assert_eq!(got.sessions["s1"].cwd.as_deref(), Some("C:\\p"));
        assert_eq!(again.query(Some(NOW + 5)).entries.len(), 2);
        assert!(again.query(Some(NOW + 100)).sessions.is_empty());

        // A session's name can arrive later without losing its folder.
        again.append(vec![], HashMap::from([("s1".to_string(), SessionInfo { cwd: None, name: Some("renamed".into()) })]), 7, NOW + 10);
        let s = &again.query(None).sessions["s1"];
        assert_eq!((s.cwd.as_deref(), s.name.as_deref()), (Some("C:\\p"), Some("renamed")));

        again.clear().unwrap();
        assert!(!path.exists());
        assert!(again.query(None).entries.is_empty());
        again.flush();
        assert!(!path.exists(), "nothing changed since the clear");
        again.clear().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn entries_from_the_page_and_broken_files_load() {
        // What bridge.ts sends: camel-free field names, optional fields missing, a float.
        let e: Entry = serde_json::from_str(
            r#"{"id":"s:1","session":"s","agent":"codex","at":1790985600000.0,"kind":"edit","tool":"apply_patch","title":"Edit · a.rs","files":[{"path":"a.rs","change":"edit"}],"status":"ok","ms":12.4}"#,
        )
        .unwrap();
        assert_eq!((e.at, e.ms), (NOW, Some(12)));
        assert_eq!(e.files.unwrap()[0].change, "edit");

        let dir = temp("broken");
        let path = dir.join("history.json");
        std::fs::write(&path, b"{ not json").unwrap();
        assert!(Store::new(path.clone()).query(None).entries.is_empty());
        std::fs::write(&path, b"\xEF\xBB\xBF{\"version\":1,\"entries\":[],\"sessions\":{}}").unwrap();
        assert_eq!(Store::new(path).info().entries, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn export_names_are_safe_and_never_overwrite() {
        assert_eq!(sanitise_name("  week: 40/2026?  "), "week_ 40_2026_");
        assert_eq!(sanitise_name("..\\..\\evil"), "_.._evil");
        assert_eq!(sanitise_name("***"), "___");
        assert_eq!(sanitise_name(" . "), "awuuu-export");
        assert_eq!(sanitise_name("con"), "_con");
        assert_eq!(sanitise_name("COM1.txt"), "_COM1.txt");
        assert_eq!(sanitise_name(&"a".repeat(300)).len(), 80);

        let dir = temp("export");
        let first = export_to(&dir, "report", "# one", "{}").unwrap();
        assert!(first[0].ends_with("report.md") && first[1].ends_with("report.json"));
        // Only the .json name is taken: both files still move on together.
        std::fs::write(dir.join("report (2).json"), "keep").unwrap();
        let second = export_to(&dir, "report", "# two", "[]").unwrap();
        assert!(second[0].ends_with("report (3).md") && second[1].ends_with("report (3).json"));
        assert_eq!(std::fs::read_to_string(&first[0]).unwrap(), "# one");
        assert_eq!(std::fs::read_to_string(dir.join("report (2).json")).unwrap(), "keep");
        assert_eq!(std::fs::read_to_string(&second[1]).unwrap(), "[]");
        let escaped = export_to(&dir, "..\\up", "m", "j").unwrap();
        assert!(std::path::Path::new(&escaped[0]).parent().unwrap().ends_with(dir.file_name().unwrap()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
