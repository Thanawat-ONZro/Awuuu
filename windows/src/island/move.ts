// Moving the island, drawn as a drop of liquid.
//
// Pressing the grip (or Alt + press on the island) turns the window into a
// transparent overlay over the display's work area (Rust island_overlay_begin).
// The island shrinks to its pill and follows the cursor. Behind it an SVG
// "goo" layer (blur + alpha threshold) melts simple shapes into one liquid:
//   • a neck from the spot it was pulled off, thinning with distance until it
//     snaps and the stub sinks back into the edge;
//   • the pill itself, stretched along the direction it is flung;
//   • near any edge, a bulge rising from that edge to meet it, and a bridge
//     once it is close — where it will dock.
// Released, it flows into place on the nearest edge and Rust docks it there.
// Nothing runs between drags: the frame loop exists only while moving.

import { Bridge, IS_TAURI } from "../core/bridge";
import { State } from "../core/state";

export type Edge = "top" | "bottom" | "left" | "right";

export interface MoveHost {
  /** Pill size for an edge (layout.ts islandSize compact). */
  pillSize(edge: Edge): { w: number; h: number };
  /** Draw the island centred at (x, y) with an optional transform; null = normal. */
  setMoveOverride(at: { x: number; y: number; transform: string } | null): void;
  /** Shape the pill for the edge it is about to dock to (upright on the sides). */
  previewEdge(edge: Edge): void;
  /** Shrink to the pill and keep it from auto-hiding while it moves. */
  enterMove(): { wasExpanded: boolean; view: string };
  leaveMove(state: { wasExpanded: boolean; view: string }): void;
}

const NS = "http://www.w3.org/2000/svg";
const BREAK = 170; // px of pull before the neck snaps
const REACH = 130; // an edge starts reaching for the island within this distance
const BRIDGE = 70; // …and joins it within this one
const BEADS = 12;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** The point on the edge nearest to (x, y) and how far it is. */
function nearestEdge(x: number, y: number, W: number, H: number): { edge: Edge; d: number; px: number; py: number } {
  const c: { edge: Edge; d: number; px: number; py: number }[] = [
    { edge: "top", d: y, px: x, py: 0 },
    { edge: "bottom", d: H - y, px: x, py: H },
    { edge: "left", d: x, px: 0, py: y },
    { edge: "right", d: W - x, px: W, py: y },
  ];
  return c.reduce((a, b) => (b.d < a.d ? b : a));
}

function edgeAnchor(edge: Edge, along: number, W: number, H: number): { x: number; y: number } {
  switch (edge) {
    case "bottom": return { x: along * W, y: H };
    case "left": return { x: 0, y: along * H };
    case "right": return { x: W, y: along * H };
    default: return { x: along * W, y: 0 };
  }
}

export class Mover {
  private active = false;

  constructor(private host: MoveHost, private root: HTMLElement) {}

