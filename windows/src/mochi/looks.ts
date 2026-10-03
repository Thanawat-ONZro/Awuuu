// How a dog looks: coat colours, markings, ears, tail, eyes and collar.
//
// A look is plain data (it is what `settings.dog` stores); dog.ts turns it into
// a palette and draws from it. The owner's dog comes from settings, every agent
// gets its own through lookForAgent().

export type DogPattern = "shiba" | "mask" | "saddle" | "spots" | "solid" | "tricolor";
export type DogEars = "pointed" | "floppy" | "round";
export type DogTail = "curl" | "straight" | "fluffy";
export type DogEyes = "dot" | "sparkle" | "sleepy";
export type DogCollar = "none" | "collar" | "bandana";

export interface DogLook {
  /** Preset id this look started from ("custom" once edited by hand). */
  preset: string;
  /** Main fur. */
  coat: string;
  /** Markings: ears and tail (shiba, solid), mask, tan points, spots, white blaze. */
  patch: string;
  /** Small details: inner ear, and the tricolor's brows and cheeks. */
  accent: string;
  pattern: DogPattern;
  ears: DogEars;
  tail: DogTail;
  eyes: DogEyes;
  collar: DogCollar;
  collarColor: string;
  /** Iris colour ("" = plain dark eyes). */
  eyeColor: string;
}

export const PATTERNS: readonly DogPattern[] = ["shiba", "mask", "saddle", "spots", "solid", "tricolor"];
export const EARS: readonly DogEars[] = ["pointed", "floppy", "round"];
export const TAILS: readonly DogTail[] = ["curl", "straight", "fluffy"];
export const EYES: readonly DogEyes[] = ["dot", "sparkle", "sleepy"];
export const COLLARS: readonly DogCollar[] = ["none", "collar", "bandana"];

const PINK = "#FFB0BE";

/** The dog Awuuu has always been: cream Shiba, caramel ears, white muzzle. */
export const CLASSIC: DogLook = Object.freeze({
  preset: "shiba",
  coat: "#FFF8EE", patch: "#E4A871", accent: PINK,
  pattern: "shiba", ears: "pointed", tail: "curl", eyes: "dot",
  collar: "none", collarColor: "#E5484D", eyeColor: "",
});

export interface DogPreset {
  id: string;
  name: string;
  look: DogLook;
}

const preset = (id: string, name: string, over: Partial<DogLook>): DogPreset =>
  ({ id, name, look: Object.freeze({ ...CLASSIC, ...over, preset: id }) });

export const PRESETS: readonly DogPreset[] = [
  preset("shiba", "Shiba", {}),
  preset("husky", "Husky", {
    coat: "#8793A6", patch: "#FAFCFF", pattern: "mask", tail: "fluffy", eyes: "sparkle", eyeColor: "#49B4F5",
  }),
  preset("blacktan", "Black & Tan", {
    coat: "#35302E", patch: "#DD9A55", accent: "#E9A9A0", pattern: "saddle", tail: "straight", eyeColor: "#E0A458",
  }),
  preset("dalmatian", "Dalmatian", {
    coat: "#FCFBF8", patch: "#2E2A28", pattern: "spots", ears: "floppy", tail: "straight",
    collar: "collar", collarColor: "#E5484D",
  }),
  preset("golden", "Golden", {
    coat: "#EFBE6E", patch: "#D0913F", pattern: "solid", ears: "floppy", tail: "fluffy",
  }),
  preset("corgi", "Corgi", {
    coat: "#EC9A4C", patch: "#FFF9F0", accent: "#B4652A", pattern: "tricolor", tail: "fluffy",
    collar: "bandana", collarColor: "#3B9EFF",
  }),
  preset("bernese", "Bernese", {
    coat: "#383230", patch: "#FFFFFF", accent: "#C8742F", pattern: "tricolor", ears: "floppy", tail: "fluffy",
    eyeColor: "#D99A52",
  }),
  preset("samoyed", "Samoyed", {
    coat: "#FFFFFF", patch: "#DDE5F0", pattern: "solid", tail: "fluffy", eyes: "sparkle",
  }),
  preset("pug", "Pug", {
    coat: "#EFD3A8", patch: "#5A463A", accent: "#F2B8A8", pattern: "saddle", ears: "round", eyes: "sparkle",
  }),
];

// ── Colour helpers (hex ↔ HSL) ────────────────────────────────────────────────

const HEX = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;

/** "#abc" / "#AABBCC" → "#AABBCC"; anything else → null. */
export function cleanHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (HEX.test(s)) return s.toUpperCase();
  if (HEX3.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toUpperCase();
  return null;
}

