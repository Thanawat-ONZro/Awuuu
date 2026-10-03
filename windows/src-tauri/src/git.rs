// What git says changed in a project: the ground truth for a request.
//
// The island takes a snapshot when a request starts and another when it ends;
// the difference (island/ground.ts) catches files the hooks never saw, such as
// a `sed -i`, a formatter or a code generator. Read-only git commands, no
// window, 3 s at most; a folder that isn't a repository gives nothing.

use serde::Serialize;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const TIMEOUT: Duration = Duration::from_secs(3);
/// A huge working tree is cut here; the rest isn't worth a prompt line.
const MAX_FILES: usize = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    pub path: String,
    /// Porcelain status: "M", "A", "D", "R", "??"…
    pub status: String,
    /// Lines added / removed against HEAD; None for binary or untracked files.
    pub added: Option<u32>,
    pub removed: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSnapshot {
    /// The repository's top folder; file paths are under it.
    pub root: String,
    pub head: String,
    pub files: Vec<GitFile>,
}

fn git(cwd: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(cwd).args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    let child = cmd.spawn().ok()?;
    let (tx, rx) = mpsc::channel();
    let pid = child.id();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    match rx.recv_timeout(TIMEOUT) {
        Ok(Ok(out)) if out.status.success() => Some(String::from_utf8_lossy(&out.stdout).into_owned()),
        Ok(_) => None,
        Err(_) => {
            // Too slow (a network drive, a giant repo): give up, don't leave it running.
            let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW).stdout(Stdio::null()).stderr(Stdio::null()).status();
            None
        }
    }
}

/// `git status --porcelain=v1 -z`: "XY path\0" (renames add "\0old").
pub fn parse_status(out: &str) -> Vec<(String, String)> {
    let mut files = Vec::new();
    let mut parts = out.split('\0');
    while let Some(rec) = parts.next() {
        if rec.len() < 4 {
            continue;
        }
        let status = rec[..2].trim().to_string();
        let path = rec[3..].to_string();
        if status.starts_with('R') || status.starts_with('C') {
            parts.next(); // the old name
        }
        files.push((path, status));
    }
    files
}

/// `git diff --numstat HEAD`: "added\tremoved\tpath" ("-" for binary).
pub fn parse_numstat(out: &str) -> Vec<(String, Option<u32>, Option<u32>)> {
    out.lines()
        .filter_map(|l| {
            let mut it = l.splitn(3, '\t');
            let a = it.next()?;
            let r = it.next()?;
            let p = it.next()?;
            // A rename shows as "old => new" or "dir/{old => new}"; keep the new name.
            let path = match (p.find('{'), p.find(" => ")) {
                (Some(open), Some(_)) => {
                    let close = p.find('}').unwrap_or(p.len() - 1);
                    let inner = &p[open + 1..close];
                    let new = inner.split(" => ").nth(1).unwrap_or(inner);
                    format!("{}{}{}", &p[..open], new, &p[(close + 1).min(p.len())..]).replace("//", "/")
                }
                (None, Some(i)) => p[i + 4..].to_string(),
                _ => p.to_string(),
            };
            Some((path, a.parse().ok(), r.parse().ok()))
        })
        .collect()
}

/// git's paths are relative to the repository; the hooks' are absolute.
fn absolute(root: &str, path: &str) -> String {
    format!("{}/{}", root.trim_end_matches(['/', '\\']), path)
}

pub fn snapshot(cwd: &str) -> Option<GitSnapshot> {
    if cwd.trim().is_empty() || !std::path::Path::new(cwd).is_dir() {
        return None;
    }
    let root = git(cwd, &["rev-parse", "--show-toplevel"])?.trim().to_string();
    let status = git(cwd, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    // A repository with no commit yet has no HEAD to diff against.
    let head = git(cwd, &["rev-parse", "--short", "HEAD"]).map(|h| h.trim().to_string()).unwrap_or_default();
    let numstat = if head.is_empty() { String::new() } else { git(cwd, &["diff", "--numstat", "HEAD"]).unwrap_or_default() };
    let counts = parse_numstat(&numstat);
    let files = parse_status(&status)
        .into_iter()
        .take(MAX_FILES)
        .map(|(path, status)| {
            let c = counts.iter().find(|(p, _, _)| *p == path);
            GitFile { added: c.and_then(|c| c.1), removed: c.and_then(|c| c.2), path: absolute(&root, &path), status }
        })
        .collect();
    Some(GitSnapshot { root, head, files })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_reads_changes_renames_and_untracked() {
        let out = " M src/a.ts\0A  new.rs\0R  b.ts\0old/b.ts\0?? notes.md\0";
        assert_eq!(
            parse_status(out),
            vec![
                ("src/a.ts".into(), "M".into()),
                ("new.rs".into(), "A".into()),
                ("b.ts".into(), "R".into()),
                ("notes.md".into(), "??".into()),
            ]
        );
    }

    #[test]
    fn numstat_reads_counts_binaries_and_renames() {
        let out = "3\t1\tsrc/a.ts\n-\t-\tlogo.png\n5\t0\tsrc/{old => new}/c.ts\n2\t2\tx.ts => y.ts\n";
        assert_eq!(
            parse_numstat(out),
            vec![
                ("src/a.ts".into(), Some(3), Some(1)),
                ("logo.png".into(), None, None),
                ("src/new/c.ts".into(), Some(5), Some(0)),
                ("y.ts".into(), Some(2), Some(2)),
            ]
        );
    }

    #[test]
    fn paths_are_made_absolute() {
        assert_eq!(absolute("C:/code/app", "src/a.ts"), "C:/code/app/src/a.ts");
        assert_eq!(absolute("C:/code/app/", "a.ts"), "C:/code/app/a.ts");
    }

    #[test]
    fn a_folder_that_is_not_there_gives_nothing() {
        assert_eq!(snapshot(""), None);
        assert_eq!(snapshot("Z:\\definitely\\not\\here"), None);
    }
}
