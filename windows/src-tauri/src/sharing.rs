//! Only explicit Shelf uploads leave the PC. AES-GCM keys live in the link fragment,
//! outside HTTP requests; the service stores ciphertext, expiry and a revocation hash.
use reqwest::{Client, Url};
use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
const MAX_FILE: u64 = 25 * 1024 * 1024;
const AAD: &[u8] = b"Awuuu share v1";
static UPLOAD: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
static RECEIPTS: Mutex<()> = Mutex::new(());
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn endpoint() -> Result<Url, String> {
    let value = std::env::var("AWUUU_SHARE_URL")
        .ok()
        .filter(|_| cfg!(debug_assertions))
        .or_else(|| option_env!("AWUUU_SHARE_URL").map(str::to_owned))
        .unwrap_or_default();
    if value.is_empty() {
        return Err("Sharing service is not configured in this build".into());
    }
    let url = Url::parse(&value).map_err(|_| "Invalid sharing service URL")?;
    let local = cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1" | "localhost"));
    if (url.scheme() != "https" && !local)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("Sharing service requires an HTTPS origin".into());
    }
    Ok(url)
}
fn client(timeout: u64) -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(timeout))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareStatus {
    configured: bool,
    available: bool,
    max_bytes: u64,
}
#[tauri::command]
pub async fn shelf_share_status() -> ShareStatus {
    let Ok(base) = endpoint() else {
        return ShareStatus {
            configured: false,
            available: false,
            max_bytes: MAX_FILE,
        };
    };
    let available = if let Ok(client) = client(5) {
        match client.get(base.join("health").unwrap()).send().await {
            Ok(response) if response.status().is_success() => response
                .json::<serde_json::Value>()
                .await
                .is_ok_and(|v| v["service"] == "awuuu-share" && v["encrypted"] == true),
            _ => false,
        }
    } else {
        false
    };
    ShareStatus {
        configured: true,
        available,
        max_bytes: MAX_FILE,
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexEntry {
    id: String,
    name: String,
    expires_at_ms: u64,
    service: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Credentials {
    url: String,
    revoke_token: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    id: String,
    name: String,
    url: String,
    qr: String,
    expires_at_ms: u64,
}
fn credential(id: &str) -> Result<keyring::Entry, String> {
    if !valid_id(id) {
        return Err("Invalid share ID".into());
    }
    keyring::Entry::new("com.thanawat.awuuu.shares", id).map_err(|e| e.to_string())
}
fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit() && !c.is_ascii_uppercase()
            }
        })
}
fn index_path() -> std::path::PathBuf {
    crate::settings::local_dir().join("share-receipts.json")
}
fn read_index() -> Vec<IndexEntry> {
    crate::store::read_json_file(&index_path())
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}
fn write_index(entries: &[IndexEntry]) -> Result<(), String> {
    crate::store::write_json_atomic(
        &index_path(),
        &serde_json::to_value(entries).map_err(|e| e.to_string())?,
    )
}
fn qr(url: &str) -> Result<String, String> {
    let code = qrcode::QrCode::new(url.as_bytes()).map_err(|e| e.to_string())?;
    let width = code.width();
    let side = width + 8;
    let mut svg=format!("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {side} {side}\" shape-rendering=\"crispEdges\"><path fill=\"white\" d=\"M0 0h{side}v{side}H0z\"/><g fill=\"black\">");
    for y in 0..width {
        for x in 0..width {
            if code[(x, y)] == qrcode::Color::Dark {
                svg.push_str(&format!("<path d=\"M{} {}h1v1h-1z\"/>", x + 4, y + 4));
            }
        }
    }
    svg.push_str("</g></svg>");
    Ok(format!(
        "data:image/svg+xml;base64,{}",
        crate::claude::base64_for(svg.as_bytes())
    ))
}
fn receipt(entry: &IndexEntry) -> Option<Receipt> {
    let text = credential(&entry.id).ok()?.get_password().ok()?;
    let c: Credentials = serde_json::from_str(&text).ok()?;
    Some(Receipt {
        id: entry.id.clone(),
        name: entry.name.clone(),
        qr: qr(&c.url).ok()?,
        url: c.url,
        expires_at_ms: entry.expires_at_ms,
    })
}

