// The water that rises from the nearest screen edge to meet the carried drop
// (see src-tauri/src/water.rs). The drop is drawn by the island window; here
// only the edge reacts: a swell that grows as the drop comes near, and a bridge
// of blobs between the two once it is close. Blur + threshold melt them into
// one liquid. Idle (nothing drawn) unless Rust is sending the drop's position.

import { onEvent } from "../core/bridge";

const NS = "http://www.w3.org/2000/svg";
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const svg = el("svg");
const filter = el("filter", { id: "goo", x: "-20%", y: "-20%", width: "140%", height: "140%" });
filter.append(
  el("feGaussianBlur", { in: "SourceGraphic", stdDeviation: 9, result: "b" }),
  el("feColorMatrix", { in: "b", mode: "matrix", values: "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" }),
);
const defs = el("defs");
defs.append(filter);
const g = el("g", { filter: "url(#goo)", fill: "#120f0c" });
const swell = el("ellipse", { rx: 0, ry: 0 });
const BRIDGE = 7;
const blobs = Array.from({ length: BRIDGE }, () => el("circle", { r: 0 }));
g.append(swell, ...blobs);
svg.append(defs, g);
document.body.append(svg);

function draw(x: number, y: number, r: number) {
  const W = window.innerWidth, H = window.innerHeight;
  const cand = [
    { e: "top", d: y, px: x, py: 0 },
    { e: "bottom", d: H - y, px: x, py: H },
    { e: "left", d: x, px: 0, py: y },
    { e: "right", d: W - x, px: W, py: y },
  ];
  const n = cand.reduce((a, b) => (b.d < a.d ? b : a));
  const gap = n.d - r; // free space between the drop and the edge
  const reach = smooth(clamp(1 - gap / (r * 2.2), 0, 1)); // the swell wakes up
  const join = smooth(clamp(1 - gap / (r * 0.9), 0, 1)); // the bridge forms
  const horizontal = n.e === "top" || n.e === "bottom";
  // The swell: a low dome on the edge under the drop, rising as it comes.
  const along = r * (0.9 + 0.8 * reach);
  const rise = r * 0.5 * reach;
  swell.setAttribute("cx", String(n.px));
  swell.setAttribute("cy", String(n.py));
  swell.setAttribute("rx", String(horizontal ? along : rise));
  swell.setAttribute("ry", String(horizontal ? rise : along));
  // The bridge: blobs from the swell to the drop, thicker the closer it is.
  blobs.forEach((b, i) => {
    const t = (i + 1) / (BRIDGE + 1);
    b.setAttribute("cx", String(n.px + (x - n.px) * t));
    b.setAttribute("cy", String(n.py + (y - n.py) * t));
    b.setAttribute("r", String(join > 0 ? r * (0.18 + 0.32 * join) * (1 - 0.35 * Math.abs(t - 0.5)) : 0));
  });
}

void onEvent<[number, number, number]>("water-ball", ([x, y, r]) => draw(x, y, r));
void onEvent<null>("water-end", () => {
  swell.setAttribute("rx", "0");
  swell.setAttribute("ry", "0");
  blobs.forEach((b) => b.setAttribute("r", "0"));
});
