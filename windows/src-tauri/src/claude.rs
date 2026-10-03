// Chat backends: the local Hermes Agent (OpenAI-compatible, streamed) by
// default, the Claude API when a claude-* model is selected.
//
// Everything happens here rather than in the island: keys never leave the
// Credential Manager and file bytes never cross the IPC boundary. Hermes
// replies stream back through `on_delta`, which the island shows as it types.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::secrets;

pub const DEFAULT_MODEL: &str = "hermes-agent";
const DEFAULT_HERMES_URL: &str = "http://127.0.0.1:8642/v1/chat/completions";

const ANTHROPIC_ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
const MAX_TOKENS: u32 = 4096;
const MAX_INLINE_TEXT: u64 = 200_000;

const SYSTEM_PROMPT: &str = "You are Awuuu, a personal AI companion dog living at the top of the user's screen. \
Respond in the user's language. Be thorough, helpful and concise.";

/// Sent ahead of the Hermes history. Kept light on persona so the agent's own
/// profile and memories stay in charge; it only sets the display constraints.
const HERMES_SYSTEM: &str = "You are talking through Awuuu, a small dog companion that lives at the top of the user's screen. \
Your reply appears in a small chat bubble: keep it clear and reasonably short, plain text with line breaks, no markdown. \
Respond in the user's language.";

/// Images larger than this are not sent inline (base64 grows them by a third).
const MAX_INLINE_IMAGE: u64 = 5_000_000;

#[derive(Default)]
pub struct Chat {
    /// Full multi-turn history.
    messages: Mutex<Vec<Value>>,
    /// The Hermes session the island chat lives in (Runs API); a new one after
    /// a reset.
    hermes_session: Mutex<Option<String>>,
}

impl Chat {
    pub fn reset(&self) {
        self.messages.lock().unwrap().clear();
        *self.hermes_session.lock().unwrap() = None;
    }

    fn hermes_session(&self) -> String {
        self.hermes_session
            .lock()
            .unwrap()
            .get_or_insert_with(|| {
                let t = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                format!("awuuu-chat-{t}")
            })
            .clone()
    }

    fn is_empty(&self) -> bool {
        self.messages.lock().unwrap().is_empty()
    }

    fn push(&self, message: Value) {
        self.messages.lock().unwrap().push(message);
    }

    fn pop(&self) {
        self.messages.lock().unwrap().pop();
    }

