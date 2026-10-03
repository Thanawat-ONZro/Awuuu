// Sign-in for integrations, so nobody has to paste a password.
//
// Google and Microsoft: OAuth authorization code + PKCE (S256) in the user's
// browser, with a loopback redirect. The listener binds 127.0.0.1 on an
// ephemeral port, exists only while a sign-in is in progress (3 minutes at
// most), accepts only /callback carrying the `state` we generated, and answers
// with a small "you can close this tab" page.
//
// GitHub: the token the GitHub CLI already has (`gh auth token`), or the
// device flow (a short code typed on github.com).
//
// Refresh tokens live in the Windows Credential Manager (secrets.rs). Access
// tokens stay in memory and are refreshed when they expire. Nothing here is
// ever logged or written to disk, and nothing runs before an explicit click.

use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::secrets;

/// How long the browser has to come back.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(180);
const GITHUB_SCOPE: &str = "repo read:org notifications";

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Provider {
    Google,
    Microsoft,
}

impl Provider {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "google" => Some(Self::Google),
            "microsoft" => Some(Self::Microsoft),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Google => "Google",
            Self::Microsoft => "Microsoft",
        }
    }

    fn auth_url(self) -> &'static str {
        match self {
            Self::Google => "https://accounts.google.com/o/oauth2/v2/auth",
            Self::Microsoft => "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        }
    }

    fn token_url(self) -> &'static str {
        match self {
            Self::Google => "https://oauth2.googleapis.com/token",
            Self::Microsoft => "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        }
    }

    fn scopes(self) -> &'static str {
        match self {
            Self::Google => {
                "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly openid email"
            }
            Self::Microsoft => "offline_access User.Read Mail.Read Calendars.Read",
        }
    }

    /// Google's desktop clients take any loopback address; Microsoft only
    /// lets `http://localhost` be registered in the portal (the port is free).
    fn redirect_host(self) -> &'static str {
        match self {
            Self::Google => "127.0.0.1",
            Self::Microsoft => "localhost",
        }
    }

    fn refresh_key(self) -> &'static str {
        match self {
            Self::Google => "google-refresh-token",
            Self::Microsoft => "microsoft-refresh-token",
        }
    }

    fn account_key(self) -> &'static str {
        match self {
            Self::Google => "google-account",
            Self::Microsoft => "microsoft-account",
        }
    }

    fn client_id(self, s: &crate::settings::Settings) -> String {
        match self {
            Self::Google => s.google_client_id.trim().to_string(),
            Self::Microsoft => s.microsoft_client_id.trim().to_string(),
        }
    }
}

fn settings(app: &AppHandle) -> Result<crate::settings::Settings, String> {
    app.try_state::<crate::Shared>().map(|s| s.settings.lock().unwrap().clone()).ok_or_else(|| "Settings not loaded".to_string())
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn http() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(15)).user_agent("Awuuu").build().unwrap_or_default()
}

// ── PKCE ──────────────────────────────────────────────────────────────────────

/// Base64 with the URL alphabet and no padding (RFC 7636 §3).
pub fn base64url(bytes: &[u8]) -> String {
    crate::claude::base64_for(bytes).trim_end_matches('=').replace('+', "-").replace('/', "_")
}

/// S256: BASE64URL(SHA256(verifier)).
pub fn challenge(verifier: &str) -> String {
    base64url(ring::digest::digest(&ring::digest::SHA256, verifier.as_bytes()).as_ref())
}

/// `n` bytes from the system's secure random source, base64url-encoded.
fn random_token(n: usize) -> Result<String, String> {
    use ring::rand::SecureRandom;
    let mut bytes = vec![0u8; n];
    ring::rand::SystemRandom::new().fill(&mut bytes).map_err(|_| "No secure random numbers available.".to_string())?;
    Ok(base64url(&bytes))
}

/// The page the browser is sent to.
pub fn auth_url(p: Provider, client_id: &str, redirect: &str, state: &str, challenge: &str) -> String {
    let mut params = vec![
        ("client_id", client_id),
        ("redirect_uri", redirect),
        ("response_type", "code"),
        ("scope", p.scopes()),
        ("state", state),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
    ];
    match p {
        // offline + consent: Google only hands out a refresh token then.
        Provider::Google => params.extend([("access_type", "offline"), ("prompt", "consent")]),
        Provider::Microsoft => params.push(("prompt", "select_account")),
    }
    reqwest::Url::parse_with_params(p.auth_url(), &params).map(String::from).unwrap_or_default()
}

// ── The loopback redirect ─────────────────────────────────────────────────────

#[derive(Debug, PartialEq)]
pub enum Callback {
    /// The authorization code, `state` verified.
    Code(String),
    /// The provider said no (the user cancelled, the app is not allowed…).
    Denied(String),
    /// Right path, wrong or missing `state`: not our sign-in.
    BadState,
    /// Anything else (favicon, another path, another method).
    NotFound,
}

