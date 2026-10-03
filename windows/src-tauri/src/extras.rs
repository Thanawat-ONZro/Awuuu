// Everyday integrations that need no OAuth app: mail over IMAP (an app
// password), a calendar's private iCal link, RSS/Atom feeds, uptime checks,
// the weather (Open-Meteo, no key) and Todoist (a personal token).
//
// Same contract as integrations.rs: nothing runs until it is configured,
// nothing runs while paused, every poll emits one `integration` update and
// an `event` only when something new happened.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

use crate::integrations::{emit, IntegrationEvent, IntegrationUpdate};
use crate::secrets;

fn settings(app: &AppHandle) -> Option<crate::settings::Settings> {
    app.try_state::<crate::Shared>().map(|s| s.settings.lock().unwrap().clone())
}

/// Things already announced, so an event fires once.
static SEEN: std::sync::LazyLock<Mutex<HashSet<String>>> = std::sync::LazyLock::new(|| Mutex::new(HashSet::new()));
/// First poll of each source fills cards quietly.
static PRIMED: std::sync::LazyLock<Mutex<HashSet<&'static str>>> = std::sync::LazyLock::new(|| Mutex::new(HashSet::new()));

fn first_poll(id: &'static str) -> bool {
    PRIMED.lock().unwrap().insert(id)
}

fn announce(key: String) -> bool {
    SEEN.lock().unwrap().insert(key)
}

pub fn configured(app: &AppHandle, id: &str) -> bool {
    let Some(s) = settings(app) else { return false };
    match id {
        "integration_mail" => !s.mail_host.is_empty() && !s.mail_user.is_empty() && secrets::present("mail-password"),
        "integration_calendar" => secrets::present("ical-url"),
        "integration_feeds" => !s.rss_feeds.is_empty(),
        "integration_uptime" => !s.uptime_urls.is_empty(),
        "integration_weather" => !s.weather_city.trim().is_empty(),
        "integration_todoist" => secrets::present("todoist-token"),
        _ => false,
    }
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn update(app: &AppHandle, id: &'static str, data: Value, error: Option<String>, event: Option<IntegrationEvent>) {
    emit(app, IntegrationUpdate { id, data, error, event });
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("Awuuu")
        .build()
        .unwrap_or_default()
}

// ── Mail (IMAP) ───────────────────────────────────────────────────────────────

/// RFC 2047 encoded words (=?UTF-8?B?…?=, =?TIS-620?Q?…?=) → text.
pub fn decode_words(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    let mut last_was_word = false;
    while let Some(start) = rest.find("=?") {
        let before = &rest[..start];
        if !(last_was_word && before.trim().is_empty()) {
            out.push_str(before);
        }
        let after = &rest[start + 2..];
        let parts: Vec<&str> = after.splitn(3, '?').collect();
        if parts.len() < 3 {
            out.push_str(&rest[start..]);
            return out;
        }
        let (charset, enc, tail) = (parts[0], parts[1], parts[2]);
        let Some(end) = tail.find("?=") else {
            out.push_str(&rest[start..]);
            return out;
        };
        let text = &tail[..end];
        let bytes = match enc.to_ascii_uppercase().as_str() {
            "B" => base64_decode(text),
            _ => q_decode(text),
        };
        out.push_str(&charset_decode(charset, &bytes));
        rest = &tail[end + 2..];
        last_was_word = true;
    }
    out.push_str(rest);
    out
}

fn q_decode(s: &str) -> Vec<u8> {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'_' => out.push(b' '),
            b'=' if i + 2 < b.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(b'=');
            }
            c => out.push(c),
        }
        i += 1;
    }
    out
}

fn base64_decode(s: &str) -> Vec<u8> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            _ => return None,
        })
    };
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0;
    for &c in s.as_bytes() {
        let Some(v) = val(c) else { continue };
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    out
}

/// UTF-8, Latin-1 and the Thai single-byte sets (TIS-620 / windows-874).
fn charset_decode(charset: &str, bytes: &[u8]) -> String {
    match charset.to_ascii_lowercase().as_str() {
        "tis-620" | "windows-874" | "iso-8859-11" | "cp874" => bytes
            .iter()
            .map(|&b| match b {
                0xA1..=0xFB => char::from_u32(0x0E01 + (b - 0xA1) as u32).unwrap_or('?'),
                _ => b as char,
            })
            .collect(),
        "iso-8859-1" | "latin1" | "us-ascii" => bytes.iter().map(|&b| b as char).collect(),
        _ => String::from_utf8_lossy(bytes).to_string(),
    }
}

