// Interface language: English and Thai.
//
// Strings are looked up by their English text: `t("Allow")`,
// `t("Uploading {name}", { name })`. th.json maps the English text to Thai.
// A string missing from it shows in English, so a gap is never a blank.

import TH from "./th.json";

export type Language = "en" | "th";
export type LanguageSetting = "auto" | "en" | "th";
export type Vars = Record<string, string | number>;

const TABLES: Record<Language, Record<string, string>> = { en: {}, th: TH as Record<string, string> };

let current: Language = "en";

/** The language "auto" resolves to: Thai when the system locale is Thai. */
export function systemLanguage(locale?: string): Language {
  const l = locale ?? (typeof navigator !== "undefined" ? navigator.language : "");
  return /^th/i.test(l ?? "") ? "th" : "en";
}

export function resolveLanguage(code: string | undefined | null, locale?: string): Language {
  if (code === "en" || code === "th") return code;
  return systemLanguage(locale);
}

/** Apply a Settings `language` value ("auto" | "en" | "th"). */
export function setLanguage(code: string | undefined | null): Language {
  current = resolveLanguage(code);
  try {
    document.documentElement.lang = current;
  } catch {
    /* no document (tests) */
  }
  return current;
}

export function currentLanguage(): Language {
  return current;
}

export function format(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Look up `key` (the English text) in the current language, then fill `{name}`s. */
export function t(key: string, vars?: Vars): string {
  return format(TABLES[current][key] ?? key, vars);
}

/** Thai table, for tests. */
export const THAI: Record<string, string> = TABLES.th;
