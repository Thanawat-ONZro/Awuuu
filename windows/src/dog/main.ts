// The dog's own window on the desktop (dog.html): draws it in the owner's look
// and outfit, and turns clicks and drags on it into pokes, a trip home and a
// new spot. Where the window is, and when it takes the mouse, is Rust's
// (desktop_dog.rs); what the dog should be doing comes from the island.
//
// Cost: nothing while the window is parked. On the desktop, full frame rate
// only while the cursor is within ~300 px (Rust only reports it then) or
// something moves; a 400 ms idle tick otherwise; nothing once it sleeps.

import { Bridge, emitToWindow, onEvent } from "../core/bridge";
import type { BotStateName } from "../core/layout";
import { Sound } from "../core/sound";
import type { Settings } from "../core/state";
import { setOwnerLook } from "../mochi/dog";
import { BotEngine } from "../mochi/engine";
import { normalizeLook } from "../mochi/looks";
import { setOutfitSelection } from "../mochi/outfits";
import {
  DOUBLE_CLICK_MS, PANEL, frameDelay, gaze, idleAction, isDrag, isOverBody, shouldSleep, type Point,
} from "../mochi/desktop-logic";

const ISLAND = "island";
/** The dog is drawn this wide; the rest of the window is room for ears, tail and hearts. */
const DRAW_W = 80;
const OVERHANG = PANEL - DRAW_W;
const SIDE = (PANEL - DRAW_W) / 2;
/** How long a poke, fidget or wake-up keeps the frame rate up. */
const TWEEN_MS = 1200;

class DesktopDogView {
  private engine = new BotEngine();
  private canvas: HTMLCanvasElement;

  private visible = false;
  private flying = false;
  private near = false;
  private asleep = false;
  private cursor: Point | null = null;
  /** What the island says the dog is doing. */
  private state: BotStateName = "idle";
  private lastActivity = performance.now();
  private tweenUntil = 0;
  private lastFidget = performance.now();
  private fidgetGap = 6;

  private timer: number | null = null;
  private lastDraw = performance.now();

