// Awuuu the dog — the parts that turn the squircle body into a puppy.
// Shared by the island bot (engine.ts), the launch greeting (greeting.ts) and
// the file-drop sequence (upload/canvas.ts) so all three draw the same dog.
//
// Every function draws in body-local coordinates: origin at the body centre,
// y pointing down, `rx`/`ry` the body half-width / half-height. Tail and
// upright ears go *before* the body fill (their roots hide behind it); coat
// markings, muzzle and brows go *after*, clipped to the body; floppy ears and
// the collar tag go last, over it.
//
// Nothing here reads a DogLook directly: paletteFor() turns a look into the
// colours and switches the drawing needs, once, and caches it.

import { CLASSIC, type DogLook } from "./looks";

export type RGB = readonly [number, number, number]; // components 0…1

/** Fur palette of the classic look: warm cream head, caramel ears/brows/tail, white muzzle. */
export const DOG = {
  furTop: [1.0, 0.973, 0.933] as RGB, // #FFF8EE
  furBottom: [0.925, 0.851, 0.761] as RGB, // #ECD9C2
  caramel: [0.894, 0.659, 0.443] as RGB, // #E4A871
  caramelDark: [0.784, 0.518, 0.29] as RGB, // #C8844A
  earInner: "rgba(255,176,190,0.85)",
  muzzle: "rgba(255,255,255,0.96)",
  nose: "#231A17",
  tongue: "#FF7A93",
  tongueLine: "rgba(196,52,84,0.55)",
};

// ── Palette ───────────────────────────────────────────────────────────────────

type C3 = readonly [number, number, number]; // components 0…255

