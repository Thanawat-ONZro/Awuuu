// Moving the island, as a drop of water carried by the cursor.
//
// Pressing the grip (or Alt + press on the island) and pulling turns the card
// into a round drop *where it is*: the window shrinks to a small square around
// the card's centre (Rust island_carry_begin) and from then on only moves
// (island_carry_step) — nothing is drawn on a display-sized overlay, so there is
// nothing to line up and nothing to jump. The drop follows the cursor with a
// little lag; close to a screen edge it flattens against it, the more the
// closer it gets. Released, it settles on the nearest edge and Rust docks it.
// Nothing runs between drags: the frame loop exists only while carrying.

import { Bridge, IS_TAURI } from "../core/bridge";

export type Edge = "top" | "bottom" | "left" | "right";

export interface MoveState {
  wasExpanded: boolean;
  view: string;
}

export interface MoveHost {
  /** The island as drawn right now, in window coordinates. */
  rect(): { x: number; y: number; w: number; h: number };
  /** Draw the island centred at (x, y) with an optional transform; null = normal. */
  setMoveOverride(at: { x: number; y: number; transform: string } | null): void;
  /** Shrink to the drop and keep it from auto-hiding while it moves. */
  enterMove(): MoveState;
  leaveMove(state: MoveState): void;
}

/** Diameter of the drop, logical px. */
export const DROPLET = 120;
/** The window while carrying: room for the drop and its shadow. */
const WINDOW = Math.round(DROPLET * 1.5);
const DRAG_START = 3; // px of travel before a press becomes a move
const GRAB_MS = 180; // the drop slides from where it was grabbed to under the cursor
const SETTLE_MS = 200; // …and from where it is let go to the edge

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

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

    // The window becomes a small square around the card's centre.
    const r0 = this.host.rect();
    const info = await Bridge.islandCarryBegin(r0.x + r0.w / 2, r0.y + r0.h / 2, WINDOW, DROPLET);
    if (!info) {
      void Bridge.log("move: could not start carrying");
      this.active = false;
      return;
    }
    const [scale, wx, wy, ww, wh, cx0, cy0, curX0, curY0] = info;
    const R = (DROPLET / 2) * scale;
    const pos = { x: cx0, y: cy0 };
    const grab = { x: curX0 - cx0, y: curY0 - cy0 };
    let cursor = { x: curX0, y: curY0 };

    this.root.classList.add("moving");
    // The card stays what it is, centred in the new window; it rounds into the drop.
    this.host.setMoveOverride({ x: WINDOW / 2, y: WINDOW / 2, transform: "none" });
    const saved = this.host.enterMove();

    // Distances to the work area's edges for a centre at (x, y).
    const edges = (x: number, y: number) => [
      { edge: "top" as Edge, d: y - wy },
      { edge: "bottom" as Edge, d: wy + wh - y },
      { edge: "left" as Edge, d: x - wx },
      { edge: "right" as Edge, d: wx + ww - x },
    ];
    const nearest = (x: number, y: number) => edges(x, y).reduce((a, b) => (b.d < a.d ? b : a));

    let down = true;
    let release: { t0: number; from: { x: number; y: number }; edge: Edge; along: number } | null = null;
    let t0 = performance.now();
    let last = t0;
    let done = false;

    const frame = async (now: number) => {
      if (done) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      let edge: Edge;
      if (!release) {
        const held = Math.pow(1 - Math.min(1, (now - t0) / GRAB_MS), 3);
        const ax = cursor.x - grab.x * held;
        const ay = cursor.y - grab.y * held;
        // A little lag is what makes it feel liquid.
        const f = Math.min(1, dt * 18);
        pos.x = clamp(pos.x + (ax - pos.x) * f, wx, wx + ww);
        pos.y = clamp(pos.y + (ay - pos.y) * f, wy, wy + wh);
        // Near an edge the water draws the drop in, gently: it stays round,
        // it just leans toward the edge the closer it is.
        const n = nearest(pos.x, pos.y);
        edge = n.edge;
        const k = smooth(clamp(1 - (n.d - R) / (R * 1.4), 0, 1));
        const pull = Math.max(0, n.d - R * 1.05) * k * 0.45;
        if (edge === "top") pos.y -= pull;
        else if (edge === "bottom") pos.y += pull;
        else if (edge === "left") pos.x -= pull;
        else pos.x += pull;
      } else {
        // Settling: the drop rests on the edge, where the island docks.
        edge = release.edge;
        const t = Math.min(1, (now - release.t0) / SETTLE_MS);
        const to =
          edge === "top" ? { x: release.from.x, y: wy + R }
          : edge === "bottom" ? { x: release.from.x, y: wy + wh - R }
          : edge === "left" ? { x: wx + R, y: release.from.y }
          : { x: wx + ww - R, y: release.from.y };
        const e = 1 - Math.pow(1 - t, 3);
        pos.x = release.from.x + (to.x - release.from.x) * e;
        pos.y = release.from.y + (to.y - release.from.y) * e;
        if (t >= 1) {
          done = true;
          await finish(edge, release.along);
          return;
        }
      }
      this.host.setMoveOverride({ x: WINDOW / 2, y: WINDOW / 2, transform: "none" });

      const answer = await Bridge.islandCarryStep(pos.x, pos.y);
      if (done) return;
      if (answer) {
        cursor = { x: answer[0], y: answer[1] };
        if (answer[2] === 0) down = false;
      }
      if (!down && !release) {
        const n = nearest(pos.x, pos.y);
        const along = n.edge === "top" || n.edge === "bottom" ? (pos.x - wx) / ww : (pos.y - wy) / wh;
        release = { t0: performance.now(), from: { ...pos }, edge: n.edge, along: clamp(along, 0, 1) };
      }
      requestAnimationFrame(frame);
    };

    const finish = async (dock: Edge, along: number) => {
      await Bridge.islandOverlayEnd(dock, along);
      this.root.classList.remove("moving");
      this.host.setMoveOverride(null);
      this.host.leaveMove(saved);
      this.active = false;
    };

    // The loop reads the real button state itself; pointer events are not needed.
    t0 = last = performance.now();
    requestAnimationFrame(frame);
  }
}