  private press: Point | null = null;
  private dragging = false;
  private pokeTimer: number | null = null;
  private dizzyTimer: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const dpr = this.dpr();
    canvas.width = Math.round(PANEL * dpr);
    canvas.height = Math.round(PANEL * dpr);
    this.engine.particleOverhang = OVERHANG;
    this.engine.setState("idle", true);
    this.engine.onDizzy = () => {
      this.engine.setState("dizzy");
      if (this.dizzyTimer != null) window.clearTimeout(this.dizzyTimer);
      this.dizzyTimer = window.setTimeout(() => {
        this.dizzyTimer = null;
        this.engine.setState(this.state);
        this.engine.triggerEmote("happy");
        this.animate();
      }, 3300);
    };
    this.wireInput();
  }

  async start() {
    const boot = await Bridge.boot();
    if (boot) this.applySettings(boot.settings);
    await onEvent<Settings>("settings-changed", (s) => this.applySettings(s));
    await onEvent<{ visible: boolean; flying: boolean }>("dog-visible", (v) => this.setVisible(v.visible, v.flying));
    await onEvent<{ x: number; y: number; near: boolean }>("dog-cursor", (c) => this.onCursor(c));
    await onEvent<{ state: BotStateName }>("dog-state", (s) => this.onState(s.state));
    await emitToWindow(ISLAND, "dog-ready");
  }

  private applySettings(s: Settings) {
    const look = normalizeLook(s.dog);
    setOwnerLook(look);
    this.engine.setLook(look, false);
    setOutfitSelection(s.outfit);
    Sound.setEnabled(s.soundEnabled);
    Sound.setVolume(s.soundVolume);
    this.schedule();
  }

  // ── State ───────────────────────────────────────────────────────────────────

  private setVisible(on: boolean, flying: boolean) {
    this.visible = on;
    this.flying = on && flying;
    if (on) {
      this.lastActivity = performance.now();
      this.wake();
      this.animate();
      return;
    }
    this.near = false;
    this.cursor = null;
    this.press = null;
    this.dragging = false;
    this.cancelPoke();
    this.stop();
  }

  private onCursor(c: { x: number; y: number; near: boolean }) {
    this.near = c.near;
    this.cursor = c.near ? { x: c.x, y: c.y } : null;
    if (c.near) {
      this.lastActivity = performance.now();
      this.wake();
    }
    this.schedule();
  }

  private onState(state: BotStateName) {
    this.state = state;
    if (state !== "idle") this.lastActivity = performance.now();
    if (state !== "idle") this.wake();
    if (!this.asleep && this.dizzyTimer == null) this.engine.setState(state);
    this.animate();
  }

  private wake() {
    if (!this.asleep) return;
    this.asleep = false;
    this.engine.setState(this.state);
    this.animate();
  }

  /** A short burst of full-rate frames (a poke, a fidget, waking up). */
  private animate() {
    this.tweenUntil = performance.now() + TWEEN_MS;
    this.schedule();
  }

  // ── Frames ──────────────────────────────────────────────────────────────────

  private stop() {
    if (this.timer != null) window.clearTimeout(this.timer);
    this.timer = null;
    Sound.idle();
  }

  private schedule() {
    if (this.timer != null) return;
    const delay = frameDelay({
      visible: this.visible,
      near: this.near,
      flying: this.flying || this.dragging,
      tweening: performance.now() < this.tweenUntil,
      asleep: this.asleep,
    });
    if (delay == null) {
      Sound.idle();
      return;
    }
    const due = Math.max(0, this.lastDraw + delay - performance.now());
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.frame(performance.now());
    }, due);
  }

  private frame(now: number) {
    if (!this.visible) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastDraw) / 1000));
    this.lastDraw = now;
    this.idleRules(now);
    this.draw(dt);
    this.schedule();
  }

  /** Falls asleep when nothing goes on, fidgets now and then while awake. */
  private idleRules(now: number) {
    if (this.asleep || this.flying || this.dragging) return;
    if (shouldSleep((now - this.lastActivity) / 1000, this.near, this.state)) {
      this.asleep = true;
      this.engine.setState("sleeping");
      this.animate(); // let the eyes close before the frames stop
      return;
    }
    if (idleAction(this.near, (now - this.lastFidget) / 1000, this.fidgetGap) === "fidget") {
      this.lastFidget = now;
      this.fidgetGap = 5 + Math.random() * 5;
      if (this.engine.fidget()) this.animate();
    }
  }

  private draw(dt: number) {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const g = gaze(this.asleep ? null : this.cursor);
    this.engine.lookX = g.lookX;
    this.engine.lookY = g.lookY;
    this.engine.update(dt);
    const dpr = this.dpr();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PANEL, PANEL);
    ctx.translate(SIDE, 0);
    this.engine.draw(ctx, DRAW_W, PANEL);
  }

  private dpr(): number {
    return Math.min(2, window.devicePixelRatio || 1);
  }

  // ── Input ───────────────────────────────────────────────────────────────────
  // The window only takes the mouse over the body (Rust's click-through), so
  // anything that arrives here is on the dog; the checks are a second guard.

  private wireInput() {
    document.addEventListener("pointerdown", (e) => {
      const p = { x: e.clientX, y: e.clientY };
      if (e.button !== 0 || !isOverBody(p)) return;
      Sound.resume();
      this.press = p;
      this.dragging = false;
    });

    document.addEventListener("pointermove", (e) => {
      const press = this.press;
      if (!press || this.dragging) return;
      if (!isDrag(press, { x: e.clientX, y: e.clientY })) return;
      this.dragging = true;
      this.cancelPoke();
      this.schedule();
      // From here Rust carries the window with the cursor and drops it on release.
      void Bridge.dogDragBegin().then((ok) => {
        if (!ok) this.dragging = false;
      });
    });

    document.addEventListener("pointerup", () => {
      const press = this.press;
      this.press = null;
      if (!press) return;
      if (this.dragging) {
        this.dragging = false;
        return;
      }
      // A click pokes, once it is clear it isn't the first half of a double click.
      this.cancelPoke();
      this.pokeTimer = window.setTimeout(() => {
        this.pokeTimer = null;
        this.lastActivity = performance.now();
        this.wake();
        void Sound.preload();
        this.engine.slap();
        this.animate();
      }, DOUBLE_CLICK_MS);
    });

    document.addEventListener("dblclick", (e) => {
      if (!isOverBody({ x: e.clientX, y: e.clientY })) return;
      this.cancelPoke();
      void emitToWindow(ISLAND, "dog-home");
    });

    // No browser menu on the dog.
    document.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private cancelPoke() {
    if (this.pokeTimer != null) window.clearTimeout(this.pokeTimer);
    this.pokeTimer = null;
  }
}

const canvas = document.getElementById("dog");
if (canvas instanceof HTMLCanvasElement) void new DesktopDogView(canvas).start();