    fn snapshot(&self) -> Vec<Value> {
        self.messages.lock().unwrap().clone()
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatContext {
    File { name: String, path: String },
    Window { app_name: String, title: String, url: Option<String> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReply {
    pub text: String,
    /// What actually answered ("provider · model"), when the server says.
    pub used: Option<String>,
}

/// The `.env` files Hermes writes its API_SERVER_KEY to, in lookup order.
fn hermes_env_files() -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Some(dir) = std::env::var_os("LOCALAPPDATA") {
        files.push(PathBuf::from(dir).join("hermes").join(".env"));
    }
    if let Some(dir) = std::env::var_os("USERPROFILE") {
        files.push(PathBuf::from(dir).join(".hermes").join(".env"));
    }
    files
}

pub fn get_hermes_key() -> Option<String> {
    if let Some(key) = secrets::get("hermes-api-key") {
        if !key.is_empty() {
            return Some(key);
        }
    }
    if let Ok(key) = std::env::var("HERMES_API_KEY") {
        if !key.is_empty() {
            return Some(key);
        }
    }
    if let Ok(key) = std::env::var("API_SERVER_KEY") {
        if !key.is_empty() {
            return Some(key);
        }
    }
    for env_path in hermes_env_files() {
        if let Ok(content) = std::fs::read_to_string(&env_path) {
            for line in content.lines() {
                let line = line.trim();
                if let Some(val) = line.strip_prefix("API_SERVER_KEY=") {
                    let val = val.trim().trim_matches('"').trim_matches('\'');
                    if !val.is_empty() {
                        return Some(val.to_string());
                    }
                }
            }
        }
    }
    None
}

/// The chat-completions endpoint. Settings may hold just the server
/// ("http://127.0.0.1:8642"), the /v1 base, or the full endpoint.
pub fn get_hermes_url() -> String {
    let raw = secrets::get("hermes-url").unwrap_or_else(|| DEFAULT_HERMES_URL.to_string());
    let base = raw.trim().trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        base.to_string()
    } else if base.ends_with("/v1") {
        format!("{base}/chat/completions")
    } else {
        format!("{base}/v1/chat/completions")
    }
}

fn missing_key_message() -> String {
    "Hermes API key missing. Add it in Settings, or check API_SERVER_KEY in \
%LOCALAPPDATA%\\hermes\\.env (or %USERPROFILE%\\.hermes\\.env)."
        .to_string()
}

/// Settings → "Test connection": lists the models the Hermes server offers.
/// Only ever called from that button, never in the background.
pub async fn hermes_models() -> Result<Vec<String>, String> {
    let key = get_hermes_key().ok_or_else(missing_key_message)?;
    let url = get_hermes_url().replace("/chat/completions", "/models");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
        .map_err(|e| format!("Can't reach Hermes at {url}: {e}"))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Hermes returned {status}: {}", text.chars().take(200).collect::<String>()));
    }
    let parsed: Value = serde_json::from_str(&text).map_err(|e| format!("Invalid JSON from Hermes: {e}"))?;
    Ok(parsed
        .get("data")
        .and_then(Value::as_array)
        .map(|models| {
            models
                .iter()
                .filter_map(|m| m.get("id").and_then(Value::as_str).map(str::to_string))
                .collect()
        })
        .unwrap_or_default())
}

/// One chat turn. Returns the assistant's text, or a message the island shows
/// in the note view.
pub async fn send(
    app: &tauri::AppHandle,
    chat: &Chat,
    model: &str,
    provider: Option<&crate::settings::ChatProvider>,
    query: String,
    context: Option<ChatContext>,
    on_delta: &(dyn Fn(&str) + Send + Sync),
) -> Result<ChatReply, String> {
    if let Some(p) = provider {
        return send_openai(chat, p, query, context, on_delta).await;
    }
    if model.starts_with("claude-") {
        return send_claude(chat, model, query, context).await;
    }
    // A real Hermes session through the Runs API (tools, approvals and steps
    // show in the island). Images still go through chat completions, which
    // takes them inline; so does an older Hermes without /v1/runs.
    let has_image = matches!(&context, Some(ChatContext::File { path, .. }) if image_part(path).is_some());
    if !has_image {
        let input = with_context(chat.is_empty() && chat.hermes_session.lock().unwrap().is_none(), &context, &query);
        let session = chat.hermes_session();
        let pick = {
            use tauri::Manager;
            app.try_state::<crate::Shared>().map(|s| {
                let s = s.settings.lock().unwrap();
                crate::hermes::Pick {
                    model: s.hermes_model.clone(),
                    provider: s.hermes_provider.clone(),
                    effort: s.reasoning_effort.clone(),
                }
            })
        };
        match crate::hermes::run_turn(app, &session, &input, Some(HERMES_SYSTEM), pick.as_ref(), on_delta).await {
            Ok(reply) => return Ok(reply),
            Err(crate::hermes::RunError::Failed(e)) => return Err(e),
            Err(crate::hermes::RunError::Unsupported) => {
                *chat.hermes_session.lock().unwrap() = None;
            }
        }
    }
    send_hermes(chat, model, query, context, on_delta).await
}

/// The first message of a chat carries the dropped file or the window it was
/// opened from.
fn with_context(first: bool, context: &Option<ChatContext>, query: &str) -> String {
    let mut prompt = String::new();
    if first {
        match context {
            Some(ChatContext::File { name, path }) => {
                prompt.push_str(&format!("File: {name} ({path})\n"));
                if std::fs::metadata(path).map(|m| m.len() <= MAX_INLINE_TEXT).unwrap_or(false) {
                    if let Ok(text) = std::fs::read_to_string(path) {
                        prompt.push_str(&format!("File contents:\n{text}\n\n"));
                    }
                }
            }
            Some(ChatContext::Window { app_name, title, url }) => {
                prompt.push_str(&format!("Context — App: {app_name}, Window: {title}"));
                if let Some(u) = url {
                    prompt.push_str(&format!(", URL: {u}"));
                }
                prompt.push_str("\n\n");
            }
            None => {}
        }
    }
    prompt.push_str(query);
    prompt
}

/// An image as an OpenAI `image_url` part (data URL), when the file is one.
fn image_part(path: &str) -> Option<Value> {
    let ext = std::path::Path::new(path).extension()?.to_str()?.to_lowercase();
    let media = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => return None,
    };
    if std::fs::metadata(path).ok()?.len() > MAX_INLINE_IMAGE {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    Some(json!({
        "type": "image_url",
        "image_url": { "url": format!("data:{media};base64,{}", base64(&bytes)) },
    }))
}

/// Any OpenAI-compatible server (OpenAI, OpenRouter, Ollama, LM Studio…).
async fn send_openai(
    chat: &Chat,
    p: &crate::settings::ChatProvider,
    query: String,
    context: Option<ChatContext>,
    on_delta: &(dyn Fn(&str) + Send + Sync),
) -> Result<ChatReply, String> {
    let url = format!("{}/chat/completions", p.base_url.trim().trim_end_matches('/'));
    let key = secrets::get(&format!("provider-key:{}", p.id));
    let content = with_context(chat.is_empty(), &context, &query);
    chat.push(json!({ "role": "user", "content": content }));
    let mut messages = vec![json!({ "role": "system", "content": SYSTEM_PROMPT })];
    messages.extend(chat.snapshot());
    let body = json!({ "model": p.model, "messages": messages, "stream": true });
    match stream_chat(&url, key.as_deref(), &body, on_delta, &p.name).await {
        Ok(text) => {
            chat.push(json!({ "role": "assistant", "content": text }));
            Ok(ChatReply { text, used: Some(format!("{} · {}", p.name, p.model)) })
        }
        Err(e) => {
            chat.pop();
            Err(e)
        }
    }
}

/// POSTs a chat-completions request and returns the whole reply, streaming
/// the text so far through `on_delta`. Falls back to a plain JSON body when
/// the server ignores `stream`.
async fn stream_chat(
    url: &str,
    key: Option<&str>,
    body: &Value,
    on_delta: &(dyn Fn(&str) + Send + Sync),
    name: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.post(url).header("Content-Type", "application/json; charset=utf-8").json(body);
    if let Some(k) = key {
        req = req.bearer_auth(k);
    }
    let mut response = req.send().await.map_err(|e| format!("Can't reach {name} at {url}: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("{name} returned {status}: {}", text.chars().take(300).collect::<String>()));
    }
    let streamed = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("text/event-stream"));
    let mut reply = String::new();
    if streamed {
        let mut buf: Vec<u8> = Vec::new();
        'read: loop {
            let chunk = match response.chunk().await {
                Ok(Some(c)) => c,
                Ok(None) => break,
                Err(err) => {
                    if reply.is_empty() {
                        return Err(format!("{name} stream broke: {err}"));
                    }
                    break;
                }
            };
            buf.extend_from_slice(&chunk);
            while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = buf.drain(..=pos).collect();
                let line = String::from_utf8_lossy(&line);
                let Some(data) = line.trim().strip_prefix("data:") else { continue };
                let data = data.trim();
                if data == "[DONE]" {
                    break 'read;
                }
                let Ok(event) = serde_json::from_str::<Value>(data) else { continue };
                if let Some(piece) = event.pointer("/choices/0/delta/content").and_then(Value::as_str) {
                    reply.push_str(piece);
                    on_delta(&reply);
                }
            }
        }
    } else {
        let text = response.text().await.map_err(|e| e.to_string())?;
        let parsed: Value = serde_json::from_str(&text).map_err(|e| format!("Invalid JSON from {name}: {e}"))?;
        reply = parsed.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or("").to_string();
    }
    let reply = reply.trim().to_string();
    if reply.is_empty() {
        return Err(format!("No response received from {name}."));
    }
    Ok(reply)
}