/// %XX and `+` → text (application/x-www-form-urlencoded).
fn url_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < b.len() && s.is_char_boundary(i + 1) && s.is_char_boundary(i + 3) => {
                match u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    Ok(v) => {
                        out.push(v);
                        i += 3;
                        continue;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Reads the first line of the browser's request ("GET /callback?… HTTP/1.1").
pub fn parse_callback(request_line: &str, expected_state: &str) -> Callback {
    let mut parts = request_line.split_whitespace();
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else { return Callback::NotFound };
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != "/callback" {
        return Callback::NotFound;
    }
    let get = |name: &str| {
        query.split('&').filter_map(|kv| kv.split_once('=')).find(|(k, _)| *k == name).map(|(_, v)| url_decode(v))
    };
    if expected_state.is_empty() || get("state").as_deref() != Some(expected_state) {
        return Callback::BadState;
    }
    if let Some(error) = get("error") {
        let why = get("error_description").filter(|d| !d.is_empty()).unwrap_or(error.clone());
        return Callback::Denied(if error == "access_denied" { "You cancelled the sign-in.".into() } else { why });
    }
    match get("code").filter(|c| !c.is_empty()) {
        Some(code) => Callback::Code(code),
        None => Callback::BadState,
    }
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn page(status: &str, title: &str, text: &str) -> String {
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Awuuu</title></head>\
         <body style=\"font:15px system-ui,sans-serif;background:#0e0b09;color:#fff4e6;text-align:center;padding-top:18vh\">\
         <div style=\"font-size:44px\">&#128054;</div><h2>{}</h2><p style=\"color:#a89a8a\">{}</p></body></html>",
        html_escape(title),
        html_escape(text)
    );
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

/// Only one sign-in at a time: starting another, or Cancel, ends the one
/// that is waiting.
static FLOW: AtomicU64 = AtomicU64::new(0);

fn begin() -> u64 {
    FLOW.fetch_add(1, Ordering::SeqCst) + 1
}

fn cancelled(flow: u64) -> bool {
    FLOW.load(Ordering::SeqCst) != flow
}

pub fn cancel() {
    FLOW.fetch_add(1, Ordering::SeqCst);
}

async fn read_head(stream: &mut tokio::net::TcpStream) -> String {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 2048];
    // Authorization codes can be long (Microsoft's run past 1 kB).
    while buf.len() < 32 * 1024 && !buf.windows(4).any(|w| w == b"\r\n\r\n") {
        match tokio::time::timeout(Duration::from_secs(3), stream.read(&mut chunk)).await {
            Ok(Ok(n)) if n > 0 => buf.extend_from_slice(&chunk[..n]),
            _ => break,
        }
    }
    String::from_utf8_lossy(&buf).lines().next().unwrap_or("").to_string()
}

/// Waits for the browser to come back with the code. The listener is dropped
/// (the port closed) as soon as this returns, whatever the outcome.
async fn wait_for_code(listener: tokio::net::TcpListener, state: &str, flow: u64, limit: Duration) -> Result<String, String> {
    let started = Instant::now();
    loop {
        if cancelled(flow) {
            return Err("Sign-in cancelled.".into());
        }
        if started.elapsed() >= limit {
            return Err("Sign-in timed out — nothing came back from the browser. Try again.".into());
        }
        // Short waits, so Cancel and the time limit are noticed promptly.
        let Ok(Ok((mut stream, peer))) = tokio::time::timeout(Duration::from_millis(400), listener.accept()).await else {
            continue;
        };
        if !peer.ip().is_loopback() {
            continue;
        }
        let line = read_head(&mut stream).await;
        let (reply, outcome) = match parse_callback(&line, state) {
            Callback::Code(code) => (page("200 OK", "Signed in", "You can close this tab and go back to Awuuu."), Some(Ok(code))),
            Callback::Denied(why) => (page("200 OK", "Sign-in did not finish", &format!("{why} You can close this tab.")), Some(Err(why))),
            Callback::BadState => (page("400 Bad Request", "Not this sign-in", "This link does not belong to the sign-in Awuuu started."), None),
            Callback::NotFound => (page("404 Not Found", "Not found", ""), None),
        };
        let _ = stream.write_all(reply.as_bytes()).await;
        let _ = stream.shutdown().await;
        if let Some(result) = outcome {
            return result;
        }
    }
}

// ── Tokens ────────────────────────────────────────────────────────────────────

#[derive(Debug, PartialEq)]
pub struct Tokens {
    pub access: String,
    /// Seconds the access token lasts.
    pub expires_in: u64,
    pub refresh: Option<String>,
    pub id_token: Option<String>,
}

/// A token endpoint's answer → tokens, or the reason in plain words.
pub fn parse_token_response(p: Provider, v: &Value) -> Result<Tokens, String> {
    if let Some(error) = v["error"].as_str() {
        let detail = v["error_description"].as_str().unwrap_or("").lines().next().unwrap_or("").trim();
        return Err(match error {
            "invalid_grant" => format!(
                "{} sign-in has expired or was revoked — sign in again.{}",
                p.name(),
                if p == Provider::Google { " (A Google app left in \"Testing\" expires after 7 days.)" } else { "" }
            ),
            "invalid_client" if p == Provider::Google => {
                "Google refused the client — check the client ID, and add the client secret under Advanced.".into()
            }
            "invalid_client" | "unauthorized_client" => {
                format!("{} refused the client ID — check it under Advanced.", p.name())
            }
            _ if detail.is_empty() => format!("{} refused the sign-in ({error}).", p.name()),
            _ => format!("{} refused the sign-in: {detail}", p.name()),
        });
    }
    let access = v["access_token"].as_str().filter(|t| !t.is_empty()).ok_or_else(|| format!("{} sent no access token.", p.name()))?;
    Ok(Tokens {
        access: access.to_string(),
        expires_in: v["expires_in"].as_u64().or_else(|| v["expires_in"].as_str().and_then(|s| s.parse().ok())).unwrap_or(3600),
        refresh: v["refresh_token"].as_str().filter(|t| !t.is_empty()).map(str::to_string),
        id_token: v["id_token"].as_str().map(str::to_string),
    })
}

/// The `email` claim of an ID token. It came straight from the token endpoint
/// over TLS and only labels the account in Settings, so it is read, not verified.
pub fn id_token_email(id_token: &str) -> Option<String> {
    let payload = id_token.split('.').nth(1)?;
    let v: Value = serde_json::from_slice(&crate::extras::base64_decode(payload)).ok()?;
    v["email"].as_str().filter(|e| !e.is_empty()).map(str::to_string)
}

/// Graph `/me` → the address shown as the signed-in account.
pub fn graph_account(v: &Value) -> Option<String> {
    v["mail"].as_str().or_else(|| v["userPrincipalName"].as_str()).filter(|e| !e.is_empty()).map(str::to_string)
}

struct Access {
    token: String,
    /// Unix seconds.
    expires_at: u64,
}

/// Still good for at least a minute.
fn fresh(expires_at: u64, now: u64) -> bool {
    now + 60 < expires_at
}

/// Access tokens, in memory only.
static ACCESS: LazyLock<Mutex<HashMap<Provider, Access>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
/// One refresh at a time (mail and calendar poll side by side).
static REFRESHING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn remember(p: Provider, tokens: &Tokens) {
    ACCESS.lock().unwrap().insert(p, Access { token: tokens.access.clone(), expires_at: now_secs() + tokens.expires_in });
}

fn cached(p: Provider) -> Option<String> {
    ACCESS.lock().unwrap().get(&p).filter(|a| fresh(a.expires_at, now_secs())).map(|a| a.token.clone())
}

async fn token_request(p: Provider, mut form: Vec<(&'static str, String)>) -> Result<Tokens, String> {
    // Google's "Desktop app" clients come with a secret that is not
    // confidential; it is sent when the user saved one.
    if p == Provider::Google {
        if let Some(secret) = secrets::get("google-client-secret") {
            form.push(("client_secret", secret));
        }
    }
    let res = http()
        .post(p.token_url())
        .header("Accept", "application/json")
        .form(&form)
        .send()
        .await
        .map_err(|e| if e.is_timeout() { format!("{} took too long to answer.", p.name()) } else { format!("Can't reach {}.", p.name()) })?;
    let code = res.status().as_u16();
    let body: Value = res.json().await.map_err(|_| format!("{} answered {code}.", p.name()))?;
    parse_token_response(p, &body)
}

pub fn connected(p: Provider) -> bool {
    secrets::present(p.refresh_key())
}

pub fn account(p: Provider) -> Option<String> {
    secrets::get(p.account_key())
}

/// A valid access token, refreshed when the one in memory has expired.
pub async fn access_token(app: &AppHandle, p: Provider) -> Result<String, String> {
    if let Some(token) = cached(p) {
        return Ok(token);
    }
    let _one = REFRESHING.lock().await;
    if let Some(token) = cached(p) {
        return Ok(token);
    }
    let refresh = secrets::get(p.refresh_key()).ok_or_else(|| format!("Not signed in with {}.", p.name()))?;
    let client_id = p.client_id(&settings(app)?);
    if client_id.is_empty() {
        return Err(format!("The {} client ID is missing (Integrations → Advanced).", p.name()));
    }
    let tokens = token_request(p, vec![("grant_type", "refresh_token".into()), ("refresh_token", refresh), ("client_id", client_id)]).await?;
    // Microsoft rotates refresh tokens; keep the newest.
    if let Some(next) = &tokens.refresh {
        let _ = secrets::set(p.refresh_key(), next);
    }
    remember(p, &tokens);
    Ok(tokens.access)
}

/// What an API said no with, in plain words.
pub fn api_error(p: Provider, code: u16, body: &Value) -> String {
    let message = body["error"]["message"].as_str().unwrap_or("").lines().next().unwrap_or("").trim().to_string();
    match code {
        401 => format!("{} sign-in has expired — sign in again.", p.name()),
        403 if p == Provider::Google && (message.contains("has not been used") || message.contains("is disabled")) => {
            "Turn on the Gmail API and the Google Calendar API in your Google Cloud project, then try again.".into()
        }
        403 => format!("{} refused (403){}", p.name(), if message.is_empty() { ".".to_string() } else { format!(": {message}") }),
        429 => format!("{} is rate limiting — try again in a minute.", p.name()),
        _ => format!("{} answered {code}.", p.name()),
    }
}

/// GET on the provider's API as the signed-in user.
pub async fn get_json(app: &AppHandle, p: Provider, url: &str, query: &[(&str, &str)], headers: &[(&str, &str)]) -> Result<Value, String> {
    let token = access_token(app, p).await?;
    let mut req = http().get(url).query(query).bearer_auth(token).header("Accept", "application/json");
    for (k, v) in headers {
        req = req.header(*k, *v);
    }
    let res = req
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "Network error: timed out".to_string() } else { "Network error: no connection".to_string() })?;
    let code = res.status().as_u16();
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !(200..300).contains(&code) {
        if code == 401 {
            ACCESS.lock().unwrap().remove(&p); // the next call refreshes
        }
        return Err(api_error(p, code, &body));
    }
    Ok(body)
}

// ── Sign-in, sign-out, status ─────────────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub connected: bool,
    /// The signed-in account (an address, a GitHub login), when known.
    pub account: Option<String>,
    /// No OAuth client ID saved yet: the Sign in button can't work.
    pub needs_client_id: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub google: ProviderStatus,
    pub microsoft: ProviderStatus,
    pub github: ProviderStatus,
    /// The GitHub CLI is on this PC.
    pub github_cli: bool,
}