  /** Starts a move from a pointerdown on `target` (the grip or the island). */
  async begin(ev: PointerEvent, target: HTMLElement) {
    if (this.active || ev.button !== 0) {
      void Bridge.log(`move ignored (active=${this.active}, button=${ev.button})`);
      return;
    }
    this.active = true;
    ev.preventDefault();
    ev.stopPropagation();
    try {
      target.setPointerCapture(ev.pointerId);
    } catch {
      /* captured below through window listeners anyway */
    }

    const fromEdge = (State.settings.position ?? "top") as Edge;
    const fromAlong = State.settings.along ?? 0.5;
    // `npm run dev` in a browser: the page itself is the overlay.
    const size = IS_TAURI ? await Bridge.islandOverlayBegin() : ([window.innerWidth, window.innerHeight] as [number, number]);
    if (!size) {
      void Bridge.log("move: overlay could not start");
      this.active = false;
      return;
    }
    void Bridge.log(`move: overlay ${size[0]}x${size[1]} from ${fromEdge} ${fromAlong.toFixed(2)}`);
    const [W, H] = size;
    const saved = this.host.enterMove();
    this.root.classList.add("moving");

    // ── Liquid layer ──────────────────────────────────────────────────────
    const svg = svgEl("svg", { class: "move-layer", width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    const filter = svgEl("filter", { id: "awuuu-goo", x: "-20%", y: "-20%", width: "140%", height: "140%" });
    filter.append(
      svgEl("feGaussianBlur", { in: "SourceGraphic", stdDeviation: 7, result: "blur" }),
      svgEl("feColorMatrix", { in: "blur", mode: "matrix", values: "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" }),
    );
    const defs = svgEl("defs");
    defs.append(filter);
    const g = svgEl("g", { filter: "url(#awuuu-goo)", fill: "#120f0c" });
    const source = svgEl("rect", { rx: 10 });
    const blob = svgEl("rect", { rx: 16 });
    const bulge = svgEl("circle", { r: 0 });
    const beads = Array.from({ length: BEADS }, () => svgEl("circle", { r: 0 }));
    const bridge = Array.from({ length: 6 }, () => svgEl("circle", { r: 0 }));
    g.append(source, ...beads, ...bridge, bulge, blob);
    svg.append(defs, g);
    this.root.append(svg);

    const src = edgeAnchor(fromEdge, fromAlong, W, H);
    let pointer = { x: ev.clientX, y: ev.clientY };
    // The pill starts where the island was grabbed; it eases toward the cursor.
    const pos = { ...pointer };
    let vel = { x: 0, y: 0 };
    let neck = 1; // 1 = attached … 0 = snapped
    let snapped = false;
    let stub = 1; // the leftover on the source edge, sinking after the snap
    let release: { edge: Edge; along: number; t0: number; from: { x: number; y: number }; to: { x: number; y: number } } | null = null;
    let last = performance.now();
    let raf = 0;

    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
    };
    const finish = async (dock: { edge: Edge; along: number } | null) => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      await Bridge.islandOverlayEnd(dock?.edge ?? "", dock?.along ?? 0);
      svg.remove();
      this.root.classList.remove("moving");
      this.host.setMoveOverride(null);
      this.host.leaveMove(saved);
      this.active = false;
    };
    const onUp = () => {
      if (release) return;
      const near = nearestEdge(pos.x, pos.y, W, H);
      const along = near.edge === "top" || near.edge === "bottom" ? pos.x / W : pos.y / H;
      const pill = this.host.pillSize(near.edge);
      const to =
        near.edge === "top" ? { x: pos.x, y: pill.h / 2 }
        : near.edge === "bottom" ? { x: pos.x, y: H - pill.h / 2 }
        : near.edge === "left" ? { x: pill.w / 2, y: pos.y }
        : { x: W - pill.w / 2, y: pos.y };
      release = { edge: near.edge, along: Math.min(1, Math.max(0, along)), t0: performance.now(), from: { ...pos }, to };
    };
    const onCancel = () => void finish(null);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);

    let shape: Edge = "top";
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Upright once it is clearly heading for a side, flat otherwise.
      const ahead = release?.edge ?? (() => {
        // The cursor decides: the pill itself is held back from the edge.
        const n = nearestEdge(pointer.x, pointer.y, W, H);
        return n.d < REACH * 0.6 ? n.edge : "top";
      })();
      if (ahead !== shape) {
        shape = ahead;
        this.host.previewEdge(shape);
      }
      const pill = this.host.pillSize(shape);

