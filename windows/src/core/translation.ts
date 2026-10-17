// Pure translation helpers, provider selection, and text chunking for Awuuu's notch dashboard.
// Never persists or logs translated text (spec requirement).

export type TranslationProvider = "libretranslate" | "deepl" | "google";

export interface ProviderConfig {
  libreTranslateReachable: boolean;
  hasDeeplKey: boolean;
  hasGoogleKey: boolean;
  preferred?: TranslationProvider | null;
}

export const PROVIDER_CAPS: Record<TranslationProvider, number> = {
  libretranslate: 2000,
  deepl: 5000,
  google: 5000,
};

export interface LanguageOption {
  code: string;
  name: string;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "en", name: "English" },
  { code: "th", name: "Thai" },
  { code: "ja", name: "Japanese" },
  { code: "zh", name: "Chinese" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "ko", name: "Korean" },
];

/**
 * Selects translation provider following the strict order:
 * 1. Local LibreTranslate if available / reachable
 * 2. DeepL if API key configured
 * 3. Google if API key configured
 * 4. Otherwise null (module stays hidden)
 * If the owner set an explicit preference that is currently configured, honors it.
 */
export function selectProvider(config: ProviderConfig): TranslationProvider | null {
  const available = new Set<TranslationProvider>();
  if (config.libreTranslateReachable) available.add("libretranslate");
  if (config.hasDeeplKey) available.add("deepl");
  if (config.hasGoogleKey) available.add("google");

  if (config.preferred && available.has(config.preferred)) {
    return config.preferred;
  }

  if (available.has("libretranslate")) return "libretranslate";
  if (available.has("deepl")) return "deepl";
  if (available.has("google")) return "google";

  return null;
}

/**
 * Chunks text to fit within a provider's character cap.
 * Attempts splits on paragraph boundaries (\n\n), then sentence boundaries,
 * then word boundaries, before hard-splitting oversized words.
 */
export function chunkText(text: string, maxChars: number): string[] {
  const trimmed = text.trim();
  if (!trimmed || maxChars <= 0) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  // Try splitting by paragraph
  if (trimmed.includes("\n\n")) {
    const paragraphs = trimmed.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    const result: string[] = [];
    let current = "";

    for (const p of paragraphs) {
      if (p.length > maxChars) {
        if (current) {
          result.push(current);
          current = "";
        }
        result.push(...chunkText(p, maxChars));
      } else if (!current) {
        current = p;
      } else if (current.length + 2 + p.length <= maxChars) {
        current += `\n\n${p}`;
      } else {
        result.push(current);
        current = p;
      }
    }
    if (current) result.push(current);
    return result;
  }

  // Try splitting by sentence (. ! ? or newlines)
  const sentences = trimmed
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length > 1) {
    const result: string[] = [];
    let current = "";

    for (const s of sentences) {
      if (s.length > maxChars) {
        if (current) {
          result.push(current);
          current = "";
        }
        result.push(...chunkWords(s, maxChars));
      } else if (!current) {
        current = s;
      } else if (current.length + 1 + s.length <= maxChars) {
        current += ` ${s}`;
      } else {
        result.push(current);
        current = s;
      }
    }
    if (current) result.push(current);
    return result;
  }

  return chunkWords(trimmed, maxChars);
}

function chunkWords(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    // Single word exceeds maxChars -> hard split
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxChars) {
      chunks.push(text.slice(i, i + maxChars));
    }
    return chunks;
  }

  const result: string[] = [];
  let current = "";

  for (const w of words) {
    if (w.length > maxChars) {
      if (current) {
        result.push(current);
        current = "";
      }
      for (let i = 0; i < w.length; i += maxChars) {
        result.push(w.slice(i, i + maxChars));
      }
    } else if (!current) {
      current = w;
    } else if (current.length + 1 + w.length <= maxChars) {
      current += ` ${w}`;
    } else {
      result.push(current);
      current = w;
    }
  }

  if (current) result.push(current);
  return result;
}
