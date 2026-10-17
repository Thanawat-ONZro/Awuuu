// Screen time tracker: polls foreground window every 5 s while island is visible,
// aggregates per minute into daily JSON in %LOCALAPPDATA%\Awuuu\store\screentime_<YYYY-MM-DD>.json.
// Zero CPU when hidden: no timers poll when island is closed or module is disabled.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use windows::core::PWSTR;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::SystemInformation::GetLocalTime;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

use crate::store;

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScreenTimeDay {
    pub date: String,
    pub total_minutes: u32,
    pub app_minutes: HashMap<String, u32>,
    pub switch_count: u32,
}

struct SamplerState {
    date: String,
    day_data: ScreenTimeDay,
    current_minute_samples: Vec<String>,
    last_app: Option<String>,
    minute_start: Instant,
}

static SAMPLER: Mutex<Option<SamplerState>> = Mutex::new(None);

pub fn today_date_string() -> String {
    let st = unsafe { GetLocalTime() };
    format!("{:04}-{:02}-{:02}", st.wYear, st.wMonth, st.wDay)
}

pub fn friendly_app_name(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower == "code.exe" || lower == "code" {
        "Visual Studio Code".into()
    } else if lower == "chrome.exe" || lower == "chrome" {
        "Google Chrome".into()
    } else if lower == "msedge.exe" || lower == "msedge" {
        "Microsoft Edge".into()
    } else if lower == "windowsterminal.exe" {
        "Terminal".into()
    } else if lower == "slack.exe" {
        "Slack".into()
    } else if lower == "spotify.exe" {
        "Spotify".into()
    } else if lower == "discord.exe" {
        "Discord".into()
    } else if lower == "explorer.exe" {
        "File Explorer".into()
    } else if lower == "devenv.exe" {
        "Visual Studio".into()
    } else if lower.ends_with(".exe") {
        raw[..raw.len() - 4].to_string()
    } else {
        raw.to_string()
    }
}

pub fn active_process_name() -> Option<String> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(handle);
        if ok.is_ok() && len > 0 {
            let full_path = String::from_utf16_lossy(&buf[..len as usize]);
            let name = std::path::Path::new(&full_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or(full_path);
            return Some(friendly_app_name(&name));
        }
    }
    None
}

/// Periodic 5s sampler called while screen-time module is visible and enabled.
#[tauri::command]
pub fn screentime_sample() -> Result<ScreenTimeDay, String> {
    let today = today_date_string();
    let proc = active_process_name();

    let mut lock = SAMPLER.lock().map_err(|e| e.to_string())?;
    let state = lock.get_or_insert_with(|| {
        let store_name = format!("screentime_{today}");
        let day_data = store::store_read(store_name)
            .and_then(|v| serde_json::from_value::<ScreenTimeDay>(v).ok())
            .unwrap_or_else(|| ScreenTimeDay {
                date: today.clone(),
                total_minutes: 0,
                app_minutes: HashMap::new(),
                switch_count: 0,
            });

        SamplerState {
            date: today.clone(),
            day_data,
            current_minute_samples: Vec::new(),
            last_app: None,
            minute_start: Instant::now(),
        }
    });

    // Handle day rollover past midnight
    if state.date != today {
        let old_store = format!("screentime_{}", state.date);
        let _ = store::store_write(
            old_store,
            serde_json::to_value(&state.day_data).unwrap_or_default(),
        );

        state.date = today.clone();
        state.day_data = ScreenTimeDay {
            date: today,
            total_minutes: 0,
            app_minutes: HashMap::new(),
            switch_count: 0,
        };
        state.current_minute_samples.clear();
        state.last_app = None;
        state.minute_start = Instant::now();
    }

    if let Some(app) = proc {
        if let Some(ref prev) = state.last_app {
            if prev != &app {
                state.day_data.switch_count += 1;
            }
        }
        state.last_app = Some(app.clone());
        state.current_minute_samples.push(app);
    }

    // Every 60s or >= 12 samples at 5s intervals
    if state.minute_start.elapsed().as_secs() >= 60 || state.current_minute_samples.len() >= 12 {
        aggregate_samples_into_day(&state.current_minute_samples, &mut state.day_data);
        state.current_minute_samples.clear();
        state.minute_start = Instant::now();

        // Persist to store
        let store_name = format!("screentime_{}", state.date);
        let _ = store::store_write(
            store_name,
            serde_json::to_value(&state.day_data).unwrap_or_default(),
        );
    }

    Ok(state.day_data.clone())
}

