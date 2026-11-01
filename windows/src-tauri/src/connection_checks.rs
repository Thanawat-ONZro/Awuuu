//! Explicit read-only diagnostics; saved reports never contain credentials or account data.
use serde::Serialize;
use tauri::AppHandle;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    name: String,
    status: &'static str,
    detail: &'static str,
}
fn failure(message: &str) -> (&'static str, &'static str) {
    let lower = message.to_ascii_lowercase();
    if lower.contains("401") || lower.contains("invalid_grant") || lower.contains("unauthorized") {
        (
            "fail",
            "Authentication failed. Sign in again or replace the saved key.",
        )
    } else if lower.contains("403") || lower.contains("permission") {
        (
            "fail",
            "Permission is missing. Review the provider permissions.",
        )
    } else if lower.contains("429") || lower.contains("rate limit") {
        ("warn", "Provider rate limit reached. Try again later.")
    } else if lower.contains("city not found") {
        (
            "fail",
            "City not found. Try another city name in Weather settings.",
        )
    } else if lower.contains("weather lookup is unreachable") {
        (
            "fail",
            "The weather location service is unreachable. Check the network.",
        )
    } else if lower.contains("weather service is unreachable") {
        (
            "fail",
            "The weather forecast service is unreachable. Check the network.",
        )
    } else if lower.contains("weather lookup failed")
        || lower.contains("weather service returned an error")
    {
        (
            "fail",
            "The weather provider rejected the request. Try again later.",
        )
    } else {
        (
            "fail",
            "Read request failed. Use the provider card Test button for details.",
        )
    }
}
#[tauri::command]
pub async fn check_saved_connections(app: AppHandle) -> Vec<Check> {
    let configured = crate::integrations_configured(app.clone());
    let mut pending = Vec::new();
    let mut rows = Vec::new();
    for (id, name) in [
        ("integration_calendar", "Calendar"),
        ("integration_mail", "Mail"),
        ("integration_github", "GitHub"),
        ("integration_notion", "Notion"),
        ("integration_weather", "Weather"),
        ("integration_todoist", "Todoist"),
        ("integration_feeds", "News"),
        ("integration_uptime", "Uptime"),
        ("integration_stripe", "Stripe"),
        ("integration_vercel", "Vercel"),
        ("integration_resend", "Resend"),
        ("integration_n8n", "n8n"),
        ("integration_calcom", "Cal.com"),
    ] {
        if !configured.contains(&id) {
            rows.push(Check {
                name: name.into(),
                status: "not-configured",
                detail: "Not configured; no request was sent.",
            });
            continue;
        }
        let handle = app.clone();
        pending.push(tauri::async_runtime::spawn(async move {
            let (status, detail) = match tokio::time::timeout(
                std::time::Duration::from_secs(25),
                crate::integration_test(handle, id.into()),
            )
            .await
            {
                Ok(Ok(_)) => ("ok", "Read request succeeded."),
                Ok(Err(error)) => failure(&error),
                Err(_) => (
                    "fail",
                    "Request timed out. Check the connection and try again.",
                ),
            };
            Check {
                name: name.into(),
                status,
                detail,
            }
        }));
    }
    for check in pending {
        if let Ok(check) = check.await {
            rows.push(check);
        }
    }
    rows
}
#[cfg(debug_assertions)]
pub fn write_shelf_report() {
    tauri::async_runtime::spawn(async {
        let files = crate::shelf::shelf_list(Some(7)).await.unwrap_or_default();
        let mut previews = 0;
        for file in files.iter().take(20) {
            if crate::shelf::shelf_preview(file.path.clone()).await.is_some() { previews += 1; }
        }
        let _ = crate::store::write_json_atomic(&crate::settings::local_dir().join("shelf-check.json"),
            &serde_json::json!({"files":files.len(),"checked":files.len().min(20),"previews":previews}));
    });
}
#[cfg(debug_assertions)]
pub fn write_clipboard_report() {
    let _ = crate::store::write_json_atomic(
        &crate::settings::local_dir().join("clipboard-check.json"),
        &crate::clipboard_history::diagnostic_state(),
    );
}
#[cfg(debug_assertions)]
pub fn write_dev_report(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let rows = check_saved_connections(app.clone()).await;
        let agents:Vec<_>=crate::detect_agents().into_iter().map(|agent|serde_json::json!({"agent":agent.id,"installed":agent.present,"hooksInstalled":agent.hooks_installed,"liveSessionVerified":false})).collect();
        let share = crate::sharing::shelf_share_status().await;
        let value = serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"connections":rows,"agents":agents,"sharing":share,"clipboard":crate::clipboard_history::diagnostic_state()});
        match crate::store::write_json_atomic(
            &crate::settings::local_dir().join("connection-check.json"),
            &value,
        ) {
            Ok(()) => crate::log::line("Read-only connection check report saved"),
            Err(_) => crate::log::line("Could not save connection check report"),
        };
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reports_do_not_echo_secrets_from_provider_errors() {
        assert_eq!(
            failure("401 api-key=private").1,
            "Authentication failed. Sign in again or replace the saved key."
        );
        assert!(!failure("https://example/?token=secret")
            .1
            .contains("secret"));
    }
}
