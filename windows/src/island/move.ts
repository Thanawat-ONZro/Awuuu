// Edge-attached island relocation. No free flight or release momentum.
import { Bridge, IS_TAURI } from "../core/bridge";
import { Spring } from "../core/anim";
import { State } from "../core/state";
import { geo, type IslandLayout } from "../core/layout";
import { attachedEdge, edgeTrackPosition, unwrapEdgeTrack, edgeTrackPoint, attachedCenter, carryShape,
  clampOriginToMonitor, type Edge, type WorkArea } from "./move-physics";
import type { SwellUniforms } from "./liquid";

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


// Retained for the host's compact geometry; carrying frames own their shape.
export const DROPLET = 120;

export class Mover {
  private active = false;
  constructor(private host: MoveHost, private root: HTMLElement) {}

  async begin(ev: PointerEvent, target: HTMLElement) {
    if (this.active || ev.button !== 0 || !IS_TAURI) return;
    this.active = true;
    ev.preventDefault(); ev.stopPropagation();
    let saved: MoveState | null = null;
    let carrying = false;
    let cancelled = false;
    let currentEdge: Edge = geo.layout.edge;
    let along = .5;
    let cleanup = () => {};
    try {
      try { target.setPointerCapture(ev.pointerId); } catch { /* native button state is authoritative */ }
      let moved = false, released = false;
      let wake: (() => void) | undefined;
      const move = (e: PointerEvent) => {
        if (Math.hypot(e.screenX - ev.screenX, e.screenY - ev.screenY) >= 4) { moved = true; wake?.(); }
      };
      const up = () => { released = true; wake?.(); };
      const cancel = () => { cancelled = true; up(); };
      const key = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", cancel, true);
      window.addEventListener("keydown", key, true);
      window.addEventListener("blur", cancel, true);
      cleanup = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", cancel, true);
        window.removeEventListener("keydown", key, true);
        window.removeEventListener("blur", cancel, true);
      };
      await new Promise<void>(resolve => { wake = resolve; if (moved || released) resolve(); });
      if (!moved || released) return;
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", cancel, true);
      const initial = this.host.rect();
      // A fixed small carry window avoids a landscape-sized square on a portrait display.
      const side = 256;
      const info = await Bridge.islandCarryBegin(side);
      if (!info) throw new Error("Could not start moving the island");
      carrying = true;
      const [scale, wx, wy, ww, wh, mx, my, mw, mh, ox, oy, px, py] = info;
      const work: WorkArea = { wx, wy, ww, wh };
      const monitor = { x: mx, y: my, w: mw, h: mh };
      const sourceEdge = currentEdge;
      const sourceAlong = State.settings.along;
      let cursor = { x: px, y: py };
      const track = new Spring(edgeTrackPosition(ox + (initial.x + initial.w / 2) * scale,
        oy + (initial.y + initial.h / 2) * scale, work, currentEdge), .18, 1);
      const initialShape = carryShape(sourceEdge, 0);
      const width = new Spring(initialShape.w, .22, .86);
      const height = new Spring(initialShape.h, .22, .86);
      saved = this.host.enterMove();
      this.root.classList.add("moving");
      this.host.startLiquid();
      const reduced = Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
      let last = performance.now();
      let finalFrame: { point: ReturnType<typeof edgeTrackPoint>; origin: { x: number; y: number } } | null = null;
      while (!released && !cancelled) {
        const now = await new Promise<number>(resolve => requestAnimationFrame(resolve));
        const dt = Math.max(.001, Math.min(.04, (now - last) / 1000)); last = now;
        currentEdge = attachedEdge(cursor.x, cursor.y, work, currentEdge, 36 * scale);
        track.target = unwrapEdgeTrack(edgeTrackPosition(cursor.x, cursor.y, work, currentEdge), track.value, work);
        if (reduced) track.set(track.target); else track.step(dt);
        const point = edgeTrackPoint(track.value, work);
        const vertical = point.edge === "left" || point.edge === "right";
        const shape = carryShape(point.edge, reduced ? 0 : track.velocity / scale);
        width.target = shape.w; height.target = shape.h;
        if (reduced) { width.set(width.target); height.set(height.target); }
        else { width.step(dt); height.step(dt); }
        const center = attachedCenter(point, work, width.value * scale / 2, height.value * scale / 2);
        const origin = clampOriginToMonitor(center.x - side * scale / 2, center.y - side * scale / 2, monitor, side * scale);
        const cx = (center.x - origin.x) / scale, cy = (center.y - origin.y) / scale;
        const radius = Math.min(width.value, height.value) / 2;
        this.root.dataset.moveEdge = point.edge;
        this.root.style.setProperty("--carry-energy", String(shape.energy));
        this.host.applyMorph(cx, cy, width.value, height.value, [radius, radius, radius, radius],
          [(wx - origin.x) / scale, (wy - origin.y) / scale, ww / scale, wh / scale]);
        along = vertical ? (center.y - wy) / wh : (center.x - wx) / ww;
        finalFrame = { point, origin };
        const result = await Bridge.islandCarryStep(origin.x, origin.y);
        if (!result) throw new Error("Could not update island position");
        cursor = { x: result[0], y: result[1] };
        if (result[2] < 0) cancelled = true;
        if (result[2] === 0) released = true;
        if (released) currentEdge = point.edge;
      }
      // Let the elastic stretch relax on the same edge before the panel opens.
      if (!cancelled && !reduced && finalFrame) {
        const frame = finalFrame;
        const shape = carryShape(frame.point.edge, 0);
        width.target = shape.w; height.target = shape.h;
        this.root.style.setProperty("--carry-energy", "0");
        const start = performance.now();
        let previous = start;
        while (performance.now() - start < 110 && !cancelled) {
          const now = await new Promise<number>(resolve => requestAnimationFrame(resolve));
          const dt = Math.min(.04, (now - previous) / 1000); previous = now;
          width.step(dt); height.step(dt);
          const center = attachedCenter(frame.point, work, width.value * scale / 2, height.value * scale / 2);
          along = frame.point.edge === "left" || frame.point.edge === "right" ? (center.y - wy) / wh : (center.x - wx) / ww;
          const radius = Math.min(width.value, height.value) / 2;
          this.host.applyMorph((center.x - frame.origin.x) / scale, (center.y - frame.origin.y) / scale,
            width.value, height.value, [radius, radius, radius, radius],
            [(wx - frame.origin.x) / scale, (wy - frame.origin.y) / scale, ww / scale, wh / scale]);
        }
      }
      const edge = cancelled ? sourceEdge : currentEdge;
      const position = cancelled ? sourceAlong : along;
      const dock = await Bridge.islandDockRect(edge, position);
      if (dock) this.host.applyDockedLayout(dock[1]);
      await Bridge.islandOverlayEnd(edge, position);
      carrying = false;
    } catch (error) {
      void Bridge.log(`edge move failed: ${String(error)}`);
    } finally {
      cleanup();
      try { if (target.hasPointerCapture(ev.pointerId)) target.releasePointerCapture(ev.pointerId); } catch { /* window changed */ }
      // Always restore the native window and input even after an IPC error.
      if (carrying) await Bridge.islandOverlayEnd("", 0).catch(() => {});
      this.host.clearLiquid();
      this.host.setMoveOverride(null);
      this.root.classList.remove("moving");
      delete this.root.dataset.moveEdge;
      this.root.style.setProperty("--carry-energy", "0");
      if (saved) this.host.leaveMove(saved);
      this.active = false;
    }
  }
}
