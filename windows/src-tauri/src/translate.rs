// Translation provider client for Awuuu's notch dashboard (Task 12).
// Providers: Local LibreTranslate (default), DeepL, Google Cloud Translate.
// Never persists or logs the translated text (CLAUDE.md / privacy rule).

use std::time::Duration;
use serde_json::json;
use crate::secrets;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
const CHECK_TIMEOUT: Duration = Duration::from_millis(800);

/// Checks if a local LibreTranslate instance responds at the specified endpoint.
pub async fn check_libretranslate_service(endpoint: Option<&str>) -> bool {
    let base = endpoint.unwrap_or("http://127.0.0.1:5000");
    let check_url = format!("{}/languages", base.trim_end_matches('/'));
    let client = match reqwest::Client::builder().timeout(CHECK_TIMEOUT).build() {
        Ok(c) => c,
        Err(_) => return false,
    };
    client
        .get(&check_url)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

#[tauri::command]
pub async fn check_libretranslate(endpoint: Option<String>) -> bool {
    check_libretranslate_service(endpoint.as_deref()).await
}

/// Translates text via the chosen provider.
/// Never logs or saves the input or output text.
pub async fn translate(
    provider: &str,
    text: &str,
    source_lang: &str,
    target_lang: &str,
    endpoint: Option<&str>,
) -> Result<String, String> {
    if text.trim().is_empty() {
        return Ok(String::new());
    }

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    match provider {
        "libretranslate" => {
            let base_url = endpoint.unwrap_or("http://127.0.0.1:5000");
            let url = format!("{}/translate", base_url.trim_end_matches('/'));
            let mut payload = json!({
                "q": text,
                "target": target_lang,
                "format": "text"
            });
            if !source_lang.is_empty() && source_lang != "auto" {
                payload["source"] = json!(source_lang);
            } else {
                payload["source"] = json!("auto");
            }
            let res = client
                .post(&url)
                .json(&payload)
                .send()
                .await
                .map_err(|e| format!("LibreTranslate request failed: {e}"))?;

            if !res.status().is_success() {
                return Err(format!("LibreTranslate returned status {}", res.status()));
            }

            let val: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
            val.get("translatedText")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "Missing translatedText in LibreTranslate response".to_string())
        }
        "deepl" => {
            let api_key = secrets::get("deepl-api-key")
                .ok_or_else(|| "DeepL API key not configured in Settings".to_string())?;

            let url = if api_key.ends_with(":fx") {
                "https://api-free.deepl.com/v2/translate"
            } else {
                "https://api.deepl.com/v2/translate"
            };

            let mut body = json!({
                "text": [text],
                "target_lang": target_lang.to_uppercase(),
            });
            if !source_lang.is_empty() && source_lang != "auto" {
                body["source_lang"] = json!(source_lang.to_uppercase());
            }

            let res = client
                .post(url)
                .header("Authorization", format!("DeepL-Auth-Key {api_key}"))
                .header("Content-Type", "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("DeepL request failed: {e}"))?;

            if !res.status().is_success() {
                return Err(format!("DeepL returned status {}", res.status()));
            }

            let val: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
            val.get("translations")
                .and_then(|t| t.as_array())
                .and_then(|arr| arr.first())
                .and_then(|item| item.get("text"))
                .and_then(|s| s.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "Missing translation in DeepL response".to_string())
        }
        "google" => {
            let api_key = secrets::get("google-translate-api-key")
                .ok_or_else(|| "Google Translate API key not configured in Settings".to_string())?;

            let url = "https://translation.googleapis.com/language/translate/v2";

            let mut body = json!({
                "q": [text],
                "target": target_lang,
                "format": "text"
            });
            if !source_lang.is_empty() && source_lang != "auto" {
                body["source"] = json!(source_lang);
            }

            let res = client
                .post(url)
                .header("x-goog-api-key", &api_key)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("Google Translate request failed: {}", e.without_url()))?;

            if !res.status().is_success() {
                return Err(format!("Google Translate returned status {}", res.status()));
            }

            let val: serde_json::Value = res.json().await.map_err(|e| e.without_url().to_string())?;
            val.get("data")
                .and_then(|d| d.get("translations"))
                .and_then(|t| t.as_array())
                .and_then(|arr| arr.first())
                .and_then(|item| item.get("translatedText"))
                .and_then(|s| s.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "Missing translatedText in Google response".to_string())
        }
        other => Err(format!("Unknown translation provider '{other}'")),
    }
}

#[tauri::command]
pub async fn translate_text(
    provider: String,
    text: String,
    source_lang: String,
    target_lang: String,
    endpoint: Option<String>,
) -> Result<String, String> {
    translate(&provider, &text, &source_lang, &target_lang, endpoint.as_deref()).await
}
