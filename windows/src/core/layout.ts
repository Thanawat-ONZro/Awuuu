// Island geometry — ported from IslandTypes.swift + IslandWindowController.islandSize
// + IslandRootView.botPosition. All values are logical pixels, identical to the
// macOS app's points.

export type IslandMode = "hidden" | "compact" | "expanded";

export type IslandViewName =
  | "overview"
  | "agents"
  | "empty"
  | "approval"
  | "error"
  | "finished"
  | "confused"
  | "upload"
  | "uploading"
  | "choose"
  | "mail"
  | "prompt"
  | "searching"
  | "result"
  | "note"
  | "settings"
  | "greeting";

export type BotStateName =
  | "idle"
  | "working"
  | "thinking"
  | "searching"
  | "approval"
  | "question"
  | "error"
  | "finished"
  | "ratelimit"
  | "sleeping"
  | "dizzy";

export type BotEmoteName = "love" | "surprised" | "proud" | "wink" | "yawn" | "happy" | "annoyed";

export type AgentLayoutMode = "none" | "grid" | "pills" | "column";

export interface ViewLayout {
  height: number;
  botX: number;
  botY: number | null; // null = auto-centred
  botDiameter: number;
  agentMode: AgentLayoutMode;
}

// The window holds the open island (720×320 by default, bigger when the user
// makes the island bigger); the island is drawn inside it where `IslandLayout`
// says — Rust decides that from the placement (edge or free, see island.rs).
export interface IslandLayout {
  /** Island centre x in window px (h = "center"). */
  anchorX: number;
  h: "center" | "left" | "right";
  /** "top": hangs down from its anchor; "bottom": grows up. */
  v: "top" | "bottom";
  edge: "top" | "bottom" | "left" | "right";
  /** Hidden tab stands upright (left/right edges). */
  vertical: boolean;
  panelW: number;
  panelH: number;
}

export const DEFAULT_LAYOUT: IslandLayout = {
  anchorX: 360, h: "center", v: "top", edge: "top", vertical: false, panelW: 720, panelH: 320,
};

/** The header is 34 px: a row along the top (top edge), along the bottom
 * (bottom edge, upside down) or a rail down the docked side (left/right). */
export const HEADER_SIZE = 34;

/** The island is upright on the sides: a tall pill, a rail for the header. */
export function onSide(): boolean {
  return geo.layout.edge === "left" || geo.layout.edge === "right";
}

/**
 * How the open island differs from the top-edge layout every view was drawn
 * for: where the card sits (dx, dy) and how the island grows (dw, dh) so the
 * card keeps exactly the same size whichever edge it hangs from.
 */
export function edgeShift(): { dx: number; dy: number; dw: number; dh: number } {
  switch (geo.layout.edge) {
    case "bottom":
      return { dx: 0, dy: -HEADER_SIZE, dw: 0, dh: 0 };
    case "left":
      return { dx: HEADER_SIZE, dy: -HEADER_SIZE, dw: HEADER_SIZE, dh: -HEADER_SIZE };
    case "right":
      return { dx: 0, dy: -HEADER_SIZE, dw: HEADER_SIZE, dh: -HEADER_SIZE };
    default:
      return { dx: 0, dy: 0, dw: 0, dh: 0 };
  }
}

/** Compact pill on a side: upright. */
export const SIDE_COMPACT = { w: 32, h: 168 };

/** Current layout and user sizes; island.ts keeps these up to date. */
export const geo = {
  layout: { ...DEFAULT_LAYOUT },
  /** Width of the open island. */
  expandedW: 640,
  /** Height of the Agents hub. */
  hubH: 290,
};

// No notch on a PC: hidden/compact sizes carried over from the original Coucou spec.
export const NOTCH_W = 184;
export const NOTCH_H = 32;
export const COMPACT_W = 288; // NOTCH_W + 104
export const EXPANDED_W = 640;

export const ROUNDED_CORNER = 14; // compact
export const EXPANDED_CORNER = 22;
export const NOTCH_TAB_CORNER = 8; // subtle notch tab