/// Lists a provider's models (`GET {base}/models`). Only from a button.
pub async fn list_models(base_url: &str, key: Option<String>) -> Result<Vec<String>, String> {
    let url = format!("{}/models", base_url.trim().trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(&url);
    if let Some(k) = key.filter(|k| !k.is_empty()) {
        req = req.bearer_auth(k);
    }
    let res = req.send().await.map_err(|e| format!("Can't reach {url}: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("{url} returned {status}: {}", text.chars().take(200).collect::<String>()));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("Invalid JSON: {e}"))?;
    let list = v.get("data").or_else(|| v.get("models")).and_then(Value::as_array).cloned().unwrap_or_default();
    Ok(list
        .iter()
        .filter_map(|m| m.get("id").or_else(|| m.get("name")).and_then(Value::as_str).map(str::to_string))
        .collect())
}

async fn send_hermes(
    chat: &Chat,
    model: &str,
    query: String,
    context: Option<ChatContext>,
    on_delta: &(dyn Fn(&str) + Send + Sync),
) -> Result<ChatReply, String> {
    let key = get_hermes_key().ok_or_else(missing_key_message)?;
    let url = get_hermes_url();

    // File / window context rides along with the first message only.
    let mut prompt = String::new();
    let mut image: Option<Value> = None;
    if chat.is_empty() {
        match &context {
            Some(ChatContext::File { name, path }) => {
                prompt.push_str(&format!("File: {name}\n"));
                if let Some(part) = image_part(path) {
                    image = Some(part);
                } else if std::fs::metadata(path).map(|m| m.len() <= MAX_INLINE_TEXT).unwrap_or(false) {
                    if let Ok(text) = std::fs::read_to_string(path) {
                        prompt.push_str(&format!("File contents:\n{text}\n\n"));
                    } else {
                        prompt.push_str(&format!("(Binary file saved at {path})\n\n"));
                    }
                }
            }
            Some(ChatContext::Window { app_name, title, url }) => {
                prompt.push_str(&format!("Context — App: {app_name}, Window: {title}"));
                if let Some(u) = url {
                    prompt.push_str(&format!(", URL: {u}"));
                }
                prompt.push_str("\n\n");
            }
            None => {}
        }
    }
    prompt.push_str(&query);

    let content = match image {
        Some(part) => json!([{ "type": "text", "text": prompt }, part]),
        None => json!(prompt),
    };
    chat.push(json!({ "role": "user", "content": content }));

    let mut messages = vec![json!({ "role": "system", "content": HERMES_SYSTEM })];
    messages.extend(chat.snapshot());
    let body = json!({ "model": model, "messages": messages, "stream": true });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let mut response = match client
        .post(&url)
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json; charset=utf-8")
        .json(&body)
        .send()
        .await
    {
        Ok(res) => res,
        Err(err) => {
            chat.pop();
            return Err(format!("Can't reach Hermes at {url} — is the gateway running? ({err})"));
        }
    };

    let status = response.status();
    if !status.is_success() {
        chat.pop();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Hermes returned {status}: {}", text.chars().take(300).collect::<String>()));
    }

    let streamed = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("text/event-stream"));

    let mut reply_text = String::new();
    if streamed {
        // Server-sent events: `data: {json}` lines, ending with `data: [DONE]`.
        let mut buf: Vec<u8> = Vec::new();
        'read: loop {
            let chunk = match response.chunk().await {
                Ok(Some(c)) => c,
                Ok(None) => break,
                Err(err) => {
                    if reply_text.is_empty() {
                        chat.pop();
                        return Err(format!("Hermes stream broke: {err}"));
                    }
                    break; // keep what already arrived
                }
            };
            buf.extend_from_slice(&chunk);
            while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
                let line: Vec<u8> = buf.drain(..=pos).collect();
                let line = String::from_utf8_lossy(&line);
                let Some(data) = line.trim().strip_prefix("data:") else { continue };
                let data = data.trim();
                if data == "[DONE]" {
                    break 'read;
                }
                let Ok(event) = serde_json::from_str::<Value>(data) else { continue };
                if let Some(piece) = event
                    .pointer("/choices/0/delta/content")
                    .and_then(Value::as_str)
                {
                    reply_text.push_str(piece);
                    on_delta(&reply_text);
                }
            }
        }
    } else {
        // A server that ignores `stream` answers with one JSON body.
        let text = response.text().await.map_err(|e| e.to_string())?;
        let parsed: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => {
                chat.pop();
                return Err(format!("Invalid JSON from Hermes: {e}"));
            }
        };
        reply_text = parsed
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
    }

    let reply_text = reply_text.trim().to_string();
    if reply_text.is_empty() {
        chat.pop();
        return Err("No response received from Hermes Agent.".into());
    }

    chat.push(json!({ "role": "assistant", "content": reply_text }));
    Ok(ChatReply { text: reply_text, used: Some(format!("Hermes · {model}")) })
}

