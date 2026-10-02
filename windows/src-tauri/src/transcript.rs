// What an agent said and thought, read from its own transcript.
//
// Hooks only tell us about tool calls. The words in between — "I'll fix the
// test first", the final answer — live in the transcript the agent writes as it
// goes. Both Claude Code (`transcript_path`) and AGY (`transcriptPath`) hand
// us that path with every hook event, so the island reads only the bytes added
// since its last look, right when a hook fires. Nothing polls: idle stays 0 %.
//
//   Claude Code: one JSON object per line; `type: "assistant"` lines carry
//                `message.content[]` blocks of `text` / `thinking` / `tool_use`.
//   AGY:         `transcript_full.jsonl`; `type: "USER_INPUT"` holds the prompt
//                inside <USER_REQUEST>…</USER_REQUEST>, `PLANNER_RESPONSE`
//                carries `content` (what it says) and `thinking`.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;

/// How far back to look the first time a transcript is seen.
const FIRST_LOOK: u64 = 48 * 1024;
/// Never read more than this in one go (a huge burst skips to the end).
const MAX_READ: u64 = 1024 * 1024;
/// Longest text handed to the island per step.
const MAX_TEXT: usize = 600;

static OFFSETS: Mutex<Option<HashMap<PathBuf, u64>>> = Mutex::new(None);

#[derive(Serialize, Debug, PartialEq)]
pub struct Step {
    /// "prompt" | "say" | "think"
    pub kind: &'static str,
    pub text: String,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(PathBuf::from)
}

/// Only an agent's own transcript folder may be read.
fn allowed(agent: &str, path: &Path) -> bool {
    let Some(home) = home() else { return false };
    let root = match agent {
        "claude" => home.join(".claude").join("projects"),
        "agy" => home.join(".gemini"),
        _ => return false,
    };
    if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
        return false;
    }
    match (path.canonicalize(), root.canonicalize()) {
        (Ok(p), Ok(r)) => p.starts_with(r),
        _ => false,
    }
}

/// New steps written to `path` since the last call for that file.
pub fn tail(agent: &str, path: &str) -> Result<Vec<Step>, String> {
    let path = PathBuf::from(path.replace('/', "\\"));
    if !allowed(agent, &path) {
        return Err("not an agent transcript".into());
    }
    let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();

    let mut offsets = OFFSETS.lock().unwrap();
    let map = offsets.get_or_insert_with(HashMap::new);
    let first = !map.contains_key(&path);
    let mut start = *map.get(&path).unwrap_or(&len.saturating_sub(FIRST_LOOK));
    if start > len {
        start = 0; // rewritten or truncated
    }
    if len - start > MAX_READ {
        start = len - MAX_READ;
    }
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
    let mut buf = Vec::with_capacity((len - start) as usize);
    file.take(len - start).read_to_end(&mut buf).map_err(|e| e.to_string())?;

    // Only whole lines; a half-written last line is read next time.
    let Some(end) = buf.iter().rposition(|&b| b == b'\n') else {
        map.insert(path, start);
        return Ok(Vec::new());
    };
    map.insert(path, start + end as u64 + 1);
    let mut chunk = &buf[..end];
    // Starting mid-file: drop the partial first line.
    if start > 0 && (first || start == len.saturating_sub(MAX_READ)) {
        match chunk.iter().position(|&b| b == b'\n') {
            Some(i) => chunk = &chunk[i + 1..],
            None => return Ok(Vec::new()),
        }
    }
    let text = String::from_utf8_lossy(chunk);
    Ok(parse(agent, &text))
}

pub fn parse(agent: &str, text: &str) -> Vec<Step> {
    let mut out = Vec::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        match agent {
            "claude" => claude_line(&v, &mut out),
            "agy" => agy_line(&v, &mut out),
            _ => {}
        }
    }
    out
}

fn claude_line(v: &Value, out: &mut Vec<Step>) {
    if v["type"] != "assistant" || v["isSidechain"] == true {
        return;
    }
    let Some(blocks) = v["message"]["content"].as_array() else { return };
    for b in blocks {
        match b["type"].as_str() {
            Some("text") => push(out, "say", b["text"].as_str()),
            Some("thinking") => push(out, "think", b["thinking"].as_str()),
            _ => {}
        }
    }
}

fn agy_line(v: &Value, out: &mut Vec<Step>) {
    match v["type"].as_str() {
        Some("USER_INPUT") => {
            let content = v["content"].as_str().unwrap_or("");
            let asked = between(content, "<USER_REQUEST>", "</USER_REQUEST>").unwrap_or(content);
            push(out, "prompt", Some(asked));
        }
        Some("PLANNER_RESPONSE") => {
            push(out, "think", v["thinking"].as_str());
            push(out, "say", v["content"].as_str());
        }
        _ => {}
    }
}

fn between<'a>(s: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let a = s.find(open)? + open.len();
    let b = s[a..].find(close)? + a;
    Some(&s[a..b])
}

fn push(out: &mut Vec<Step>, kind: &'static str, text: Option<&str>) {
    let Some(text) = text else { return };
    let clean = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.is_empty() {
        return;
    }
    let text = if clean.chars().count() > MAX_TEXT {
        let mut s: String = clean.chars().take(MAX_TEXT).collect();
        s.push('…');
        s
    } else {
        clean
    };
    out.push(Step { kind, text });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_text_and_thinking_but_not_tools_or_subagents() {
        let t = r#"{"type":"user","message":{"content":"hi"}}
{"type":"assistant","isSidechain":false,"message":{"content":[{"type":"thinking","thinking":""},{"type":"text","text":"Fixing the\n test."},{"type":"tool_use","name":"Bash"}]}}
{"type":"assistant","isSidechain":true,"message":{"content":[{"type":"text","text":"sub"}]}}"#;
        assert_eq!(parse("claude", t), vec![Step { kind: "say", text: "Fixing the test.".into() }]);
    }

    #[test]
    fn agy_prompt_thinking_and_answer() {
        let t = r#"{"type":"USER_INPUT","content":"<USER_REQUEST>\nสวัสดี\n</USER_REQUEST>\n<ADDITIONAL_METADATA>x</ADDITIONAL_METADATA>"}
{"type":"PLANNER_RESPONSE","thinking":"Plan it.","tool_calls":[]}
{"type":"GENERIC","content":"tool output"}
{"type":"PLANNER_RESPONSE","content":"Done."}"#;
        assert_eq!(
            parse("agy", t),
            vec![
                Step { kind: "prompt", text: "สวัสดี".into() },
                Step { kind: "think", text: "Plan it.".into() },
                Step { kind: "say", text: "Done.".into() },
            ]
        );
    }

    #[test]
    fn refuses_files_outside_agent_folders() {
        assert!(!allowed("claude", Path::new("C:\\Windows\\win.ini")));
        assert!(!allowed("hermes", Path::new("C:\\x.jsonl")));
    }
}