fn provider_status(p: Provider, s: &crate::settings::Settings) -> ProviderStatus {
    let connected = connected(p);
    ProviderStatus { connected, account: if connected { account(p) } else { None }, needs_client_id: p.client_id(s).is_empty() }
}

fn github_status(s: &crate::settings::Settings) -> ProviderStatus {
    let connected = secrets::present("github-token");
    ProviderStatus {
        connected,
        account: if connected { secrets::get("github-account") } else { None },
        needs_client_id: s.github_client_id.trim().is_empty(),
    }
}

pub fn status(app: &AppHandle) -> Result<Status, String> {
    let s = settings(app)?;
    Ok(Status {
        google: provider_status(Provider::Google, &s),
        microsoft: provider_status(Provider::Microsoft, &s),
        github: github_status(&s),
        github_cli: gh_path().is_some(),
    })
}

/// The island shows or hides the pills, and the cards fill without waiting
/// for the next poll.
fn changed(app: &AppHandle, ids: &'static [&'static str]) {
    let _ = app.emit("secrets-changed", ());
    for id in ids {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if crate::integrations::configured(id) || crate::extras::configured(&app, id) {
                crate::integrations::poll_once(app, id).await;
            }
        });
    }
}

async fn sign_in(app: &AppHandle, p: Provider) -> Result<ProviderStatus, String> {
    let s = settings(app)?;
    let client_id = p.client_id(&s);
    if client_id.is_empty() {
        return Err(format!("Add your {} client ID under Advanced first.", p.name()));
    }
    let flow = begin();
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.map_err(|e| format!("Can't listen for the browser: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://{}:{port}/callback", p.redirect_host());
    let verifier = random_token(32)?;
    let state = random_token(16)?;
    let url = auth_url(p, &client_id, &redirect, &state, &challenge(&verifier));
    if url.is_empty() {
        return Err("Could not build the sign-in address.".into());
    }
    crate::open_url(url);
    crate::log::line(format!("{} sign-in started", p.name()));

    let code = wait_for_code(listener, &state, flow, SIGN_IN_TIMEOUT).await?;
    let tokens = token_request(
        p,
        vec![
            ("grant_type", "authorization_code".into()),
            ("code", code),
            ("redirect_uri", redirect),
            ("client_id", client_id),
            ("code_verifier", verifier),
        ],
    )
    .await?;
    let refresh = tokens.refresh.clone().ok_or_else(|| format!("{} did not allow Awuuu to stay signed in. Try again.", p.name()))?;
    secrets::set(p.refresh_key(), &refresh)?;
    remember(p, &tokens);

    let who = match p {
        Provider::Google => tokens.id_token.as_deref().and_then(id_token_email),
        Provider::Microsoft => get_json(app, p, "https://graph.microsoft.com/v1.0/me", &[("$select", "mail,userPrincipalName")], &[])
            .await
            .ok()
            .and_then(|v| graph_account(&v)),
    };
    let _ = secrets::set(p.account_key(), who.as_deref().unwrap_or(""));
    crate::log::line(format!("{} sign-in finished", p.name()));
    changed(app, &["integration_mail", "integration_calendar"]);
    Ok(provider_status(p, &s))
}

fn sign_out(app: &AppHandle, provider: &str) -> Result<(), String> {
    cancel();
    match provider {
        "github" => {
            secrets::clear("github-token")?;
            secrets::clear("github-account")?;
            *DEVICE.lock().unwrap() = None;
            changed(app, &[]);
        }
        other => {
            let p = Provider::parse(other).ok_or_else(|| format!("Unknown provider '{other}'"))?;
            ACCESS.lock().unwrap().remove(&p);
            secrets::clear(p.refresh_key())?;
            secrets::clear(p.account_key())?;
            // Another source (the other account, IMAP, an iCal link) may still fill the cards.
            changed(app, &["integration_mail", "integration_calendar"]);
        }
    }
    Ok(())
}

// ── GitHub ────────────────────────────────────────────────────────────────────

fn gh_path() -> Option<std::path::PathBuf> {
    crate::find_on_path("gh")
}

/// What `gh auth token` printed → the token, if it looks like one.
pub fn clean_cli_token(stdout: &str) -> Option<String> {
    let token = stdout.lines().next()?.trim();
    let ok = (20..=400).contains(&token.len()) && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    ok.then(|| token.to_string())
}

/// Runs `gh auth token` with no window and a short leash.
fn gh_cli_token() -> Result<String, String> {
    use std::io::Read;
    let gh = gh_path().ok_or("The GitHub CLI (gh) is not installed on this PC.")?;
    let mut child = std::process::Command::new(gh)
        .args(["auth", "token", "--hostname", "github.com"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .creation_flags(crate::CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Can't run the GitHub CLI: {e}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < Duration::from_secs(8) => std::thread::sleep(Duration::from_millis(60)),
            _ => {
                let _ = child.kill();
                return Err("The GitHub CLI took too long to answer.".into());
            }
        }
    }
    let mut out = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        let _ = stdout.read_to_string(&mut out);
    }
    clean_cli_token(&out).ok_or_else(|| "The GitHub CLI is not signed in. Run `gh auth login` in a terminal, then try again.".to_string())
}

/// Saves the token and looks up whose it is (for the card's label).
async fn store_github_token(app: &AppHandle, token: &str) -> Result<ProviderStatus, String> {
    secrets::set("github-token", token)?;
    let login = match http()
        .get("https://api.github.com/user")
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
    {
        Ok(r) if r.status().is_success() => r.json::<Value>().await.ok().and_then(|v| v["login"].as_str().map(str::to_string)),
        _ => None,
    };
    let _ = secrets::set("github-account", login.as_deref().unwrap_or(""));
    changed(app, &["integration_github"]);
    Ok(github_status(&settings(app)?))
}

/// What the UI shows while the user types the code on github.com.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_uri: String,
    /// Seconds until the code stops working.
    pub expires_in: u64,
}