/// Header block → (name lowercased, unfolded value).
fn headers(block: &str) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for line in block.split("\r\n").flat_map(|l| l.split('\n')) {
        if line.starts_with(' ') || line.starts_with('\t') {
            if let Some(last) = out.last_mut() {
                last.1.push(' ');
                last.1.push_str(line.trim());
            }
        } else if let Some((k, v)) = line.split_once(':') {
            out.push((k.trim().to_ascii_lowercase(), v.trim().to_string()));
        }
    }
    out
}

/// "Name <a@b>" → "Name"; "a@b" → "a@b".
fn sender_name(from: &str) -> String {
    let from = decode_words(from);
    match from.find('<') {
        Some(i) if i > 0 => from[..i].trim().trim_matches('"').to_string(),
        _ => from.trim_matches(|c| c == '<' || c == '>').to_string(),
    }
}

fn imap_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

struct Imap<S> {
    r: BufReader<S>,
    tag: u32,
}

impl<S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin> Imap<S> {
    /// Sends one command and returns every line of the reply (literals inlined).
    async fn cmd(&mut self, c: &str) -> Result<Vec<String>, String> {
        self.tag += 1;
        let tag = format!("a{}", self.tag);
        self.r.get_mut().write_all(format!("{tag} {c}\r\n").as_bytes()).await.map_err(|e| e.to_string())?;
        let mut lines = Vec::new();
        loop {
            let mut line = String::new();
            if self.r.read_line(&mut line).await.map_err(|e| e.to_string())? == 0 {
                return Err("the mail server closed the connection".into());
            }
            // A literal: {n} at the end, then exactly n bytes.
            if let Some(n) = line.trim_end().strip_suffix('}').and_then(|l| l.rsplit_once('{')).and_then(|(_, n)| n.parse::<usize>().ok()) {
                let mut buf = vec![0u8; n];
                self.r.read_exact(&mut buf).await.map_err(|e| e.to_string())?;
                line.push_str(&String::from_utf8_lossy(&buf));
            }
            if let Some(status) = line.strip_prefix(&format!("{tag} ")) {
                if status.starts_with("OK") {
                    return Ok(lines);
                }
                return Err(status.trim().to_string());
            }
            lines.push(line);
        }
    }
}

pub struct MailHost {
    pub host: String,
    pub port: u16,
}

pub fn mail_host(setting: &str) -> MailHost {
    let (host, port) = match setting.to_ascii_lowercase().as_str() {
        "gmail" => ("imap.gmail.com".to_string(), 993),
        "outlook" => ("outlook.office365.com".to_string(), 993),
        "icloud" => ("imap.mail.me.com".to_string(), 993),
        "yahoo" => ("imap.mail.yahoo.com".to_string(), 993),
        other => match other.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), p.parse().unwrap_or(993)),
            None => (other.to_string(), 993),
        },
    };
    MailHost { host, port }
}

async fn imap_poll(host: &MailHost, user: &str, pass: &str) -> Result<Value, String> {
    use tokio_rustls::rustls;
    let tcp = tokio::time::timeout(Duration::from_secs(12), tokio::net::TcpStream::connect((host.host.as_str(), host.port)))
        .await
        .map_err(|_| "Can't reach the mail server (timed out).".to_string())?
        .map_err(|e| format!("Can't reach {}: {e}", host.host))?;
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let config = rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_root_certificates(roots)
        .with_no_client_auth();
    let name = rustls::pki_types::ServerName::try_from(host.host.clone()).map_err(|e| e.to_string())?;
    let tls = tokio_rustls::TlsConnector::from(Arc::new(config))
        .connect(name, tcp)
        .await
        .map_err(|e| format!("TLS with {}: {e}", host.host))?;
    let mut imap = Imap { r: BufReader::new(tls), tag: 0 };
    let mut greeting = String::new();
    imap.r.read_line(&mut greeting).await.map_err(|e| e.to_string())?;

    let work = async {
        imap.cmd(&format!("LOGIN {} {}", imap_quote(user), imap_quote(pass)))
            .await
            .map_err(|e| format!("Sign-in refused ({e}). Use an app password."))?;
        imap.cmd("EXAMINE INBOX").await?;
        let found = imap.cmd("UID SEARCH UNSEEN").await?;
        let mut uids: Vec<u64> = found
            .iter()
            .filter_map(|l| l.strip_prefix("* SEARCH"))
            .flat_map(|l| l.split_whitespace().filter_map(|n| n.parse().ok()).collect::<Vec<u64>>())
            .collect();
        uids.sort_unstable();
        let unread = uids.len();
        let recent: Vec<String> = uids.iter().rev().take(5).map(|u| u.to_string()).collect();
        let mut messages = Vec::new();
        if !recent.is_empty() {
            let lines = imap
                .cmd(&format!("UID FETCH {} (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)])", recent.join(",")))
                .await?;
            for l in lines {
                let uid = l
                    .split("UID ")
                    .nth(1)
                    .and_then(|r| r.split(|c: char| !c.is_ascii_digit()).next())
                    .unwrap_or("")
                    .to_string();
                let Some(i) = l.find("\r\n") else { continue };
                let h = headers(&l[i + 2..]);
                let get = |k: &str| h.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone()).unwrap_or_default();
                messages.push(json!({
                    "uid": uid,
                    "from": sender_name(&get("from")),
                    "subject": decode_words(&get("subject")),
                    "date": get("date"),
                    "messageId": get("message-id").trim_matches(|c| c == '<' || c == '>').to_string(),
                }));
            }
            messages.sort_by(|a, b| b["uid"].as_str().unwrap_or("").parse::<u64>().unwrap_or(0).cmp(&a["uid"].as_str().unwrap_or("").parse::<u64>().unwrap_or(0)));
        }
        let _ = imap.cmd("LOGOUT").await;
        Ok::<Value, String>(json!({ "unread": unread, "messages": messages }))
    };
    tokio::time::timeout(Duration::from_secs(25), work).await.map_err(|_| "The mail server took too long.".to_string())?
}

