import { describe, expect, it } from "vitest";
import { t, setLanguage, currentLanguage, resolveLanguage, systemLanguage, THAI } from "../src/i18n/i18n";
import { SHORTCUTS } from "../src/core/shortcuts";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("t", () => {
  it("falls back to the key and substitutes placeholders", () => {
    setLanguage("en");
    expect(t("No such string")).toBe("No such string");
    expect(t("Uploading {what}", { what: "a.txt" })).toBe("Uploading a.txt");
    expect(t("Keep {x}", {})).toBe("Keep {x}");
  });
  it("speaks Thai and still substitutes", () => {
    setLanguage("th");
    expect(currentLanguage()).toBe("th");
    expect(t("Uploading {what}", { what: "a.txt" })).toContain("a.txt");
    expect(t("Uploading {what}", { what: "a.txt" })).not.toBe("Uploading a.txt");
    setLanguage("en");
  });
  it("resolves auto from the locale", () => {
    expect(resolveLanguage("auto", "th-TH")).toBe("th");
    expect(resolveLanguage("auto", "en-US")).toBe("en");
    expect(resolveLanguage(undefined, "de")).toBe("en");
    expect(resolveLanguage("en", "th-TH")).toBe("en");
    expect(resolveLanguage("th", "en-US")).toBe("th");
    expect(systemLanguage("th")).toBe("th");
  });
});

describe("Thai dictionary", () => {
  it("keeps the same {placeholders} as the English key", () => {
    for (const [k, v] of Object.entries(THAI)) expect(placeholders(v), k).toBe(placeholders(k));
  });
  it("covers the shortcut labels and hints (looked up dynamically)", () => {
    for (const d of SHORTCUTS) {
      expect(THAI[d.label], d.label).toBeTruthy();
      expect(THAI[d.hint], d.hint).toBeTruthy();
    }
  });
});

// Files whose strings are only partly translated yet: their missing entries do
// not fail the build. Listed by file; remove a file once it is complete.
const ALLOWED_FILES: Record<string, string> = {
  "app/pages/sessions.ts": "long recap/story sentences and plural-composed lines still English",
  "app/pages/stats.ts": "chart and tile captions composed from plural() still English",
  "app/pages/welcome.ts": "onboarding copy not finished",
  "app/pages/about.ts": "about text not finished",
  "app/pages/composio-card.ts": "technical card, English only for now",
  "app/weekly-card.ts": "canvas card text not finished",
};

const SOURCES = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("every t(\"…\") literal", () => {
  const re = /(?<![\w.])t\(\s*"((?:[^"\\]|\\.)+)"\s*[,)]/g;
  it("has a Thai entry, or its file is allowlisted", () => {
    const missing: string[] = [];
    for (const [f, src] of Object.entries(SOURCES)) {
      const rel = f.replace("../src/", "");
      if (rel.startsWith("i18n/") || ALLOWED_FILES[rel]) continue;
      for (const m of src.matchAll(re)) {
        const key = JSON.parse(`"${m[1]}"`) as string;
        if (!(key in THAI)) missing.push(`${rel}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
