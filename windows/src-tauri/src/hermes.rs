// Hermes Agent through its Runs API (http://127.0.0.1:8642 by default).
//
// A run is one agent turn in a real Hermes session: memory, tools, skills.
// `POST /v1/runs` starts it, `GET /v1/runs/{id}/events` streams what happens:
//   message.delta    → the chat bubble types along
//   tool.started/... → steps in the Agents hub, like any hooked agent
//   approval.request → the island's approval card; the click goes back via
//                      `POST /v1/runs/{id}/approval`
//   run.completed    → the final answer
// Island events are emitted as the same "hook" payloads Claude Code sends, so
// the hub shows a Hermes run exactly like any other session.

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::claude::{get_hermes_key, get_hermes_url, ChatReply};
use crate::island::WINDOW_LABEL;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProvider {
    pub slug: String,
    pub name: String,
    pub models: Vec<String>,
    /// Models that take a reasoning effort.
    pub reasoning: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOptions {
    pub model: String,
    pub provider: String,
    pub providers: Vec<ModelProvider>,
}

/// What the chat's model picker offers: Hermes' default and every provider
/// it is signed in to (GET /api/model/options). Only when the picker opens.
pub async fn model_options() -> Result<ModelOptions, String> {
    let res = client(10)?
        .get(format!("{}/api/model/options", base_url()))
        .bearer_auth(key()?)
        .send()
        .await
        .map_err(|e| format!("Can't reach Hermes: {e}"))?;
    let status = res.status();
    let v: Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Hermes returned {status}"));
    }
    let providers = v["providers"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|p| p["authenticated"] == true)
        .map(|p| {
            let models: Vec<String> =
                p["models"].as_array().into_iter().flatten().filter_map(|m| m.as_str().map(str::to_string)).collect();
            let reasoning = p["capabilities"]
                .as_object()
                .map(|caps| caps.iter().filter(|(_, c)| c["reasoning"] == true).map(|(m, _)| m.clone()).collect())
                .unwrap_or_default();
            ModelProvider {
                slug: p["slug"].as_str().unwrap_or("").to_string(),
                name: p["name"].as_str().unwrap_or("").to_string(),
                models,
                reasoning,
            }
        })
        .collect();
    Ok(ModelOptions {
        model: v["model"].as_str().unwrap_or("").to_string(),
        provider: v["provider"].as_str().unwrap_or("").to_string(),
        providers,
    })
}

/// Approval card ids for runs carry the run: "hermes-run:<run_id>:<request_id>".
pub const APPROVAL_PREFIX: &str = "hermes-run:";

/// "http://127.0.0.1:8642" from whatever form the URL setting holds.
pub fn base_url() -> String {
    let url = get_hermes_url();
    url.trim_end_matches("/chat/completions").trim_end_matches("/v1").to_string()
}

fn key() -> Result<String, String> {
    get_hermes_key().ok_or_else(|| {
        "Hermes API key missing. Add it in Settings, or check API_SERVER_KEY in %LOCALAPPDATA%\\hermes\\.env.".into()
    })
}

fn client(timeout_s: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_s))
        .build()
        .map_err(|e| e.to_string())
}

fn hook(app: &AppHandle, event: &str, session: &str, extra: Value) {
    let mut payload = json!({
        "hook_event_name": event,
        "session_id": session,
        "agent_source": "hermes",
        "cwd": "",
    });
    if let (Some(p), Some(e)) = (payload.as_object_mut(), extra.as_object()) {
        for (k, v) in e {
            p.insert(k.clone(), v.clone());
        }
    }
    let _ = app.emit_to(WINDOW_LABEL, "hook", payload);
}

/// Why a run could not be used, so the caller can fall back to plain chat.
pub enum RunError {
    /// The server has no Runs API (older Hermes): use chat completions.
    Unsupported,
    Failed(String),
}

/// One turn in Hermes session `session`, streamed. `show_in_hub` also mirrors
/// the run into the Agents hub (tool steps, approvals, the answer).
/// The model the user picked in the chat ("" = Hermes' own default).
pub struct Pick {
    pub model: String,
    pub provider: String,
    pub effort: String,
}