      if (release) {
        // Flow into place: an overshooting ease toward the dock point.
        const t = Math.min(1, (now - release.t0) / 280);
        const k = 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 1.2);
        pos.x = release.from.x + (release.to.x - release.from.x) * k;
        pos.y = release.from.y + (release.to.y - release.from.y) * k;
        vel = { x: 0, y: 0 };
        if (t >= 1) {
          void finish({ edge: release.edge, along: release.along });
          return;
        }
      } else {
        // Follow the cursor with a little lag, which is what makes it feel liquid.
        const nx = pos.x + (pointer.x - pos.x) * Math.min(1, dt * 18);
        const ny = pos.y + (pointer.y - pos.y) * Math.min(1, dt * 18);
        vel = { x: vel.x * 0.8 + ((nx - pos.x) / Math.max(dt, 1e-3)) * 0.2, y: vel.y * 0.8 + ((ny - pos.y) / Math.max(dt, 1e-3)) * 0.2 };
        // Most of the pill stays on screen, however hard it is pulled.
        pos.x = Math.min(W - pill.w * 0.3, Math.max(pill.w * 0.3, nx));
        pos.y = Math.min(H - pill.h * 0.3, Math.max(pill.h * 0.3, ny));
      }

      // Neck from the source: thins with distance, snaps past BREAK.
      const dx = pos.x - src.x;
      const dy = pos.y - src.y;
      const dist = Math.hypot(dx, dy);
      if (!snapped) {
        neck = Math.max(0, 1 - dist / BREAK);
        if (neck <= 0) snapped = true;
      } else {
        neck = 0;
        stub = Math.max(0, stub - dt * 3.5);
      }
      const stubSize = snapped ? stub : 1;
      const horizontalSrc = fromEdge === "top" || fromEdge === "bottom";
      const sw = (horizontalSrc ? 150 : 22) * (0.4 + 0.6 * stubSize);
      const sh = (horizontalSrc ? 22 : 150) * (0.4 + 0.6 * stubSize);
      source.setAttribute("x", String(src.x - sw / 2));
      source.setAttribute("y", String(src.y - sh / 2));
      source.setAttribute("width", String(sw * (stubSize > 0.02 ? 1 : 0)));
      source.setAttribute("height", String(sh));
      beads.forEach((b, i) => {
        const t = (i + 1) / (BEADS + 1);
        // Never thinner than the blur can carry, until it snaps.
        const r = neck > 0 ? (26 * (1 - t) + 16 * t) * (0.45 + 0.55 * neck) : 0;
        b.setAttribute("cx", String(src.x + dx * t));
        b.setAttribute("cy", String(src.y + dy * t));
        b.setAttribute("r", String(r));
      });

      // The nearest edge reaches for the island.
      const near = nearestEdge(pos.x, pos.y, W, H);
      const reach = Math.max(0, 1 - near.d / REACH);
      const br = 34 * reach;
      const inward = { x: Math.sign(pos.x - near.px), y: Math.sign(pos.y - near.py) };
      bulge.setAttribute("cx", String(near.px + inward.x * br * 0.5 * (near.edge === "left" || near.edge === "right" ? 1 : 0)));
      bulge.setAttribute("cy", String(near.py + inward.y * br * 0.5 * (near.edge === "top" || near.edge === "bottom" ? 1 : 0)));
      bulge.setAttribute("r", String(br));
      const join = Math.max(0, 1 - near.d / BRIDGE);
      bridge.forEach((b, i) => {
        const t = (i + 1) / (bridge.length + 1);
        b.setAttribute("cx", String(near.px + (pos.x - near.px) * t));
        b.setAttribute("cy", String(near.py + (pos.y - near.py) * t));
        b.setAttribute("r", String(join > 0 ? 10 + 8 * join : 0));
      });

      // The pill stretches along its motion and toward an edge it is about to touch.
      const speed = Math.hypot(vel.x, vel.y);
      const stretch = 1 + Math.min(0.32, speed / 3200) + reach * 0.12;
      const angle = speed > 40 ? Math.atan2(vel.y, vel.x) : near.edge === "left" || near.edge === "right" ? 0 : Math.PI / 2;
      const deg = (angle * 180) / Math.PI;
      const transform = `rotate(${deg}deg) scale(${stretch}, ${1 / stretch}) rotate(${-deg}deg)`;
      blob.setAttribute("x", String(pos.x - pill.w / 2));
      blob.setAttribute("y", String(pos.y - pill.h / 2));
      blob.setAttribute("width", String(pill.w));
      blob.setAttribute("height", String(pill.h));
      blob.setAttribute("transform", `rotate(${deg} ${pos.x} ${pos.y}) translate(${pos.x} ${pos.y}) scale(${stretch} ${1 / stretch}) translate(${-pos.x} ${-pos.y}) rotate(${-deg} ${pos.x} ${pos.y})`);
      this.host.setMoveOverride({ x: pos.x, y: pos.y, transform });

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }
}
