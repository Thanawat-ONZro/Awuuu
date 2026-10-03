// Appearance: how Awuuu the dog looks.
//
// The preview is the island's own engine drawing the look being edited, so it
// is exactly what the island shows. Every change is written to `settings.dog`
// and saved; the island picks it up through `settings-changed`.

import "../appearance.css";
import { AGENT_INFO } from "../../core/state";
import { BotEngine } from "../../mochi/engine";
import {
  CLASSIC, COLLARS, EARS, EYES, PATTERNS, PRESETS, TAILS,
  lookForAgent, normalizeLook, randomLook, sameLook, type DogLook,
} from "../../mochi/looks";
import type { BotStateName } from "../../core/layout";
import { h } from "../../views/dom";
import { onLeave } from "../shell";
import { card, pageOf, save, settings } from "../ui";

const STAGE_W = 300;
const STAGE_H = 230;
const DOG_W = 210; // the engine draws the body at 60 % of this

const dprOf = () => Math.min(2, window.devicePixelRatio || 1);

/** One still frame of a dog, for the preset cards and the agent strip. */
function still(look: DogLook, size: number): HTMLCanvasElement {
  const dpr = dprOf();
  const canvas = h("canvas", { width: Math.round(size * dpr), height: Math.round(size * dpr) }) as HTMLCanvasElement;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const engine = new BotEngine();
    engine.setLook(look, false);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    engine.draw(ctx, size, size);
  }
  return canvas;
}

const LABELS: Record<string, string> = {
  shiba: "Shiba", mask: "Mask", saddle: "Tan points", spots: "Spots", solid: "Solid", tricolor: "Tricolor",
  pointed: "Pointed", floppy: "Floppy", round: "Round",
  curl: "Curl", straight: "Straight", fluffy: "Fluffy",
  dot: "Classic", sparkle: "Sparkle", sleepy: "Sleepy",
  none: "None", collar: "Collar", bandana: "Bandana",
};

const STATES: [string, BotStateName][] = [
  ["Idle", "idle"], ["Working", "working"], ["Thinking", "thinking"], ["Needs you", "approval"],
  ["Done", "finished"], ["Asleep", "sleeping"],
];