struct Device {
    /// Stays on this side: the UI only ever sees the user code.
    device_code: String,
    interval: u64,
    expires_at: u64,
    client_id: String,
}

static DEVICE: LazyLock<Mutex<Option<Device>>> = LazyLock::new(|| Mutex::new(None));

fn device_error(error: &str, detail: &str) -> String {
    match error {
        "device_flow_disabled" => "Device flow is off for this GitHub OAuth app — tick \"Enable Device Flow\" in its settings.".into(),
        "incorrect_client_credentials" | "Not Found" => "GitHub does not know this client ID — check it under Advanced.".into(),
        "expired_token" => "The code expired before it was entered. Start again.".into(),
        "access_denied" => "You cancelled the sign-in on GitHub.".into(),
        _ if detail.is_empty() => format!("GitHub refused the sign-in ({error})."),
        _ => format!("GitHub refused the sign-in: {detail}"),
    }
}

/// `login/device/code` → (device code, what to show, seconds between polls).
pub fn parse_device_code(v: &Value) -> Result<(String, DeviceCode, u64), String> {
    if let Some(error) = v["error"].as_str() {
        return Err(device_error(error, v["error_description"].as_str().unwrap_or("")));
    }
    let field = |k: &str| v[k].as_str().filter(|s| !s.is_empty()).map(str::to_string);
    let (Some(device), Some(user_code)) = (field("device_code"), field("user_code")) else {
        return Err("GitHub sent no code.".into());
    };
    Ok((
        device,
        DeviceCode {
            user_code,
            verification_uri: field("verification_uri").unwrap_or_else(|| "https://github.com/login/device".into()),
            expires_in: v["expires_in"].as_u64().unwrap_or(900),
        },
        v["interval"].as_u64().unwrap_or(5).max(1),
    ))
}

