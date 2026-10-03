// Git as the ground truth for what a request changed. An agent's tool calls say which files
// it edited, but not what a command changed (`sed -i`, a formatter, a code generator, a
// commit). The island takes a snapshot when a request starts and another when it ends, and
// the difference is what changed, however it was changed.
//
// A snapshot is HEAD plus every file `git status` lists, each with its size and
// modification time. Nothing is read but the file list and file times; nothing is written.
// It can't tell who changed a file: another agent, or the user, in the same repository at
// the same time shows up too.
//
// cwd comes from an agent's hook payload, so git runs with the fsmonitor setting forced
// off (a repository's own config could otherwise name a program to run).

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, UNIX_EPOCH};

use serde::Serialize;

use crate::CREATE_NO_WINDOW;

/// More changed files than this is a build into a tracked folder: too many to compare.
const LIMIT: usize = 2000;
const TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    /// Absolute, with the separators git uses.
    pub path: String,
    /// "??" new, " M"/"M " changed, " D"/"D " deleted, "R " renamed (the new name)…
    pub code: String,
    pub size: u64,
    /// Modification time, epoch ms (0 when the file is gone).
    pub mtime: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitSnap {
    pub head: String,
    pub files: Vec<GitFile>,
}

fn git(cwd: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .args(["-c", "core.fsmonitor=false", "-C"])
        .arg(cwd)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// `git status --porcelain=v1 -z` → (code, path). A rename's old name follows and is dropped.
pub fn parse_status(out: &str) -> Vec<(String, String)> {
    let mut list = Vec::new();
    let mut parts = out.split('\0');
    while let Some(p) = parts.next() {
        if p.len() < 4 {
            continue;
        }
        let code = &p[..2];
        list.push((code.to_string(), p[3..].to_string()));
        if code.starts_with('R') || code.starts_with('C') {
            parts.next();
        }
    }
    list
}

/// `git diff --name-status -z` → (letter, path); a rename or copy gives its new name.
pub fn parse_name_status(out: &str) -> Vec<(String, String)> {
    let mut list = Vec::new();
    let mut parts = out.split('\0').filter(|p| !p.is_empty());
    while let Some(status) = parts.next() {
        let Some(mut path) = parts.next() else { break };
        if status.starts_with('R') || status.starts_with('C') {
            path = parts.next().unwrap_or(path);
        }
        list.push((status[..1].to_string(), path.to_string()));
    }
    list
}

fn file(root: &Path, code: &str, rel: &str) -> GitFile {
    let path: PathBuf = root.join(rel);
    let meta = std::fs::metadata(&path).ok();
    let mtime = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    GitFile {
        path: path.to_string_lossy().replace('\\', "/"),
        code: code.to_string(),
        size: meta.map(|m| m.len()).unwrap_or(0),
        mtime,
    }
}

fn root_of(cwd: &Path) -> Option<PathBuf> {
    Some(PathBuf::from(git(cwd, &["rev-parse", "--show-toplevel"])?.trim()))
}

fn snapshot(cwd: &Path) -> Option<GitSnap> {
    let root = root_of(cwd)?;
    // No commit yet: HEAD does not resolve, which is fine ("" never equals a real one).
    let head = git(cwd, &["rev-parse", "HEAD"]).map(|h| h.trim().to_string()).unwrap_or_default();
    let status = parse_status(&git(cwd, &["status", "--porcelain=v1", "-z"])?);
    if status.len() > LIMIT {
        return None;
    }
    Some(GitSnap { head, files: status.iter().map(|(c, p)| file(&root, c, p)).collect() })
}

fn between(cwd: &Path, from: &str, to: &str) -> Option<Vec<GitFile>> {
    // Only hashes: the strings come from a snapshot, not from a person.
    let hash = |s: &str| !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_hexdigit());
    if !hash(from) || !hash(to) {
        return None;
    }
    let root = root_of(cwd)?;
    let changed = parse_name_status(&git(cwd, &["diff", "--name-status", "-z", from, to])?);
    if changed.len() > LIMIT {
        return None;
    }
    Some(changed.iter().map(|(c, p)| file(&root, &format!("{c} "), p)).collect())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Option<T> + Send + 'static) -> Option<T> {
    tokio::time::timeout(TIMEOUT, tauri::async_runtime::spawn_blocking(f)).await.ok()?.ok()?
}

fn dir(cwd: &str) -> Option<PathBuf> {
    let p = PathBuf::from(cwd);
    p.is_dir().then_some(p)
}

/// HEAD and the changed files of the repository `cwd` is in; None when it isn't in one.
#[tauri::command]
pub async fn git_snapshot(cwd: String) -> Option<GitSnap> {
    let cwd = dir(&cwd)?;
    blocking(move || snapshot(&cwd)).await
}

/// The files that differ between two commits (hashes from `git_snapshot`).
#[tauri::command]
pub async fn git_changed_between(cwd: String, from: String, to: String) -> Option<Vec<GitFile>> {
    let cwd = dir(&cwd)?;
    blocking(move || between(&cwd, &from, &to)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_lines_and_renames() {
        let out = " M src/a.ts\0?? new file.txt\0R  b.ts\0old.ts\0D  gone.ts\0";
        assert_eq!(
            parse_status(out),
            vec![
                (" M".to_string(), "src/a.ts".to_string()),
                ("??".to_string(), "new file.txt".to_string()),
                ("R ".to_string(), "b.ts".to_string()),
                ("D ".to_string(), "gone.ts".to_string()),
            ]
        );
        assert!(parse_status("").is_empty());
    }

    #[test]
    fn name_status_takes_the_new_name_of_a_rename() {
        let out = "M\0a.ts\0A\0b.ts\0R100\0old.ts\0new.ts\0D\0c.ts\0";
        assert_eq!(
            parse_name_status(out),
            vec![
                ("M".to_string(), "a.ts".to_string()),
                ("A".to_string(), "b.ts".to_string()),
                ("R".to_string(), "new.ts".to_string()),
                ("D".to_string(), "c.ts".to_string()),
            ]
        );
    }

    #[test]
    fn only_hashes_reach_git_diff() {
        let here = std::env::current_dir().unwrap();
        assert!(between(&here, "--output=x", "abc").is_none());
        assert!(between(&here, "abc", "").is_none());
    }
}