const hex3 = (hex: string): C3 => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const css = (c: C3, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const mix = (a: C3, b: C3, t: number): C3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lum = (c: C3) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const WHITE: C3 = [255, 255, 255];

/**
 * Fur in shadow. Warm colours darken towards brown (the classic cream → sand,
 * caramel → chestnut); cool ones keep their hue.
 */
function shade(c: C3, deep: boolean): C3 {
  if (c[0] >= c[1] && c[1] >= c[2]) {
    return deep ? [c[0] * 0.877, c[1] * 0.786, c[2] * 0.655] : [c[0] * 0.925, c[1] * 0.875, c[2] * 0.816];
  }
  const k = deep ? 0.78 : 0.875;
  return [c[0] * k, c[1] * k, c[2] * k];
}

const INK_LIGHT = "rgb(255,244,230)";

export interface Palette {
  look: DogLook;
  bodyTop: string;
  bodyBottom: string;
  pawTop: string;
  pawBottom: string;
  /** Ear gradient, root → tip. */
  earRoot: string;
  earTip: string;
  earInner: string;
  /** Tail gradient: base, middle, tip. */
  tailBase: string;
  tailMid: string;
  tailTip: string;
  /** Eyebrow dots (null = this pattern has none). */
  brow: string | null;
  muzzle: string;
  muzzleFade: string;
  /** Muzzle patch contrasts enough to be worth drawing at compact sizes. */
  muzzleSmall: boolean;
  nose: string;
  /** Eye ink when the fur under the eyes is too dark for the usual one. */
  eyeInk: string | null;
  /** Mouth ink, same idea, for the muzzle. */
  mouthInk: string | null;
  iris: string | null;
  /** Thin light outline for coats that would melt into the black island. */
  rim: string | null;
  /** Markings (paintCoat). */
  patch: string;
  accent: string;
  /** Pale cheeks and chest of a red Shiba, 0 for a coat that is already pale. */
  urajiro: number;
  urajiroColor: string;
  /** Saddle: the points are lighter than the coat, so cheeks and chest get them too. */
  points: boolean;
  chest: string;
  cap: string;
  capFade: string;
  collar: string;
  collarEdge: string;
  /** Something has to be painted over the body fill (markings or a collar). */
  hasCoat: boolean;
}

const palettes = new WeakMap<DogLook, Palette>();

/** Everything the drawing needs from a look, derived once per look object. */
export function paletteFor(look: DogLook): Palette {
  const hit = palettes.get(look);
  if (hit) return hit;

  const c = hex3(look.coat);
  const p = hex3(look.patch);
  const a = hex3(look.accent);
  const pat = look.pattern;
  const earsInPatch = pat === "shiba" || pat === "solid" || pat === "spots";
  const ear = earsInPatch ? p : shade(c, false);
  const cDeep = shade(c, true);

  const muzzle: C3 = pat === "shiba" ? WHITE
    : pat === "mask" || pat === "saddle" || pat === "tricolor" ? p
      : mix(c, WHITE, pat === "spots" ? 0.7 : 0.55);
  const muzzleA = pat === "shiba" ? 0.96 : 1;
  const underEyes = pat === "mask" ? p : c;
  const paw = pat === "mask" || pat === "saddle" || pat === "tricolor" ? p : pat === "solid" ? mix(c, WHITE, 0.4) : c;
  const tail: readonly [C3, C3, C3] =
    pat === "shiba" ? [shade(p, true), p, c]
      : pat === "solid" ? [p, c, mix(c, WHITE, 0.45)]
        : pat === "saddle" ? [cDeep, c, mix(c, WHITE, 0.12)]
          : pat === "spots" ? [shade(c, false), c, p]
            : [cDeep, c, p];
  const dark = lum(c) < 0.3;
  const urajiro = pat === "shiba" ? Math.max(0, Math.min(1, (0.86 - lum(c)) * 5)) : 0;

  const pal: Palette = {
    look,
    bodyTop: css(c),
    bodyBottom: css(shade(c, false)),
    pawTop: css(paw),
    pawBottom: css(shade(paw, false)),
    earRoot: css(ear),
    earTip: css(shade(ear, true)),
    earInner: css(pat === "tricolor" ? mix(p, [255, 176, 190], 0.45) : a, 0.85),
    tailBase: css(tail[0]),
    tailMid: css(tail[1]),
    tailTip: css(tail[2]),
    brow: pat === "shiba" ? css(p, 0.9) : pat === "saddle" ? css(p) : pat === "tricolor" ? css(a) : null,
    muzzle: css(muzzle, muzzleA),
    muzzleFade: css(muzzle, 0),
    muzzleSmall: Math.abs(lum(muzzle) - lum(c)) > 0.12,
    nose: lum(muzzle) < 0.3 ? "#0D0A09" : DOG.nose,
    eyeInk: lum(underEyes) < 0.3 ? INK_LIGHT : null,
    mouthInk: lum(muzzle) < 0.3 ? INK_LIGHT : null,
    iris: look.eyeColor ? css(hex3(look.eyeColor)) : null,
    rim: dark ? "rgba(255,255,255,0.2)" : null,
    patch: css(p),
    accent: css(a),
    urajiro,
    urajiroColor: css(mix(c, [255, 250, 242], 0.86)),
    points: lum(p) > lum(c),
    chest: css(mix(c, WHITE, 0.5), 0.85),
    cap: css(p, 0.5),
    capFade: css(p, 0),
    collar: css(hex3(look.collarColor)),
    collarEdge: css(shade(hex3(look.collarColor), true)),
    hasCoat: look.collar !== "none" || pat !== "shiba" || urajiro > 0,
  };
  palettes.set(look, pal);
  return pal;
}

let owner = paletteFor(CLASSIC);

/** The owner's own dog — what the greeting and the file-drop sequence draw. */
export function setOwnerLook(look: DogLook) {
  owner = paletteFor(look);
}

export const ownerPalette = () => owner;

// ── Ears ──────────────────────────────────────────────────────────────────────

export interface EarPose {
  /** Horizontal shift of both ears (head turn), in px. */
  shift: number;
  /** 0 = relaxed, 1 = perked up (alert), -1 = drooped (sad/sleepy). */
  perk: number;
  /** Extra rotation per ear for twitches: [left, right] in radians. */
  twitch: readonly [number, number];
  alpha: number;
}

const EDGE = "rgba(0,0,0,0.10)";

/** Upright ears (pointed or round) rising from the top corners of the head. */
export function drawEars(x: CanvasRenderingContext2D, rx: number, ry: number, o: EarPose, pal: Palette = owner) {
  if (o.alpha <= 0.01 || pal.look.ears === "floppy") return;
  const up = Math.max(0, o.perk);
  const down = Math.max(0, -o.perk);
  x.save();
  x.globalAlpha *= o.alpha;
  x.strokeStyle = pal.rim ?? EDGE;
  x.lineWidth = 1;

  if (pal.look.ears === "round") {
    const r = rx * 0.3 * (1 + 0.06 * up);
    for (const sd of [-1, 1] as const) {
      x.save();
      // Twitches swing the ear around a point inside the head.
      x.translate(sd * rx * 0.4 + o.shift, -ry * 0.3);
      x.rotate(o.twitch[sd < 0 ? 0 : 1] + sd * 0.5 * down);
      x.translate(sd * rx * 0.25, -ry * (0.46 + 0.06 * up));
      x.beginPath();
      x.arc(0, 0, r, 0, Math.PI * 2);
      const g = x.createLinearGradient(0, r, 0, -r);
      g.addColorStop(0, pal.earRoot);
      g.addColorStop(1, pal.earTip);
      x.fillStyle = g;
      x.fill();
      x.stroke();
      x.beginPath();
      x.arc(0, r * 0.1, r * 0.56, 0, Math.PI * 2);
      x.fillStyle = pal.earInner;
      x.fill();
      x.restore();
    }
    x.restore();
    return;
  }

  const w = rx * 0.56;
  const h = ry * (0.62 + 0.12 * up - 0.1 * down);
  for (const sd of [-1, 1] as const) {
    // Relaxed ears lean outwards; perked ones stand up; drooped ones flop sideways.
    const lean = 0.42 - 0.2 * up + 1.05 * down;
    const ang = sd * lean + o.twitch[sd < 0 ? 0 : 1];
    x.save();
    x.translate(sd * rx * 0.56 + o.shift, -ry * 0.7);
    x.rotate(ang);

    // Outer ear.
    x.beginPath();
    x.moveTo(-w / 2, h * 0.12);
    x.bezierCurveTo(-w * 0.52, -h * 0.45, -w * 0.18, -h * 0.9, 0, -h);
    x.bezierCurveTo(w * 0.18, -h * 0.9, w * 0.52, -h * 0.45, w / 2, h * 0.12);
    x.closePath();
    const g = x.createLinearGradient(0, 0, 0, -h);
    g.addColorStop(0, pal.earRoot);
    g.addColorStop(1, pal.earTip);
    x.fillStyle = g;
    x.fill();
    x.stroke();

    // Inner ear.
    x.beginPath();
    x.moveTo(-w * 0.26, 0);
    x.bezierCurveTo(-w * 0.28, -h * 0.4, -w * 0.1, -h * 0.72, 0, -h * 0.78);
    x.bezierCurveTo(w * 0.1, -h * 0.72, w * 0.28, -h * 0.4, w * 0.26, 0);
    x.closePath();
    x.fillStyle = pal.earInner;
    x.fill();
    x.restore();
  }
  x.restore();
}

/**
 * Floppy ears hang over the sides of the head, so they are drawn after the
 * body and the face. No-op for the other ear shapes.
 */
export function drawEarsFront(x: CanvasRenderingContext2D, rx: number, ry: number, o: EarPose, pal: Palette = owner) {
  if (o.alpha <= 0.01 || pal.look.ears !== "floppy") return;
  const up = Math.max(0, o.perk);
  const down = Math.max(0, -o.perk);
  const w = rx * 0.5;
  const h = ry * (1.08 - 0.12 * up + 0.14 * down);
  x.save();
  x.globalAlpha *= o.alpha;
  x.strokeStyle = pal.rim ?? EDGE;
  x.lineWidth = 1;
  for (const sd of [-1, 1] as const) {
    x.save();
    x.translate(sd * rx * 0.56 + o.shift, -ry * 0.84);
    // Perked: the ear lifts away from the head; twitches flap it.
    x.rotate(-sd * (0.1 + 0.42 * up) + o.twitch[sd < 0 ? 0 : 1]);
    x.scale(sd, 1);
    x.beginPath();
    x.moveTo(-w * 0.3, h * 0.03);
    x.bezierCurveTo(w * 0.1, -h * 0.14, w * 0.78, -h * 0.06, w * 0.9, h * 0.34);
    x.bezierCurveTo(w * 1.0, h * 0.7, w * 0.76, h * 1.0, w * 0.46, h);
    x.bezierCurveTo(w * 0.14, h, w * 0.12, h * 0.5, -w * 0.3, h * 0.03);
    x.closePath();
    const g = x.createLinearGradient(0, 0, w * 0.4, h);
    g.addColorStop(0, pal.earRoot);
    g.addColorStop(1, pal.earTip);
    x.fillStyle = g;
    x.fill();
    x.stroke();
    x.restore();
  }
  x.restore();
}

// ── Tail ──────────────────────────────────────────────────────────────────────

/** The tail behind the right side of the body. `wag` in radians. */
export function drawTail(x: CanvasRenderingContext2D, rx: number, ry: number, wag: number, pal: Palette = owner) {
  const shape = pal.look.tail;
  const L = ry * (shape === "fluffy" ? 0.84 : shape === "straight" ? 0.8 : 0.72);
  const T = ry * (shape === "fluffy" ? 0.46 : shape === "straight" ? 0.2 : 0.3);
  x.save();
  x.translate(rx * 0.78, ry * 0.3);
  x.rotate((shape === "straight" ? -0.95 : -0.75) + wag);

  x.beginPath();
  if (shape === "fluffy") {
    // A plume: smooth on top, feathered underneath.
    x.moveTo(-T * 0.15, -T * 0.4);
    x.bezierCurveTo(L * 0.3, -T * 1.25, L * 0.85, -T * 1.25, L * 1.04, -T * 0.8);
    x.quadraticCurveTo(L * 1.22, -T * 0.6, L * 1.0, -T * 0.3);
    x.quadraticCurveTo(L * 1.13, T * 0.04, L * 0.84, T * 0.16);
    x.quadraticCurveTo(L * 0.9, T * 0.5, L * 0.58, T * 0.46);
    x.quadraticCurveTo(L * 0.56, T * 0.76, L * 0.27, T * 0.58);
    x.quadraticCurveTo(L * 0.1, T * 0.6, -T * 0.15, T * 0.4);
  } else if (shape === "straight") {
    // A whip tail, tapering to a rounded tip.
    x.moveTo(-T * 0.3, -T * 0.8);
    x.bezierCurveTo(L * 0.4, -T * 0.95, L * 0.9, -T * 0.7, L * 1.05, -T * 0.42);
    x.bezierCurveTo(L * 1.2, -T * 0.2, L * 1.2, T * 0.3, L * 1.04, T * 0.34);
    x.bezierCurveTo(L * 0.7, T * 0.55, L * 0.3, T * 0.8, -T * 0.3, T * 0.8);
  } else {
    // A crescent sweeping outwards and curling up at the tip.
    x.moveTo(-T * 0.2, -T * 0.55);
    x.bezierCurveTo(L * 0.45, -T * 1.1, L * 0.95, -T * 0.55, L, -T * 1.25);
    x.bezierCurveTo(L * 1.12, -T * 0.25, L * 0.85, T * 0.75, L * 0.45, T * 0.6);
    x.bezierCurveTo(L * 0.2, T * 0.52, 0, T * 0.6, -T * 0.2, T * 0.45);
  }
  x.closePath();
  const g = x.createLinearGradient(0, 0, L * 1.05, -T);
  g.addColorStop(0, pal.tailBase);
  g.addColorStop(0.62, pal.tailMid);
  g.addColorStop(0.85, pal.tailTip);
  g.addColorStop(1, pal.tailTip);
  x.fillStyle = g;
  x.fill();
  x.strokeStyle = pal.rim ?? EDGE;
  x.lineWidth = 1;
  x.stroke();
  x.restore();
}

// ── Coat markings ─────────────────────────────────────────────────────────────

export interface CoatPose {
  /** Where the face centre sits (head turn / nod), in px from the body centre. */
  faceX: number;
  faceY: number;
  /** Horizontal foreshortening of the face (cos yaw), 0…1. */
  squash: number;
  /** 0 when the dog faces away (roll) — face-bound markings fade with it. */
  faceAlpha: number;
  alpha: number;
  /** Compact sizes: only the big two-tone areas, no small details. */
  small: boolean;
}

/** Dalmatian spots: [x, y, radius, turn] in body half-widths / half-heights, biggest first. */
const SPOTS: readonly (readonly [number, number, number, number])[] = [
  [-0.7, -0.5, 0.17, 0.4], [0.66, 0.52, 0.16, -0.5], [0.78, -0.28, 0.13, 0.9], [-0.84, 0.3, 0.12, -0.2],
  [0.16, -0.76, 0.11, 0.2], [-0.4, 0.8, 0.1, 1.1], [-0.12, -0.42, 0.065, 0], [0.9, 0.16, 0.06, 0.6],
  [-0.56, 0.02, 0.055, -0.8], [0.42, 0.86, 0.07, 0.3],
];

function blob(x: CanvasRenderingContext2D, cx: number, cy: number, a: number, b: number, turn: number) {
  x.beginPath();
  x.ellipse(cx, cy, a, b, turn, 0, Math.PI * 2);
  x.fill();
}

/**
 * Markings painted over the body fill: mask, tan points, spots, blaze, pale
 * chest, then the collar. The caller has clipped to the body.
 */
export function paintCoat(x: CanvasRenderingContext2D, rx: number, ry: number, o: CoatPose, pal: Palette = owner) {
  if (!pal.hasCoat || o.alpha <= 0.01) return;
  const pat = pal.look.pattern;
  const fa = o.alpha * o.faceAlpha;
  x.save();
  x.globalAlpha *= o.alpha;

  // Body-bound parts barely follow the head.
  const bx = o.faceX * 0.35;
  if (pat === "spots") {
    x.fillStyle = pal.patch;
    const n = o.small ? 5 : SPOTS.length;
    for (let i = 0; i < n; i++) {
      const s = SPOTS[i];
      blob(x, s[0] * rx + bx, s[1] * ry, s[2] * rx * 1.15, s[2] * rx * 0.9, s[3]);
    }
  } else if (pat === "solid") {
    // Darker crown, paler chest: one colour, but not flat.
    const g = x.createRadialGradient(bx, -ry * 1.15, 0, bx, -ry * 1.15, ry * 1.35);
    g.addColorStop(0, pal.cap);
    g.addColorStop(1, pal.capFade);
    x.fillStyle = g;
    x.fillRect(-rx, -ry, rx * 2, ry * 1.4);
    x.fillStyle = pal.chest;
    blob(x, bx, ry * 1.02, rx * 0.5, ry * 0.34, 0);
  }

  // Face-bound parts turn and nod with the head.
  if (fa > 0.01 && pat !== "spots" && pat !== "solid") {
    x.save();
    x.globalAlpha *= o.faceAlpha;
    x.translate(o.faceX, o.faceY);
    x.scale(Math.max(0.35, o.squash), 1);
    if (pat === "shiba") {
      x.globalAlpha *= pal.urajiro;
      x.fillStyle = pal.urajiroColor;
      blob(x, -rx * 0.56, ry * 0.5, rx * 0.44, ry * 0.42, 0);
      blob(x, rx * 0.56, ry * 0.5, rx * 0.44, ry * 0.42, 0);
      blob(x, 0, ry * 0.98, rx * 0.62, ry * 0.4, 0);
    } else if (pat === "mask") {
      // The cap comes down in a point between the eyes; the mask rises over each.
      x.fillStyle = pal.patch;
      x.beginPath();
      x.moveTo(-rx * 2.4, ry * 0.2);
      x.bezierCurveTo(-rx * 1.15, ry * 0.16, -rx * 0.84, -ry * 0.4, -rx * 0.4, -ry * 0.38);
      x.bezierCurveTo(-rx * 0.15, -ry * 0.36, -rx * 0.1, -ry * 0.02, 0, ry * 0.1);
      x.bezierCurveTo(rx * 0.1, -ry * 0.02, rx * 0.15, -ry * 0.36, rx * 0.4, -ry * 0.38);
      x.bezierCurveTo(rx * 0.84, -ry * 0.4, rx * 1.15, ry * 0.16, rx * 2.4, ry * 0.2);
      x.lineTo(rx * 2.4, ry * 2);
      x.lineTo(-rx * 2.4, ry * 2);
      x.closePath();
      x.fill();
    } else if (pat === "saddle") {
      // Tan points: cheeks and chest (brows and muzzle come with the face).
      // Dark points on a pale coat (a pug) stop at the muzzle.
      if (pal.points) {
        x.fillStyle = pal.patch;
        blob(x, -rx * 0.68, ry * 0.5, rx * 0.15, ry * 0.17, -0.3);
        blob(x, rx * 0.68, ry * 0.5, rx * 0.15, ry * 0.17, 0.3);
        blob(x, 0, ry * 1.14, rx * 0.42, ry * 0.26, 0);
      }
    } else {
      // Tricolor: tan cheeks under a white blaze that widens into muzzle and chest.
      if (!o.small) {
        x.fillStyle = pal.accent;
        blob(x, -rx * 0.62, ry * 0.4, rx * 0.2, ry * 0.19, -0.2);
        blob(x, rx * 0.62, ry * 0.4, rx * 0.2, ry * 0.19, 0.2);
      }
      x.fillStyle = pal.patch;
      x.beginPath();
      x.moveTo(-rx * 0.07, -ry * 1.3);
      x.bezierCurveTo(-rx * 0.1, -ry * 0.4, -rx * 0.14, -ry * 0.05, -rx * 0.4, ry * 0.36);
      x.bezierCurveTo(-rx * 0.56, ry * 0.62, -rx * 0.66, ry * 0.9, -rx * 0.62, ry * 1.4);
      x.lineTo(rx * 0.62, ry * 1.4);
      x.bezierCurveTo(rx * 0.66, ry * 0.9, rx * 0.56, ry * 0.62, rx * 0.4, ry * 0.36);
      x.bezierCurveTo(rx * 0.14, -ry * 0.05, rx * 0.1, -ry * 0.4, rx * 0.07, -ry * 1.3);
      x.closePath();
      x.fill();
    }
    x.restore();
  }

  if (pal.look.collar === "collar") {
    // A band hugging the bottom of the body.
    x.strokeStyle = pal.collarEdge;
    x.lineWidth = ry * 0.26;
    x.beginPath();
    x.moveTo(-rx * 1.1, ry * 0.7);
    x.quadraticCurveTo(0, ry * 1.12, rx * 1.1, ry * 0.7);
    x.stroke();
    x.strokeStyle = pal.collar;
    x.lineWidth = ry * 0.18;
    x.stroke();
  } else if (pal.look.collar === "bandana") {
    x.fillStyle = pal.collar;
    x.beginPath();
    x.moveTo(-rx * 1.15, ry * 0.5);
    x.quadraticCurveTo(0, ry * 0.86, rx * 1.15, ry * 0.5);
    x.lineTo(0, ry * 1.6);
    x.closePath();
    x.fill();
  }
  x.restore();
}

/** The part of the collar that hangs below the body: a tag, or the bandana's tip. */
export function drawCollarTag(x: CanvasRenderingContext2D, rx: number, ry: number, alpha: number, pal: Palette = owner) {
  const kind = pal.look.collar;
  if (kind === "none" || alpha <= 0.01) return;
  x.save();
  x.globalAlpha *= alpha;
  if (kind === "collar") {
    x.fillStyle = "#F7C948";
    x.strokeStyle = "rgba(0,0,0,0.25)";
    x.lineWidth = 1;
    x.beginPath();
    x.arc(0, ry * 0.99, Math.max(1.6, ry * 0.12), 0, Math.PI * 2);
    x.fill();
    x.stroke();
  } else {
    x.fillStyle = pal.collar;
    x.strokeStyle = pal.collar;
    x.lineJoin = "round";
    x.lineWidth = Math.max(1, ry * 0.06);
    x.beginPath();
    x.moveTo(-rx * 0.3, ry * 0.96);
    x.lineTo(rx * 0.3, ry * 0.96);
    x.lineTo(0, ry * 1.24);
    x.closePath();
    x.fill();
    x.stroke();
    // Fold line where the scarf leaves the neck.
    x.strokeStyle = pal.collarEdge;
    x.lineWidth = Math.max(0.8, ry * 0.035);
    x.beginPath();
    x.moveTo(-rx * 0.22, ry * 1.0);
    x.lineTo(0, ry * 1.16);
    x.lineTo(rx * 0.22, ry * 1.0);
    x.stroke();
  }
  x.restore();
}

// ── Face ──────────────────────────────────────────────────────────────────────

export type DogMouth = "smile" | "howl" | "flat" | "none";

export interface FacePose {
  /** Face offset from the head turn / nod, in px. */
  shiftX: number;
  shiftY: number;
  /** Horizontal foreshortening while the head turns (cos yaw), 0…1. */
  squash: number;
  mouth: DogMouth;
  /** 0…1 — how far the tongue hangs out. */
  tongue: number;
  /** Ink for nose and mouth. */
  ink: string;
  /** Draw the muzzle patch and the brows. */
  markings: boolean;
  alpha: number;
}

/** "Maro" eyebrow dots, one per [x, y, side] (side -1 = left). */
export function drawBrows(
  x: CanvasRenderingContext2D, R: number,
  brows: readonly (readonly [number, number, number])[], o: FacePose, pal: Palette = owner,
) {
  if (!o.markings || !pal.brow || o.alpha <= 0.01) return;
  x.save();
  x.globalAlpha *= o.alpha;
  x.fillStyle = pal.brow;
  for (const [bx, by, sd] of brows) {
    x.beginPath();
    x.ellipse(bx, by, R * 0.075 * o.squash + R * 0.01, R * 0.05, sd * 0.12, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
}

/**
 * Muzzle patch, nose, mouth and tongue. `cy` is the muzzle centre (px below
 * the body centre); everything scales with R.
 */
export function drawMuzzle(
  x: CanvasRenderingContext2D, R: number, rx: number, cy: number, o: FacePose, pal: Palette = owner,
) {
  if (o.alpha <= 0.01) return;
  const mx = o.shiftX;
  const my = cy + o.shiftY;
  x.save();
  x.globalAlpha *= o.alpha;

  if (o.markings) {
    const mg = x.createRadialGradient(mx, my - R * 0.04, R * 0.08, mx, my, R * 0.42);
    mg.addColorStop(0, pal.muzzle);
    mg.addColorStop(0.75, pal.muzzle);
    mg.addColorStop(1, pal.muzzleFade);
    x.fillStyle = mg;
    x.beginPath();
    x.ellipse(mx, my, rx * 0.4 * o.squash + R * 0.04, R * 0.3, 0, 0, Math.PI * 2);
    x.fill();
  }

  const noseW = R * 0.2 * o.squash + R * 0.02;
  const noseH = R * 0.13;
  const ny = my - R * 0.1;
  const mouthY = ny + noseH * 0.95;
  const mw = R * 0.1;
  const ink = pal.mouthInk ?? o.ink;

  // Tongue first so the mouth line sits over its root.
  if (o.tongue > 0.01 && o.mouth !== "howl") {
    const tw = R * 0.17;
    const th = R * 0.27 * o.tongue;
    x.save();
    x.translate(mx, mouthY + R * 0.01);
    x.beginPath();
    x.moveTo(-tw / 2, 0);
    x.lineTo(-tw / 2, th - tw / 2);
    x.arc(0, th - tw / 2, tw / 2, Math.PI, 0, true);
    x.lineTo(tw / 2, 0);
    x.closePath();
    x.fillStyle = DOG.tongue;
    x.fill();
    if (th > R * 0.08) {
      x.strokeStyle = DOG.tongueLine;
      x.lineWidth = Math.max(0.8, R * 0.018);
      x.lineCap = "round";
      x.beginPath();
      x.moveTo(0, R * 0.02);
      x.lineTo(0, th * 0.6);
      x.stroke();
    }
    x.restore();
  }

  x.strokeStyle = ink;
  x.fillStyle = ink;
  x.lineWidth = Math.max(1.1, R * 0.04);
  x.lineCap = "round";
  x.lineJoin = "round";

  switch (o.mouth) {
    case "smile":
      // The classic dog "w": a short philtrum and two little arcs.
      x.beginPath();
      x.moveTo(mx, ny + noseH * 0.35);
      x.lineTo(mx, mouthY - R * 0.01);
      x.stroke();
      for (const sd of [-1, 1]) {
        x.beginPath();
        x.arc(mx + sd * mw * 0.5, mouthY - mw * 0.35, mw * 0.5, 0.05 * Math.PI, 0.95 * Math.PI);
        x.stroke();
      }
      break;
    case "flat":
      x.beginPath();
      x.moveTo(mx - mw * 0.7, mouthY + R * 0.02);
      x.lineTo(mx + mw * 0.7, mouthY + R * 0.02);
      x.stroke();
      break;
    case "howl": {
      // "Awuuu!" — a little round O.
      x.beginPath();
      x.ellipse(mx, mouthY + R * 0.05, R * 0.06, R * 0.085, 0, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = DOG.tongue;
      x.beginPath();
      x.ellipse(mx, mouthY + R * 0.1, R * 0.035, R * 0.025, 0, 0, Math.PI * 2);
      x.fill();
      break;
    }
    case "none":
      break;
  }

  // Nose: rounded inverted triangle with a glossy highlight.
  x.fillStyle = pal.nose;
  x.beginPath();
  x.moveTo(mx - noseW / 2, ny - noseH * 0.3);
  x.bezierCurveTo(mx - noseW / 2, ny - noseH * 0.62, mx + noseW / 2, ny - noseH * 0.62, mx + noseW / 2, ny - noseH * 0.3);
  x.bezierCurveTo(mx + noseW / 2, ny + noseH * 0.05, mx + noseW * 0.14, ny + noseH * 0.42, mx, ny + noseH * 0.42);
  x.bezierCurveTo(mx - noseW * 0.14, ny + noseH * 0.42, mx - noseW / 2, ny + noseH * 0.05, mx - noseW / 2, ny - noseH * 0.3);
  x.closePath();
  x.fill();
  x.fillStyle = "rgba(255,255,255,0.65)";
  x.beginPath();
  x.ellipse(mx - noseW * 0.18, ny - noseH * 0.25, noseW * 0.16, noseH * 0.12, -0.3, 0, Math.PI * 2);
  x.fill();

  x.restore();
}

/** Smooth, natural-looking ear twitch: one quick flick every few seconds. */
export function earTwitch(t: number, seed: number): number {
  const period = 3.7 + seed * 1.3;
  const ph = (t + seed * 2.1) % period;
  return ph < 0.32 ? Math.sin((ph / 0.32) * Math.PI * 2) * 0.16 * (1 - ph / 0.32) : 0;
}