function hexToHsl(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  const r = ((v >> 16) & 255) / 255;
  const g = ((v >> 8) & 255) / 255;
  const b = (v & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hsl(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(1, s));
  const ll = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x]
    : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  const to = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

// ── Stored look → DogLook ─────────────────────────────────────────────────────

const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T =>
  typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : fallback;

/**
 * Whatever settings hold → a complete look. `null` (and anything that is not an
 * object) is the classic Shiba; unknown fields are dropped, missing or invalid
 * ones fall back to the look's preset, then to the classic.
 */
export function normalizeLook(raw: unknown): DogLook {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return CLASSIC;
  const r = raw as Record<string, unknown>;
  const base = PRESETS.find((p) => p.id === r.preset)?.look ?? CLASSIC;
  const eye = r.eyeColor === "" ? "" : cleanHex(r.eyeColor) ?? base.eyeColor;
  return {
    preset: typeof r.preset === "string" && r.preset.length <= 24 ? r.preset : "custom",
    coat: cleanHex(r.coat) ?? base.coat,
    patch: cleanHex(r.patch) ?? base.patch,
    accent: cleanHex(r.accent) ?? base.accent,
    pattern: oneOf(r.pattern, PATTERNS, base.pattern),
    ears: oneOf(r.ears, EARS, base.ears),
    tail: oneOf(r.tail, TAILS, base.tail),
    eyes: oneOf(r.eyes, EYES, base.eyes),
    collar: oneOf(r.collar, COLLARS, base.collar),
    collarColor: cleanHex(r.collarColor) ?? base.collarColor,
    eyeColor: eye,
  };
}

/** Same look, field by field (preset name aside). */
export function sameLook(a: DogLook, b: DogLook): boolean {
  return a === b || (
    a.coat === b.coat && a.patch === b.patch && a.accent === b.accent &&
    a.pattern === b.pattern && a.ears === b.ears && a.tail === b.tail && a.eyes === b.eyes &&
    a.collar === b.collar && a.collarColor === b.collarColor && a.eyeColor === b.eyeColor
  );
}

// ── A look built around one colour ────────────────────────────────────────────

const TAN = "#E3A765";

/**
 * Coat, markings and details for `pattern`, all derived from one hue so the
 * dog reads as "that colour" while keeping two or three tones. Lightness is
 * kept well above the island's black, whatever colour comes in.
 */
function themed(pattern: DogPattern, h: number, s: number): Pick<DogLook, "coat" | "patch" | "accent" | "eyeColor"> {
  const grey = s < 0.12;
  const sat = (k: number) => (grey ? 0 : Math.max(0.3, s) * k);
  switch (pattern) {
    case "shiba":
      return { coat: hsl(h + 4, sat(0.92), 0.68), patch: hsl(h - 6, sat(0.85), 0.5), accent: PINK, eyeColor: "" };
    case "mask":
      return { coat: hsl(h, sat(0.5), 0.57), patch: hsl(h, sat(0.6), 0.97), accent: PINK, eyeColor: hsl(h, grey ? 0 : 0.88, 0.62) };
    case "saddle":
      return { coat: hsl(h, sat(0.42), 0.34), patch: TAN, accent: "#E9A9A0", eyeColor: hsl(h, sat(0.8), 0.8) };
    case "spots":
      return { coat: hsl(h, sat(0.55), 0.95), patch: hsl(h, sat(0.85), 0.36), accent: PINK, eyeColor: "" };
    case "solid":
      return { coat: hsl(h, sat(0.85), 0.66), patch: hsl(h, sat(0.8), 0.48), accent: PINK, eyeColor: "" };
    case "tricolor":
      return { coat: hsl(h, sat(0.75), 0.46), patch: hsl(h, sat(0.5), 0.97), accent: grey ? TAN : hsl(h + 28, sat(0.9), 0.74), eyeColor: "" };
  }
}

type Shape = Pick<DogLook, "pattern" | "ears" | "tail" | "eyes">;

const AGENT_SHAPES: Record<string, Shape> = {
  claude: { pattern: "shiba", ears: "pointed", tail: "curl", eyes: "dot" },
  agy: { pattern: "mask", ears: "pointed", tail: "fluffy", eyes: "sparkle" },
  hermes: { pattern: "saddle", ears: "pointed", tail: "straight", eyes: "sparkle" },
  opencode: { pattern: "spots", ears: "floppy", tail: "straight", eyes: "dot" },
  codex: { pattern: "tricolor", ears: "floppy", tail: "fluffy", eyes: "dot" },
};

/** Integrations (and agents nobody has met yet) pick one of these by colour. */
const OTHER_SHAPES: readonly Shape[] = [
  { pattern: "solid", ears: "floppy", tail: "fluffy", eyes: "dot" },
  { pattern: "tricolor", ears: "pointed", tail: "fluffy", eyes: "dot" },
  { pattern: "mask", ears: "pointed", tail: "curl", eyes: "dot" },
  { pattern: "shiba", ears: "round", tail: "curl", eyes: "dot" },
  { pattern: "spots", ears: "floppy", tail: "straight", eyes: "dot" },
  { pattern: "solid", ears: "round", tail: "curl", eyes: "sparkle" },
];

const agentLooks = new Map<string, Map<string, DogLook>>();

/**
 * The dog an agent (or an integration) wears: a detailed breed recoloured
 * around its colour — never a flat blob. Cached, so the same (source, colour)
 * always returns the same object.
 */
export function lookForAgent(source: string, color: string): DogLook {
  let byColor = agentLooks.get(source);
  if (!byColor) agentLooks.set(source, (byColor = new Map()));
  const hit = byColor.get(color);
  if (hit) return hit;

  const hex = cleanHex(color) ?? "#F06543";
  const [h, s] = hexToHsl(hex);
  let shape = AGENT_SHAPES[source];
  if (!shape) {
    let n = 0;
    for (let i = 0; i < hex.length; i++) n = (n * 31 + hex.charCodeAt(i)) >>> 0;
    shape = OTHER_SHAPES[n % OTHER_SHAPES.length];
  }
  const look: DogLook = Object.freeze({
    preset: `agent-${source}`,
    ...shape,
    ...themed(shape.pattern, h, s),
    // Dark coats carry their agent's colour on a collar.
    collar: shape.pattern === "saddle" ? "collar" : "none",
    collarColor: hsl(h, Math.max(0.5, s), 0.62),
  });
  byColor.set(color, look);
  return look;
}

// ── Surprise me ───────────────────────────────────────────────────────────────

const pick = <T>(all: readonly T[]): T => all[Math.floor(Math.random() * all.length)];

/** Real coat colours, as [coat, markings, accent, pattern]. */
const NATURAL: readonly (readonly [string, string, string, DogPattern])[] = [
  ["#FFF8EE", "#E4A871", PINK, "shiba"],
  ["#F0A56A", "#C9702E", PINK, "shiba"],
  ["#F3E3C8", "#B98A5A", PINK, "shiba"],
  ["#8793A6", "#FAFCFF", PINK, "mask"],
  ["#B58C66", "#FFF6EA", PINK, "mask"],
  ["#6B6F78", "#F2F4F7", PINK, "mask"],
  ["#35302E", "#DD9A55", "#E9A9A0", "saddle"],
  ["#6A4630", "#E8B77A", "#E9A9A0", "saddle"],
  ["#EFD3A8", "#5A463A", "#F2B8A8", "saddle"],
  ["#FCFBF8", "#2E2A28", PINK, "spots"],
  ["#FBF3E6", "#9A5A2E", PINK, "spots"],
  ["#EFBE6E", "#D0913F", PINK, "solid"],
  ["#FFFFFF", "#DDE5F0", PINK, "solid"],
  ["#C98B5A", "#9A5F35", PINK, "solid"],
  ["#EC9A4C", "#FFF9F0", "#B4652A", "tricolor"],
  ["#383230", "#FFFFFF", "#C8742F", "tricolor"],
  ["#8A5A3A", "#FFF7EC", "#E0A868", "tricolor"],
];

const COLLAR_COLORS = ["#E5484D", "#3B9EFF", "#34D399", "#F5A524", "#A78BFA", "#F472B6"];
const EYE_COLORS = ["", "", "", "#49B4F5", "#E0A458", "#7BC47F"];

/** A random look that still looks like a dog someone would own. */
export function randomLook(): DogLook {
  let colors: Pick<DogLook, "coat" | "patch" | "accent" | "eyeColor">;
  let pattern: DogPattern;
  if (Math.random() < 0.7) {
    const [coat, patch, accent, p] = pick(NATURAL);
    pattern = p;
    colors = { coat, patch, accent, eyeColor: "" };
  } else {
    // A pastel dog of any hue.
    pattern = pick(PATTERNS);
    colors = themed(pattern, Math.floor(Math.random() * 360), 0.45 + Math.random() * 0.35);
    colors.eyeColor = "";
  }
  const collar = Math.random() < 0.45 ? pick(["collar", "bandana"] as const) : "none";
  const dark = pattern === "saddle";
  return {
    preset: "custom",
    ...colors,
    pattern,
    ears: pick(EARS),
    tail: pick(TAILS),
    eyes: pick(EYES),
    collar,
    collarColor: pick(COLLAR_COLORS),
    eyeColor: colors.eyeColor || (dark ? "#E0A458" : pick(EYE_COLORS)),
  };
}