/// Returns today's screen time statistics.
#[tauri::command]
pub fn screentime_today() -> Result<ScreenTimeDay, String> {
    let today = today_date_string();
    let lock = SAMPLER.lock().map_err(|e| e.to_string())?;
    if let Some(ref state) = *lock {
        if state.date == today {
            return Ok(state.day_data.clone());
        }
    }

    let store_name = format!("screentime_{today}");
    let day = store::store_read(store_name)
        .and_then(|v| serde_json::from_value::<ScreenTimeDay>(v).ok())
        .unwrap_or_else(|| ScreenTimeDay {
            date: today,
            total_minutes: 0,
            app_minutes: HashMap::new(),
            switch_count: 0,
        });

    Ok(day)
}

/// Aggregates samples from a 1-minute bucket to increment total and dominant app minutes.
pub fn aggregate_samples_into_day(samples: &[String], day_data: &mut ScreenTimeDay) {
    if samples.is_empty() {
        return;
    }
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for s in samples {
        *counts.entry(s.as_str()).or_insert(0) += 1;
    }
    if let Some((dominant, _)) = counts.into_iter().max_by_key(|&(_, count)| count) {
        *day_data.app_minutes.entry(dominant.to_string()).or_insert(0) += 1;
        day_data.total_minutes += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_friendly_app_name() {
        assert_eq!(friendly_app_name("Code.exe"), "Visual Studio Code");
        assert_eq!(friendly_app_name("chrome.exe"), "Google Chrome");
        assert_eq!(friendly_app_name("msedge.exe"), "Microsoft Edge");
        assert_eq!(friendly_app_name("windowsterminal.exe"), "Terminal");
        assert_eq!(friendly_app_name("notepad.exe"), "notepad");
    }

    #[test]
    fn test_today_date_format() {
        let d = today_date_string();
        assert_eq!(d.len(), 10);
        let parts: Vec<&str> = d.split('-').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0].len(), 4);
        assert_eq!(parts[1].len(), 2);
        assert_eq!(parts[2].len(), 2);
    }

    #[test]
    fn test_screen_time_day_serialization() {
        let mut app_minutes = HashMap::new();
        app_minutes.insert("Visual Studio Code".into(), 120);
        app_minutes.insert("Google Chrome".into(), 45);

        let day = ScreenTimeDay {
            date: "2026-10-17".into(),
            total_minutes: 165,
            app_minutes,
            switch_count: 42,
        };

        let json = serde_json::to_string(&day).unwrap();
        let parsed: ScreenTimeDay = serde_json::from_str(&json).unwrap();
        assert_eq!(day, parsed);
    }

    #[test]
    fn test_aggregate_samples_into_day() {
        let mut day = ScreenTimeDay {
            date: "2026-10-17".into(),
            total_minutes: 0,
            app_minutes: HashMap::new(),
            switch_count: 0,
        };

        // Dominant is Code (3 samples) over Chrome (1 sample)
        let samples = vec![
            "Visual Studio Code".to_string(),
            "Visual Studio Code".to_string(),
            "Google Chrome".to_string(),
            "Visual Studio Code".to_string(),
        ];

        aggregate_samples_into_day(&samples, &mut day);
        assert_eq!(day.total_minutes, 1);
        assert_eq!(day.app_minutes.get("Visual Studio Code"), Some(&1));
        assert_eq!(day.app_minutes.get("Google Chrome"), None);

        // Next minute: Chrome is dominant
        let samples2 = vec![
            "Google Chrome".to_string(),
            "Google Chrome".to_string(),
            "Visual Studio Code".to_string(),
        ];
        aggregate_samples_into_day(&samples2, &mut day);
        assert_eq!(day.total_minutes, 2);
        assert_eq!(day.app_minutes.get("Visual Studio Code"), Some(&1));
        assert_eq!(day.app_minutes.get("Google Chrome"), Some(&1));
    }
}
