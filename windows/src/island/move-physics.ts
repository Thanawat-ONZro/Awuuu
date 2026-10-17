import { Spring } from "../core/anim";

export type Edge = "top" | "bottom" | "left" | "right";

export interface WorkArea {
  wx: number;
  wy: number;
  ww: number;
  wh: number;
}

export interface SettleTargets {
  edge: Edge;
  targetX: number;
  targetY: number;
  along: number;
}

export interface SwellShape {
  ex: number;
  ey: number;
  along: number;
  rise: number;
  k: number;
  horizontal: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (t: number) => t * t * (3 - 2 * t);


/**
 * Resistance curve for overshooting a work-area edge:
 * over = limit * (1 - exp(-rawOver / limit / 0.3))
 * Asymptotic to `limit` and strictly monotonic.
 */
export function rubberBandOffset(rawOver: number, limit: number): number {
  if (rawOver <= 0 || limit <= 0) return 0;
  return limit * (1 - Math.exp(-rawOver / (limit * 0.3)));
}

/**
 * Clamps `val` to `[min, max]` with rubber-band overshoot up to `limit`.
 */
export function rubberBandClamp(val: number, min: number, max: number, limit: number): number {
  if (val < min) {
    return min - rubberBandOffset(min - val, limit);
  }
  if (val > max) {
    return max + rubberBandOffset(val - max, limit);
  }
  return val;
}

/**
 * Distances from point (x, y) to each of the work area's 4 edges.
 */
export function edgeDistances(x: number, y: number, work: WorkArea): { edge: Edge; d: number }[] {
  return [
    { edge: "top", d: y - work.wy },
    { edge: "bottom", d: work.wy + work.wh - y },
    { edge: "left", d: x - work.wx },
    { edge: "right", d: work.wx + work.ww - x },
  ];
}

/**
 * Edge nearest to point (x, y).
 */
export function pickNearestEdge(x: number, y: number, work: WorkArea): Edge {
  const edges = edgeDistances(x, y, work);
  return edges.reduce((a, b) => (b.d < a.d ? b : a)).edge;
}

/**
 * Calculates effective horizon seconds capped to avoid throwing across the display:
 * max displacement = 0.3 * min(ww, wh).
 */
export function cappedHorizon(vx: number, vy: number, work: WorkArea, maxHorizonSec = 0.12): number {
  const speed = Math.hypot(vx, vy);
  if (speed <= 0) return maxHorizonSec;
  const maxDist = 0.3 * Math.min(work.ww, work.wh);
  return Math.min(maxHorizonSec, maxDist / speed);
}

/**
 * Picks the edge nearest the projected resting position:
 * projects current velocity forward by at most `projectSec` (default ~0.12s),
 * capped to 0.3 * min(ww, wh).
 */
export function pickProjectedEdge(
  x: number,
  y: number,
  vx: number,
  vy: number,
  work: WorkArea,
  projectSec = 0.12
): Edge {
  const dt = cappedHorizon(vx, vy, work, projectSec);
  const projX = x + vx * dt;
  const projY = y + vy * dt;
  return pickNearestEdge(projX, projY, work);
}

/**
 * Calculates settled targets (targetX, targetY, along) on the release edge.
 * Enforces the displacement cap (~0.3 * min(ww, wh)) and work area clamping.
 */
export function settleTargets(
  pos: { x: number; y: number },
  vel: { x: number; y: number },
  work: WorkArea,
  radius: number,
  edge?: Edge,
  horizonSec = 0.12
): SettleTargets {
  const dt = cappedHorizon(vel.x, vel.y, work, horizonSec);
  const chosenEdge = edge ?? pickProjectedEdge(pos.x, pos.y, vel.x, vel.y, work, dt);

  const minX = work.wx + radius;
  const maxX = work.wx + work.ww - radius;
  const minY = work.wy + radius;
  const maxY = work.wy + work.wh - radius;

  let targetX: number;
  let targetY: number;

  if (chosenEdge === "top") {
    targetX = clamp(pos.x + vel.x * dt, minX, maxX);
    targetY = work.wy + radius;
  } else if (chosenEdge === "bottom") {
    targetX = clamp(pos.x + vel.x * dt, minX, maxX);
    targetY = work.wy + work.wh - radius;
  } else if (chosenEdge === "left") {
    targetX = work.wx + radius;
    targetY = clamp(pos.y + vel.y * dt, minY, maxY);
  } else {
    targetX = work.wx + work.ww - radius;
    targetY = clamp(pos.y + vel.y * dt, minY, maxY);
  }

  const along =
    chosenEdge === "top" || chosenEdge === "bottom"
      ? (targetX - work.wx) / work.ww
      : (targetY - work.wy) / work.wh;

  return {
    edge: chosenEdge,
    targetX,
    targetY,
    along: clamp(along, 0, 1),
  };
}

/**
 * Settle ends when visual motion stops:
 * |target - value| < 0.5 px and |velocity| < 4 px/s.
 */
export function isSettleResting(spring: Spring): boolean {
  return Math.abs(spring.target - spring.value) < 0.5 && Math.abs(spring.velocity) < 4;
}

/**
 * End condition for island settle: resting visually or reached 400ms cap.
 */
export function isSettleDone(springX: Spring, springY: Spring, elapsedMs: number): boolean {
  return (isSettleResting(springX) && isSettleResting(springY)) || elapsedMs >= 400;
}

/**
 * Computes the carry window logical side S:
 * S = max(4 * DROPLET, ceil(max(cardW, cardH)) + 2 * SHADOW_PAD).
 */
export function computeCarryWindowSide(
  cardW: number,
  cardH: number,
  droplet = 120,
  shadowPad = 32
): number {
  return Math.max(4 * droplet, Math.ceil(Math.max(cardW, cardH)) + 2 * shadowPad);
}

/**
 * Clamps corner radius r to [0, min(w, h) / 2] to prevent the browser's radius-overlap rule
 * from rescaling corner radii and distorting the outline.
 */
export function clampCornerRadius(r: number, w: number, h: number): number {
  const maxR = Math.min(w, h) / 2;
  return Math.max(0, Math.min(r, maxR));
}

/**
 * Clamps all four corner radii [tl, tr, br, bl] to [0, min(w, h) / 2].
 */
export function clampRadii(
  radii: [number, number, number, number],
  w: number,
  h: number
): [number, number, number, number] {
  return [
    clampCornerRadius(radii[0], w, h),
    clampCornerRadius(radii[1], w, h),
    clampCornerRadius(radii[2], w, h),
    clampCornerRadius(radii[3], w, h),
  ];
}

/**
 * Clamps the window origin (ox, oy) so the window stays strictly within its monitor's physical bounds.
 */
export function clampOriginToMonitor(
  targetOx: number,
  targetOy: number,
  monitor: { x: number; y: number; w: number; h: number },
  windowPhysSide: number
): { x: number; y: number } {
  const minX = monitor.x;
  const maxX = Math.max(monitor.x, monitor.x + monitor.w - windowPhysSide);
  const minY = monitor.y;
  const maxY = Math.max(monitor.y, monitor.y + monitor.h - windowPhysSide);
  return {
    x: Math.max(minX, Math.min(maxX, targetOx)),
    y: Math.max(minY, Math.min(maxY, targetOy)),
  };
}

/**
 * Computes the drop's centre inside the window in logical pixels:
 * (pos - origin) / scale.
 */
export function computeDropInWindow(
  posX: number,
  posY: number,
  originX: number,
  originY: number,
  scale: number
): { x: number; y: number } {
  return {
    x: (posX - originX) / scale,
    y: (posY - originY) / scale,
  };
}

/**
 * Derives the drop's physical centre from the window origin and physical side:
 * (origin + side / 2).
 */
export function computeDropCentreFromOrigin(
  originX: number,
  originY: number,
  windowPhysSide: number
): { x: number; y: number } {
  return {
    x: originX + windowPhysSide / 2,
    y: originY + windowPhysSide / 2,
  };
}

/**
 * Maps DOM/CSS corner radii [tl, tr, br, bl] to Inigo Quilez sdRoundBox uniform vec4(r.x, r.y, r.z, r.w).
 *
 * In standard IQ sdRoundBox:
 *   r.xy = (p.x > 0.0) ? r.xy : r.zw;
 *   r.x  = (p.y > 0.0) ? r.x  : r.y;
 * In our screen-space shader, p.y is measured downwards from top (y-down):
 *   p.y > 0 is the BOTTOM half of the card
 *   p.y <= 0 is the TOP half of the card
 * Therefore:
 *   When p.x > 0 and p.y > 0 (bottom-right): picks r.x -> must be br (radii[2])
 *   When p.x > 0 and p.y <= 0 (top-right):   picks r.y -> must be tr (radii[1])
 *   When p.x <= 0 and p.y > 0 (bottom-left): picks r.z -> must be bl (radii[3])
 *   When p.x <= 0 and p.y <= 0 (top-left):   picks r.w -> must be tl (radii[0])
 *
 * Resulting mapping: [br, tr, bl, tl] = [radii[2], radii[1], radii[3], radii[0]].
 */
export function radiiToShader(
  radii: [number, number, number, number]
): [number, number, number, number] {
  return [radii[2], radii[1], radii[3], radii[0]];
}

/**
 * Clamps the drawn droplet centre into logical px bounds inside the carry window.
 * At fast flick velocities (~3000 px/s), origin lag ~0.115s (~345 px) can push the drop against the window boundary;
 * clamping drawn center prevents the droplet from clipping against the window edge while keeping physics unclamped.
 * Supports per-axis radii (rx, ry) so the clamp does not bite at pickup for rectangular cards (e.g. h=36, y=18).
 */
export function clampDrawnDrop(
  cx: number,
  cy: number,
  rx: number,
  ryOrSide: number,
  sideLog?: number
): { x: number; y: number } {
  const ry = sideLog !== undefined ? ryOrSide : rx;
  const side = sideLog !== undefined ? sideLog : ryOrSide;
  return {
    x: clamp(cx, rx, side - rx),
    y: clamp(cy, ry, side - ry),
  };
}

export interface DockedTargetMath {
  cx: number;
  cy: number;
  w: number;
  h: number;
  radii: [number, number, number, number];
}

/**
 * Computes the exact docked target geometry in window-relative logical px,
 * given the docked physical window rect, the target layout, card dimensions/radii,
 * carry window origin, and display scale.
 */
export function computeDockedTarget(
  dockRect: [number, number, number, number],
  layout: { edge: string; anchorX: number; anchorY: number; panelW: number; panelH: number },
  cardSize: { w: number; h: number },
  radii: [number, number, number, number],
  origin: { x: number; y: number },
  scale: number,
  sideGap: number = 0
): DockedTargetMath {
  const { w, h } = cardSize;
  const edge = layout.edge;
  const isSide = edge === "left" || edge === "right";

  let cardX: number;
  let cardY: number;
  if (isSide) {
    cardX = edge === "left" ? sideGap : layout.panelW - w - sideGap;
    cardY = Math.min(Math.max(layout.anchorY - h / 2, 0), Math.max(0, layout.panelH - h));
  } else {
    cardX = Math.min(Math.max(layout.anchorX - w / 2, 0), Math.max(0, layout.panelW - w));
    cardY = edge === "bottom" ? layout.panelH - h : 0;
  }

  const physCardX = dockRect[0] + cardX * scale;
  const physCardY = dockRect[1] + cardY * scale;
  const physCardW = w * scale;
  const physCardH = h * scale;

  const cx = (physCardX + physCardW / 2 - origin.x) / scale;
  const cy = (physCardY + physCardH / 2 - origin.y) / scale;

  return { cx, cy, w, h, radii };
}

/**
 * Calculates the liquid swell shape on the nearest screen edge in window-relative logical px.
 * - Keeps today's formulas: reach = smooth(1 - gap/(2.2R)), along = R(0.9 + 0.8*reach), rise = 0.5R*reach*approachDrop,
 *   the wake lag, and the 1.35 widen cap.
 * - Monotonic neck: k is continuous from wake (0 at wake, 0.8R at contact).
 *   k = reach * (4 + (0.8 * r - 4) * join) where join = smooth(clamp(1 - gap/(0.9R), 0, 1)).
 *   k is non-decreasing as gap -> 0 and k(0) = 0.8R.
 * - Swell stays off (along=0, rise=0, k=0) when gap >= 2.2R.
 */
export function swellShape(
  dropX: number,
  dropY: number,
  r: number,
  vx: number,
  vy: number,
  held: number,
  work: [number, number, number, number] | WorkArea
): SwellShape {
  const [wx, wy, ww, wh] = Array.isArray(work) ? work : [work.wx, work.wy, work.ww, work.wh];

  const speed = Math.hypot(vx, vy);
  const maxDist = 0.3 * Math.min(ww, wh);
  const dtProj = speed > 0 ? Math.min(0.12, maxDist / speed) : 0.12;
  const pxProj = held === 0 ? dropX + vx * dtProj : dropX;
  const pyProj = held === 0 ? dropY + vy * dtProj : dropY;

  const cand = [
    { e: "top" as const, d: dropY - wy, pd: pyProj - wy, px: dropX, py: wy, vAlong: vx, vToward: -vy },
    { e: "bottom" as const, d: wy + wh - dropY, pd: wy + wh - pyProj, px: dropX, py: wy + wh, vAlong: vx, vToward: vy },
    { e: "left" as const, d: dropX - wx, pd: pxProj - wx, px: wx, py: dropY, vAlong: vy, vToward: -vx },
    { e: "right" as const, d: wx + ww - dropX, pd: wx + ww - pxProj, px: wx + ww, py: dropY, vAlong: vy, vToward: vx },
  ];
  const n = cand.reduce((a, b) => (b.pd < a.pd ? b : a));
  const horizontal = n.e === "top" || n.e === "bottom";

  const gap = n.d - r;
  if (gap >= 2.2 * r) {
    return {
      ex: n.px,
      ey: n.py,
      along: 0,
      rise: 0,
      k: 0,
      horizontal,
    };
  }

  const reach = smooth(clamp(1 - gap / (r * 2.2), 0, 1));
  const join = smooth(clamp(1 - gap / (r * 0.9), 0, 1));

  // Motion wake: swell trails/leans opposite to drop velocity along edge
  const wakeLag = clamp(-n.vAlong * 0.035, -r * 0.5, r * 0.5);
  const wakeStretch = clamp(Math.abs(n.vAlong) / 1200, 0, 0.35);

  // Approach: swell widens while height drops
  const approach = clamp(n.vToward / 800, 0, 1);
  const approachWiden = 1 + 0.3 * approach;
  const approachDrop = 1 - 0.22 * approach;

  const baseAlong = r * (0.9 + 0.8 * reach);
  const widen = Math.min(1.35, (1 + wakeStretch) * approachWiden);
  const along = baseAlong * widen;
  const rise = 0.5 * r * reach * approachDrop;

  // Neck strength: k is continuous from wake (0 at wake, 0.8R at contact)
  const k = reach > 0 ? reach * (4 + (0.8 * r - 4) * join) : 0;

  const ex = horizontal ? n.px + wakeLag : n.px;
  const ey = horizontal ? n.py : n.py + wakeLag;

  return {
    ex,
    ey,
    along,
    rise,
    k,
    horizontal,
  };
}


