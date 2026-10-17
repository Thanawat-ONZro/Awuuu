// The Shelf: holds dropped files under %LOCALAPPDATA%\Awuuu\shelf.
// Safe retention policy (default 7 days), copy on drag-out, zero outside path modifications.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::files;
use crate::settings;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShelfFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub added_at_ms: u64,
}

pub fn shelf_dir() -> PathBuf {
    settings::local_dir().join("shelf")
}

/// Lists all files in the shelf folder. Sweeps files exceeding `retention_days` (default 7 days).
#[tauri::command]
pub async fn shelf_list(retention_days: Option<u32>) -> Result<Vec<ShelfFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = shelf_dir();
        if !dir.exists() {
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            return Ok(Vec::new());
        }

        let days = retention_days.unwrap_or(7);
        sweep(&dir, days);

        let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
        let mut files = Vec::new();

        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                continue;
            }

            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path().to_string_lossy().to_string();
            let size = meta.len();
            let added_at_ms = meta
                .modified()
                .unwrap_or_else(|_| SystemTime::now())
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            files.push(ShelfFile {
                name,
                path,
                size,
                added_at_ms,
            });
        }

        // Sort newest first
        files.sort_by(|a, b| b.added_at_ms.cmp(&a.added_at_ms));
        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Copies a file into the shelf folder, never overwriting existing items.
#[tauri::command]
pub async fn shelf_add(source: String) -> Result<ShelfFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let src = Path::new(&source);
        let meta = std::fs::metadata(src).map_err(|e| format!("cannot read {source}: {e}"))?;
        if meta.is_dir() {
            return Err("Folders cannot be added to shelf.".into());
        }

        let dir = shelf_dir();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        let name = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".into());

        let dest = files::free_name(&dir, &name);
        std::fs::copy(src, &dest).map_err(|e| format!("cannot copy to shelf: {e}"))?;

        // Clear read-only bit if copied from read-only source so timestamp update succeeds
        if let Ok(mut perms) = std::fs::metadata(&dest).map(|m| m.permissions()) {
            if perms.readonly() {
                perms.set_readonly(false);
                let _ = std::fs::set_permissions(&dest, perms);
            }
        }

        // Fresh timestamp for retention window
        let now = SystemTime::now();
        if let Ok(file) = std::fs::File::options().write(true).open(&dest) {
            let _ = file.set_modified(now);
        }

        let added_at_ms = now
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        Ok(ShelfFile {
            name: dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or(name),
            path: dest.to_string_lossy().to_string(),
            size: meta.len(),
            added_at_ms,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Removes a specific file from the shelf.
/// SAFETY: Ensures path is strictly inside the shelf directory. Never touches outside files.
#[tauri::command]
pub fn shelf_remove(path: String) -> Result<bool, String> {
    let p = Path::new(&path);
    let dir = shelf_dir();

    let Ok(canon_dir) = std::fs::canonicalize(&dir) else {
        return Ok(false);
    };
    let Ok(canon_p) = std::fs::canonicalize(p) else {
        return Ok(false);
    };

    if !canon_p.starts_with(&canon_dir) {
        return Err("Refusing to delete file outside shelf folder.".into());
    }

    if canon_p.is_file() {
        std::fs::remove_file(canon_p).map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Clears all files in the shelf directory.
#[tauri::command]
pub fn shelf_clear() -> Result<usize, String> {
    let dir = shelf_dir();
    if !dir.exists() {
        return Ok(0);
    }
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut count = 0;
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_file() && std::fs::remove_file(entry.path()).is_ok() {
            count += 1;
        }
    }
    Ok(count)
}

pub(crate) fn sweep(dir: &Path, retention_days: u32) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let keep_duration = Duration::from_secs(retention_days as u64 * 86400);
    let now = SystemTime::now();

    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let Ok(modified) = meta.modified() else { continue };
        if now.duration_since(modified).map(|age| age > keep_duration).unwrap_or(false) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shelf_lifecycle_and_safety() {
        let tmp = std::env::temp_dir().join(format!("awuuu-shelf-test-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();

        let sample = tmp.join("demo.txt");
        std::fs::write(&sample, b"shelf test content").unwrap();

        let sdir = shelf_dir();
        std::fs::create_dir_all(&sdir).unwrap();

        let added = tauri::async_runtime::block_on(shelf_add(sample.to_str().unwrap().to_string())).unwrap();
        assert_eq!(added.name, "demo.txt");
        assert!(Path::new(&added.path).exists());
        assert_eq!(added.size, 18);

        // Outside path deletion must be refused
        assert!(shelf_remove(sample.to_str().unwrap().to_string()).is_err());
        assert!(sample.exists());

        // Inside shelf deletion must succeed
        let removed = shelf_remove(added.path.clone()).unwrap();
        assert!(removed);
        assert!(!Path::new(&added.path).exists());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_shelf_readonly_sweep_case() {
        let tmp = std::env::temp_dir().join(format!("awuuu-shelf-sweep-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        // 1. Subfolder: sweep must never touch directories
        let sub = tmp.join("subfolder");
        std::fs::create_dir(&sub).unwrap();
        std::fs::write(sub.join("nested.txt"), b"nested").unwrap();

        // 2. Old file exceeding 7 days retention
        let old_file = tmp.join("old.txt");
        std::fs::write(&old_file, b"old content").unwrap();
        let ten_days_ago = SystemTime::now() - Duration::from_secs(10 * 86400);
        let f_old = std::fs::File::options().write(true).open(&old_file).unwrap();
        f_old.set_modified(ten_days_ago).unwrap();
        drop(f_old);

        // 3. Read-only file added to shelf
        let src_ro = tmp.join("source_ro.txt");
        std::fs::write(&src_ro, b"read only source").unwrap();
        let mut perms = std::fs::metadata(&src_ro).unwrap().permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&src_ro, perms).unwrap();

        // Simulate shelf_add copy + readonly clearance + mtime refresh
        let dest_ro = tmp.join("copied_ro.txt");
        std::fs::copy(&src_ro, &dest_ro).unwrap();
        assert!(std::fs::metadata(&dest_ro).unwrap().permissions().readonly());

        // Clearing read-only allows set_modified to succeed
        if let Ok(mut perms) = std::fs::metadata(&dest_ro).map(|m| m.permissions()) {
            if perms.readonly() {
                perms.set_readonly(false);
                std::fs::set_permissions(&dest_ro, perms).unwrap();
            }
        }
        let now = SystemTime::now();
        let f_dest = std::fs::File::options().write(true).open(&dest_ro).unwrap();
        f_dest.set_modified(now).unwrap();
        drop(f_dest);

        // Run sweep with 7-day retention
        sweep(&tmp, 7);

        // Assert: old file swept, read-only copy preserved, subfolder preserved
        assert!(!old_file.exists(), "files older than retention window must be swept");
        assert!(dest_ro.exists(), "read-only copy with refreshed timestamp must be preserved");
        assert!(sub.exists(), "sweep must never delete subfolders");
        assert!(sub.join("nested.txt").exists());

        // Cleanup
        let _ = std::fs::set_permissions(&src_ro, {
            let mut p = std::fs::metadata(&src_ro).unwrap().permissions();
            p.set_readonly(false);
            p
        });
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
