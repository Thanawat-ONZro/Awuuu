// The dog on the desktop — every decision that can be pure. No DOM, no Tauri.
// The window side is src-tauri/src/desktop_dog.rs (its `logic` module holds
// the geometry: monitors, spots, home zone); the life cycle runs in
// src/island/desktop-dog.ts and the drawing in src/dog/main.ts.

import type { BotStateName, IslandMode, IslandViewName } from "../core/layout";

/** Label of the dog's window (desktop_dog.rs LABEL). */
export const DOG_WINDOW = "dog";
/** Side of the square window, logical px (desktop_dog.rs SIZE). */
export const PANEL = 120;
/** The body disc, as fractions of the side (desktop_dog.rs BODY_*). */
export const BODY = { cx: 0.5, cy: 0.62, r: 0.3 } as const;
/** Island ⇄ desktop. */
export const FLIGHT_MS = 400;
/** A press that moves this far (logical px) is a drag, not a poke. */
export const DRAG_THRESHOLD = 8;
/** A click waits this long for a second one before it pokes. */
export const DOUBLE_CLICK_MS = 260;
/** Nothing going on for this long and the cursor away: the dog dozes off. */
export const SLEEP_AFTER_S = 120;
/** Frame pacing: awake and watched, and the slow idle tick otherwise. */
export const AWAKE_FRAME_MS = 33;
export const IDLE_TICK_MS = 400;
/** A finished task calls the dog home for this long. */
export const FINISHED_VISIT_MS = 2500;

export interface Point {
  x: number;
  y: number;
}

// ── Life cycle ────────────────────────────────────────────────────────────────

/** Where the dog is: in the island, on the desktop, on its way, or in the user's hand. */
export type Phase = "home" | "out" | "flying" | "carried";

export interface LifeInput {
  phase: Phase;
  /** Settings → General → Dog on desktop. */
  enabled: boolean;
  /** The user put it on the desktop (drag out, Ctrl+Alt+D, last session). */
  wantOut: boolean;
  /** An approval, error or finished alert is up: the dog comes home for it. */
  alert: boolean;
}

export type Move = "none" | "flyOut" | "flyHome";

/**
 * The one rule: the dog belongs on the desktop when the feature is on, the
 * user wants it there and nothing calls it home; otherwise in the island.
 * Nothing interrupts a flight or a drag — the rule runs again once it ends.
 */
export function decide(s: LifeInput): Move {
  if (s.phase === "flying" || s.phase === "carried") return "none";
  const target = s.enabled && s.wantOut && !s.alert ? "out" : "home";
  if (target === s.phase) return "none";
  return target === "out" ? "flyOut" : "flyHome";
}

/** Flying home because the user wants it home (not for an alert): forget the desktop. */
export function forgetsDesktop(s: LifeInput): boolean {
  return !s.enabled || !s.wantOut;
}

export interface AlertInput {
  /** A permission or question card waits. */
  approval: boolean;
  mode: IslandMode;
  view: IslandViewName;
  /** performance.now() and until when a finished task keeps the dog home. */
  now: number;
  finishedUntil: number;
}

/** Approval, error or finished: the alerts the dog flies home for. */
export function alertActive(a: AlertInput): boolean {
  if (a.approval) return true;
  if (a.mode === "expanded" && (a.view === "approval" || a.view === "error" || a.view === "finished")) return true;
  return a.now < a.finishedUntil;
}

// ── Flights ───────────────────────────────────────────────────────────────────

export function easeInOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 4 * c * c * c : 1 - (-2 * c + 2) ** 3 / 2;
}

/** How high the flight arcs above the straight line: a hop, never a loop. */
export function arcLift(from: Point, to: Point): number {
  return Math.min(160, Math.hypot(to.x - from.x, to.y - from.y) * 0.25);
}

/**
 * The window's top-left at progress `t` (0…1, already eased): a quadratic
 * curve through a control point above the midpoint, so the dog hops instead
 * of sliding. Exactly `from` at 0 and `to` at 1.
 */
export function flightPoint(from: Point, to: Point, t: number): Point {
  const c = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - arcLift(from, to) };
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * c.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * c.y + t * t * to.y,
  };
}

/** The positions a flight of `ms` goes through at one step every `stepMs`, eased. */
export function flightPath(from: Point, to: Point, ms = FLIGHT_MS, stepMs = 16): Point[] {
  const steps = Math.max(1, Math.round(ms / stepMs));
  const out: Point[] = [];
  for (let k = 1; k <= steps; k++) out.push(flightPoint(from, to, easeInOutCubic(k / steps)));
  return out;
}

// ── The dog's own window ─────────────────────────────────────────────────────

export interface PaceInput {
  /** The window is on the desktop (not parked). */
  visible: boolean;
  /** The cursor is within ~300 px (Rust only reports it then). */
  near: boolean;
  /** A flight or a drag is moving the window. */
  flying: boolean;
  /** A short engine animation (poke, fidget, waking) is playing. */
  tweening: boolean;
  asleep: boolean;
}

/**
 * Milliseconds to the next frame, or null for no frame at all. Full rate only
 * while something is worth watching; a slow idle tick otherwise; nothing once
 * the window is parked or the dog sleeps.
 */
export function frameDelay(p: PaceInput): number | null {
  if (!p.visible) return null;
  if (p.flying || p.near || p.tweening) return AWAKE_FRAME_MS;
  if (p.asleep) return null;
  return IDLE_TICK_MS;
}

/** Idle rule: an idle dog with nobody around dozes off after a while. */
export function shouldSleep(idleSeconds: number, near: boolean, state: BotStateName): boolean {
  return !near && state === "idle" && idleSeconds >= SLEEP_AFTER_S;
}

/** What a still, awake dog does next: watch a cursor that is near, else a small fidget now and then. */
export function idleAction(near: boolean, sinceFidgetS: number, gapS: number): "watch" | "fidget" | "rest" {
  if (near) return "watch";
  return sinceFidgetS >= gapS ? "fidget" : "rest";
}

/** Hit test of the body (window-local, logical px). */
export function isOverBody(p: Point, size = PANEL): boolean {
  const dx = p.x - size * BODY.cx;
  const dy = p.y - size * BODY.cy;
  const r = size * BODY.r;
  return dx * dx + dy * dy <= r * r;
}

/** Where the eyes look (−1…1) for a cursor in window-local px; straight ahead without one. */
export function gaze(cursor: Point | null, size = PANEL): { lookX: number; lookY: number } {
  if (!cursor) return { lookX: 0, lookY: 0 };
  return {
    lookX: Math.tanh((cursor.x - size * BODY.cx) / 260),
    lookY: -Math.tanh((cursor.y - size * BODY.cy) / 200),
  };
}

/** A press that moved this far is a drag. */
export function isDrag(from: Point, to: Point): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > DRAG_THRESHOLD;
}
