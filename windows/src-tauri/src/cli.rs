// `aw`, the command-line companion: `aw claude`, `aw agy`, `aw hermes`,
// `aw opencode`, `aw setup <agent>`.
//
// aw.cmd ships inside the app and is copied next to awuuu-hook.exe in
// %LOCALAPPDATA%\Awuuu\bin at launch. Putting that folder on the user PATH is
// a button in Settings (an explicit click, undone by another), done here
// rather than in the NSIS installer: NSIS strings stop at 1024 characters and
// a longer PATH would come back truncated.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::System::Registry::{
    RegCloseKey, RegGetValueW, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, KEY_WRITE,
    REG_EXPAND_SZ, RRF_NOEXPAND, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ,
};
use windows::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE};

use crate::settings;

pub fn bin_dir() -> PathBuf {
    settings::local_dir().join("bin")
}

/// Copies aw.cmd from the app's resources (or the repo, in dev) into bin\.
pub fn ensure_aw_cmd(app: &AppHandle) {
    let dest = bin_dir().join("aw.cmd");
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(p) = app.path().resolve("aw.cmd", tauri::path::BaseDirectory::Resource) {
        candidates.push(p);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("aw.cmd"));
            candidates.push(dir.join("../../../aw.cmd")); // windows/target/release → repo root
        }
    }
    let Some(src) = candidates.into_iter().find(|p| p.exists()) else { return };
    let same = matches!((std::fs::read(&src), std::fs::read(&dest)), (Ok(a), Ok(b)) if a == b);
    if !same {
        let _ = std::fs::create_dir_all(bin_dir());
        if let Err(e) = std::fs::copy(&src, &dest) {
            crate::log::line(format!("could not install aw.cmd: {e}"));
        }
    }
}

fn open_env(write: bool) -> Result<HKEY, String> {
    let mut key = HKEY::default();
    let access = if write { KEY_READ | KEY_WRITE } else { KEY_READ };
    unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from("Environment"), Some(0), access, &mut key) }
        .ok()
        .map_err(|e| format!("Can't open the user environment: {e}"))?;
    Ok(key)
}

/// The user PATH exactly as stored (unexpanded), or "" when there is none.
fn read_user_path() -> Result<String, String> {
    let key = open_env(false)?;
    let name = HSTRING::from("Path");
    let mut size: u32 = 0;
    let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND;
    let first = unsafe { RegGetValueW(key, PCWSTR::null(), &name, flags, None, None, Some(&mut size)) };
    if first.is_err() {
        unsafe {
            let _ = RegCloseKey(key);
        }
        return Ok(String::new());
    }
    let mut buf = vec![0u16; (size as usize / 2) + 1];
    let res = unsafe {
        RegGetValueW(key, PCWSTR::null(), &name, flags, None, Some(buf.as_mut_ptr().cast()), Some(&mut size))
    };
    unsafe {
        let _ = RegCloseKey(key);
    }
    res.ok().map_err(|e| format!("Can't read PATH: {e}"))?;
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Ok(String::from_utf16_lossy(&buf[..len]))
}

fn write_user_path(value: &str) -> Result<(), String> {
    let key = open_env(true)?;
    let wide: Vec<u16> = value.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = unsafe { std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2) };
    let res = unsafe { RegSetValueExW(key, &HSTRING::from("Path"), Some(0), REG_EXPAND_SZ, Some(bytes)) };
    unsafe {
        let _ = RegCloseKey(key);
    }
    res.ok().map_err(|e| format!("Can't write PATH: {e}"))?;
    // New terminals pick it up; running ones keep their old PATH.
    let env = HSTRING::from("Environment");
    unsafe {
        let _ = SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(env.as_ptr() as isize),
            SMTO_ABORTIFHUNG,
            2000,
            None,
        );
    }
    Ok(())
}

fn same_dir(entry: &str, dir: &str) -> bool {
    let norm = |s: &str| s.trim().trim_end_matches('\\').to_ascii_lowercase();
    norm(entry) == norm(dir) || norm(entry) == norm("%LOCALAPPDATA%\\Awuuu\\bin")
}

/// `path` with `dir` added at the end, unless it is already there.
pub fn with_dir(path: &str, dir: &str) -> String {
    if path.split(';').any(|e| same_dir(e, dir)) {
        return path.to_string();
    }
    let base = path.trim_end_matches(';');
    if base.is_empty() { dir.to_string() } else { format!("{base};{dir}") }
}

/// `path` without `dir`; every other entry untouched and in order.
pub fn without_dir(path: &str, dir: &str) -> String {
    path.split(';').filter(|e| !same_dir(e, dir)).collect::<Vec<_>>().join(";")
}

pub fn on_path() -> bool {
    let dir = bin_dir().to_string_lossy().to_string();
    read_user_path().map(|p| p.split(';').any(|e| same_dir(e, &dir))).unwrap_or(false)
}

pub fn set_on_path(on: bool) -> Result<(), String> {
    let dir = bin_dir().to_string_lossy().to_string();
    let current = read_user_path()?;
    let next = if on { with_dir(&current, &dir) } else { without_dir(&current, &dir) };
    if next != current {
        write_user_path(&next)?;
        crate::log::line(format!("aw {} the user PATH", if on { "added to" } else { "removed from" }));
    }
    Ok(())
}

/// `--settings=<agent>` on the command line (aw setup <agent>).
pub fn settings_arg(args: &[String]) -> Option<String> {
    args.iter().find_map(|a| a.strip_prefix("--settings").map(|rest| rest.trim_start_matches('=').to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIR: &str = "C:\\Users\\me\\AppData\\Local\\Awuuu\\bin";

    #[test]
    fn adds_once_and_removes_only_ours() {
        let p = "C:\\a;C:\\b";
        let added = with_dir(p, DIR);
        assert_eq!(added, format!("C:\\a;C:\\b;{DIR}"));
        assert_eq!(with_dir(&added, DIR), added);
        assert_eq!(with_dir(&format!("{p};"), DIR), format!("C:\\a;C:\\b;{DIR}"));
        assert_eq!(without_dir(&added, DIR), p);
        assert_eq!(without_dir("C:\\a;%LOCALAPPDATA%\\Awuuu\\bin\\;C:\\b", DIR), p);
        assert_eq!(with_dir("", DIR), DIR);
    }

    #[test]
    fn settings_argument() {
        let args = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(settings_arg(&args(&["awuuu.exe", "--settings=agy"])).as_deref(), Some("agy"));
        assert_eq!(settings_arg(&args(&["awuuu.exe", "--settings"])).as_deref(), Some(""));
        assert_eq!(settings_arg(&args(&["awuuu.exe"])), None);
    }
}
