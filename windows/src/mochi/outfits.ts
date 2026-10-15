// Outfits for Awuuu: small accessories drawn with Canvas 2D primitives on top
// of the dog, in the same body-local space as dog.ts (origin at the body
// centre, y down, rx / ry the body half-width / half-height).
//
// `outfit` in the settings is "auto" (seasonOutfit picks), "none" or an id.
// Drawing is called from the dog's own draw path, so a hidden dog costs nothing.

export type OutfitId = "party" | "witch" | "santa" | "bowtie" | "sunglasses" | "flowers" | "scarf" | "halo";
export type OutfitSelection = "auto" | "none" | OutfitId;

export interface Outfit {
  id: OutfitId;
  name: string;
}

export const OUTFITS: readonly Outfit[] = [
  { id: "party", name: "Party hat" },
  { id: "witch", name: "Witch hat" },
  { id: "santa", name: "Santa hat" },
  { id: "bowtie", name: "Bow tie" },
  { id: "sunglasses", name: "Sunglasses" },
  { id: "flowers", name: "Flower crown" },
  { id: "scarf", name: "Scarf" },
  { id: "halo", name: "Halo" },
];

const IDS = new Set<string>(OUTFITS.map((o) => o.id));

/** Anything stored in the settings, turned into a valid selection. */
export function normalizeOutfit(v: unknown): OutfitSelection {
  if (v === "none") return "none";
  return typeof v === "string" && IDS.has(v) ? (v as OutfitId) : "auto";
}

/**
 * The outfit "auto" wears on a date. Pure: October a witch hat, December a
 * Santa hat, January and February a scarf, spring a flower crown, summer
 * sunglasses, everything else nothing.
 */
export function seasonOutfit(date: Date): OutfitId | "none" {
  const m = date.getMonth(); // 0 = January
  if (m === 9) return "witch";
  if (m === 11) return "santa";
  if (m <= 1) return "scarf";
  if (m >= 2 && m <= 4) return "flowers";
  if (m >= 5 && m <= 7) return "sunglasses";
  return "none";
}

/** The concrete outfit of a selection ("none" when bare). */
export function resolveOutfit(sel: OutfitSelection, date: Date = new Date()): OutfitId | "none" {
  return sel === "auto" ? seasonOutfit(date) : sel;
}

// The selection every dog in this window wears (set from the settings).
let current: OutfitSelection = "auto";
let resolvedDay = -1;
let resolved: OutfitId | "none" = "none";

export function setOutfitSelection(sel: unknown) {
  current = normalizeOutfit(sel);
  resolvedDay = -1;
}

/** Cheap enough to call every frame: "auto" is re-resolved once a day. */
export function currentOutfit(): OutfitId | "none" {
  if (current !== "auto") return current;
  const now = new Date();
  const day = now.getFullYear() * 400 + now.getMonth() * 32 + now.getDate();
  if (day !== resolvedDay) {
    resolvedDay = day;
    resolved = seasonOutfit(now);
  }
  return resolved;
}

// ── Drawing ───────────────────────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D;

export interface OutfitPose {
  /** Horizontal head turn in px (the ear shift): hats follow it a little. */
  shift: number;
  alpha?: number;
}

const INK = "rgba(40,30,28,0.9)";

function tri(x: Ctx, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  x.beginPath();
  x.moveTo(ax, ay);
  x.lineTo(bx, by);
  x.lineTo(cx, cy);
  x.closePath();
}

function ball(x: Ctx, cx: number, cy: number, r: number, fill: string) {
  x.fillStyle = fill;
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.fill();
}

