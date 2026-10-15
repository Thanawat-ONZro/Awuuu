// The app's accent colour follows the dog the user picked. Pure: DogLook in,
// CSS values out. The default Shiba maps to the original caramel exactly.

import { CLASSIC, cleanHex, hexToHsl, hsl, normalizeLook, type DogLook } from "../mochi/looks";

export interface Accent {
  accent: string;
  hover: string;
  ink: string;
  /** "r, g, b" for rgba(var(--accent-caramel-rgb), a). */
  rgb: string;
}

/** The island background (--bg-nose). */
export const BG = "#0b0908";
const DARK_INK = "#2b1e14";
const LIGHT_INK = "#fff4e6";
const MIN_CONTRAST = 4.5;

const SHIBA: Accent = { accent: "#e4a871", hover: "#edb985", ink: DARK_INK, rgb: "228, 168, 113" };

function channels(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const chroma = (hex: string) => {
  const c = channels(hex);
  return Math.max(...c) - Math.min(...c);
};

/** Dark or light text, whichever reads better on `bg` (>= 4.5:1 guaranteed). */
export function inkFor(bg: string): string {
  const best = [DARK_INK, LIGHT_INK].sort((x, y) => contrast(y, bg) - contrast(x, bg))[0];
  if (contrast(best, bg) >= MIN_CONTRAST) return best;
  return contrast("#000000", bg) >= contrast("#ffffff", bg) ? "#000000" : "#ffffff";
}

export function accentForLook(look: DogLook | null | undefined): Accent {
  const l = look ? normalizeLook(look) : CLASSIC;
  const patch = cleanHex(l.patch) ?? CLASSIC.patch;
  const coat = cleanHex(l.coat) ?? CLASSIC.coat;
  // The more colourful of markings and coat; markings win ties.
  const src = chroma(coat) > chroma(patch) ? coat : patch;
  if (src.toLowerCase() === "#e4a871") return SHIBA;

  const [h, s0, l0] = hexToHsl(src);
  const s = s0 < 0.08 ? s0 : Math.min(0.85, Math.max(0.4, s0));
  let li = Math.min(0.78, Math.max(0.58, l0));
  let accent = hsl(h, s, li);
  while (contrast(accent, BG) < MIN_CONTRAST && li < 0.97) {
    li += 0.02;
    accent = hsl(h, s, li);
  }
  const hover = hsl(h, s, Math.min(0.98, li + 0.06));
  const a = accent.toLowerCase();
  return { accent: a, hover: hover.toLowerCase(), ink: inkFor(a), rgb: channels(a).join(", ") };
}

/** Write the --accent-caramel* variables for `look` on the page root. */
export function applyAccent(look: DogLook | Record<string, unknown> | null | undefined): void {
  if (typeof document === "undefined") return;
  const a = accentForLook(look as DogLook | null);
  const st = document.documentElement.style;
  st.setProperty("--accent-caramel", a.accent);
  st.setProperty("--accent-caramel-hover", a.hover);
  st.setProperty("--accent-caramel-ink", a.ink);
  st.setProperty("--accent-caramel-rgb", a.rgb);
}
