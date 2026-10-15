// The coloured band at the top of every Awuuu window page: a deep-black strip
// with the page's token colour breathing in one corner and a few faint
// particles that drift away from the pointer. One canvas and one
// requestAnimationFrame loop serve the whole window; the loop stops when the
// window is hidden, or when reduced motion is on (one static frame is drawn).

import { h } from "../views/dom";

export const HERO_HEIGHT = 72;

export interface HeroTone {
  /** CSS custom property that holds the colour. */
  token: string;
  /** Used when the token cannot be read (tests, early paint). */
  fallback: string;
  /** Strength of the glow, 0..1. */
  strength: number;
}

const CARAMEL: HeroTone = { token: "--accent-caramel", fallback: "#e4a871", strength: 0.34 };

const TONES: Record<string, HeroTone> = {
  agents: { token: "--state-agent", fallback: "#7fb6d9", strength: 0.34 },
  chat: { token: "--state-info", fallback: "#f29db0", strength: 0.34 },
  sessions: CARAMEL,
  stats: { token: "--state-done", fallback: "#6fcf97", strength: 0.32 },
  integrations: { token: "--state-wait", fallback: "#f2b04c", strength: 0.34 },
  // The error colour, kept soft so a privacy page does not look like a failure.
  privacy: { token: "--state-error", fallback: "#ef6f5e", strength: 0.22 },
};

export function heroTone(page: string | null | undefined): HeroTone {
  return (page && TONES[page]) || CARAMEL;
}

/** "#rrggbb" or "#rgb" to [r, g, b]; anything else gives null. */
export function parseHex(v: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.replace(/./g, (c) => c + c);
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
}

export interface Pointer {
  x: number;
  y: number;
}

export const PARTICLE_COUNT = 28;
const PUSH_RADIUS = 90;

/** Deterministic-friendly: pass any 0..1 source. */
export function makeParticles(w: number, hgt: number, rnd: () => number = Math.random, n = PARTICLE_COUNT): Particle[] {
  return Array.from({ length: n }, () => ({
    x: rnd() * w,
    y: rnd() * hgt,
    vx: (rnd() - 0.5) * 8,
    vy: (rnd() - 0.5) * 5,
    r: 0.6 + rnd() * 1.1,
    a: 0.08 + rnd() * 0.14,
  }));
}

/** Moves particles by `dt` seconds: a slow drift, a gentle push away from the pointer, wrap-around edges. */
export function stepParticles(ps: Particle[], dt: number, w: number, hgt: number, pointer: Pointer | null): void {
  for (const p of ps) {
    if (pointer) {
      const dx = p.x - pointer.x;
      const dy = p.y - pointer.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.001 && d < PUSH_RADIUS) {
        const k = (1 - d / PUSH_RADIUS) * 40 * dt;
        p.vx += (dx / d) * k;
        p.vy += (dy / d) * k;
      }
    }
    const damp = Math.exp(-dt * 0.8);
    p.vx *= damp;
    p.vy *= damp;
    // Keep a faint ambient drift alive.
    p.vx += (Math.sin(p.y * 0.05 + p.r) * 1.2) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.x < -4) p.x = w + 4;
    else if (p.x > w + 4) p.x = -4;
    if (p.y < -4) p.y = hgt + 4;
    else if (p.y > hgt + 4) p.y = -4;
  }
}

// ── Runtime (one canvas, one loop) ──────────────────────────────────────────

const reducedQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)");

let band: HTMLElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let tone: HeroTone = CARAMEL;
let rgb: [number, number, number] = [228, 168, 113];
let particles: Particle[] = [];
let pointer: Pointer | null = null;
let w = 0;
let raf = 0;
let last = 0;
let lastDraw = 0;
let t0 = 0;
let focused = true;

function readColour() {
  let v = "";
  try {
    v = getComputedStyle(document.documentElement).getPropertyValue(tone.token);
  } catch {
    /* no computed style */
  }
  rgb = parseHex(v) ?? parseHex(tone.fallback) ?? [228, 168, 113];
}

function resize() {
  if (!band || !canvas) return;
  const bw = Math.max(1, Math.round(band.clientWidth));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (bw === w && canvas.width === Math.round(bw * dpr)) return;
  w = bw;
  canvas.width = Math.round(bw * dpr);
  canvas.height = Math.round(HERO_HEIGHT * dpr);
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  particles = makeParticles(w, HERO_HEIGHT);
}

function draw(now: number, still: boolean) {
  if (!ctx) return;
  ctx.clearRect(0, 0, w, HERO_HEIGHT);
  // The glow breathes on a ~7 s cycle and sits in the right-hand corner.
  const breath = still ? 0.5 : 0.5 + 0.5 * Math.sin(((now - t0) / 7000) * Math.PI * 2);
  const [r, g, b] = rgb;
  const cx = w * 0.86;
  const cy = -HERO_HEIGHT * 0.15;
  const rad = Math.max(160, w * 0.42) * (0.92 + 0.12 * breath);
  const a = tone.strength * (0.72 + 0.28 * breath);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${a})`);
  grad.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, ${a * 0.28})`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, HERO_HEIGHT);
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  for (const p of particles) {
    ctx.globalAlpha = p.a;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function canRun() {
  return !!band && document.visibilityState === "visible" && !reducedQuery().matches;
}

function frame(now: number) {
  raf = 0;
  if (!canRun()) {
    stop();
    return;
  }
  // Unfocused windows tick at ~6 fps; focused ones at the display rate.
  const minGap = focused ? 0 : 160;
  if (now - lastDraw >= minGap) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    lastDraw = now;
    stepParticles(particles, dt, w, HERO_HEIGHT, pointer);
    draw(now, false);
  }
  raf = requestAnimationFrame(frame);
}

function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

/** Starts the loop if it should run, otherwise draws one static frame. */
function sync() {
  if (!band) return;
  resize();
  if (canRun()) {
    if (!raf) {
      last = lastDraw = performance.now();
      raf = requestAnimationFrame(frame);
    }
  } else {
    stop();
    if (document.visibilityState === "visible") draw(performance.now(), true);
  }
}

/** Sets the page whose colour the band wears. */
export function setHeroPage(page: string | null) {
  tone = heroTone(page);
  readColour();
  if (band && !raf) sync();
}

/** Creates the band; the caller places it at the top of the content area. */
export function createHero(): HTMLElement {
  if (band) return band;
  canvas = h("canvas", { class: "hero-canvas", "aria-hidden": "true" }) as HTMLCanvasElement;
  band = h("div", { class: "hero-band", "aria-hidden": "true" }, canvas);
  ctx = canvas.getContext("2d");
  t0 = performance.now();
  readColour();
  document.addEventListener("visibilitychange", sync);
  const rq = reducedQuery();
  rq.addEventListener?.("change", sync);
  window.addEventListener("focus", () => { focused = true; });
  window.addEventListener("blur", () => { focused = false; });
  focused = document.hasFocus();
  window.addEventListener("resize", () => { resize(); if (!raf) sync(); });
  window.addEventListener("pointermove", (e) => {
    if (!band) return;
    const r = band.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  }, { passive: true });
  document.addEventListener("pointerleave", () => { pointer = null; });
  requestAnimationFrame(() => sync()); // after layout
  return band;
}