pub async fn run_turn(
    app: &AppHandle,
    session: &str,
    input: &str,
    instructions: Option<&str>,
    pick: Option<&Pick>,
    on_delta: &(dyn Fn(&str) + Send + Sync),
) -> Result<ChatReply, RunError> {
    let key = key().map_err(RunError::Failed)?;
    let base = base_url();
    let http = client(600).map_err(RunError::Failed)?;

    let mut body = json!({ "input": input, "session_id": session });
    if let Some(i) = instructions {
        body["instructions"] = json!(i);
    }
    // /v1/runs always honours a requested model (api-server.md, per-request
    // model selection).
    if let Some(p) = pick {
        if !p.model.is_empty() {
            body["model"] = json!(p.model);
            if !p.provider.is_empty() {
                body["provider"] = json!(p.provider);
            }
        }
        if !p.effort.is_empty() {
            body["model_options"] = json!({ "reasoning_effort": p.effort });
        }
    }
    let res = http
        .post(format!("{base}/v1/runs"))
        .bearer_auth(&key)
        .json(&body)
        .send()
        .await
        .map_err(|e| RunError::Failed(format!("Can't reach Hermes at {base} — is the gateway running? ({e})")))?;
    if res.status().as_u16() == 404 {
        return Err(RunError::Unsupported);
    }
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(RunError::Failed(format!("Hermes returned {status}: {}", text.chars().take(300).collect::<String>())));
    }
    let run_id = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| v["run_id"].as_str().map(str::to_string))
        .ok_or_else(|| RunError::Failed("Hermes didn't return a run id.".into()))?;

    hook(app, "UserPromptSubmit", session, json!({ "prompt": input }));

    let mut res = http
        .get(format!("{base}/v1/runs/{run_id}/events"))
        .bearer_auth(&key)
        .header("Accept", "text/event-stream")
        .send()
        .await
        .map_err(|e| RunError::Failed(format!("Hermes event stream: {e}")))?;

    let mut reply = String::new();
    let mut final_text: Option<String> = None;
    let mut used: Option<String> = None;
    let mut buf: Vec<u8> = Vec::new();
    'read: loop {
        let chunk = match res.chunk().await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => {
                if reply.is_empty() {
                    return Err(RunError::Failed(format!("Hermes stream broke: {e}")));
                }
                break;
            }
        };
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line);
            let Some(data) = line.trim().strip_prefix("data:") else { continue };
            let Ok(ev) = serde_json::from_str::<Value>(data.trim()) else { continue };
            match ev["event"].as_str().unwrap_or_default() {
                "message.delta" => {
                    if let Some(d) = ev["delta"].as_str() {
                        reply.push_str(d);
                        on_delta(&reply);
                    }
                }
                "message.interim" => {
                    if ev["already_streamed"] != true {
                        if let Some(t) = ev["text"].as_str() {
                            reply.push_str(t);
                            on_delta(&reply);
                        }
                    }
                }
                "reasoning.available" => {
                    if let Some(t) = ev["text"].as_str().filter(|t| !t.trim().is_empty()) {
                        hook(app, "AgentThought", session, json!({ "message": t }));
                    }
                }
                "tool.started" => hook(
                    app,
                    "PreToolUse",
                    session,
                    json!({
                        "tool_name": ev["tool"],
                        "tool_input": { "command": ev["preview"] },
                    }),
                ),
                "tool.completed" => {
                    let mut extra = json!({ "tool_name": ev["tool"], "tool_input": {} });
                    if ev["error"] == true {
                        extra["error"] = json!(ev["preview"].as_str().unwrap_or("error"));
                    }
                    hook(app, "PostToolUse", session, extra);
                }
                "approval.request" => {
                    let request = ev["request_id"].as_str().unwrap_or("");
                    let command = ev["command"].as_str().unwrap_or("");
                    let description = ev["description"].as_str().unwrap_or("");
                    hook(
                        app,
                        "PermissionRequest",
                        session,
                        json!({
                            "request_id": format!("{APPROVAL_PREFIX}{run_id}:{request}"),
                            "tool_name": "terminal",
                            "tool_input": { "command": command, "description": description },
                        }),
                    );
                }
                "run.completed" => {
                    final_text = ev["output"].as_str().map(str::to_string);
                    // The pair that really served the turn (after any fallback).
                    let rt = &ev["runtime"];
                    if let (Some(prov), Some(model)) = (rt["provider"].as_str(), rt["model"].as_str()) {
                        let effort = pick.map(|p| p.effort.as_str()).filter(|e| !e.is_empty());
                        used = Some(match effort {
                            Some(e) => format!("{prov} · {model} · {e}"),
                            None => format!("{prov} · {model}"),
                        });
                    }
                    break 'read;
                }
                "run.failed" | "run.cancelled" | "run.interrupted" => {
                    let err = ev["error"].as_str().unwrap_or("The Hermes run stopped.").to_string();
                    hook(app, "StopFailure", session, json!({ "message": err }));
                    if reply.is_empty() {
                        return Err(RunError::Failed(err));
                    }
                    break 'read;
                }
                _ => {}
            }
        }
    }

    let text = final_text.filter(|t| !t.trim().is_empty()).unwrap_or(reply).trim().to_string();
    if text.is_empty() {
        return Err(RunError::Failed("No response received from Hermes Agent.".into()));
    }
    hook(app, "Stop", session, json!({ "last_assistant_message": text }));
    Ok(ChatReply { text, used })
}

/// The island's Allow / Always / Deny for a run's approval card.
pub async fn answer(request_id: &str, decision: &str) -> Result<(), String> {
    let rest = request_id.strip_prefix(APPROVAL_PREFIX).ok_or("not a Hermes run approval")?;
    let (run_id, req) = rest.split_once(':').unwrap_or((rest, ""));
    let choice = match decision {
        "allow" => "once",
        "always" => "always",
        _ => "deny",
    };
    let mut body = json!({ "choice": choice });
    if !req.is_empty() {
        body["request_id"] = json!(req);
    }
    let res = client(10)?
        .post(format!("{}/v1/runs/{run_id}/approval", base_url()))
        .bearer_auth(key()?)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Hermes refused the approval ({status}): {}", text.chars().take(200).collect::<String>()));
    }
    Ok(())
}