fn encrypt_file(name: &str, bytes: &[u8]) -> Result<(Vec<u8>, String), String> {
    if name.is_empty() || name.len() > 240 || bytes.len() as u64 > MAX_FILE {
        return Err("Maximum file size is 25 MB; filename must be under 240 bytes".into());
    }
    let random = SystemRandom::new();
    let mut key = [0; 32];
    let mut nonce = [0; 12];
    random
        .fill(&mut key)
        .map_err(|_| "Random generation failed")?;
    random
        .fill(&mut nonce)
        .map_err(|_| "Random generation failed")?;
    let cipher = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_256_GCM, &key)
            .map_err(|_| "Encryption initialization failed")?,
    );
    let mut body = Vec::with_capacity(bytes.len() + name.len() + 18);
    body.extend_from_slice(&(name.len() as u16).to_le_bytes());
    body.extend_from_slice(name.as_bytes());
    body.extend_from_slice(bytes);
    cipher
        .seal_in_place_append_tag(
            aead::Nonce::assume_unique_for_key(nonce),
            aead::Aad::from(AAD),
            &mut body,
        )
        .map_err(|_| "File encryption failed")?;
    let mut out = Vec::with_capacity(body.len() + 16);
    out.extend_from_slice(b"AWU1");
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&body);
    Ok((out, crate::oauth::base64url(&key)))
}
fn shelf_bytes(path: &str) -> Result<(String, Vec<u8>), String> {
    let dir = std::fs::canonicalize(crate::shelf::shelf_dir()).map_err(|_| "Shelf is empty")?;
    let file = std::fs::canonicalize(path).map_err(|_| "Shelf file no longer exists")?;
    if file.parent() != Some(dir.as_path()) || !file.is_file() {
        return Err("Only files on Shelf can be shared".into());
    }
    let name = file
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or("Invalid filename")?
        .to_owned();
    let mut bytes = Vec::new();
    std::fs::File::open(&file)
        .map_err(|e| e.to_string())?
        .take(MAX_FILE + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_FILE {
        return Err("Maximum file size is 25 MB".into());
    }
    Ok((name, bytes))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Created {
    id: String,
    url: String,
    revoke_token: String,
    expires_at_ms: u64,
}
#[tauri::command]
pub async fn shelf_share_create(path: String) -> Result<Receipt, String> {
    let _permit = UPLOAD
        .try_acquire()
        .map_err(|_| "An upload is already in progress")?;
    let base = endpoint()?;
    {
        let _guard = RECEIPTS.lock().unwrap();
        if read_index()
            .iter()
            .filter(|e| e.expires_at_ms > now())
            .count()
            >= 50
        {
            return Err("Revoke an old share before creating another".into());
        }
    }
    let (name, encrypted, key) = tauri::async_runtime::spawn_blocking(move || {
        let (name, bytes) = shelf_bytes(&path)?;
        let (encrypted, key) = encrypt_file(&name, &bytes)?;
        Ok::<_, String>((name, encrypted, key))
    })
    .await
    .map_err(|e| e.to_string())??;
    let http = client(90)?;
    let response = http
        .post(base.join("api/shares").unwrap())
        .header("Content-Type", "application/octet-stream")
        .body(encrypted)
        .send()
        .await
        .map_err(|_| "Upload failed. Check your internet connection and try again.")?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            413 => "Maximum file size is 25 MB",
            429 => "Sharing limit reached. Try again later.",
            _ => "Sharing service is unavailable. Try again later.",
        }
        .into());
    }
    let created: Created = response
        .json()
        .await
        .map_err(|_| "Invalid sharing service response")?;
    let target = Url::parse(&created.url).map_err(|_| "Invalid share link")?;
    if !valid_id(&created.id)
        || target.origin() != base.origin()
        || target.path() != format!("/s/{}", created.id)
        || target.fragment().is_some()
        || target.query().is_some()
        || created.expires_at_ms <= now()
        || created.expires_at_ms > now() + 86_460_000
        || created.revoke_token.len() != 43
    {
        return Err("Invalid sharing service response".into());
    }
    let url = format!("{}#{}", created.url, key);
    let entry = IndexEntry {
        id: created.id.clone(),
        name: name.clone(),
        service: base.as_str().into(),
        expires_at_ms: created.expires_at_ms,
    };
    let credentials = Credentials {
        url: url.clone(),
        revoke_token: created.revoke_token.clone(),
    };
    let result = (|| {
        let _guard = RECEIPTS.lock().unwrap();
        let store = credential(&created.id)?;
        store
            .set_password(&serde_json::to_string(&credentials).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let mut index = read_index();
        index.push(entry.clone());
        if let Err(error) = write_index(&index) {
            let _ = store.delete_credential();
            return Err(error);
        }
        receipt(&entry).ok_or_else(|| "Could not load saved share".into())
    })();
    if result.is_err() {
        let _ = http
            .delete(base.join(&format!("api/shares/{}", created.id)).unwrap())
            .bearer_auth(&created.revoke_token)
            .send()
            .await;
    }
    result
}
#[tauri::command]
pub async fn shelf_share_list() -> Result<Vec<Receipt>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let _guard = RECEIPTS.lock().unwrap();
        let mut index = read_index();
        let expired: Vec<_> = index
            .iter()
            .filter(|e| e.expires_at_ms <= now())
            .map(|e| e.id.clone())
            .collect();
        for id in expired {
            if let Ok(entry) = credential(&id) {
                let _ = entry.delete_credential();
            }
        }
        index.retain(|e| e.expires_at_ms > now());
        write_index(&index)?;
        Ok(index.iter().rev().filter_map(receipt).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn shelf_share_revoke(id: String) -> Result<(), String> {
    let entry = {
        let _guard = RECEIPTS.lock().unwrap();
        read_index()
            .into_iter()
            .find(|e| e.id == id)
            .ok_or("Share no longer exists")?
    };
    let c: Credentials = serde_json::from_str(
        &credential(&id)?
            .get_password()
            .map_err(|_| "Share credentials are unavailable")?,
    )
    .map_err(|_| "Share credentials are unavailable")?;
    let base = Url::parse(&entry.service).map_err(|_| "Invalid share service")?;
    let response = client(10)?
        .delete(
            base.join(&format!("api/shares/{id}"))
                .map_err(|_| "Invalid share ID")?,
        )
        .bearer_auth(&c.revoke_token)
        .send()
        .await
        .map_err(|_| "Could not revoke. Connect to the internet and try again.")?;
    if !response.status().is_success() && response.status().as_u16() != 404 {
        return Err("Could not revoke this share. Try again later.".into());
    }
    let _guard = RECEIPTS.lock().unwrap();
    let mut index = read_index();
    index.retain(|e| e.id != id);
    write_index(&index)?;
    let _ = credential(&id)?.delete_credential();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypted_envelope_roundtrips_and_hides_filename() {
        let (encrypted, key) = encrypt_file("private.txt", b"hello private world").unwrap();
        assert_eq!(&encrypted[..4], b"AWU1");
        assert!(!encrypted.windows(11).any(|w| w == b"private.txt"));
        let raw = crate::extras::base64_decode(&key);
        let cipher =
            aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_256_GCM, &raw).unwrap());
        let nonce: [u8; 12] = encrypted[4..16].try_into().unwrap();
        let mut body = encrypted[16..].to_vec();
        let plain = cipher
            .open_in_place(
                aead::Nonce::assume_unique_for_key(nonce),
                aead::Aad::from(AAD),
                &mut body,
            )
            .unwrap();
        assert_eq!(&plain[2..13], b"private.txt");
        assert_eq!(&plain[13..], b"hello private world");
    }
    #[test]
    fn unsafe_ids_are_rejected() {
        assert!(!valid_id("../other"));
        assert!(valid_id("12345678-1234-4234-8234-123456789abc"));
    }
    #[test]
    #[ignore = "requires Wrangler on 127.0.0.1:8787; sends only a generated test file"]
    fn local_worker_roundtrip() {
        tauri::async_runtime::block_on(async {
            let base = Url::parse("http://127.0.0.1:8787/").unwrap();
            let http = client(20).unwrap();
            let (bytes, key) =
                encrypt_file("awuuu-roundtrip.txt", b"Awuuu local encrypted sharing test").unwrap();
            let response = http
                .post(base.join("api/shares").unwrap())
                .header("Content-Type", "application/octet-stream")
                .body(bytes)
                .send()
                .await
                .unwrap();
            assert!(
                response.status().is_success(),
                "Upload returned {}",
                response.status()
            );
            let created: Created = response.json().await.unwrap();
            assert!(valid_id(&created.id));
            let api = base.join(&format!("api/shares/{}", created.id)).unwrap();
            let encrypted = http
                .get(api.clone())
                .send()
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap();
            let raw = crate::extras::base64_decode(&key);
            let cipher =
                aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_256_GCM, &raw).unwrap());
            let nonce: [u8; 12] = encrypted[4..16].try_into().unwrap();
            let mut body = encrypted[16..].to_vec();
            let plain = cipher
                .open_in_place(
                    aead::Nonce::assume_unique_for_key(nonce),
                    aead::Aad::from(AAD),
                    &mut body,
                )
                .unwrap();
            let name_len = u16::from_le_bytes(plain[..2].try_into().unwrap()) as usize;
            assert_eq!(&plain[2..2 + name_len], b"awuuu-roundtrip.txt");
            assert_eq!(
                &plain[2 + name_len..],
                b"Awuuu local encrypted sharing test"
            );
            assert!(qr(&format!("{}#{}", created.url, key))
                .unwrap()
                .starts_with("data:image/svg+xml;base64,"));
            assert_eq!(
                http.delete(api.clone())
                    .bearer_auth("wrong-token")
                    .send()
                    .await
                    .unwrap()
                    .status()
                    .as_u16(),
                403
            );
            assert!(http
                .delete(api.clone())
                .bearer_auth(&created.revoke_token)
                .send()
                .await
                .unwrap()
                .status()
                .is_success());
            assert_eq!(http.get(api).send().await.unwrap().status().as_u16(), 404);
        });
    }
}
