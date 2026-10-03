// Who Awuuu is in a chat: the system prompt, built from the user's settings.
//
// Two shapes: the full persona for models that know nothing about the user
// (Anthropic, OpenAI-compatible providers), and a light one for Hermes, whose
// own profile and memories stay in charge; it only adds the voice and the
// display rules. Pure, so it is tested on any OS.

/// How Awuuu talks. Settings → Chat → Tone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    /// Warm and a little playful, the default.
    Playful,
    /// Few words, no chatter.
    Calm,
    /// Plain and to the point, like a colleague.
    Pro,
}

impl Tone {
    pub fn parse(s: &str) -> Tone {
        match s.trim().to_ascii_lowercase().as_str() {
            "calm" | "quiet" => Tone::Calm,
            "pro" | "professional" => Tone::Pro,
            _ => Tone::Playful,
        }
    }

    fn voice(self) -> &'static str {
        match self {
            Tone::Playful => {
                "Your voice is warm, upbeat and a little playful, like a loyal dog who is happy to help: \
                 a light touch of fun is welcome (an occasional \"woof\" or tail wag), but never at the cost of a clear answer."
            }
            Tone::Calm => {
                "Your voice is calm and quiet: few words, no small talk, no exclamation marks, no jokes. \
                 Answer, then stop."
            }
            Tone::Pro => {
                "Your voice is professional and direct, like a senior colleague: no jokes or dog sounds, \
                 lead with the answer, then the reasoning if it helps."
            }
        }
    }
}

/// What a prompt is built from.
pub struct Persona<'a> {
    pub tone: Tone,
    /// The user's first name, or "" when unknown.
    pub name: &'a str,
    /// The chat bubble renders Markdown (bold, lists, code blocks).
    pub markdown: bool,
}

impl Persona<'_> {
    /// For Anthropic and OpenAI-compatible models.
    pub fn full(&self) -> String {
        let mut p = String::from(
            "You are Awuuu, a small AI companion dog who lives at the top of the user's screen on Windows. \
             You help with their work: questions, writing, code, and what their coding agents (Claude Code, Codex, Hermes…) are doing.",
        );
        self.common(&mut p);
        p.push_str(" If you don't know something, say so plainly instead of guessing.");
        p
    }

    /// For Hermes: its own profile, memories and tools stay in charge.
    pub fn hermes(&self) -> String {
        let mut p = String::from(
            "You are talking through Awuuu, a small dog companion that lives at the top of the user's screen. \
             Keep your own memory, skills and tools; Awuuu only sets the voice and how replies are shown.",
        );
        self.common(&mut p);
        p
    }

    fn common(&self, p: &mut String) {
        p.push(' ');
        p.push_str(self.tone.voice());
        let name = self.name.trim();
        if !name.is_empty() {
            p.push_str(&format!(
                " The user's name is {name}; use it now and then, naturally, not in every reply."
            ));
        }
        p.push_str(
            " Always reply in the language the user writes in. In Thai, sound like a friendly Thai speaker, \
             not like a translation.",
        );
        p.push_str(" Your reply appears in a small chat bubble: keep it short unless the user asks for detail.");
        if self.markdown {
            p.push_str(
                " You may use simple Markdown: **bold**, bullet or numbered lists, `inline code` and fenced code blocks. \
                 No tables, no images, no HTML.",
            );
        } else {
            p.push_str(" Write plain text with line breaks, no Markdown.");
        }
    }
}

/// The user's first name: the one set in Settings, else the Windows account
/// name when it looks like a name ("owen", "Owen.T" → "Owen").
pub fn first_name(setting: &str, account: Option<&str>) -> String {
    let pick = |s: &str| -> Option<String> {
        let word = s.trim().split(|c: char| c.is_whitespace() || c == '.' || c == '_' || c == '-').next()?;
        if word.chars().count() < 2 || !word.chars().all(char::is_alphabetic) {
            return None;
        }
        let mut cs = word.chars();
        let first = cs.next()?;
        Some(first.to_uppercase().chain(cs).collect())
    };
    if !setting.trim().is_empty() {
        return setting.trim().to_string();
    }
    account.and_then(pick).unwrap_or_default()
}