/** Draw an outfit over the dog. Does nothing for "none" and very small dogs. */
export function drawOutfit(x: Ctx, rx: number, ry: number, id: OutfitId | "none", pose: OutfitPose) {
  if (id === "none" || ry < 8) return;
  const a = pose.alpha ?? 1;
  if (a <= 0.01) return;
  const small = ry < 16;
  const s = pose.shift;
  x.save();
  x.globalAlpha *= a;
  x.lineJoin = "round";
  x.lineCap = "round";
  x.lineWidth = Math.max(0.8, ry * 0.04);
  x.strokeStyle = "rgba(0,0,0,0.22)";

  switch (id) {
    case "party": {
      const cx = s * 1.2 + rx * 0.1, by = -ry * 0.86, w = rx * 0.34, h = ry * 0.8;
      x.save();
      x.translate(cx, by);
      x.rotate(0.18);
      x.fillStyle = "#FF6FA5";
      tri(x, -w, 0, w, 0, 0, -h);
      x.fill();
      x.stroke();
      if (!small) {
        x.fillStyle = "#FFD84D";
        for (const [px, py] of [[-0.35, -0.25], [0.3, -0.42], [-0.05, -0.62]]) ball(x, px * w * 2, py * h, ry * 0.045, "#FFD84D");
      }
      ball(x, 0, -h, ry * 0.09, "#6EC8FF");
      x.restore();
      break;
    }
    case "witch": {
      const cx = s * 1.2, by = -ry * 0.82, w = rx * 0.42;
      x.fillStyle = "#3A2A57";
      x.beginPath();
      x.ellipse(cx, by, rx * 0.66, ry * 0.12, -0.05, 0, Math.PI * 2);
      x.fill();
      x.stroke();
      x.beginPath();
      x.moveTo(cx - w, by);
      x.quadraticCurveTo(cx - w * 0.4, by - ry * 0.55, cx + w * 0.55, by - ry * 0.95);
      x.quadraticCurveTo(cx + w * 0.25, by - ry * 0.45, cx + w, by);
      x.closePath();
      x.fill();
      x.stroke();
      x.fillStyle = "#F59E0B";
      x.fillRect(cx - w * 0.95, by - ry * 0.16, w * 1.9, ry * 0.1);
      break;
    }
    case "santa": {
      const cx = s * 1.2, by = -ry * 0.78, w = rx * 0.5;
      x.fillStyle = "#E5322D";
      x.beginPath();
      x.moveTo(cx - w, by);
      x.quadraticCurveTo(cx - w * 0.6, by - ry * 0.7, cx + w * 0.7, by - ry * 0.62);
      x.quadraticCurveTo(cx + w * 0.95, by - ry * 0.3, cx + w, by);
      x.closePath();
      x.fill();
      x.stroke();
      ball(x, cx + w * 0.72, by - ry * 0.6, ry * 0.1, "#FFFFFF");
      x.fillStyle = "#FFFFFF";
      x.beginPath();
      x.ellipse(cx, by, w * 1.05, ry * 0.11, 0, 0, Math.PI * 2);
      x.fill();
      x.stroke();
      break;
    }
    case "sunglasses": {
      const ex = rx * 0.37, ey = ry * 0.12 - ry * 0.01, w = rx * 0.3, h = ry * 0.2;
      const o = s * 2.4;
      x.fillStyle = INK;
      for (const sd of [-1, 1]) {
        x.beginPath();
        x.roundRect(sd * ex + o - w / 2, ey - h / 2, w, h, [h * 0.2, h * 0.2, h * 0.6, h * 0.6]);
        x.fill();
      }
      x.strokeStyle = INK;
      x.lineWidth = Math.max(1, ry * 0.05);
      x.beginPath();
      x.moveTo(-ex + o + w / 2, ey - h * 0.2);
      x.lineTo(ex + o - w / 2, ey - h * 0.2);
      x.stroke();
      if (!small) {
        x.strokeStyle = "rgba(255,255,255,0.45)";
        x.lineWidth = Math.max(0.8, ry * 0.025);
        for (const sd of [-1, 1]) {
          x.beginPath();
          x.moveTo(sd * ex + o - w * 0.3, ey - h * 0.25);
          x.lineTo(sd * ex + o - w * 0.05, ey - h * 0.25);
          x.stroke();
        }
      }
      break;
    }
    case "bowtie": {
      const cy = ry * 0.97, w = rx * 0.2, h = ry * 0.12;
      x.fillStyle = "#3B82F6";
      for (const sd of [-1, 1]) {
        tri(x, 0, cy, sd * w * 2, cy - h * 1.2, sd * w * 2, cy + h * 1.2);
        x.fill();
        x.stroke();
      }
      ball(x, 0, cy, h * 0.9, "#2563EB");
      break;
    }
    case "flowers": {
      const n = small ? 5 : 7;
      const cols = ["#FF8FB1", "#FFD84D", "#FFFFFF", "#B79CFF"];
      for (let i = 0; i < n; i++) {
        const t = -0.82 + (1.64 * i) / (n - 1); // angle across the crown, radians from the top
        const px = Math.sin(t) * rx * 0.86 + s * 1.2;
        const py = -Math.cos(t) * ry * 0.9;
        ball(x, px, py, ry * 0.11, cols[i % cols.length]);
        ball(x, px, py, ry * 0.04, "#F59E0B");
      }
      break;
    }
    case "scarf": {
      x.strokeStyle = "#D6453D";
      x.lineWidth = Math.max(2, ry * 0.2);
      x.beginPath();
      x.ellipse(0, ry * 0.9, rx * 0.62, ry * 0.12, 0, 0.1, Math.PI - 0.1);
      x.stroke();
      x.fillStyle = "#D6453D";
      x.beginPath();
      x.roundRect(rx * 0.26, ry * 0.92, rx * 0.2, ry * 0.4, ry * 0.05);
      x.fill();
      x.fillStyle = "#F4F1EA";
      x.fillRect(rx * 0.26, ry * 1.14, rx * 0.2, ry * 0.07);
      break;
    }
    case "halo": {
      x.strokeStyle = "#FFD84D";
      x.lineWidth = Math.max(1.4, ry * 0.07);
      x.beginPath();
      x.ellipse(s * 1.2, -ry * 1.08, rx * 0.3, ry * 0.09, 0, 0, Math.PI * 2);
      x.stroke();
      break;
    }
  }
  x.restore();
}
