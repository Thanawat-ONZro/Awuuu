import { describe, expect, it } from "vitest";
import {
  chunkText,
  selectProvider,
  PROVIDER_CAPS,
  type ProviderConfig,
} from "../src/core/translation";

describe("translation text-chunking", () => {
  it("returns empty array for empty or whitespace-only input", () => {
    expect(chunkText("", 100)).toEqual([]);
    expect(chunkText("   ", 100)).toEqual([]);
  });

  it("returns single chunk when text length is within maxChars", () => {
    const text = "Hello world from Awuuu";
    expect(chunkText(text, 50)).toEqual(["Hello world from Awuuu"]);
    expect(chunkText(text, text.length)).toEqual(["Hello world from Awuuu"]);
  });

  it("splits text at paragraph breaks when available", () => {
    const p1 = "First paragraph of text.";
    const p2 = "Second paragraph of text.";
    const p3 = "Third paragraph of text.";
    const full = `${p1}\n\n${p2}\n\n${p3}`;

    const chunks = chunkText(full, 35);
    expect(chunks).toEqual([p1, p2, p3]);
  });

  it("splits text at sentence boundaries when paragraphs are too long", () => {
    const s1 = "Quick brown fox jumps.";
    const s2 = "Lazy dog sleeps soundly.";
    const s3 = "Birds sing in the morning.";
    const full = `${s1} ${s2} ${s3}`;

    const chunks = chunkText(full, 30);
    expect(chunks).toEqual([s1, s2, s3]);
  });

  it("splits text at word boundaries when a sentence exceeds maxChars", () => {
    const full = "The swift red fox leaps gracefully over the very sleepy hound";
    const chunks = chunkText(full, 25);
    expect(chunks).toEqual([
      "The swift red fox leaps",
      "gracefully over the very",
      "sleepy hound",
    ]);
  });

  it("hard splits words that exceed maxChars without spaces", () => {
    const longWord = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const chunks = chunkText(longWord, 10);
    expect(chunks).toEqual(["ABCDEFGHIJ", "KLMNOPQRST", "UVWXYZ"]);
  });

  it("has exact defined provider character caps", () => {
    expect(PROVIDER_CAPS.libretranslate).toBe(2000);
    expect(PROVIDER_CAPS.deepl).toBe(5000);
    expect(PROVIDER_CAPS.google).toBe(5000);
  });
});

describe("translation provider selection order", () => {
  it("prefers local LibreTranslate when reachable", () => {
    const config: ProviderConfig = {
      libreTranslateReachable: true,
      hasDeeplKey: true,
      hasGoogleKey: true,
    };
    expect(selectProvider(config)).toBe("libretranslate");
  });

  it("falls back to DeepL when LibreTranslate is unreachable and DeepL key exists", () => {
    const config: ProviderConfig = {
      libreTranslateReachable: false,
      hasDeeplKey: true,
      hasGoogleKey: true,
    };
    expect(selectProvider(config)).toBe("deepl");
  });

  it("falls back to Google when LibreTranslate unreachable and only Google key exists", () => {
    const config: ProviderConfig = {
      libreTranslateReachable: false,
      hasDeeplKey: false,
      hasGoogleKey: true,
    };
    expect(selectProvider(config)).toBe("google");
  });

  it("returns null when no provider is configured or reachable", () => {
    const config: ProviderConfig = {
      libreTranslateReachable: false,
      hasDeeplKey: false,
      hasGoogleKey: false,
    };
    expect(selectProvider(config)).toBeNull();
  });

  it("never returns a provider that is not configured even if preferred", () => {
    const config: ProviderConfig = {
      libreTranslateReachable: false,
      hasDeeplKey: false,
      hasGoogleKey: false,
      preferred: "deepl",
    };
    expect(selectProvider(config)).toBeNull();
  });

  it("honors preferred provider if it is available and configured", () => {
    const config: ProviderConfig = {
      libreTranslateReachable: true,
      hasDeeplKey: true,
      hasGoogleKey: true,
      preferred: "deepl",
    };
    expect(selectProvider(config)).toBe("deepl");

    const config2: ProviderConfig = {
      libreTranslateReachable: true,
      hasDeeplKey: true,
      hasGoogleKey: true,
      preferred: "google",
    };
    expect(selectProvider(config2)).toBe("google");
  });
});