export function page(): HTMLElement {
  let look: DogLook = normalizeLook(settings.dog);
  const syncers: (() => void)[] = [];

  // ── Live preview ────────────────────────────────────────────────────────────

  const canvas = h("canvas", { class: "dog-canvas" }) as HTMLCanvasElement;
  const dpr = dprOf();
  canvas.width = Math.round(STAGE_W * dpr);
  canvas.height = Math.round(STAGE_H * dpr);
  canvas.style.width = `${STAGE_W}px`;
  canvas.style.height = `${STAGE_H}px`;
  const ctx = canvas.getContext("2d");
  const engine = new BotEngine();
  engine.setLook(look, false);

  let alive = true;
  let raf = 0;
  let last = 0;
  const frame = (ms: number) => {
    raf = 0;
    if (!alive || document.hidden || !ctx) return;
    const dt = Math.min(0.05, (ms - last) / 1000);
    last = ms;
    engine.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, STAGE_W, STAGE_H);
    ctx.translate((STAGE_W - DOG_W) / 2, (STAGE_H - DOG_W) / 2 + 4);
    engine.draw(ctx, DOG_W, DOG_W);
    // Like the island: the loop stops as soon as nothing moves.
    if (engine.busy) kick();
  };
  const kick = () => {
    if (raf || !alive || document.hidden) return;
    if (!engine.busy) last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const fidget = window.setInterval(() => {
    if (document.hidden) return;
    engine.fidget();
    kick();
  }, 3200);
  const onVisible = () => kick();
  document.addEventListener("visibilitychange", onVisible);
  onLeave(() => {
    alive = false;
    if (raf) cancelAnimationFrame(raf);
    window.clearInterval(fidget);
    window.clearTimeout(saveTimer);
    document.removeEventListener("visibilitychange", onVisible);
  });

  const stage = h("div", { class: "dog-stage" }, canvas);
  stage.addEventListener("pointermove", (e) => {
    const r = stage.getBoundingClientRect();
    engine.lookX = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2.4));
    engine.lookY = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2.4));
    kick();
  });
  stage.addEventListener("pointerleave", () => {
    engine.lookX = 0;
    engine.lookY = 0;
    kick();
  });
  stage.addEventListener("click", () => {
    engine.triggerEmote("happy");
    kick();
  });

  const stateRow = h("div", { class: "dog-states" });
  for (const [label, state] of STATES) {
    const b = h("button", { class: "chip", text: label });
    b.addEventListener("click", () => {
      engine.setState(state);
      kick();
      sync();
    });
    syncers.push(() => b.classList.toggle("on", engine.state === state));
    stateRow.append(b);
  }

  // ── Applying a change ───────────────────────────────────────────────────────

  let saveTimer = 0;
  /** `soft`: a colour being dragged — save once the hand stops. */
  const apply = (next: DogLook, soft = false, fade = false) => {
    const named = PRESETS.find((p) => sameLook(p.look, next));
    look = { ...next, preset: named ? named.id : "custom" };
    engine.setLook(look, fade);
    kick();
    // The classic look is stored as "no look at all".
    settings.dog = sameLook(look, CLASSIC) ? null : { ...look };
    window.clearTimeout(saveTimer);
    if (soft) saveTimer = window.setTimeout(() => void save(), 220);
    else void save();
    sync();
  };
  const sync = () => syncers.forEach((f) => f());

  // ── Presets ─────────────────────────────────────────────────────────────────

  const presets = h("div", { class: "dog-presets" });
  for (const p of PRESETS) {
    const b = h("button", { class: "dog-preset", title: p.name }, still(p.look, 72), h("span", { text: p.name }));
    b.addEventListener("click", () => apply(p.look, false, true));
    syncers.push(() => b.classList.toggle("on", look.preset === p.id));
    presets.append(b);
  }

  // ── Controls ────────────────────────────────────────────────────────────────

  const color = (key: "coat" | "patch" | "accent" | "collarColor" | "eyeColor", fallback = "#49B4F5") => {
    const input = h("input", { type: "color" }) as HTMLInputElement;
    const hex = h("code", {});
    const wrap = h("label", { class: "swatch" }, input, hex);
    input.addEventListener("input", () => apply({ ...look, [key]: input.value.toUpperCase() }, true));
    syncers.push(() => {
      const v = look[key] || fallback;
      if (input.value.toUpperCase() !== v) input.value = v;
      hex.textContent = look[key] ? v : "—";
    });
    return wrap;
  };

  const segmented = <K extends "pattern" | "ears" | "tail" | "eyes" | "collar">(key: K, all: readonly DogLook[K][]) => {
    const box = h("span", { class: "seg" });
    for (const v of all) {
      const b = h("button", { text: LABELS[v] ?? v });
      b.addEventListener("click", () => apply({ ...look, [key]: v }));
      syncers.push(() => b.classList.toggle("on", look[key] === v));
      box.append(b);
    }
    return box;
  };

  const plainEyes = h("button", { class: "chip", text: "Plain dark" });
  plainEyes.addEventListener("click", () => apply({ ...look, eyeColor: "" }));
  syncers.push(() => plainEyes.classList.toggle("on", !look.eyeColor));

  const collarColor = h("span", { class: "row-inline" }, color("collarColor"));
  syncers.push(() => collarColor.classList.toggle("off", look.collar === "none"));

  const surprise = h("button", { class: "primary", text: "Surprise me" });
  surprise.addEventListener("click", () => {
    apply(randomLook(), false, true);
    engine.triggerEmote("happy");
    kick();
  });
  const reset = h("button", { text: "Reset to classic" });
  reset.addEventListener("click", () => apply(CLASSIC, false, true));

  const controls = h("div", { class: "dog-controls" },
    h("div", { class: "row" }, h("label", { text: "Coat" }), color("coat")),
    h("div", { class: "row" }, h("label", { text: "Markings" }), color("patch")),
    h("div", { class: "row" }, h("label", { text: "Accent" }), color("accent"),
      h("span", { class: "hint", text: "inner ear, small details" })),
    h("div", { class: "row" }, h("label", { text: "Pattern" }), segmented("pattern", PATTERNS)),
    h("div", { class: "row" }, h("label", { text: "Ears" }), segmented("ears", EARS)),
    h("div", { class: "row" }, h("label", { text: "Tail" }), segmented("tail", TAILS)),
    h("div", { class: "row" }, h("label", { text: "Eyes" }), segmented("eyes", EYES)),
    h("div", { class: "row" }, h("label", { text: "Eye colour" }), color("eyeColor"), plainEyes),
    h("div", { class: "row" }, h("label", { text: "Collar" }), segmented("collar", COLLARS), collarColor),
  );

  // ── Agent dogs ──────────────────────────────────────────────────────────────

  const agents = h("div", { class: "dog-agents" });
  const others: [string, string, string][] = [
    ["integration", "GitHub", "#F0645A"], ["integration", "Mail", "#EA4335"], ["integration", "Weather", "#38BDF8"],
  ];
  const strip: [string, string, string][] = [
    ...Object.entries(AGENT_INFO).map(([id, a]) => [id, a.short, a.color] as [string, string, string]),
    ...others,
  ];
  for (const [source, name, col] of strip) {
    agents.append(h("div", { class: "dog-agent" },
      still(lookForAgent(source, col), 64),
      h("span", {}, h("i", { class: "dot", style: `background:${col}` }), name),
    ));
  }

  sync();
  kick();

  return pageOf("Appearance", "Make Awuuu yours. Changes show on the island straight away.",
    h("section", { class: "dog-top" },
      h("div", { class: "dog-preview" }, stage, stateRow,
        h("div", { class: "row-buttons" }, surprise, reset)),
      controls,
    ),
    card("Breeds", presets),
    card("Agent dogs",
      h("p", { class: "hint", text: "Each agent and integration wears its own dog, in its own colour — in the hub's pills, and on the island while you look at it." }),
      agents),
  );
}
