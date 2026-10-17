// Calendar feed integration and cache for Awuuu's notch dashboard.
// Fetches events via iCal or signed-in accounts.
// In-memory 15-minute debounce + persistent disk cache under %LOCALAPPDATA%\Awuuu\store\calendar_cache.json.

use std::sync::Mutex;
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalEvent {
    pub title: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub all_day: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
}

struct CacheEntry {
    instant: Instant,
    days: u32,
    events: Vec<CalEvent>,
}

static CACHE: Mutex<Option<CacheEntry>> = Mutex::new(None);

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub async fn calendar_upcoming(app: AppHandle, days: u32) -> Vec<CalEvent> {
    let days = if days == 0 { 7 } else { days };

    // Check 15-minute in-memory cache
    if let Ok(guard) = CACHE.lock() {
        if let Some(ref entry) = *guard {
            if entry.days >= days && entry.instant.elapsed() < Duration::from_secs(15 * 60) {
                return entry.events.clone();
            }
        }
    }

    let now = now_secs();
    let from = now - 3600 * 4; // Events from last 4 hours (e.g. current ongoing meetings)
    let to = now + (days as i64) * 86400;

    let result = crate::extras::fetch_calendar(&app, from, to).await;

    match result {
        Ok(raw_events) => {
            let mapped: Vec<CalEvent> = raw_events
                .into_iter()
                .map(|e| CalEvent {
                    title: e.title,
                    start_ms: e.start * 1000,
                    end_ms: e.end * 1000,
                    all_day: e.all_day,
                    location: if e.location.trim().is_empty() {
                        None
                    } else {
                        Some(e.location)
                    },
                })
                .collect();

            // Update in-memory cache
            if let Ok(mut guard) = CACHE.lock() {
                *guard = Some(CacheEntry {
                    instant: Instant::now(),
                    days,
                    events: mapped.clone(),
                });
            }

            // Persist to store under calendar_cache.json
            if let Ok(val) = serde_json::to_value(&mapped) {
                let _ = crate::store::store_write("calendar_cache".into(), val);
            }

            mapped
        }
        Err(_) => {
            // Offline or network error: fall back to disk cache
            if let Some(val) = crate::store::store_read("calendar_cache".into()) {
                if let Ok(cached) = serde_json::from_value::<Vec<CalEvent>>(val) {
                    return cached;
                }
            }
            Vec::new()
        }
    }
}

#[tauri::command]
pub async fn calendar_refresh(app: AppHandle) -> Result<(), String> {
    // Invalidate in-memory cache
    if let Ok(mut guard) = CACHE.lock() {
        *guard = None;
    }
    let _ = calendar_upcoming(app, 7).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cal_event_serialization() {
        let ev = CalEvent {
            title: "Standup".into(),
            start_ms: 1792227600000,
            end_ms: 1792229400000,
            all_day: false,
            location: Some("Room 1".into()),
        };
        let val = serde_json::to_value(&ev).unwrap();
        assert_eq!(val["title"], "Standup");
        assert_eq!(val["startMs"], 1792227600000i64);
        assert_eq!(val["endMs"], 1792229400000i64);
        assert_eq!(val["allDay"], false);
        assert_eq!(val["location"], "Room 1");

        let ev_no_loc = CalEvent {
            title: "Focus Time".into(),
            start_ms: 1792227600000,
            end_ms: 1792229400000,
            all_day: true,
            location: None,
        };
        let val_no_loc = serde_json::to_value(&ev_no_loc).unwrap();
        assert_eq!(val_no_loc.get("location"), None);
    }
}