/// The awareness note, appended to a system prompt.
pub fn awareness_block(note: &str) -> String {
    format!(
        "\n\nWhat Awuuu can see on the user's computer right now (from the island; use it only when it helps \
         answer, never recite it unasked):\n{note}"
    )
}

/// Whether the awareness note may go to this backend. `mode` is the setting
/// ("" = "local").
pub fn may_share(mode: &str, local: bool) -> bool {
    match mode.trim() {
        "off" => false,
        "always" => true,
        _ => local,
    }
}

/// A provider URL on this machine (Ollama, LM Studio, a local gateway).
pub fn is_local_url(url: &str) -> bool {
    let rest = url.trim().split("://").nth(1).unwrap_or(url.trim());
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = if host.starts_with('[') { host.split(']').next().map(|h| &h[1..]).unwrap_or("") } else { host.split(':').next().unwrap_or("") };
    let host = host.to_ascii_lowercase();
    host == "localhost" || host == "::1" || host.starts_with("127.")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn persona(tone: Tone, name: &str, markdown: bool) -> Persona<'_> {
        Persona { tone, name, markdown }
    }

    #[test]
    fn tones_parse_with_a_playful_default() {
        assert_eq!(Tone::parse("calm"), Tone::Calm);
        assert_eq!(Tone::parse(" PRO "), Tone::Pro);
        assert_eq!(Tone::parse(""), Tone::Playful);
        assert_eq!(Tone::parse("whatever"), Tone::Playful);
    }

    #[test]
    fn each_tone_sets_its_own_voice() {
        let playful = persona(Tone::Playful, "", false).full();
        let calm = persona(Tone::Calm, "", false).full();
        let pro = persona(Tone::Pro, "", false).full();
        assert!(playful.contains("playful"));
        assert!(calm.contains("calm and quiet"));
        assert!(pro.contains("professional"));
    }

    #[test]
    fn the_name_is_used_only_when_known() {
        assert!(persona(Tone::Playful, "Owen", false).full().contains("name is Owen"));
        assert!(!persona(Tone::Playful, "  ", false).full().contains("name is"));
    }

    #[test]
    fn markdown_follows_what_the_bubble_can_show() {
        assert!(persona(Tone::Pro, "", true).hermes().contains("simple Markdown"));
        assert!(persona(Tone::Pro, "", false).hermes().contains("no Markdown"));
    }

    #[test]
    fn hermes_keeps_its_own_memory() {
        let h = persona(Tone::Playful, "", false).hermes();
        assert!(h.contains("Keep your own memory"));
        assert!(!h.contains("You are Awuuu,"));
    }

    #[test]
    fn awareness_goes_only_where_the_setting_allows() {
        assert!(may_share("", true));
        assert!(!may_share("", false));
        assert!(may_share("local", true));
        assert!(may_share("always", false));
        assert!(!may_share("off", true));
    }

    #[test]
    fn local_urls_are_this_machine_only() {
        assert!(is_local_url("http://127.0.0.1:11434/v1"));
        assert!(is_local_url("http://localhost:1234/v1"));
        assert!(is_local_url("http://[::1]:8080"));
        assert!(!is_local_url("https://api.openai.com/v1"));
        assert!(!is_local_url("http://localhost.evil.com/v1"));
        assert!(!is_local_url("http://192.168.1.5:11434"));
    }

    #[test]
    fn first_name_prefers_the_setting_then_the_account() {
        assert_eq!(first_name("Owen", Some("thanawat")), "Owen");
        assert_eq!(first_name("", Some("thanawat.o")), "Thanawat");
        assert_eq!(first_name("", Some("user01")), "");
        assert_eq!(first_name("", Some("x")), "");
        assert_eq!(first_name("", None), "");
    }
}