async fn send_claude(
    chat: &Chat,
    model: &str,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let key = secrets::get("anthropic-api-key")
        .ok_or_else(|| "Anthropic API key missing. Open settings.".to_string())?;

    let mut content: Vec<Value> = Vec::new();

    if chat.is_empty() {
        match &context {
            Some(ChatContext::File { name, path }) => {
                if let Some(block) = file_block(path) {
                    content.push(block);
                }
                content.push(json!({ "type": "text", "text": format!("File: {name}") }));
            }
            Some(ChatContext::Window { app_name, title, url }) => {
                let mut text = format!("Context — App: {app_name}, Window: {title}");
                if let Some(url) = url {
                    text.push_str(&format!(", URL: {url}"));
                }
                content.push(json!({ "type": "text", "text": text }));
            }
            None => {}
        }
    }
    content.push(json!({ "type": "text", "text": query }));

    chat.push(json!({ "role": "user", "content": content }));

    let body = json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM_PROMPT,
        "tools": [{ "type": "web_search_20260209", "name": "web_search", "max_uses": 5 }],
        "fallbacks": "default",
        "messages": chat.snapshot(),
    });

    let response = match call(&key, &body).await {
        Ok(v) => v,
        Err(err) => {
            chat.pop();
            return Err(err);
        }
    };

    if response.get("stop_reason").and_then(Value::as_str) == Some("refusal") {
        chat.pop();
        let why = response
            .get("stop_details")
            .and_then(|d| d.get("explanation"))
            .and_then(Value::as_str)
            .unwrap_or("Claude declined this one.");
        return Err(why.to_string());
    }

    let Some(blocks) = response.get("content").and_then(Value::as_array).cloned() else {
        chat.pop();
        return Err("Unexpected API response.".into());
    };

    chat.push(json!({ "role": "assistant", "content": blocks.clone() }));

    let text = blocks
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

    if text.is_empty() {
        return Err("No response text.".into());
    }
    Ok(ChatReply { text, used: Some(format!("Claude · {model}")) })
}

