// Dev harness: every bot state and emote side by side, plus the launch greeting
// on a loop, in a plain browser. Not part of the app bundle.

import { BotEngine, hexToRGB } from "../src/mochi/engine";
import { Greeting } from "../src/mochi/greeting";
import type { BotEmoteName, BotStateName } from "../src/core/layout";

type Cell = { label: string; engine: BotEngine; ctx: CanvasRenderingContext2D; size: number };
const grid = document.getElementById("grid")!;
const cells: Cell[] = [];
const OH = 20;

function add(label: string, setup: (e: BotEngine) => void, size = 110) {
  const el = document.createElement("div");
  el.className = "cell";
  const c = document.createElement("canvas");
  c.width = size * 2; c.height = (size + OH) * 2;
  c.style.width = `${size}px`; c.style.height = `${size + OH}px`;
  el.append(c, Object.assign(document.createElement("div"), { textContent: label }));
  grid.append(el);
  const engine = new BotEngine();
  engine.particleOverhang = OH;
  setup(engine);
  cells.push({ label, engine, ctx: c.getContext("2d")!, size });
}

const states: BotStateName[] = ["idle", "working", "thinking", "searching", "approval", "question",
  "error", "finished", "ratelimit", "sleeping", "dizzy"];
for (const s of states) add(s, (e) => e.setState(s, true));
const emotes: BotEmoteName[] = ["love", "proud", "happy", "annoyed", "wink", "yawn", "surprised"];
for (const m of emotes) add(`emote ${m}`, (e) => e.setPermanentEmote(m));
add("greet (wave)", (e) => { e.greet(); setInterval(() => e.greet(), 3000); });
add("integration", (e) => (e.bodyColor = hexToRGB("#3E86E0")));
add("mini", (e) => { e.isMini = true; e.bodyColor = hexToRGB("#E86A6A"); e.setPermanentEmote("happy"); }, 40);
add("compact", () => {}, 30);

// Idle moves, as the island schedules them (faster here so they show up).
setInterval(() => cells.forEach((c) => c.engine.fidget()), 1500);

let last = performance.now();
// The greeting, frozen at a few moments of its timeline (seconds), stacked.
const FROZEN = [0.7, 1.8, 2.2, 3.5];
const greetCanvas = document.getElementById("greet") as HTMLCanvasElement;
greetCanvas.height = 150 * FROZEN.length;
const gctx = greetCanvas.getContext("2d")!;
const greetings = FROZEN.map(() => { const g = new Greeting(); g.start(); return g; });

function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const c of cells) {
    c.engine.lookX = Math.sin(now / 1400) * 0.6;
    c.engine.lookY = Math.cos(now / 1900) * 0.3;
    c.engine.update(dt);
    c.ctx.setTransform(2, 0, 0, 2, 0, 0);
    c.ctx.clearRect(0, 0, c.size, c.size + OH);
    c.engine.draw(c.ctx, c.size, c.size + OH);
  }
  greetings.forEach((g, i) => {
    (g as unknown as { startMs: number }).startMs = performance.now() - FROZEN[i] * 1000;
    gctx.save();
    gctx.translate(0, i * 150);
    gctx.beginPath(); gctx.rect(0, 0, 640, 150); gctx.clip();
    g.draw(gctx);
    gctx.restore();
  });
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
