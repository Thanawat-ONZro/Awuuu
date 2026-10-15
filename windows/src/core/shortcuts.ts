// Global keyboard shortcuts — the pure part: accelerator parsing, normalising,
// recording a key press, conflict detection. No DOM, no Tauri.
//
// Rust (src-tauri/src/hotkeys.rs) owns the same table of actions and defaults
// and registers the keys; keep both tables in the same order.
//
// settings.shortcuts is a map action -> accelerator, holding only what the
// user changed. A missing entry means the default; "" means switched off.

export type ShortcutId =
  | "openChat" | "goToAlert" | "jumpToTerminal" | "muteToggle" | "toggleIsland"
  | "toggleDesktopDog" | "approvalAllow" | "approvalDeny";

export interface ShortcutDef {
  id: ShortcutId;
  label: string;
  hint: string;
  /** Accelerator used when the action is on by default, or suggested when it is off. */
  defaultKeys: string;
  defaultOn: boolean;
  /** Only registered while a permission card waits. */
  approvalOnly: boolean;
  /** Only registered while Settings → General → Dog on desktop is on. */
  desktopOnly?: boolean;
}

/** Same ids, order and defaults as ACTIONS in src-tauri/src/hotkeys.rs. */
export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: "openChat", label: "Open the chat", hint: "From any app. The island opens on the chat; only its text field takes the keyboard.", defaultKeys: "Ctrl+Alt+Space", defaultOn: true, approvalOnly: false },
  { id: "goToAlert", label: "Jump to the waiting permission", hint: "Opens the card that waits for an answer.", defaultKeys: "Ctrl+Alt+A", defaultOn: true, approvalOnly: false },
  { id: "jumpToTerminal", label: "Open the waiting session's terminal", hint: "Brings the terminal of the session that asks, or of the focused one.", defaultKeys: "Ctrl+Alt+T", defaultOn: true, approvalOnly: false },
  { id: "muteToggle", label: "Mute or unmute", hint: "Turns Awuuu's sounds off and on.", defaultKeys: "Ctrl+Alt+S", defaultOn: true, approvalOnly: false },
  { id: "toggleIsland", label: "Open or close the island", hint: "Off by default.", defaultKeys: "Ctrl+Alt+I", defaultOn: false, approvalOnly: false },
  { id: "toggleDesktopDog", label: "Send the dog to the desktop, or home", hint: "Active only while Dog on desktop is on (General).", defaultKeys: "Ctrl+Alt+D", defaultOn: true, approvalOnly: false, desktopOnly: true },
  { id: "approvalAllow", label: "Allow (permission card)", hint: "Active only while a permission card waits.", defaultKeys: "Ctrl+Alt+Y", defaultOn: true, approvalOnly: true },
  { id: "approvalDeny", label: "Deny (permission card)", hint: "Active only while a permission card waits.", defaultKeys: "Ctrl+Alt+N", defaultOn: true, approvalOnly: true },
];

/** `settings.shortcuts`: action id -> accelerator ("" = off). Only changes are stored. */
export type Bindings = Record<string, string>;

/** The accelerator in force for an action ("" = off). */
export function effectiveKeys(d: ShortcutDef, stored: Bindings | undefined): string {
  const own = stored && Object.prototype.hasOwnProperty.call(stored, d.id) ? stored[d.id] : undefined;
  if (own !== undefined) return normalizeKeys(own) ?? "";
  return d.defaultOn ? d.defaultKeys : "";
}

/** (id, accelerator) of every action that has a key. */
export function activeKeys(stored: Bindings | undefined): [ShortcutId, string][] {
  return SHORTCUTS.map((d) => [d.id, effectiveKeys(d, stored)] as [ShortcutId, string]).filter(([, k]) => k !== "");
}

/** Stores `keys` for `id`, dropping the entry when it equals the default. */
export function withBinding(stored: Bindings | undefined, id: ShortcutId, keys: string): Bindings {
  const next: Bindings = { ...(stored ?? {}) };
  const d = SHORTCUTS.find((s) => s.id === id);
  const norm = keys === "" ? "" : normalizeKeys(keys) ?? "";
  if (d && norm === (d.defaultOn ? d.defaultKeys : "")) delete next[id];
  else next[id] = norm;
  return next;
}

// ── Accelerators ──────────────────────────────────────────────────────────────

export interface Combo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** The Windows key. */
  meta: boolean;
  key: string;
}

const PUNCTUATION: Record<string, string> = {
  Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'", Backquote: "`",
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=",
};

const NAMED = [
  "Space", "Enter", "Tab", "Backspace", "Delete", "Insert", "Home", "End",
  "PageUp", "PageDown", "Up", "Down", "Left", "Right",
];

/** Every main key an accelerator may name; Rust parses the same names. */
export const KEY_NAMES: readonly string[] = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  ...NAMED,
  ...Object.keys(PUNCTUATION),
];

const KEY_ALIASES: Record<string, string> = {
  ARROWUP: "Up", ARROWDOWN: "Down", ARROWLEFT: "Left", ARROWRIGHT: "Right",
  RETURN: "Enter", DEL: "Delete", " ": "Space",
  ...Object.fromEntries(Object.entries(PUNCTUATION).map(([name, ch]) => [ch, name])),
};

function canonicalKey(token: string): string | null {
  const up = token.toUpperCase();
  if (KEY_ALIASES[token]) return KEY_ALIASES[token];
  if (KEY_ALIASES[up]) return KEY_ALIASES[up];
  if (/^KEY[A-Z]$/.test(up)) return up.slice(3);
  if (/^DIGIT[0-9]$/.test(up)) return up.slice(5);
  return KEY_NAMES.find((k) => k.toUpperCase() === up) ?? null;
}