#[derive(Debug, PartialEq)]
pub enum DevicePoll {
    Token(String),
    /// Not entered yet: ask again after the interval.
    Pending,
    /// Asked too fast: the new interval, in seconds.
    SlowDown(u64),
    Failed(String),
}

/// `login/oauth/access_token` during the device flow.
pub fn parse_device_poll(v: &Value, interval: u64) -> DevicePoll {
    if let Some(token) = v["access_token"].as_str().filter(|t| !t.is_empty()) {
        return DevicePoll::Token(token.to_string());
    }
    match v["error"].as_str().unwrap_or("") {
        "authorization_pending" => DevicePoll::Pending,
        "slow_down" => DevicePoll::SlowDown(v["interval"].as_u64().unwrap_or(interval + 5)),
        "" => DevicePoll::Failed("GitHub sent no token.".into()),
        error => DevicePoll::Failed(device_error(error, v["error_description"].as_str().unwrap_or(""))),
    }
}

async fn device_start(app: &AppHandle) -> Result<DeviceCode, String> {
    let client_id = settings(app)?.github_client_id.trim().to_string();
    if client_id.is_empty() {
        return Err("Add your GitHub OAuth client ID under Advanced first.".into());
    }
    cancel();
    let res = http()
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", client_id.as_str()), ("scope", GITHUB_SCOPE)])
        .send()
        .await
        .map_err(|_| "Can't reach GitHub.".to_string())?;
    let code = res.status().as_u16();
    let body: Value = res.json().await.map_err(|_| {
        if code == 404 { device_error("Not Found", "") } else { format!("GitHub answered {code}.") }
    })?;
    let (device_code, shown, interval) = parse_device_code(&body)?;
    *DEVICE.lock().unwrap() = Some(Device { device_code, interval, expires_at: now_secs() + shown.expires_in, client_id });
    Ok(shown)
}

