// WinRT UserNotificationListener implementation for Windows Toast notifications (Task 11 Phase B).
// Requires user permission at runtime. If permission is denied or unsupported,
// falls back cleanly without scraping.

use windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus};
use windows::UI::Notifications::NotificationKinds;

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WinNotification {
    pub id: u32,
    pub app_name: String,
    pub title: String,
    pub body: String,
    pub timestamp_ms: u64,
}

#[tauri::command]
pub async fn check_notification_permission() -> String {
    let Ok(listener) = UserNotificationListener::Current() else {
        return "unsupported".to_string();
    };

    let Ok(status) = listener.GetAccessStatus() else {
        return "unsupported".to_string();
    };

    match status {
        UserNotificationListenerAccessStatus::Allowed => "allowed".to_string(),
        UserNotificationListenerAccessStatus::Denied => "denied".to_string(),
        UserNotificationListenerAccessStatus::Unspecified => "unspecified".to_string(),
        _ => "unspecified".to_string(),
    }
}

#[tauri::command]
pub async fn request_notification_permission() -> String {
    let Ok(listener) = UserNotificationListener::Current() else {
        return "unsupported".to_string();
    };

    let Ok(async_op) = listener.RequestAccessAsync() else {
        return "denied".to_string();
    };

    let Ok(status) = async_op.get() else {
        return "denied".to_string();
    };

    match status {
        UserNotificationListenerAccessStatus::Allowed => "allowed".to_string(),
        UserNotificationListenerAccessStatus::Denied => "denied".to_string(),
        _ => "denied".to_string(),
    }
}

#[tauri::command]
pub async fn get_windows_notifications() -> Result<Vec<WinNotification>, String> {
    let listener = UserNotificationListener::Current().map_err(|e| e.to_string())?;
    let status = listener.GetAccessStatus().map_err(|e| e.to_string())?;
    if status != UserNotificationListenerAccessStatus::Allowed {
        return Ok(Vec::new());
    }

    let async_op = listener.GetNotificationsAsync(NotificationKinds::Toast).map_err(|e| e.to_string())?;
    let list = async_op.get().map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    let size = list.Size().unwrap_or(0);
    for i in 0..size {
        if let Ok(n) = list.GetAt(i) {
            let id = n.Id().unwrap_or(0);
            let creation_time = n.CreationTime().map(|dt| {
                let ticks = dt.UniversalTime;
                if ticks > 116444736000000000 {
                    ((ticks - 116444736000000000) / 10000) as u64
                } else {
                    0
                }
            }).unwrap_or(0);

            out.push(WinNotification {
                id,
                app_name: "Windows".to_string(),
                title: "Toast".to_string(),
                body: String::new(),
                timestamp_ms: creation_time,
            });
        }
    }

    Ok(out)
}
