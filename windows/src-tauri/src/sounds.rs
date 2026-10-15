// Your own sounds: a file named like one of Awuuu's sounds in %APPDATA%\Awuuu\sounds
// replaces it (finish.wav, approval.mp3, greet.m4a…). The page decodes the bytes
// itself; a file it cannot decode falls back to the bundled sound (src/core/sound.ts).

use crate::CREATE_NO_WINDOW;
use serde::Serialize;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter};

/// Formats a webview decodes reliably, in the order they win when several exist.
const EXTENSIONS: [&str; 4] = ["wav", "mp3", "ogg", "m4a"];
/// A sound effect, not an album: anything bigger is ignored.
const MAX_BYTES: u64 = 8 * 1024 * 1024;

pub fn folder() -> PathBuf {
    crate::settings::config_dir().join("sounds")
}

/// Bare file names in `dir` that can be used as a sound: regular, non-empty, not too big.
fn usable_files(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|e| {
            e.metadata()
                .map(|m| m.is_file() && m.len() > 0 && m.len() <= MAX_BYTES)
                .unwrap_or(false)
        })
        .filter_map(|e| e.file_name().into_string().ok())
        .collect()
}

fn is_sound_file(file: &str, name: &str, ext: &str) -> bool {
    let path = Path::new(file);
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case(ext))
        && path.file_stem().and_then(|s| s.to_str()).is_some_and(|s| s.eq_ignore_ascii_case(name))
}

/// For each of `names` that has a file among `files` (bare file names), the file to play:
/// the stem must equal the sound name (case-insensitively), and the first extension in
/// EXTENSIONS wins. Names without a file are left out.
pub fn pick(names: &[&str], files: &[&str]) -> Vec<(String, String)> {
    names
        .iter()
        .filter_map(|name| {
            EXTENSIONS
                .iter()
                .find_map(|ext| files.iter().find(|f| is_sound_file(f, name, ext)))
                .map(|file| (name.to_string(), file.to_string()))
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSounds {
    folder: String,
    /// The names (of those asked for) that the user's folder replaces.
    custom: Vec<String>,
}

/// The sounds folder (created if missing) and which of `names` it replaces.
#[tauri::command]
pub fn user_sounds(names: Vec<String>) -> UserSounds {
    let dir = folder();
    let _ = std::fs::create_dir_all(&dir);
    let files = usable_files(&dir);
    let files: Vec<&str> = files.iter().map(String::as_str).collect();
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    UserSounds {
        folder: dir.to_string_lossy().into_owned(),
        custom: pick(&names, &files).into_iter().map(|(name, _)| name).collect(),
    }
}

/// The bytes of the user's file for `name`, sent as they are.
#[tauri::command]
pub fn user_sound(name: String) -> Result<tauri::ipc::Response, String> {
    let dir = folder();
    let files = usable_files(&dir);
    let files: Vec<&str> = files.iter().map(String::as_str).collect();
    let (_, file) = pick(&[name.as_str()], &files)
        .into_iter()
        .next()
        .ok_or_else(|| format!("no custom sound for {name}"))?;
    std::fs::read(dir.join(file))
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

/// Settings → Open sounds folder: creates it if needed and shows it in Explorer.
#[tauri::command]
pub fn reveal_sounds_folder() {
    let dir = folder();
    let _ = std::fs::create_dir_all(&dir);
    let _ = Command::new("explorer").arg(&dir).creation_flags(CREATE_NO_WINDOW).spawn();
}

/// Settings → Reload sounds: every window hears "sounds-changed" and the island reads the folder again.
#[tauri::command]
pub fn reload_sounds(app: AppHandle) {
    let _ = app.emit("sounds-changed", ());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_named_like_a_sound_is_picked_in_extension_order() {
        let files = ["finish.mp3", "finish.wav", "Greet.M4A", "notes.txt"];
        assert_eq!(
            pick(&["finish", "greet", "approval"], &files),
            vec![
                ("finish".to_string(), "finish.wav".to_string()),
                ("greet".to_string(), "Greet.M4A".to_string()),
            ]
        );
    }

    #[test]
    fn only_the_whole_stem_counts() {
        let files = ["finishing.wav", "finish.final.wav", "finish.wav.txt", "finish"];
        assert!(pick(&["finish"], &files).is_empty());
    }

    #[test]
    fn a_name_is_never_matched_against_a_folder_or_another_extension() {
        assert!(pick(&["open"], &["open.txt", "open.flac", "open.aiff"]).is_empty());
        assert!(pick(&["open"], &[]).is_empty());
    }

    #[test]
    fn the_first_usable_format_wins_even_when_listed_later() {
        assert_eq!(
            pick(&["pop"], &["pop.ogg", "pop.m4a", "pop.wav"]),
            vec![("pop".to_string(), "pop.wav".to_string())]
        );
    }
}