async fn call(key: &str, body: &Value) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .post(ANTHROPIC_ENDPOINT)
        .header("x-api-key", key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("anthropic-beta", FALLBACK_BETA)
        .header("content-type", "application/json")
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let detail = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| text.chars().take(200).collect());
        return Err(format!("Claude API {status}: {detail}"));
    }
    serde_json::from_str(&text).map_err(|e| format!("Bad API response: {e}"))
}

fn file_block(path: &str) -> Option<Value> {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let media_type = match ext.as_str() {
        "pdf" => Some(("document", "application/pdf")),
        "jpg" | "jpeg" => Some(("image", "image/jpeg")),
        "png" => Some(("image", "image/png")),
        "gif" => Some(("image", "image/gif")),
        "webp" => Some(("image", "image/webp")),
        _ => None,
    };

    if let Some((block_type, media)) = media_type {
        let bytes = std::fs::read(path).ok()?;
        return Some(json!({
            "type": block_type,
            "source": { "type": "base64", "media_type": media, "data": base64(&bytes) },
        }));
    }

    let len = std::fs::metadata(path).ok()?.len();
    if len > MAX_INLINE_TEXT {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    Some(json!({ "type": "text", "text": format!("File contents:\n{text}") }))
}

pub(crate) fn base64_for(bytes: &[u8]) -> String {
    base64(bytes)
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::base64;

    #[test]
    fn base64_matches_rfc4648_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
}
