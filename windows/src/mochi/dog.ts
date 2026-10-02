// Awuuu the dog — the parts that turn the squircle body into a puppy.
// Shared by the island bot (engine.ts), the launch greeting (greeting.ts) and
// the file-drop sequence (upload/canvas.ts) so all three draw the same dog.
//
// Every function draws in body-local coordinates: origin at the body centre,
// y pointing down, `rx`/`ry` the body half-width / half-height. Ears and tail
// go *before* the body fill (their roots hide behind it); muzzle and brows go
// *after*, clipped to the body.

export type RGB = readonly [number, number, number]; // components 0…1

/** Fur palette: warm cream head, caramel ears/brows/tail, white muzzle. */
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

const rgba = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

export interface EarPose {
  /** Horizontal shift of both ears (head turn), in px. */
  shift: number;
  /** 0 = relaxed, 1 = perked up (alert), -1 = drooped (sad/sleepy). */
  perk: number;
  /** Extra rotation per ear for twitches: [left, right] in radians. */
  twitch: readonly [number, number];
  /** Solid body colour (mini bots / integration pills); null = dog palette. */
  solid: RGB | null;
  alpha: number;
}

/** Two soft pointed ears rising from the top corners of the head. */
export function drawEars(x: CanvasRenderingContext2D, rx: number, ry: number, o: EarPose) {
  if (o.alpha <= 0.01) return;
  const w = rx * 0.56;
  const h = ry * (0.62 + 0.12 * Math.max(0, o.perk) - 0.1 * Math.max(0, -o.perk));
  x.save();
  x.globalAlpha *= o.alpha;
  for (const sd of [-1, 1] as const) {
    // Relaxed ears lean outwards; perked ones stand up; drooped ones flop sideways.
    const lean = 0.42 - 0.2 * Math.max(0, o.perk) + 1.05 * Math.max(0, -o.perk);
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
    if (o.solid) {
      g.addColorStop(0, rgba(o.solid));
      g.addColorStop(1, rgba(shade(o.solid, 0.78)));
    } else {
      g.addColorStop(0, rgba(DOG.caramel));
      g.addColorStop(1, rgba(DOG.caramelDark));
    }
    x.fillStyle = g;
    x.fill();
    x.strokeStyle = "rgba(0,0,0,0.10)";
    x.lineWidth = 1;
    x.stroke();

    // Inner ear.
    if (!o.solid) {
      x.beginPath();
      x.moveTo(-w * 0.26, 0);
      x.bezierCurveTo(-w * 0.28, -h * 0.4, -w * 0.1, -h * 0.72, 0, -h * 0.78);
      x.bezierCurveTo(w * 0.1, -h * 0.72, w * 0.28, -h * 0.4, w * 0.26, 0);
      x.closePath();
      x.fillStyle = DOG.earInner;
      x.fill();
    }
    x.restore();
  }
  x.restore();
}

/** A fluffy curled tail behind the right side of the body. `wag` in radians. */
export function drawTail(x: CanvasRenderingContext2D, rx: number, ry: number, wag: number, solid: RGB | null) {
  const L = ry * 0.72;
  const T = ry * 0.3;
  x.save();
  x.translate(rx * 0.78, ry * 0.3);
  x.rotate(-0.75 + wag);

  // A crescent sweeping outwards and curling up at the tip.
  x.beginPath();
  x.moveTo(-T * 0.2, -T * 0.55);
  x.bezierCurveTo(L * 0.45, -T * 1.1, L * 0.95, -T * 0.55, L, -T * 1.25);
  x.bezierCurveTo(L * 1.12, -T * 0.25, L * 0.85, T * 0.75, L * 0.45, T * 0.6);
  x.bezierCurveTo(L * 0.2, T * 0.52, 0, T * 0.6, -T * 0.2, T * 0.45);
  x.closePath();
  const g = x.createLinearGradient(0, 0, L * 1.05, -T);
  if (solid) {
    g.addColorStop(0, rgba(shade(solid, 0.85)));
    g.addColorStop(1, rgba(solid));
  } else {
    g.addColorStop(0, rgba(DOG.caramelDark));
    g.addColorStop(0.62, rgba(DOG.caramel));
    g.addColorStop(0.85, rgba(DOG.furTop));
    g.addColorStop(1, rgba(DOG.furTop));
  }
  x.fillStyle = g;
  x.fill();
  x.strokeStyle = "rgba(0,0,0,0.10)";
  x.lineWidth = 1;
  x.stroke();
  x.restore();
}

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
  /** Draw the white muzzle patch and caramel brows (full-size dog only). */
  markings: boolean;
  alpha: number;
}

/** Shiba-style "maro" eyebrow dots, one per [x, y, side] (side -1 = left). */
export function drawBrows(
  x: CanvasRenderingContext2D, R: number,
  brows: readonly (readonly [number, number, number])[], o: FacePose,
) {
  if (!o.markings || o.alpha <= 0.01) return;
  x.save();
  x.globalAlpha *= o.alpha;
  x.fillStyle = rgba(DOG.caramel, 0.9);
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
export function drawMuzzle(x: CanvasRenderingContext2D, R: number, rx: number, cy: number, o: FacePose) {
  if (o.alpha <= 0.01) return;
  const mx = o.shiftX;
  const my = cy + o.shiftY;
  x.save();
  x.globalAlpha *= o.alpha;

  if (o.markings) {
    const mg = x.createRadialGradient(mx, my - R * 0.04, R * 0.08, mx, my, R * 0.42);
    mg.addColorStop(0, DOG.muzzle);
    mg.addColorStop(0.75, DOG.muzzle);
    mg.addColorStop(1, "rgba(255,255,255,0)");
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

  x.strokeStyle = o.ink;
  x.fillStyle = o.ink;
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
  x.fillStyle = DOG.nose;
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