/// Polls at GitHub's pace until the code is entered, expires or is cancelled.
async fn device_wait(app: &AppHandle) -> Result<ProviderStatus, String> {
    let Some(Device { device_code, mut interval, expires_at, client_id }) = DEVICE.lock().unwrap().take() else {
        return Err("Start the sign-in first.".into());
    };
    let flow = begin();
    loop {
        // Sleep in short steps so Cancel is noticed.
        let wake = Instant::now() + Duration::from_secs(interval);
        while Instant::now() < wake {
            if cancelled(flow) {
                return Err("Sign-in cancelled.".into());
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
        if now_secs() >= expires_at {
            return Err(device_error("expired_token", ""));
        }
        let res = http()
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", client_id.as_str()),
                ("device_code", device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await;
        // A dropped connection is not the end: the code is still good.
        let Ok(res) = res else { continue };
        let body: Value = res.json().await.unwrap_or(Value::Null);
        match parse_device_poll(&body, interval) {
            DevicePoll::Token(token) => return store_github_token(app, &token).await,
            DevicePoll::Pending => {}
            DevicePoll::SlowDown(next) => interval = next,
            DevicePoll::Failed(why) => return Err(why),
        }
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// Integrations page: who is signed in, and what is missing.
#[tauri::command]
pub fn oauth_status(app: AppHandle) -> Result<Status, String> {
    status(&app)
}

/// "Sign in with Google / Microsoft": opens the browser and resolves when the
/// sign-in finished, or fails with the reason.
#[tauri::command]
pub async fn oauth_sign_in(app: AppHandle, provider: String) -> Result<ProviderStatus, String> {
    let p = Provider::parse(&provider).ok_or_else(|| format!("Unknown provider '{provider}'"))?;
    sign_in(&app, p).await
}

/// Ends the sign-in that is waiting (browser or device code).
#[tauri::command]
pub fn oauth_cancel() {
    cancel();
}

/// "Sign out": forgets the tokens ("google", "microsoft" or "github").
#[tauri::command]
pub fn oauth_sign_out(app: AppHandle, provider: String) -> Result<(), String> {
    sign_out(&app, &provider)
}

/// "Use GitHub CLI login": takes the token `gh` already has.
#[tauri::command]
pub async fn github_cli_login(app: AppHandle) -> Result<ProviderStatus, String> {
    let token = tauri::async_runtime::spawn_blocking(gh_cli_token).await.map_err(|e| e.to_string())??;
    store_github_token(&app, &token).await
}

/// "Sign in with a code", step 1: the code to type on github.com.
#[tauri::command]
pub async fn github_device_start(app: AppHandle) -> Result<DeviceCode, String> {
    device_start(&app).await
}

/// Step 2: resolves once the code was entered (or it expired / was cancelled).
#[tauri::command]
pub async fn github_device_wait(app: AppHandle) -> Result<ProviderStatus, String> {
    device_wait(&app).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pkce_rfc7636_vector() {
        // RFC 7636, appendix B.
        let octets = [
            116u8, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5,
            88, 83, 132, 141, 121,
        ];
        let verifier = base64url(&octets);
        assert_eq!(verifier, "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
        assert_eq!(challenge(&verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn random_tokens_are_long_and_differ() {
        let (a, b) = (random_token(32).unwrap(), random_token(32).unwrap());
        assert_eq!(a.len(), 43); // RFC 7636: 43–128 characters
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    fn params(url: &str) -> HashMap<String, String> {
        reqwest::Url::parse(url).unwrap().query_pairs().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn google_auth_url() {
        let url = auth_url(Provider::Google, "id.apps.googleusercontent.com", "http://127.0.0.1:5123/callback", "st&ate", "chal");
        assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
        let q = params(&url);
        assert_eq!(q["client_id"], "id.apps.googleusercontent.com");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5123/callback");
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["state"], "st&ate");
        assert_eq!(q["code_challenge"], "chal");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["access_type"], "offline");
        assert_eq!(q["prompt"], "consent");
        let scopes: Vec<&str> = q["scope"].split(' ').collect();
        assert!(scopes.contains(&"https://www.googleapis.com/auth/gmail.readonly"));
        assert!(scopes.contains(&"https://www.googleapis.com/auth/calendar.readonly"));
        assert!(scopes.contains(&"openid") && scopes.contains(&"email"));
    }

    #[test]
    fn microsoft_auth_url() {
        let url = auth_url(Provider::Microsoft, "0000-1111", "http://localhost:6001/callback", "s", "c");
        assert!(url.starts_with("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?"));
        let q = params(&url);
        assert_eq!(q["scope"], "offline_access User.Read Mail.Read Calendars.Read");
        assert_eq!(q["redirect_uri"], "http://localhost:6001/callback");
        assert!(!q.contains_key("access_type"));
    }

    #[test]
    fn callback_parsing_and_state() {
        let ok = "GET /callback?state=abc-1&code=4%2F0Ab_c%2Bd&scope=a+b HTTP/1.1";
        assert_eq!(parse_callback(ok, "abc-1"), Callback::Code("4/0Ab_c+d".into()));
        // Someone else's state, or none at all.
        assert_eq!(parse_callback(ok, "other"), Callback::BadState);
        assert_eq!(parse_callback("GET /callback?code=x HTTP/1.1", "abc-1"), Callback::BadState);
        assert_eq!(parse_callback(ok, ""), Callback::BadState);
        // A refusal is only believed with the right state.
        let denied = "GET /callback?error=access_denied&state=abc-1 HTTP/1.1";
        assert_eq!(parse_callback(denied, "abc-1"), Callback::Denied("You cancelled the sign-in.".into()));
        assert_eq!(parse_callback(denied, "zzz"), Callback::BadState);
        let other = "GET /callback?error=invalid_scope&error_description=Bad+scope%21&state=abc-1 HTTP/1.1";
        assert_eq!(parse_callback(other, "abc-1"), Callback::Denied("Bad scope!".into()));
        // Only GET /callback.
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1", "abc-1"), Callback::NotFound);
        assert_eq!(parse_callback("GET /callback/x?state=abc-1&code=1 HTTP/1.1", "abc-1"), Callback::NotFound);
        assert_eq!(parse_callback("POST /callback?state=abc-1&code=1 HTTP/1.1", "abc-1"), Callback::NotFound);
        assert_eq!(parse_callback("", "abc-1"), Callback::NotFound);
        assert_eq!(parse_callback("GET /callback?state=abc-1&code= HTTP/1.1", "abc-1"), Callback::BadState);
    }

    #[test]
    fn decoding() {
        assert_eq!(url_decode("a%20b+c%2F%E0%B8%81"), "a b c/ก");
        assert_eq!(url_decode("100%"), "100%");
        assert_eq!(url_decode("%zz%4"), "%zz%4");
    }

    #[test]
    fn token_responses() {
        let v = json!({ "access_token": "at", "expires_in": 3599, "refresh_token": "rt", "id_token": "x.y.z", "token_type": "Bearer" });
        assert_eq!(
            parse_token_response(Provider::Google, &v),
            Ok(Tokens { access: "at".into(), expires_in: 3599, refresh: Some("rt".into()), id_token: Some("x.y.z".into()) })
        );
        // A refresh answers without a new refresh token.
        let t = parse_token_response(Provider::Google, &json!({ "access_token": "at2", "expires_in": "1800" })).unwrap();
        assert_eq!((t.expires_in, t.refresh), (1800, None));
        let gone = parse_token_response(Provider::Google, &json!({ "error": "invalid_grant", "error_description": "Token has been expired or revoked." }));
        assert!(gone.unwrap_err().contains("sign in again"));
        let ms = parse_token_response(Provider::Microsoft, &json!({ "error": "invalid_request", "error_description": "AADSTS9002327: nope.\r\nTrace ID: 1" }));
        assert_eq!(ms.unwrap_err(), "Microsoft refused the sign-in: AADSTS9002327: nope.");
        assert!(parse_token_response(Provider::Microsoft, &json!({})).is_err());
    }

    #[test]
    fn account_labels() {
        // {"alg":"none"} . {"email":"owen@example.com","sub":"1"} . sig
        let jwt = format!("{}.{}.sig", base64url(b"{\"alg\":\"none\"}"), base64url(b"{\"email\":\"owen@example.com\",\"sub\":\"1\"}"));
        assert_eq!(id_token_email(&jwt).as_deref(), Some("owen@example.com"));
        assert_eq!(id_token_email("garbage"), None);
        assert_eq!(graph_account(&json!({ "mail": null, "userPrincipalName": "o@outlook.com" })).as_deref(), Some("o@outlook.com"));
        assert_eq!(graph_account(&json!({ "mail": "a@b.c", "userPrincipalName": "x" })).as_deref(), Some("a@b.c"));
    }

    #[test]
    fn refresh_expiry() {
        assert!(fresh(1_000 + 3600, 1_000));
        assert!(fresh(1_061, 1_000));
        // Within a minute of expiring counts as expired.
        assert!(!fresh(1_060, 1_000));
        assert!(!fresh(900, 1_000));
        // An expired token in memory is not handed out; a fresh one is.
        ACCESS.lock().unwrap().insert(Provider::Microsoft, Access { token: "old".into(), expires_at: now_secs().saturating_sub(5) });
        assert_eq!(cached(Provider::Microsoft), None);
        remember(Provider::Microsoft, &Tokens { access: "new".into(), expires_in: 3600, refresh: None, id_token: None });
        assert_eq!(cached(Provider::Microsoft).as_deref(), Some("new"));
        ACCESS.lock().unwrap().remove(&Provider::Microsoft);
    }

    #[test]
    fn api_errors() {
        assert!(api_error(Provider::Google, 401, &json!({})).contains("sign in again"));
        let off = json!({ "error": { "message": "Gmail API has not been used in project 1 before or it is disabled." } });
        assert!(api_error(Provider::Google, 403, &off).contains("Turn on the Gmail API"));
        assert_eq!(api_error(Provider::Microsoft, 403, &json!({ "error": { "message": "Access is denied." } })), "Microsoft refused (403): Access is denied.");
        assert_eq!(api_error(Provider::Microsoft, 500, &Value::Null), "Microsoft answered 500.");
    }

    #[test]
    fn github_cli_output() {
        assert_eq!(clean_cli_token("gho_abcdefghijklmnopqrstuvwxyz0123456789\r\n").as_deref(), Some("gho_abcdefghijklmnopqrstuvwxyz0123456789"));
        assert_eq!(clean_cli_token(""), None);
        assert_eq!(clean_cli_token("no oauth token found for github.com\n"), None);
        assert_eq!(clean_cli_token("short\n"), None);
    }

    #[test]
    fn device_flow_responses() {
        let v = json!({ "device_code": "dc", "user_code": "WDJB-MJHT", "verification_uri": "https://github.com/login/device", "expires_in": 899, "interval": 5 });
        let (device, shown, interval) = parse_device_code(&v).unwrap();
        assert_eq!(device, "dc");
        assert_eq!(shown, DeviceCode { user_code: "WDJB-MJHT".into(), verification_uri: "https://github.com/login/device".into(), expires_in: 899 });
        assert_eq!(interval, 5);
        // The device code never reaches the UI.
        assert!(!serde_json::to_string(&shown).unwrap().contains("dc\""));
        assert!(parse_device_code(&json!({ "error": "device_flow_disabled" })).unwrap_err().contains("Enable Device Flow"));
        assert!(parse_device_code(&json!({ "error": "Not Found" })).unwrap_err().contains("client ID"));
        assert!(parse_device_code(&json!({})).is_err());

        assert_eq!(parse_device_poll(&json!({ "error": "authorization_pending" }), 5), DevicePoll::Pending);
        assert_eq!(parse_device_poll(&json!({ "error": "slow_down", "interval": 12 }), 5), DevicePoll::SlowDown(12));
        assert_eq!(parse_device_poll(&json!({ "error": "slow_down" }), 5), DevicePoll::SlowDown(10));
        assert_eq!(parse_device_poll(&json!({ "access_token": "gho_x", "token_type": "bearer", "scope": "repo" }), 5), DevicePoll::Token("gho_x".into()));
        assert!(matches!(parse_device_poll(&json!({ "error": "expired_token" }), 5), DevicePoll::Failed(m) if m.contains("expired")));
        assert!(matches!(parse_device_poll(&json!({ "error": "access_denied" }), 5), DevicePoll::Failed(m) if m.contains("cancelled")));
        assert!(matches!(parse_device_poll(&json!({}), 5), DevicePoll::Failed(_)));
    }

    // ── The listener itself, against 127.0.0.1 only ─────────────────────────

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap()
    }

    async fn browser(port: u16, target: &str) -> String {
        let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").as_bytes()).await.unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out).await;
        out
    }

    // FLOW is shared by every sign-in: these tests take turns.
    static ONE_FLOW: Mutex<()> = Mutex::new(());

    #[test]
    fn listener_takes_only_the_expected_callback() {
        let _turn = ONE_FLOW.lock().unwrap_or_else(|e| e.into_inner());
        runtime().block_on(async {
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
            let addr = listener.local_addr().unwrap();
            assert!(addr.ip().is_loopback());
            let flow = begin();
            let waiting = tokio::spawn(async move { wait_for_code(listener, "good-state", flow, Duration::from_secs(20)).await });

            let stray = browser(addr.port(), "/favicon.ico").await;
            assert!(stray.starts_with("HTTP/1.1 404"));
            let forged = browser(addr.port(), "/callback?state=evil&code=stolen").await;
            assert!(forged.starts_with("HTTP/1.1 400"));
            assert!(!waiting.is_finished());

            let real = browser(addr.port(), "/callback?state=good-state&code=the-code").await;
            assert!(real.starts_with("HTTP/1.1 200"));
            assert!(real.contains("You can close this tab"));
            assert_eq!(waiting.await.unwrap(), Ok("the-code".to_string()));
            // The port is closed once the sign-in is over.
            assert!(tokio::net::TcpStream::connect(addr).await.is_err());
        });
    }

    #[test]
    fn listener_stops_on_cancel_and_on_timeout() {
        let _turn = ONE_FLOW.lock().unwrap_or_else(|e| e.into_inner());
        runtime().block_on(async {
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
            let flow = begin();
            let waiting = tokio::spawn(async move { wait_for_code(listener, "s", flow, Duration::from_secs(20)).await });
            tokio::time::sleep(Duration::from_millis(100)).await;
            cancel();
            assert_eq!(waiting.await.unwrap(), Err("Sign-in cancelled.".to_string()));

            let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
            let flow = begin();
            let timed_out = wait_for_code(listener, "s", flow, Duration::from_millis(50)).await;
            assert!(timed_out.unwrap_err().contains("timed out"));
        });
    }
}
