// Island geometry — ported from IslandTypes.swift + IslandWindowController.islandSize
// + IslandRootView.botPosition. All values are logical pixels, identical to the
// macOS app's points.

export type IslandMode = "hidden" | "compact" | "expanded";

export type IslandViewName =
  | "overview"
  | "agents"
  | "diff"
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
  | "greeting"
  | "dashboard";

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
  /** Island centre y in window px (v = "center"): where the side pill sits. */
  anchorY: number;
  h: "center" | "left" | "right";
  /** "top": hangs down from its anchor; "bottom": grows up; "center": a side
   * edge — the pill and the open card are centred on anchorY. */
  v: "top" | "bottom" | "center";
  edge: "top" | "bottom" | "left" | "right";
  /** Hidden tab stands upright (left/right edges). */
  vertical: boolean;
  panelW: number;
  panelH: number;
}

export interface RectSize { w: number; h: number; }
export interface OrientationSpec { min: RectSize; default: RectSize; max: RectSize; }
export const ORIENTATION_GEOMETRY: Record<"landscape" | "side", OrientationSpec> = {
  landscape: { min: { w: 800, h: 320 }, default: { w: 1000, h: 360 }, max: { w: 1100, h: 440 } },
  side: { min: { w: 320, h: 480 }, default: { w: 380, h: 560 }, max: { w: 520, h: 800 } },
};
export function getOrientationBounds(edge: "top" | "bottom" | "left" | "right"): OrientationSpec {
  return (edge === "left" || edge === "right") ? ORIENTATION_GEOMETRY.side : ORIENTATION_GEOMETRY.landscape;
}
export const EXPANDED_W = 1000;

export const DEFAULT_LAYOUT: IslandLayout = {
  anchorX: 540, anchorY: 195, h: "center", v: "top", edge: "top", vertical: false, panelW: 1080, panelH: 390,
};

/** The header is a 30 px row: along the top, or along the bottom when the
 * island is docked to the bottom edge (upside down). */
export const HEADER_SIZE = 30;

/** Docked to a side: the hidden tab and the compact pill stand upright
 * against the edge. Open, the island is the same card as on the top edge. */
export function onSide(): boolean {
  return geo.layout.edge === "left" || geo.layout.edge === "right";
}

/** Docked to the bottom the header sits under the card, so everything drawn
 * for the top-edge layout moves up by the header. */
function edgeShiftY(): number {
  return geo.layout.edge === "bottom" ? -HEADER_SIZE : 0;
}

/** Compact pill on a side: upright. */
export const SIDE_COMPACT = { w: 32, h: 168 };

/** Open on a side, the card floats this far from the screen edge. */
export const SIDE_GAP = 10;

/** Current layout and user sizes; island.ts keeps these up to date. */
export const geo = {
  layout: { ...DEFAULT_LAYOUT },
  /** Width of the open island. */
  expandedW: 1000,
  /** Height of the Agents hub. */
  hubH: 360,
  /** Height of the chat; 0 = it grows with the conversation. */
  chatH: 0,
  /** Height of the agents card; 0 = defaults to hubH. */
  agentsH: 0,
  /** Width of the open island while docked to a screen side. */
  sideW: 380,
};

// No notch on a PC: hidden/compact sizes carried over from the original Coucou spec.
export const NOTCH_W = 184;
export const NOTCH_H = 32;
export const COMPACT_W = 360;

export const ROUNDED_CORNER = 14; // compact
export const EXPANDED_CORNER = 30;
export const NOTCH_TAB_CORNER = 8; // subtle notch tab

/** Subtle notch tab dimensions in hidden/idle state */
export const NOTCH_TAB_W = 140;
export const NOTCH_TAB_H = 10;

/** Hover strip that wakes the island when hidden. */
export const WAKE_STRIP_W = 140;
export const WAKE_STRIP_H = 14;

/** Default open height for the chat prompt view. */
export const CHAT_DEFAULT_H = 400;

