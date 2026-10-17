// Moving the island, as a liquid droplet carried by the cursor.
//
// Pressing the grip (or Alt + press on the island) and pulling turns the card
// into a round drop *where it is*: the window shrinks to a small square around
// the card's centre (Rust island_carry_begin) and from then on only moves
// (island_carry_step) — nothing is drawn on a display-sized overlay, so there is
// nothing to line up and nothing to jump. The drop follows the cursor with a
// smooth, framerate-independent liquid lag; at the work-area edge it rubber-bands
// up to a soft limit. Released, momentum carries it towards the nearest projected
// edge, settling with a gentle bounce into place where Rust docks it.
// Nothing runs between drags: the frame loop exists only while carrying.

import { Bridge, IS_TAURI } from "../core/bridge";
import { Spring } from "../core/anim";
import {
  rubberBandClamp,
  settleTargets,
  isSettleDone,
  computeCarryWindowSide,
  clampOriginToMonitor,
  computeDropInWindow,
  clampDrawnDrop,
  swellShape,
  clampCornerRadius,
  type Edge,
  type WorkArea,
  type SwellShape,
} from "./move-physics";
import type { SwellUniforms } from "./liquid";
import type { IslandLayout } from "../core/layout";

export type { Edge } from "./move-physics";

export interface MoveState {
  wasExpanded: boolean;
  view: string;
}

export interface DockedTarget {
  cx: number;
  cy: number;
  w: number;
  h: number;
  radii: [number, number, number, number];
}

export interface MoveHost {
  /** The island as drawn right now, in window coordinates. */
  rect(): { x: number; y: number; w: number; h: number };
  /** Live geometry of the island DOM body right now, for seeding morph springs without popping. */
  currentGeometry(): { w: number; h: number; radii: [number, number, number, number] };
  /** Update geo.layout to the docked layout ahead of the layout event. */
  applyDockedLayout(layout: IslandLayout): void;
  /** Draw the island centred at (x, y) with an optional transform; null = normal. */
  setMoveOverride(at: { x: number; y: number; transform: string } | null): void;
  /** Shrink to the drop and keep it from auto-hiding while it moves. */
  enterMove(): MoveState;
  leaveMove(state: MoveState): void;
  /** Activate WebGL liquid canvas behind island */
  startLiquid(): void;
  /** Step liquid canvas frame with window-relative logical coordinates */
  stepLiquid(
    cx: number,
    cy: number,
    work: [number, number, number, number],
    swell?: SwellUniforms
  ): void;
  /** Morph frame: updates both DOM card and SDF WebGL canvas in lockstep */
  applyMorph(
    cx: number,
    cy: number,
    w: number,
    h: number,
    radii: [number, number, number, number],
    work: [number, number, number, number],
    swell?: SwellUniforms
  ): void;
  /** Calculates the target docked card rect and corner radii in the current carry window */
  getDockedTarget(
    dockRect: [number, number, number, number],
    layout: IslandLayout,
    origin: { x: number; y: number },
    scale: number
  ): DockedTarget;
  /** Clear and hide liquid canvas */
  clearLiquid(): void;
}


/** Diameter of the drop, logical px. */
export const DROPLET = 120;
const DRAG_START = 3; // px of travel before a press becomes a move
const GRAB_MS = 180; // the drop slides from where it was grabbed to under the cursor
const HOLD_RESPONSE = 0.26; // response ~0.26s while held
const HOLD_DAMPING = 0.9; // damping ~0.9 (no overshoot under the cursor)
const SETTLE_RESPONSE = 0.35; // smooth settle response (~350ms)
const SETTLE_DAMPING = 0.8; // damping ~0.8 (one small overshoot on flick, no bounce on slow release)
const ORIGIN_RESPONSE = 0.42; // response 0.42s for origin spring
const ORIGIN_DAMPING = 0.86; // damping 0.86 (<1% overshoot)

export class Mover {
  private active = false;

  constructor(private host: MoveHost, private root: HTMLElement) {}

