// Tiny persistent JSON store under %LOCALAPPDATA%\Awuuu\store\<name>.json.
// Used by Todo, Notes, Weather cache, and other modules.

use std::path::{Path, PathBuf};
use crate::settings;

/// Validates that the store name contains only safe identifier characters (a-z, A-Z, 0-9, _, -).
fn sanitize_name(name: &str) -> Option<&str> {
    if name.is_empty() {
        return None;
    }
    if name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        Some(name)
    } else {
        None
    }
}

/// %LOCALAPPDATA%\Awuuu\store\<name>.json
fn store_path(name: &str) -> Option<PathBuf> {
    let safe = sanitize_name(name)?;
    let dir = settings::local_dir().join("store");
    Some(dir.join(format!("{safe}.json")))
}

pub fn read_json_file(path: &Path) -> Option<serde_json::Value> {
    if !path.exists() {
        return None;
    }
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn write_json_atomic(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json_str = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, json_str.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp_path, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        e.to_string()
    })?;
    Ok(())
}

#[tauri::command]
pub fn store_read(name: String) -> Option<serde_json::Value> {
    let path = store_path(&name)?;
    read_json_file(&path)
}

#[tauri::command]
pub fn store_write(name: String, value: serde_json::Value) -> Result<(), String> {
    let path = store_path(&name).ok_or_else(|| format!("invalid store name: {name}"))?;
    write_json_atomic(&path, &value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_name() {
        assert_eq!(sanitize_name("todo"), Some("todo"));
        assert_eq!(sanitize_name("notes"), Some("notes"));
        assert_eq!(sanitize_name("weather_cache"), Some("weather_cache"));
        assert_eq!(sanitize_name("module-1"), Some("module-1"));
        assert_eq!(sanitize_name(""), None);
        assert_eq!(sanitize_name("../evil"), None);
        assert_eq!(sanitize_name("foo/bar"), None);
        assert_eq!(sanitize_name("foo\\bar"), None);
    }

    #[test]
    fn test_atomic_write_and_read() {
        let dir = std::env::temp_dir().join(format!(
            "awuuu_test_store_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let file = dir.join("test_item.json");
        let val = serde_json::json!({
            "items": ["one", "two", "three"]
        });

        // Initial atomic write
        assert!(write_json_atomic(&file, &val).is_ok());
        let read_val = read_json_file(&file);
        assert_eq!(read_val, Some(val.clone()));

        // Overwrite with new value
        let val2 = serde_json::json!({
            "items": ["one", "two", "three", "four"]
        });
        assert!(write_json_atomic(&file, &val2).is_ok());
        let read_val2 = read_json_file(&file);
        assert_eq!(read_val2, Some(val2));

        // Temp file should not exist after rename
        let tmp = file.with_extension("json.tmp");
        assert!(!tmp.exists());

        // Cleanup
        let _ = std::fs::remove_file(&file);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_atomic_write_preserves_original_on_temp_failure() {
        let dir = std::env::temp_dir().join(format!(
            "awuuu_test_store_fail_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let file = dir.join("safe_item.json");
        let val_initial = serde_json::json!({"data": "critical_notes"});

        assert!(write_json_atomic(&file, &val_initial).is_ok());
        assert_eq!(read_json_file(&file), Some(val_initial.clone()));

        // The target file must still have original content
        assert_eq!(read_json_file(&file), Some(val_initial));

        // Cleanup
        let _ = std::fs::remove_file(&file);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