/** Subtle notch tab dimensions in hidden/idle state */
export const NOTCH_TAB_W = 120;
export const NOTCH_TAB_H = 10;

/** Hover strip that wakes the island when hidden. */
export const WAKE_STRIP_W = 140;
export const WAKE_STRIP_H = 14;

export const VIEW_LAYOUTS: Record<IslandViewName, ViewLayout> = {
  overview: { height: 160, botX: 68, botY: null, botDiameter: 58, agentMode: "pills" },
  agents: { height: 290, botX: 62, botY: 92, botDiameter: 58, agentMode: "pills" },
  empty: { height: 160, botX: 70, botY: null, botDiameter: 62, agentMode: "none" },
  approval: { height: 160, botX: 62, botY: null, botDiameter: 56, agentMode: "column" },
  error: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  finished: { height: 160, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  confused: { height: 160, botX: 76, botY: null, botDiameter: 66, agentMode: "column" },
  upload: { height: 176, botX: 140, botY: 104, botDiameter: 62, agentMode: "column" },
  // botY 103 = bar top (42 + 58) + 3, so the dot really rides the bar. The Swift
  // layout says 118 while its own comment says 103; the comment matches the spec.
  uploading: { height: 176, botX: 46, botY: 103, botDiameter: 20, agentMode: "none" },
  choose: { height: 176, botX: 60, botY: 101, botDiameter: 52, agentMode: "column" },
  mail: { height: 240, botX: 56, botY: null, botDiameter: 46, agentMode: "column" },
  prompt: { height: 160, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  searching: { height: 160, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  result: { height: 160, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  note: { height: 160, botX: 60, botY: null, botDiameter: 50, agentMode: "column" },
  settings: { height: 160, botX: 54, botY: null, botDiameter: 46, agentMode: "none" },
  greeting: { height: 150, botX: 320, botY: 90, botDiameter: 0, agentMode: "none" },
};

// The upload views above are only the fallback geometry. Once a file is actually
// dropped the whole sequence — Mochi included — is drawn by src/upload, which
// owns its own constants (USC) straight from UploadSequenceEngine.swift.

/** Chat view grows with the conversation — IslandContainer.chatPromptHeight. */
export function chatPromptHeight(messageCount: number): number {
  return Math.min(300, 240 + messageCount * 40);
}

/** Height of the header strip above every expanded view's card. */
export const HEADER_BOTTOM = 42;
/** Space under the card, inside the island. */
export const CARD_BOTTOM_GAP = 14;
export const APPROVAL_MIN_H = 160;
export function approvalMaxH(): number {
  return geo.layout.panelH - 12;
}

/**
 * An approval card fits its content: a long command or a question with many
 * options gets the room it needs, up to the window. `fit` is the measured
 * height of the card's content; 0 = not measured yet.
 */
export function approvalHeight(fit: number): number {
  if (fit <= 0) return 200;
  const h = HEADER_BOTTOM + fit + CARD_BOTTOM_GAP;
  return Math.round(Math.min(approvalMaxH(), Math.max(APPROVAL_MIN_H, h)));
}

export function islandSize(
  mode: IslandMode,
  view: IslandViewName,
  chatCount = 0,
  approvalFit = 0,
): { w: number; h: number } {
  switch (mode) {
    case "hidden":
      // Subtle notch tab protruding slightly from the screen edge
      return geo.layout.vertical ? { w: NOTCH_TAB_H, h: NOTCH_TAB_W } : { w: NOTCH_TAB_W, h: NOTCH_TAB_H };
    case "compact":
      return onSide() ? { ...SIDE_COMPACT } : { w: COMPACT_W, h: NOTCH_H };
    case "expanded": {
      const h =
        view === "prompt"
          ? chatPromptHeight(chatCount)
          : view === "approval"
          ? approvalHeight(approvalFit)
          : view === "agents"
          ? geo.hubH
          : VIEW_LAYOUTS[view].height;
      const s = edgeShift();
      return { w: geo.expandedW + s.dw, h: h + s.dh };
    }
  }
}

export interface BotPlacement {
  cx: number;
  cy: number;
  diameter: number;
  opacity: number;
}

/** IslandRootView.botPosition — cy is measured from the island's top edge. */
export function botPosition(
  mode: IslandMode,
  view: IslandViewName,
  islandH: number,
  uploadProgress = 0,
): BotPlacement {
  switch (mode) {
    case "hidden":
      return { cx: 46, cy: 16, diameter: 6, opacity: 0 };
    case "compact":
      return onSide() ? { cx: 16, cy: 26, diameter: 20, opacity: 1 } : { cx: 40, cy: 16, diameter: 20, opacity: 1 };
    case "expanded": {
      const p = expandedBot(view, islandH, uploadProgress);
      const s = edgeShift();
      return { ...p, cx: p.cx + s.dx, cy: p.cy + s.dy };
    }
  }
}

function expandedBot(view: IslandViewName, islandH: number, uploadProgress: number): BotPlacement {
  const layout = VIEW_LAYOUTS[view];
  if (view === "uploading") {
    return {
      cx: 36 + uploadProgress * 526,
      cy: layout.botY ?? 103,
      diameter: layout.botDiameter,
      opacity: 1,
    };
  }
  if (layout.botY != null) {
    return { cx: layout.botX, cy: layout.botY, diameter: layout.botDiameter, opacity: 1 };
  }
  // Centre of the fixed 84 pt card (8 pt top inset + 34 pt header → content at y = 42).
  // islandH here is the top-edge height: undo the side layout's shrink.
  const headerBottom = HEADER_BOTTOM;
  const cardH = 84;
  const h = islandH - edgeShift().dh;
  const cy = headerBottom + (h - headerBottom - cardH) / 2 + cardH / 2;
  return { cx: layout.botX, cy, diameter: layout.botDiameter, opacity: 1 };
}

export function botGlowColor(s: BotStateName): string {
  switch (s) {
    case "working":
      return "#3B9EFF";
    case "thinking":
      return "#A78BFA";
    case "searching":
      return "#6366F1";
    case "approval":
      return "#F5A524";
    case "error":
      return "#F4505E";
    case "finished":
      return "#34D399";
    case "ratelimit":
      return "#F59E0B";
    default:
      return "#FFFFFF";
  }
}

export function botGlowOpacity(s: BotStateName): number {
  switch (s) {
    case "idle":
    case "sleeping":
      return 0.15;
    case "dizzy":
      return 0;
    default:
      return 0.65;
  }
}

// Project colours (IslandConst.projectColors)
const PROJECT_COLORS: Record<string, string> = {
  korus: "#FF5A4E",
  "sbe hub": "#2EC4A0",
  "morning ai brief": "#F29B38",
  "publication ig": "#7C5CFF",
  "ig post": "#7C5CFF",
  "louisraille.fr": "#38BDF8",
  louisraille: "#38BDF8",
  "notch buddy": "#EC4899",
  "notch-buddy": "#EC4899",
  notchbuddy: "#EC4899",
};

const FALLBACK_COLORS = ["#22C55E", "#EAB308", "#60A5FA", "#E879F9"];

export function colorForProject(name: string): string {
  const key = name.toLowerCase().trim();
  const exact = PROJECT_COLORS[key];
  if (exact) return exact;
  for (const [k, c] of Object.entries(PROJECT_COLORS)) {
    if (key.startsWith(k) || key.includes(k)) return c;
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

// Card wash colours (CardBackground.washColor)
export type Wash = "red" | "green" | "pink" | "amber" | "cyan" | "indigo" | "soft" | null;

export function washRGBA(wash: Wash): string {
  switch (wash) {
    case "red":
      return "rgba(244,80,94,0.55)";
    case "green":
      return "rgba(52,211,153,0.5)";
    case "pink":
      return "rgba(244,114,182,0.55)";
    case "amber":
      return "rgba(245,165,36,0.42)";
    case "cyan":
      return "rgba(34,211,238,0.38)";
    case "indigo":
      return "rgba(99,102,241,0.5)";
    case "soft":
      return "rgba(255,255,255,0.08)";
    default:
      return "rgba(0,0,0,0)";
  }
}
