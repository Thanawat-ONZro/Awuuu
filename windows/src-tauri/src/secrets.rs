// API keys live in the Windows Credential Manager, never on disk and never in
// the front end — the island can only ask whether a key is present.

use keyring::Entry;

const SERVICE: &str = "com.thanawat.awuuu";

/// Every key Awuuu may store. Anything outside this list is refused.
pub const KNOWN_KEYS: &[&str] = &[
    "hermes-api-key",
    "hermes-url",
    "anthropic-api-key",
    "n8n-url",
    "n8n-api-key",
    "vercel-token",
    "github-token",
    "stripe-api-key",
    "resend-api-key",
    "notion-api-key",
    "calcom-api-key",
    "mail-password",
    "ical-url",
    "todoist-token",
];

/// `provider-key:<id>` for a chat provider added in Settings: a short id of
/// lowercase letters, digits and dashes, nothing else.
fn is_provider_key(key: &str) -> bool {
    key.strip_prefix("provider-key:").is_some_and(|id| {
        !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    })
}

fn entry(key: &str) -> Option<Entry> {
    if !KNOWN_KEYS.contains(&key) && !is_provider_key(key) {
        return None;
    }
    Entry::new(SERVICE, key).ok()
}

pub fn get(key: &str) -> Option<String> {
    entry(key)?.get_password().ok().filter(|v| !v.is_empty())
}

pub fn set(key: &str, value: &str) -> Result<(), String> {
    let entry = entry(key).ok_or_else(|| format!("unknown key {key}"))?;
    if value.is_empty() {
        let _ = entry.delete_credential();
        return Ok(());
    }
    entry.set_password(value).map_err(|e| e.to_string())
}

pub fn clear(key: &str) -> Result<(), String> {
    let entry = entry(key).ok_or_else(|| format!("unknown key {key}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn present(key: &str) -> bool {
    get(key).is_some()
}

#[cfg(test)]
mod tests {
    use super::is_provider_key;

    #[test]
    fn only_well_formed_provider_keys() {
        assert!(is_provider_key("provider-key:openrouter-1"));
        assert!(!is_provider_key("provider-key:"));
        assert!(!is_provider_key("provider-key:../x"));
        assert!(!is_provider_key("provider-key:Open AI"));
        assert!(!is_provider_key("anything-else"));
    }
}