pub async fn poll_mail(app: AppHandle) {
    let Some(s) = settings(&app) else { return };
    let Some(pass) = secrets::get("mail-password") else { return };
    let host = mail_host(&s.mail_host);
    let gmail = host.host.contains("gmail");
    match imap_poll(&host, &s.mail_user, &pass).await {
        Ok(mut data) => {
            data["gmail"] = json!(gmail);
            let quiet = first_poll("mail");
            let mut event = None;
            for m in data["messages"].as_array().cloned().unwrap_or_default() {
                let key = format!("mail-{}", m["uid"].as_str().unwrap_or(""));
                if announce(key) && !quiet && event.is_none() {
                    event = Some(IntegrationEvent {
                        success: true,
                        label: format!("{} · {}", m["from"].as_str().unwrap_or(""), m["subject"].as_str().unwrap_or("")),
                        detail: None,
                    });
                }
            }
            update(&app, "integration_mail", data, None, event);
        }
        Err(e) => update(&app, "integration_mail", json!({}), Some(e), None),
    }
}

// ── Calendar (iCal link) ──────────────────────────────────────────────────────

/// The machine's offset from UTC in seconds (Windows' current zone, DST included).
fn local_offset() -> i64 {
    use windows::Win32::System::Time::{GetTimeZoneInformation, TIME_ZONE_INFORMATION};
    let mut tz = TIME_ZONE_INFORMATION::default();
    let id = unsafe { GetTimeZoneInformation(&mut tz) };
    let mut bias = tz.Bias as i64;
    if id == 2 {
        bias += tz.DaylightBias as i64;
    } else {
        bias += tz.StandardBias as i64;
    }
    -bias * 60
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// iCal date/time → (epoch secs, all-day). Z = UTC; a TZID or floating time
/// is taken as this machine's local time (personal calendars almost always
/// are); a bare date is all-day.
pub fn ical_time(value: &str, offset: i64) -> Option<(i64, bool)> {
    let v = value.trim();
    let num = |a: usize, n: usize| v.get(a..a + n)?.parse::<i64>().ok();
    let days = days_from_civil(num(0, 4)?, num(4, 2)?, num(6, 2)?);
    if v.len() == 8 {
        return Some((days * 86400 - offset, true));
    }
    let secs = days * 86400 + num(9, 2)? * 3600 + num(11, 2)? * 60 + num(13, 2).unwrap_or(0);
    Some((if v.ends_with('Z') { secs } else { secs - offset }, false))
}

#[derive(Debug, Clone)]
pub struct CalEvent {
    pub title: String,
    pub start: i64,
    pub end: i64,
    pub all_day: bool,
    pub location: String,
    pub join: Option<String>,
}

fn join_link(text: &str) -> Option<String> {
    for host in ["meet.google.com/", "zoom.us/j/", "teams.microsoft.com/l/meetup-join", "teams.live.com/meet"] {
        if let Some(i) = text.find(host) {
            let start = text[..i].rfind("https://").unwrap_or(i);
            let end = text[i..].find(|c: char| c.is_whitespace() || c == '"' || c == '>' || c == '\\').map(|e| i + e).unwrap_or(text.len());
            let url = &text[start..end];
            return Some(if url.starts_with("https://") { url.to_string() } else { format!("https://{url}") });
        }
    }
    None
}

/// Events overlapping [from, to), recurring ones expanded (DAILY/WEEKLY with
/// INTERVAL, BYDAY, COUNT, UNTIL — what personal calendars mostly use).
pub fn ical_events(text: &str, from: i64, to: i64, offset: i64) -> Vec<CalEvent> {
    let unfolded = text.replace("\r\n ", "").replace("\n ", "").replace("\r\n\t", "").replace("\n\t", "");
    let mut out = Vec::new();
    for block in unfolded.split("BEGIN:VEVENT").skip(1) {
        let block = block.split("END:VEVENT").next().unwrap_or("");
        let mut props: Vec<(String, String, String)> = Vec::new();
        for line in block.lines() {
            let Some((head, value)) = line.split_once(':') else { continue };
            let (name, params) = head.split_once(';').unwrap_or((head, ""));
            props.push((name.to_ascii_uppercase(), params.to_string(), value.to_string()));
        }
        let get = |n: &str| props.iter().find(|p| p.0 == n).map(|p| p.2.clone());
        let unescape = |s: String| s.replace("\\n", " ").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\");
        let Some((start, all_day)) = get("DTSTART").and_then(|v| ical_time(&v, offset)) else { continue };
        let end = get("DTEND").and_then(|v| ical_time(&v, offset)).map(|e| e.0).unwrap_or(start + if all_day { 86400 } else { 3600 });
        if get("STATUS").is_some_and(|s| s.eq_ignore_ascii_case("CANCELLED")) {
            continue;
        }
        let title = unescape(get("SUMMARY").unwrap_or_else(|| "Event".into()));
        let location = unescape(get("LOCATION").unwrap_or_default());
        let blob = format!("{} {} {} {}", location, get("DESCRIPTION").unwrap_or_default(), get("URL").unwrap_or_default(), get("X-GOOGLE-CONFERENCE").unwrap_or_default());
        let join = join_link(&blob);
        let dur = end - start;
        let make = |s: i64| CalEvent { title: title.clone(), start: s, end: s + dur, all_day, location: location.clone(), join: join.clone() };

        match get("RRULE") {
            None => {
                if start < to && start + dur > from {
                    out.push(make(start));
                }
            }
            Some(rule) => {
                let part = |k: &str| rule.split(';').find_map(|p| p.strip_prefix(&format!("{k}=")).map(str::to_string));
                let freq = part("FREQ").unwrap_or_default();
                let interval = part("INTERVAL").and_then(|v| v.parse::<i64>().ok()).unwrap_or(1).max(1);
                let count = part("COUNT").and_then(|v| v.parse::<i64>().ok());
                let until = part("UNTIL").and_then(|v| ical_time(&v, offset)).map(|u| u.0);
                let byday: Vec<i64> = part("BYDAY")
                    .map(|d| {
                        d.split(',')
                            .filter_map(|x| ["SU", "MO", "TU", "WE", "TH", "FR", "SA"].iter().position(|w| x.ends_with(w)).map(|p| p as i64))
                            .collect()
                    })
                    .unwrap_or_default();
                let step = match freq.as_str() {
                    "DAILY" => 86400,
                    "WEEKLY" => 86400 * 7,
                    _ => continue,
                };
                let mut n = 0i64;
                let mut base = start;
                while base < to + step && n < 2000 {
                    let candidates: Vec<i64> = if freq == "WEEKLY" && !byday.is_empty() {
                        // Local weekday of `base` (0 = Sunday), then each BYDAY in that week.
                        let wd = ((base + offset).div_euclid(86400) + 4).rem_euclid(7);
                        byday.iter().map(|d| base + (d - wd) * 86400).filter(|t| *t >= start).collect()
                    } else {
                        vec![base]
                    };
                    for t in candidates {
                        n += 1;
                        if count.is_some_and(|c| n > c) || until.is_some_and(|u| t > u) {
                            break;
                        }
                        if t < to && t + dur > from {
                            out.push(make(t));
                        }
                    }
                    if count.is_some_and(|c| n >= c) || until.is_some_and(|u| base > u) {
                        break;
                    }
                    base += step * interval;
                }
            }
        }
    }
    out.sort_by_key(|e| e.start);
    out
}

pub async fn poll_calendar(app: AppHandle) {
    let Some(url) = secrets::get("ical-url") else { return };
    let url = url.trim().replacen("webcal://", "https://", 1);
    let text = match http().get(&url).send().await {
        Ok(r) if r.status().is_success() => r.text().await.unwrap_or_default(),
        Ok(r) => {
            update(&app, "integration_calendar", json!({}), Some(format!("The calendar link answered {}", r.status())), None);
            return;
        }
        Err(e) => {
            update(&app, "integration_calendar", json!({}), Some(format!("Network error: {e}")), None);
            return;
        }
    };
    let now = now_secs();
    let offset = local_offset();
    let events = ical_events(&text, now - 3600 * 12, now + 86400 * 2, offset);
    let mut event = None;
    for e in &events {
        let mins = (e.start - now) / 60;
        if !e.all_day && (0..=10).contains(&mins) && announce(format!("cal-{}-{}", e.title, e.start)) && event.is_none() {
            event = Some(IntegrationEvent {
                success: true,
                label: format!("Starting in {mins} min · {}", e.title),
                detail: e.join.clone().map(|_| "Join from the card".to_string()),
            });
        }
    }
    let list: Vec<Value> = events
        .iter()
        .take(12)
        .map(|e| json!({ "title": e.title, "start": e.start * 1000, "end": e.end * 1000, "allDay": e.all_day, "location": e.location, "join": e.join }))
        .collect();
    update(&app, "integration_calendar", json!({ "events": list }), None, event);
}

// ── Feeds (RSS / Atom) ────────────────────────────────────────────────────────

fn tag_text(block: &str, tag: &str) -> Option<String> {
    let open = block.find(&format!("<{tag}"))?;
    let gt = block[open..].find('>')? + open;
    if block[open..gt].ends_with('/') {
        return None;
    }
    let close = block[gt..].find(&format!("</{tag}>"))? + gt;
    let raw = block[gt + 1..close].trim();
    let raw = raw.strip_prefix("<![CDATA[").and_then(|r| r.strip_suffix("]]>")).unwrap_or(raw);
    Some(
        raw.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#39;", "'").replace("&apos;", "'"),
    )
}

fn atom_link(block: &str) -> Option<String> {
    let mut rest = block;
    while let Some(i) = rest.find("<link") {
        let end = rest[i..].find('>')? + i;
        let tag = &rest[i..end];
        if !tag.contains("rel=\"") || tag.contains("rel=\"alternate\"") {
            let h = tag.find("href=\"")? + 6;
            let e = tag[h..].find('"')? + h;
            return Some(tag[h..e].replace("&amp;", "&"));
        }
        rest = &rest[end..];
    }
    None
}

fn month(m: &str) -> Option<i64> {
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        .iter()
        .position(|x| m.to_ascii_lowercase().starts_with(x))
        .map(|p| p as i64 + 1)
}

/// "Sat, 03 Oct 2026 09:30:00 +0700" or RFC 3339 → epoch secs.
pub fn feed_time(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.len() >= 19 && s.as_bytes().get(4) == Some(&b'-') {
        let num = |a: usize, n: usize| s.get(a..a + n)?.parse::<i64>().ok();
        let mut t = days_from_civil(num(0, 4)?, num(5, 2)?, num(8, 2)?) * 86400 + num(11, 2)? * 3600 + num(14, 2)? * 60 + num(17, 2)?;
        let tail = s[19..].trim_start_matches(|c: char| c == '.' || c.is_ascii_digit());
        if let Some(sign) = tail.chars().next().filter(|c| *c == '+' || *c == '-') {
            let off = tail.get(1..3)?.parse::<i64>().ok()? * 3600 + tail.get(4..6).and_then(|m| m.parse::<i64>().ok()).unwrap_or(0) * 60;
            t -= if sign == '+' { off } else { -off };
        }
        return Some(t);
    }
    let parts: Vec<&str> = s.split_whitespace().collect();
    let p = if parts.first().is_some_and(|d| d.ends_with(',')) { &parts[1..] } else { &parts[..] };
    let (d, m, y, time) = (p.first()?.parse::<i64>().ok()?, month(p.get(1)?)?, p.get(2)?.parse::<i64>().ok()?, p.get(3)?);
    let hms: Vec<i64> = time.split(':').filter_map(|x| x.parse().ok()).collect();
    let mut t = days_from_civil(y, m, d) * 86400 + hms.first()? * 3600 + hms.get(1).unwrap_or(&0) * 60 + hms.get(2).unwrap_or(&0);
    if let Some(z) = p.get(4) {
        if let (Some(sign), Ok(v)) = (z.chars().next(), z.get(1..5).unwrap_or("").parse::<i64>()) {
            let off = (v / 100) * 3600 + (v % 100) * 60;
            if sign == '+' {
                t -= off;
            } else if sign == '-' {
                t += off;
            }
        }
    }
    Some(t)
}

pub fn feed_items(xml: &str, source: &str) -> Vec<Value> {
    let feed_title = xml.find("<item").or_else(|| xml.find("<entry")).and_then(|i| tag_text(&xml[..i], "title")).unwrap_or_else(|| source.to_string());
    let (open, close) = if xml.contains("<item") { ("<item", "</item>") } else { ("<entry", "</entry>") };
    xml.split(open)
        .skip(1)
        .filter_map(|chunk| {
            let block = chunk.split(close).next()?;
            let title = tag_text(block, "title")?;
            let link = tag_text(block, "link").filter(|l| l.starts_with("http")).or_else(|| atom_link(block)).unwrap_or_default();
            let when = ["pubDate", "published", "updated", "dc:date"].iter().find_map(|t| tag_text(block, t)).and_then(|d| feed_time(&d)).unwrap_or(0);
            Some(json!({ "title": title.trim(), "link": link, "time": when * 1000, "feed": feed_title.trim() }))
        })
        .take(20)
        .collect()
}

pub async fn poll_feeds(app: AppHandle) {
    let Some(s) = settings(&app) else { return };
    let mut items: Vec<Value> = Vec::new();
    let mut errors = Vec::new();
    for url in s.rss_feeds.iter().take(12) {
        match http().get(url).send().await {
            Ok(r) if r.status().is_success() => items.extend(feed_items(&r.text().await.unwrap_or_default(), url)),
            Ok(r) => errors.push(format!("{url}: {}", r.status())),
            Err(e) => errors.push(format!("{url}: {e}")),
        }
    }
    items.sort_by(|a, b| b["time"].as_i64().unwrap_or(0).cmp(&a["time"].as_i64().unwrap_or(0)));
    items.truncate(30);
    let quiet = first_poll("feeds");
    let mut event = None;
    for it in &items {
        let key = format!("feed-{}", it["link"].as_str().unwrap_or(it["title"].as_str().unwrap_or("")));
        if announce(key) && !quiet && event.is_none() {
            event = Some(IntegrationEvent { success: true, label: it["title"].as_str().unwrap_or("").to_string(), detail: it["feed"].as_str().map(str::to_string) });
        }
    }
    let error = (items.is_empty() && !errors.is_empty()).then(|| errors.join(" · "));
    update(&app, "integration_feeds", json!({ "items": items }), error, event);
}

// ── Uptime ────────────────────────────────────────────────────────────────────

static DOWN: std::sync::LazyLock<Mutex<HashSet<String>>> = std::sync::LazyLock::new(|| Mutex::new(HashSet::new()));

pub async fn poll_uptime(app: AppHandle) {
    let Some(s) = settings(&app) else { return };
    let mut sites = Vec::new();
    let mut event = None;
    for url in s.uptime_urls.iter().take(20) {
        let t0 = Instant::now();
        let res = http().get(url).send().await;
        let ms = t0.elapsed().as_millis() as u64;
        let (up, status) = match &res {
            Ok(r) => (r.status().as_u16() < 500, r.status().as_u16().to_string()),
            Err(e) => (false, if e.is_timeout() { "timeout".into() } else { "unreachable".into() }),
        };
        let was_down = DOWN.lock().unwrap().contains(url);
        if !up && !was_down {
            DOWN.lock().unwrap().insert(url.clone());
            event.get_or_insert(IntegrationEvent { success: false, label: format!("{url} is down ({status})"), detail: None });
        } else if up && was_down {
            DOWN.lock().unwrap().remove(url);
            event.get_or_insert(IntegrationEvent { success: true, label: format!("{url} is back up"), detail: None });
        }
        sites.push(json!({ "url": url, "up": up, "status": status, "ms": ms }));
    }
    update(&app, "integration_uptime", json!({ "sites": sites }), None, event);
}

// ── Weather (Open-Meteo, no key) ──────────────────────────────────────────────

pub fn weather_text(code: i64) -> (&'static str, &'static str) {
    match code {
        0 => ("Clear", "☀️"),
        1 | 2 => ("Partly cloudy", "⛅"),
        3 => ("Cloudy", "☁️"),
        45 | 48 => ("Fog", "🌫️"),
        51..=57 => ("Drizzle", "🌦️"),
        61..=67 | 80..=82 => ("Rain", "🌧️"),
        71..=77 | 85 | 86 => ("Snow", "🌨️"),
        95..=99 => ("Thunderstorm", "⛈️"),
        _ => ("—", "🌡️"),
    }
}

pub async fn poll_weather(app: AppHandle) {
    let Some(s) = settings(&app) else { return };
    let city = s.weather_city.trim().to_string();
    let geo = match http()
        .get("https://geocoding-api.open-meteo.com/v1/search")
        .query(&[("name", city.as_str()), ("count", "1")])
        .send()
        .await
    {
        Ok(r) => r.json::<Value>().await.unwrap_or(json!({})),
        Err(e) => {
            update(&app, "integration_weather", json!({}), Some(format!("Network error: {e}")), None);
            return;
        }
    };
    let Some(place) = geo["results"].get(0).cloned() else {
        update(&app, "integration_weather", json!({}), Some(format!("No place called \"{city}\"")), None);
        return;
    };
    let (lat, lon) = (place["latitude"].as_f64().unwrap_or(0.0), place["longitude"].as_f64().unwrap_or(0.0));
    let w = match http()
        .get("https://api.open-meteo.com/v1/forecast")
        .query(&[
            ("latitude", lat.to_string()),
            ("longitude", lon.to_string()),
            ("current", "temperature_2m,weather_code".into()),
            ("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max".into()),
            ("timezone", "auto".into()),
            ("forecast_days", "1".into()),
        ])
        .send()
        .await
    {
        Ok(r) => r.json::<Value>().await.unwrap_or(json!({})),
        Err(e) => {
            update(&app, "integration_weather", json!({}), Some(format!("Network error: {e}")), None);
            return;
        }
    };
    let code = w["current"]["weather_code"].as_i64().unwrap_or(-1);
    let (text, icon) = weather_text(code);
    let rain = w["daily"]["precipitation_probability_max"][0].as_i64().unwrap_or(0);
    let event = (rain >= 60 && announce(format!("rain-{}", now_secs() / 86400)))
        .then(|| IntegrationEvent { success: true, label: format!("{icon} {rain}% chance of rain today"), detail: None });
    update(
        &app,
        "integration_weather",
        json!({
            "place": place["name"],
            "country": place["country"],
            "temp": w["current"]["temperature_2m"],
            "max": w["daily"]["temperature_2m_max"][0],
            "min": w["daily"]["temperature_2m_min"][0],
            "rain": rain,
            "text": text,
            "icon": icon,
        }),
        None,
        event,
    );
}

// ── Todoist ───────────────────────────────────────────────────────────────────

pub async fn poll_todoist(app: AppHandle) {
    let Some(token) = secrets::get("todoist-token") else { return };
    // The unified API first; the older REST v2 as a fallback.
    let attempts = [
        "https://api.todoist.com/api/v1/tasks/filter?query=today%20%7C%20overdue",
        "https://api.todoist.com/rest/v2/tasks?filter=today%20%7C%20overdue",
    ];
    let mut last_err = String::new();
    for url in attempts {
        match http().get(url).bearer_auth(&token).send().await {
            Ok(r) if r.status().is_success() => {
                let v: Value = r.json().await.unwrap_or(json!([]));
                let list = v["results"].as_array().or_else(|| v.as_array()).cloned().unwrap_or_default();
                let tasks: Vec<Value> = list
                    .iter()
                    .take(15)
                    .map(|t| {
                        let id = t["id"].as_str().map(str::to_string).unwrap_or_else(|| t["id"].to_string());
                        json!({
                            "content": t["content"],
                            "due": t["due"]["date"],
                            "priority": t["priority"],
                            "url": t["url"].as_str().map(str::to_string).unwrap_or_else(|| format!("https://app.todoist.com/app/task/{id}")),
                        })
                    })
                    .collect();
                update(&app, "integration_todoist", json!({ "tasks": tasks }), None, None);
                return;
            }
            Ok(r) => last_err = format!("Todoist answered {}", r.status()),
            Err(e) => last_err = format!("Network error: {e}"),
        }
    }
    update(&app, "integration_todoist", json!({}), Some(last_err), None);
}

/// Settings → Test for these integrations.
pub async fn test(app: &AppHandle, id: &str) -> Result<String, String> {
    let s = settings(app).ok_or("Settings not loaded")?;
    match id {
        "integration_mail" => {
            let pass = secrets::get("mail-password").ok_or("No app password saved.")?;
            let v = imap_poll(&mail_host(&s.mail_host), &s.mail_user, &pass).await?;
            Ok(format!("Connected — {} unread.", v["unread"]))
        }
        "integration_calendar" => {
            let url = secrets::get("ical-url").ok_or("No calendar link saved.")?.replacen("webcal://", "https://", 1);
            let text = http().get(url.trim()).send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
            if !text.contains("BEGIN:VCALENDAR") {
                return Err("That link doesn't return a calendar (iCal).".into());
            }
            let n = ical_events(&text, now_secs(), now_secs() + 86400 * 7, local_offset()).len();
            Ok(format!("Connected — {n} events in the next 7 days."))
        }
        "integration_feeds" => {
            let mut n = 0;
            for url in &s.rss_feeds {
                let r = http().get(url).send().await.map_err(|e| format!("{url}: {e}"))?;
                n += feed_items(&r.text().await.unwrap_or_default(), url).len();
            }
            Ok(format!("{n} items from {} feed(s).", s.rss_feeds.len()))
        }
        "integration_uptime" => Ok(format!("Checking {} site(s) every 5 minutes.", s.uptime_urls.len())),
        "integration_weather" => {
            poll_weather(app.clone()).await;
            Ok("Updated.".into())
        }
        "integration_todoist" => {
            poll_todoist(app.clone()).await;
            Ok("Updated.".into())
        }
        _ => Err("Unknown integration.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encoded_words() {
        assert_eq!(decode_words("=?UTF-8?B?4Liq4Lin4Lix4Liq4LiU4Li1?="), "สวัสดี");
        assert_eq!(decode_words("=?utf-8?Q?Caf=C3=A9_ok?="), "Café ok");
        assert_eq!(decode_words("=?UTF-8?B?QQ==?= =?UTF-8?B?Qg==?="), "AB");
        assert_eq!(sender_name("\"Owen\" <o@x.com>"), "Owen");
    }

    #[test]
    fn ical_recurrence_and_times() {
        let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261005T020000Z\r\nDTEND:20261005T030000Z\r\nSUMMARY:Standup\r\nRRULE:FREQ=DAILY;COUNT=3\r\nLOCATION:https://meet.google.com/abc-defg-hij\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261006\r\nSUMMARY:Holiday\r\nEND:VEVENT\r\nEND:VCALENDAR";
        let from = ical_time("20261005T000000Z", 0).unwrap().0;
        let ev = ical_events(ics, from, from + 86400 * 5, 7 * 3600);
        let standups: Vec<_> = ev.iter().filter(|e| e.title == "Standup").collect();
        assert_eq!(standups.len(), 3);
        assert_eq!(standups[0].join.as_deref(), Some("https://meet.google.com/abc-defg-hij"));
        assert!(ev.iter().any(|e| e.title == "Holiday" && e.all_day));
    }

    #[test]
    fn weekly_byday() {
        // Monday 2026-10-05 09:00 local (+07:00), MO/WE/FR.
        let ics = "BEGIN:VEVENT\nDTSTART;TZID=Asia/Bangkok:20261005T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR\nSUMMARY:Gym\nEND:VEVENT";
        let from = ical_time("20261005T000000Z", 0).unwrap().0;
        let ev = ical_events(ics, from, from + 86400 * 7, 7 * 3600);
        assert_eq!(ev.len(), 3);
        assert_eq!(ev[1].start - ev[0].start, 2 * 86400);
    }

    #[test]
    fn feeds_rss_and_atom() {
        let rss = "<rss><channel><title>News</title><item><title><![CDATA[Hello & bye]]></title><link>https://x.com/a</link><pubDate>Sat, 03 Oct 2026 09:30:00 +0700</pubDate></item></channel></rss>";
        let it = feed_items(rss, "u");
        assert_eq!(it[0]["title"], "Hello & bye");
        assert_eq!(it[0]["feed"], "News");
        assert_eq!(it[0]["time"], feed_time("2026-10-03T02:30:00Z").unwrap() * 1000);
        let atom = "<feed><title>Blog</title><entry><title>Post</title><link rel=\"alternate\" href=\"https://b.com/p\"/><updated>2026-10-01T00:00:00Z</updated></entry></feed>";
        assert_eq!(feed_items(atom, "u")[0]["link"], "https://b.com/p");
    }

    #[test]
    fn hosts() {
        assert_eq!(mail_host("gmail").host, "imap.gmail.com");
        let h = mail_host("mail.example.com:1993");
        assert_eq!((h.host.as_str(), h.port), ("mail.example.com", 1993));
    }
}