  /** Starts a move from a pointerdown on `target` (the grip or the island). */
  async begin(ev: PointerEvent, target: HTMLElement) {
    if (this.active || ev.button !== 0 || !IS_TAURI) return;
    this.active = true;
    ev.preventDefault();
    ev.stopPropagation();
    try {
      target.setPointerCapture(ev.pointerId);
    } catch {
      /* the window listeners below see it anyway */
    }

    // A press that goes nowhere is a click on the grip: the window stays as it is.
    let moved = 0;
    let letGo = false;
    let wake: (() => void) | null = null;
    const onMove = (e: PointerEvent) => {
      moved = Math.max(moved, Math.hypot(e.screenX - ev.screenX, e.screenY - ev.screenY));
      if (moved >= DRAG_START) wake?.();
    };
    const onUp = () => {
      letGo = true;
      wake?.();
    };
    const unlisten = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    if (moved < DRAG_START && !letGo) await new Promise<void>((r) => (wake = r));
    wake = null;
    unlisten();
    if (letGo) {
      this.active = false;
      return;
    }

    // The window grows in place to S x S logical px with origin unchanged.
    const r0 = this.host.rect();
    const S = computeCarryWindowSide(r0.w, r0.h, DROPLET, 32);
    const info = await Bridge.islandCarryBegin(S);
    if (!info) {
      void Bridge.log("move: could not start carrying");
      this.active = false;
      return;
    }
    const [
      scale,
      wx, wy, ww, wh,
      mx, my, mw, mh,
      ox0, oy0,
      curX0, curY0,
    ] = info;
    const work: WorkArea = { wx, wy, ww, wh };
    const monitor = { x: mx, y: my, w: mw, h: mh };
    const sPhys = Math.round(S * scale);
    const R = (DROPLET / 2) * scale;
    const limit = R * 0.6; // rubber-band limit at screen boundary
    const minX = wx + R;
    const maxX = wx + ww - R;
    const minY = wy + R;
    const maxY = wy + wh - R;

    // Initial drop centre in physical px: window origin + card centre offset
    const cx0 = ox0 + (r0.x + r0.w / 2) * scale;
    const cy0 = oy0 + (r0.y + r0.h / 2) * scale;

    const pos = { x: cx0, y: cy0 };
    const grab = { x: curX0 - cx0, y: curY0 - cy0 };
    let cursor = { x: curX0, y: curY0 };

    // Springs for framerate-independent, velocity-aware follow
    const springX = new Spring(cx0, HOLD_RESPONSE, HOLD_DAMPING);
    const springY = new Spring(cy0, HOLD_RESPONSE, HOLD_DAMPING);

    // S3: Origin springs start at clampOriginToMonitor(pos - sPhys/2) so the window is centered
    // on the card at pickup and the drawn-drop clamp never bites.
    const initOrigin = clampOriginToMonitor(pos.x - sPhys / 2, pos.y - sPhys / 2, monitor, sPhys);
    const originSpringX = new Spring(initOrigin.x, ORIGIN_RESPONSE, ORIGIN_DAMPING);
    const originSpringY = new Spring(initOrigin.y, ORIGIN_RESPONSE, ORIGIN_DAMPING);
    const origin = { x: initOrigin.x, y: initOrigin.y };
    void Bridge.islandCarryStep(origin.x, origin.y);

    this.root.classList.add("moving");
    // Call enterMove() BEFORE setMoveOverride() so the carry spring wins over collapse curve
    const saved = this.host.enterMove();
    this.host.startLiquid();
    const initialDropInWin = computeDropInWindow(pos.x, pos.y, origin.x, origin.y, scale);
    const curRx0 = Math.min(DROPLET / 2, r0.w / 2);
    const curRy0 = Math.min(DROPLET / 2, r0.h / 2);
    const initialDrawn = clampDrawnDrop(initialDropInWin.x, initialDropInWin.y, curRx0, curRy0, S);
    this.host.setMoveOverride({ x: initialDrawn.x, y: initialDrawn.y, transform: "none" });
    const initialWorkInWin: [number, number, number, number] = [
      (work.wx - origin.x) / scale,
      (work.wy - origin.y) / scale,
      work.ww / scale,
      work.wh / scale,
    ];
    this.host.stepLiquid(initialDrawn.x, initialDrawn.y, initialWorkInWin);


    let down = true;
    let release: { t0: number; edge: Edge; along: number } | null = null;
    let dockPromise: Promise<[[number, number, number, number], IslandLayout] | null> | null = null;
    let lastDrawnDrop = { x: initialDrawn.x, y: initialDrawn.y };
    let lastSwell: SwellShape | null = null;
    let absorb: {
      t0: number;
      dockRect: [number, number, number, number];
      layout: IslandLayout;
      target: DockedTarget;
      springX: Spring;
      springY: Spring;
      springW: Spring;
      springH: Spring;
      springTL: Spring;
      springTR: Spring;
      springBR: Spring;
      springBL: Spring;
      springRise: Spring;
      springK: Spring;
      baseSwell: { ex: number; ey: number; along: number; horizontal: boolean };
    } | null = null;

    let t0 = performance.now();
    let last = t0;
    let done = false;

    const finish = async (
      dock: Edge,
      along: number,
      morphTarget?: DockedTarget,
      layout?: IslandLayout
    ) => {
      done = true;
      if (layout) {
        this.host.applyDockedLayout(layout);
      }
      if (morphTarget) {
        const curWorkInWin: [number, number, number, number] = [
          (work.wx - origin.x) / scale,
          (work.wy - origin.y) / scale,
          work.ww / scale,
          work.wh / scale,
        ];
        this.host.applyMorph(
          morphTarget.cx,
          morphTarget.cy,
          morphTarget.w,
          morphTarget.h,
          morphTarget.radii,
          curWorkInWin,
          undefined
        );
      }

      // S2: Suppress dress transition for the handoff frame so fill, rim, and shadow swap instantly
      this.root.classList.add("dress-instant");
      this.root.classList.remove("liquid-active");
      this.host.clearLiquid();
      requestAnimationFrame(() => {
        this.root.classList.remove("dress-instant");
      });

      // Fade card content in over 140 ms
      this.root.classList.remove("moving");
      await new Promise((r) => setTimeout(r, 140));

      // B1: Do NOT clear moveOverride before islandOverlayEnd.
      // setLayout (invoked by Rust's layout event) clears moveAt when the new layout commits.
      await Bridge.islandOverlayEnd(dock, along);
      this.host.setMoveOverride(null);
      this.host.leaveMove(saved);
      this.active = false;
    };

    const frame = async (now: number) => {
      if (done) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Stage 4: Absorb phase (morph from droplet into docked card rect)
      if (absorb) {
        // B1: Align the carry origin with the docked origin during absorb
        originSpringX.target = absorb.dockRect[0];
        originSpringY.target = absorb.dockRect[1];
        originSpringX.step(dt);
        originSpringY.step(dt);
        origin.x = originSpringX.value;
        origin.y = originSpringY.value;
        void Bridge.islandCarryStep(origin.x, origin.y);

        // Update target relative to the moving carry window origin
        absorb.target = this.host.getDockedTarget(absorb.dockRect, absorb.layout, origin, scale);
        absorb.springX.target = absorb.target.cx;
        absorb.springY.target = absorb.target.cy;

        absorb.springX.step(dt);
        absorb.springY.step(dt);
        absorb.springW.step(dt);
        absorb.springH.step(dt);
        absorb.springTL.step(dt);
        absorb.springTR.step(dt);
        absorb.springBR.step(dt);
        absorb.springBL.step(dt);
        absorb.springRise.step(dt);
        absorb.springK.step(dt);

        const curW = absorb.springW.value;
        const curH = absorb.springH.value;
        const curTL = clampCornerRadius(absorb.springTL.value, curW, curH);
        const curTR = clampCornerRadius(absorb.springTR.value, curW, curH);
        const curBR = clampCornerRadius(absorb.springBR.value, curW, curH);
        const curBL = clampCornerRadius(absorb.springBL.value, curW, curH);
        const curRadii: [number, number, number, number] = [curTL, curTR, curBR, curBL];

        const curRise = Math.max(0, absorb.springRise.value);
        const curK = Math.max(0, absorb.springK.value);
        const morphSwell: SwellUniforms | undefined =
          curRise > 0.05 && curK > 0.05
            ? {
                ex: absorb.baseSwell.ex,
                ey: absorb.baseSwell.ey,
                along: absorb.baseSwell.along,
                rise: curRise,
                k: curK,
                horizontal: absorb.baseSwell.horizontal,
              }
            : undefined;

        const workInWin: [number, number, number, number] = [
          (work.wx - origin.x) / scale,
          (work.wy - origin.y) / scale,
          work.ww / scale,
          work.wh / scale,
        ];

        this.host.applyMorph(
          absorb.springX.value,
          absorb.springY.value,
          curW,
          curH,
          curRadii,
          workInWin,
          morphSwell
        );

        const morphDuration = now - absorb.t0;
        const morphConverged =
          morphDuration >= 400 ||
          (Math.abs(absorb.springW.value - absorb.target.w) < 0.5 &&
            Math.abs(absorb.springH.value - absorb.target.h) < 0.5 &&
            Math.abs(absorb.springX.value - absorb.target.cx) < 0.5 &&
            Math.abs(absorb.springY.value - absorb.target.cy) < 0.5 &&
            curRise < 0.5 &&
            Math.abs(absorb.springW.velocity) < 4 &&
            Math.abs(absorb.springH.velocity) < 4);

        if (morphConverged) {
          // B1: Snap carry origin to the exact docked origin before handoff
          origin.x = absorb.dockRect[0];
          origin.y = absorb.dockRect[1];
          await Bridge.islandCarryStep(absorb.dockRect[0], absorb.dockRect[1]);
          const finalTarget = this.host.getDockedTarget(absorb.dockRect, absorb.layout, origin, scale);
          await finish(release!.edge, release!.along, finalTarget, absorb.layout);
          return;
        }

        requestAnimationFrame(frame);
        return;
      }

      if (!release) {
        const held = Math.pow(1 - Math.min(1, (now - t0) / GRAB_MS), 3);
        const targetCursorX = cursor.x - grab.x * held;
        const targetCursorY = cursor.y - grab.y * held;

        // Rubber-band at the work-area edge instead of hard clamping
        const targetX = rubberBandClamp(targetCursorX, minX, maxX, limit);
        const targetY = rubberBandClamp(targetCursorY, minY, maxY, limit);

        springX.target = targetX;
        springY.target = targetY;
        springX.step(dt);
        springY.step(dt);
        pos.x = springX.value;
        pos.y = springY.value;
      } else {
        // Settling: the drop springs towards the resting edge with damping ~0.8
        springX.step(dt);
        springY.step(dt);
        pos.x = springX.value;
        pos.y = springY.value;

        const settleDuration = now - release.t0;
        if (isSettleDone(springX, springY, settleDuration)) {
          // Transition into Stage 4 Absorb:
          const dockInfo = dockPromise ? await dockPromise : null;
          if (!dockInfo) {
            done = true;
            await finish(release.edge, release.along);
            return;
          }

          const [dockRect, layout] = dockInfo;
          // Align originSpring target to the docked window origin
          originSpringX.target = dockRect[0];
          originSpringY.target = dockRect[1];

          const target = this.host.getDockedTarget(dockRect, layout, origin, scale);

          // S1: Seed width, height, and radii from the host's CURRENT DOM values,
          // avoiding shape pop on a quick press-nudge-release
          const curGeo = this.host.currentGeometry();

          const MORPH_RESPONSE = 0.42;
          const MORPH_DAMPING = 0.86;

          const sX = new Spring(lastDrawnDrop.x, MORPH_RESPONSE, MORPH_DAMPING);
          sX.target = target.cx;
          const sY = new Spring(lastDrawnDrop.y, MORPH_RESPONSE, MORPH_DAMPING);
          sY.target = target.cy;
          const sW = new Spring(curGeo.w, MORPH_RESPONSE, MORPH_DAMPING);
          sW.target = target.w;
          const sH = new Spring(curGeo.h, MORPH_RESPONSE, MORPH_DAMPING);
          sH.target = target.h;
          const sTL = new Spring(curGeo.radii[0], MORPH_RESPONSE, MORPH_DAMPING);
          sTL.target = target.radii[0];
          const sTR = new Spring(curGeo.radii[1], MORPH_RESPONSE, MORPH_DAMPING);
          sTR.target = target.radii[1];
          const sBR = new Spring(curGeo.radii[2], MORPH_RESPONSE, MORPH_DAMPING);
          sBR.target = target.radii[2];
          const sBL = new Spring(curGeo.radii[3], MORPH_RESPONSE, MORPH_DAMPING);
          sBL.target = target.radii[3];

          const sRise = new Spring(lastSwell ? lastSwell.rise : 0, MORPH_RESPONSE, MORPH_DAMPING);
          sRise.target = 0;
          const sK = new Spring(lastSwell ? lastSwell.k : 0, MORPH_RESPONSE, MORPH_DAMPING);
          sK.target = 0;

          absorb = {
            t0: now,
            dockRect,
            layout,
            target,
            springX: sX,
            springY: sY,
            springW: sW,
            springH: sH,
            springTL: sTL,
            springTR: sTR,
            springBR: sBR,
            springBL: sBL,
            springRise: sRise,
            springK: sK,
            baseSwell: {
              ex: lastSwell ? lastSwell.ex : lastDrawnDrop.x,
              ey: lastSwell ? lastSwell.ey : lastDrawnDrop.y,
              along: lastSwell ? lastSwell.along : 0,
              horizontal: lastSwell ? lastSwell.horizontal : true,
            },
          };

          requestAnimationFrame(frame);
          return;
        }
      }

      // Per-frame origin springs toward clampToMonitor(pos - s/2)
      const originTarget = clampOriginToMonitor(pos.x - sPhys / 2, pos.y - sPhys / 2, monitor, sPhys);
      originSpringX.target = originTarget.x;
      originSpringY.target = originTarget.y;
      originSpringX.step(dt);
      originSpringY.step(dt);
      origin.x = originSpringX.value;
      origin.y = originSpringY.value;

      // Drop in window coordinates (logical px)
      const dropInWin = computeDropInWindow(pos.x, pos.y, origin.x, origin.y, scale);

      // Fast flick origin lag clamping: bounds drawn center into [rx, S - rx] and [ry, S - ry]
      // to keep rim and shadow within buffer without clipping or biting at pickup.
      const curGeo = this.host.currentGeometry();
      const curRx = Math.min(DROPLET / 2, curGeo.w / 2);
      const curRy = Math.min(DROPLET / 2, curGeo.h / 2);
      const drawnDrop = clampDrawnDrop(dropInWin.x, dropInWin.y, curRx, curRy, S);
      lastDrawnDrop = drawnDrop;
      this.host.setMoveOverride({ x: drawnDrop.x, y: drawnDrop.y, transform: "none" });

      const workInWin: [number, number, number, number] = [
        (work.wx - origin.x) / scale,
        (work.wy - origin.y) / scale,
        work.ww / scale,
        work.wh / scale,
      ];

      const vxLog = springX.velocity / scale;
      const vyLog = springY.velocity / scale;
      const held = release ? 0 : 1;
      const rLog = DROPLET / 2;
      const swell = swellShape(drawnDrop.x, drawnDrop.y, rLog, vxLog, vyLog, held, workInWin);
      lastSwell = swell;

      this.host.stepLiquid(
        drawnDrop.x,
        drawnDrop.y,
        workInWin,
        swell.along > 0 && swell.rise > 0 ? swell : undefined
      );

      const answer = await Bridge.islandCarryStep(origin.x, origin.y);
      if (done) return;
      if (!answer) {
        done = true;
        const fallback = settleTargets(pos, { x: 0, y: 0 }, work, R);
        await finish(fallback.edge, fallback.along);
        return;
      }

      cursor = { x: answer[0], y: answer[1] };
      if (answer[2] === 0) down = false;

      if (!down && !release) {
        // Release with momentum:
        // Hand the drop's live velocity to the settle
        const vel = { x: springX.velocity, y: springY.velocity };
        const settle = settleTargets(pos, vel, work, R);

        // Configure springs for settle: damping ~0.8
        springX.configure(SETTLE_RESPONSE, SETTLE_DAMPING);
        springY.configure(SETTLE_RESPONSE, SETTLE_DAMPING);
        springX.target = settle.targetX;
        springY.target = settle.targetY;

        release = {
          t0: performance.now(),
          edge: settle.edge,
          along: settle.along,
        };

        // Prefetch docked rect from Rust without applying:
        // By the time the settle animation finishes (~200-400ms), dockPromise is already resolved!
        dockPromise = Bridge.islandDockRect(settle.edge, settle.along);
      }

      requestAnimationFrame(frame);
    };


    // The loop reads the real button state itself; pointer events are not needed.
    t0 = last = performance.now();
    requestAnimationFrame(frame);
  }
}