export const VIEW_LAYOUTS: Record<IslandViewName, ViewLayout> = {
  overview: { height: 360, botX: 62, botY: 92, botDiameter: 0, agentMode: "none" },
  agents: { height: 360, botX: 62, botY: 92, botDiameter: 58, agentMode: "pills" },
  diff: { height: 360, botX: 44, botY: 62, botDiameter: 40, agentMode: "none" },
  empty: { height: 200, botX: 70, botY: null, botDiameter: 62, agentMode: "none" },
  approval: { height: 200, botX: 62, botY: null, botDiameter: 56, agentMode: "column" },
  error: { height: 200, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  finished: { height: 200, botX: 62, botY: null, botDiameter: 58, agentMode: "column" },
  confused: { height: 200, botX: 76, botY: null, botDiameter: 66, agentMode: "column" },
  upload: { height: 220, botX: 140, botY: 104, botDiameter: 62, agentMode: "column" },
  // botY 103 = bar top (42 + 58) + 3, so the dot really rides the bar. The Swift
  // layout says 118 while its own comment says 103; the comment matches the spec.
  uploading: { height: 220, botX: 46, botY: 103, botDiameter: 20, agentMode: "none" },
  choose: { height: 220, botX: 60, botY: 101, botDiameter: 52, agentMode: "column" },
  mail: { height: 260, botX: 56, botY: null, botDiameter: 46, agentMode: "column" },
  prompt: { height: CHAT_DEFAULT_H, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  searching: { height: 180, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  result: { height: 180, botX: 52, botY: null, botDiameter: 44, agentMode: "column" },
  note: { height: 360, botX: 60, botY: null, botDiameter: 50, agentMode: "column" },
  settings: { height: 200, botX: 54, botY: null, botDiameter: 46, agentMode: "none" },
  greeting: { height: 160, botX: 320, botY: 90, botDiameter: 0, agentMode: "none" },
  dashboard: { height: 360, botX: 62, botY: 92, botDiameter: 0, agentMode: "none" },
};

// The upload views above are only the fallback geometry. Once a file is actually
// dropped the whole sequence — Mochi included — is drawn by src/upload, which
// owns its own constants (USC) straight from UploadSequenceEngine.swift.

/** Chat view grows with the conversation — IslandContainer.chatPromptHeight. */
export function chatPromptHeight(messageCount: number): number {
  const spec = ORIENTATION_GEOMETRY.landscape;
  return Math.min(spec.max.h, Math.max(CHAT_DEFAULT_H, 300 + messageCount * 28));
}

/** Height of the header strip above every expanded view's card. */
export const HEADER_BOTTOM = 38;
/** Space under the card, inside the island. */
export const CARD_BOTTOM_GAP = 10;
export const APPROVAL_MIN_H = 200;
export const APPROVAL_MAX_H = 320;
export function approvalMaxH(): number {
  return Math.min(APPROVAL_MAX_H, geo.layout.panelH - 12);
}

/**
 * An approval card fits its content: a long command or a question with many
 * options gets the room it needs, up to the window. `fit` is the measured
 * height of the card's content; 0 = not measured yet.
 */
export function approvalHeight(fit: number): number {
  if (fit <= 0) return 200;
  return Math.round(Math.min(approvalMaxH(), Math.max(APPROVAL_MIN_H, HEADER_BOTTOM + fit + CARD_BOTTOM_GAP)));
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
      const safeView = view || "overview";
      const h =
        safeView === "prompt"
          ? geo.chatH > 0 ? geo.chatH : chatPromptHeight(chatCount)
          : safeView === "approval"
          ? approvalHeight(approvalFit)
          : safeView === "agents"
          ? (geo.agentsH > 0 ? geo.agentsH : geo.hubH)
          : safeView === "diff" || safeView === "overview" || safeView === "dashboard"
          ? geo.hubH
          : (VIEW_LAYOUTS[safeView]?.height ?? geo.hubH);
      if (onSide()) {
        // Docked to a side the card keeps the height its own view asks for; only
        // the width comes from the side geometry, so a view is never stretched
        // into a fixed slab.
        const spec = ORIENTATION_GEOMETRY.side;
        return { w: Math.round(Math.min(spec.max.w, Math.max(spec.min.w, geo.sideW))), h };
      }
      const w = (safeView === "agents" || safeView === "prompt") ? geo.expandedW : EXPANDED_W;
      return { w, h };
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
      return { ...p, cy: p.cy + edgeShiftY() };
    }
  }
}

function expandedBot(view: IslandViewName, islandH: number, uploadProgress: number): BotPlacement {
  const safeView = view || "overview";
  const layout = VIEW_LAYOUTS[safeView] || VIEW_LAYOUTS.overview;
  if (view === "uploading") {
    return {
      cx: 36 + uploadProgress * 526,
      cy: layout.botY ?? 103,
      diameter: layout.botDiameter,
      opacity: 1,
    };
  }
  if (layout.botY != null) {
    return { cx: layout.botX, cy: layout.botY, diameter: layout.botDiameter, opacity: layout.botDiameter > 0 ? 1 : 0 };
  }
  // Centre of the fixed 84 pt card (8 pt top inset + 34 pt header → content at y = 42).
  const headerBottom = HEADER_BOTTOM;
  const cardH = 84;
  const cy = headerBottom + (islandH - headerBottom - cardH) / 2 + cardH / 2;
  return { cx: layout.botX, cy, diameter: layout.botDiameter, opacity: layout.botDiameter > 0 ? 1 : 0 };
}

export interface AgentDotPosition {
  x: number;
  y: number;
  cx: number;
  cy: number;
  left: number;
  top: number;
  diameter: number;
}

export const AGENT_DOT_DIAMETER = 16;
export const AGENT_COLUMN_RIGHT_CLEARANCE = 42;

/**
 * Computes agent dot position in the right-hand column (Coucou SPEC.md:60).
 * Non-overview views put mini-bots in a right-hand column:
 * diameter 16, x = width - 31, y = 50 + i * 24.
 */
export function agentColumnPosition(i: number, islandW: number, _islandH = 0): AgentDotPosition {
  const diameter = AGENT_DOT_DIAMETER;
  const x = islandW - 31;
  const y = 50 + i * 24;
  return {
    x,
    y,
    cx: x,
    cy: y,
    left: x - diameter / 2,
    top: y - diameter / 2,
    diameter,
  };
}

export const agentColumnDotPosition = agentColumnPosition;

/**
 * Determines whether top-corner notch ears should be visible.
 * Visible ONLY when docked to the TOP edge, not moving, and top corners are square.
 */
export function shouldShowEars(
  edge: "top" | "bottom" | "left" | "right",
  isMoving: boolean,
  tl = 0,
  tr = 0,
): boolean {
  return edge === "top" && !isMoving && tl < 1 && tr < 1;
}

/**
 * Selects agent tasks for the right-hand column (up to 4, excluding the active/focused task).
 */
export function getColumnAgents<T extends { id: string }>(tasks: T[], activeId?: string | null): T[] {
  const list = activeId ? tasks.filter((t) => t.id !== activeId) : tasks.slice(1);
  return list.slice(0, 4);
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