/**
 * "Ctrl+Alt+Space" -> a Combo; null for anything else, including a bare key
 * (or Shift + key): a global shortcut needs Ctrl, Alt or the Windows key.
 */
export function parseKeys(text: string): Combo | null {
  if (!text.trim()) return null;
  const tokens = text.split("+").map((t) => t.trim());
  if (tokens.some((t) => !t)) return null;
  const combo: Combo = { ctrl: false, alt: false, shift: false, meta: false, key: "" };
  for (const [i, token] of tokens.entries()) {
    const last = i === tokens.length - 1;
    switch (token.toUpperCase()) {
      case "CTRL": case "CONTROL": case "COMMANDORCONTROL": case "CMDORCTRL":
        if (last) return null;
        combo.ctrl = true;
        continue;
      case "ALT": case "OPTION":
        if (last) return null;
        combo.alt = true;
        continue;
      case "SHIFT":
        if (last) return null;
        combo.shift = true;
        continue;
      case "SUPER": case "META": case "WIN": case "CMD": case "COMMAND":
        if (last) return null;
        combo.meta = true;
        continue;
    }
    if (!last) return null;
    const key = canonicalKey(token);
    if (!key) return null;
    combo.key = key;
  }
  if (!combo.key || !(combo.ctrl || combo.alt || combo.meta)) return null;
  return combo;
}

/** Combo -> "Ctrl+Alt+Shift+Super+Key", the form stored and handed to Rust. */
export function formatKeys(c: Combo): string {
  const parts: string[] = [];
  if (c.ctrl) parts.push("Ctrl");
  if (c.alt) parts.push("Alt");
  if (c.shift) parts.push("Shift");
  if (c.meta) parts.push("Super");
  parts.push(c.key);
  return parts.join("+");
}

/** Canonical form of an accelerator, or null when it isn't a valid one. */
export function normalizeKeys(text: string): string | null {
  const c = parseKeys(text);
  return c ? formatKeys(c) : null;
}

const KEY_GLYPHS: Record<string, string> = { Up: "↑", Down: "↓", Left: "←", Right: "→", ...PUNCTUATION };

/** What a person reads: "Ctrl+Alt+→", "Win+Space"; "Off" for no key. */
export function displayKeys(text: string): string {
  if (!text.trim()) return "Off";
  const c = parseKeys(text);
  if (!c) return text;
  const parts: string[] = [];
  if (c.ctrl) parts.push("Ctrl");
  if (c.alt) parts.push("Alt");
  if (c.shift) parts.push("Shift");
  if (c.meta) parts.push("Win");
  parts.push(KEY_GLYPHS[c.key] ?? c.key);
  return parts.join("+");
}

// ── Recording a key press ─────────────────────────────────────────────────────

export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export type Recorded =
  | { kind: "pending" }
  | { kind: "cancel" }
  | { kind: "clear" }
  | { kind: "keys"; keys: string }
  | { kind: "needsModifier" }
  | { kind: "unsupported" };

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph", "OS", "Super", "Hyper"]);

function pressedKey(e: KeyPress): string | null {
  if (/^[a-z]$/i.test(e.key) && !/^Key[A-Z]$/.test(e.code)) return e.key.toUpperCase();
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (/^Arrow(Up|Down|Left|Right)$/.test(e.code)) return e.code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.code)) return e.code;
  if (NAMED.includes(e.code) || e.code in PUNCTUATION) return e.code;
  if (e.code === "NumpadEnter") return "Enter";
  return null;
}

/** Turns a key press in the recorder into what to do with it. */
export function recordPress(e: KeyPress): Recorded {
  if (MODIFIER_KEYS.has(e.key)) return { kind: "pending" };
  const bare = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
  if (e.key === "Escape" && bare) return { kind: "cancel" };
  if ((e.key === "Backspace" || e.key === "Delete") && bare) return { kind: "clear" };
  const key = pressedKey(e);
  if (!key) return { kind: "unsupported" };
  if (!(e.ctrlKey || e.altKey || e.metaKey)) return { kind: "needsModifier" };
  return { kind: "keys", keys: formatKeys({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, key }) };
}

// ── Conflicts ─────────────────────────────────────────────────────────────────

/** Ids whose accelerator another entry also uses. */
export function duplicates(entries: Iterable<[string, string]>): Set<string> {
  const seen = new Map<string, string>();
  const dups = new Set<string>();
  for (const [id, keys] of entries) {
    const norm = normalizeKeys(keys);
    if (!norm) continue;
    const other = seen.get(norm);
    if (other != null) {
      dups.add(id);
      dups.add(other);
    } else {
      seen.set(norm, id);
    }
  }
  return dups;
}

/** The other action that already uses `keys`, if any (ignoring `except`). */
export function conflictWith(stored: Bindings | undefined, except: ShortcutId, keys: string): ShortcutId | null {
  const norm = normalizeKeys(keys);
  if (!norm) return null;
  for (const [id, k] of activeKeys(stored)) {
    if (id !== except && normalizeKeys(k) === norm) return id;
  }
  return null;
}

/** Why `keys` cannot be bound, or null when it can. */
export function validate(keys: string): string | null {
  if (!keys.trim()) return null;
  const bareish = parseKeys(keys);
  if (bareish) return null;
  return "Use Ctrl, Alt or the Windows key together with another key.";
}
