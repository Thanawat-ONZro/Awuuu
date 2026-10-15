// The dog on the desktop, island side: runs its life cycle (the pure rule in
// mochi/desktop-logic.ts) against the real app, flies it (a position tween
// through Rust), tells its window how the dog is doing, and starts the drag
// out of the island. The window itself: src-tauri/src/desktop_dog.rs, drawn
// by src/dog/main.ts. Design: docs/DESKTOP-DOG.md.

import { Bridge, emitToWindow, onEvent } from "../core/bridge";
import { State } from "../core/state";
import {
  DOG_WINDOW, FINISHED_VISIT_MS, FLIGHT_MS, alertActive, decide, easeInOutCubic, flightPoint, forgetsDesktop,
  type LifeInput, type Phase, type Point,
} from "../mochi/desktop-logic";

const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

/** Moves the window from `from` to `to` (physical px) over `ms`, one step per tick. */
function tween(from: Point, to: Point, ms: number): Promise<void> {
  const start = performance.now();
  return new Promise((done) => {
    const step = () => {
      const t = ms <= 0 ? 1 : Math.min(1, (performance.now() - start) / ms);
      const p = flightPoint(from, to, easeInOutCubic(t));
      void Bridge.dogSetPosition(Math.round(p.x), Math.round(p.y));
      // A timer, not requestAnimationFrame: the island page may be idle.
      if (t < 1) window.setTimeout(step, 16);
      else done();
    };
    step();
  });
}

export class DesktopDogLink {
  phase: Phase = "home";
  /** The user wants it on the desktop. */
  private wantOut = false;
  /** The greeting is over: from now on the rule may move it. */
  private launched = false;
  private wasEnabled = false;
  private finishedUntil = 0;
  private pushed = "";
  private onChange: () => void;

  constructor(onChange: () => void) {
    this.onChange = onChange;
    this.wasEnabled = this.enabled;
  }

  get enabled(): boolean {
    return State.settings.desktopDog?.enabled === true;
  }

  /** Out on the desktop (or on its way, or in the user's hand): the island's own dog hides. */
  get away(): boolean {
    return this.phase !== "home";
  }

  async init() {
    await onEvent<{ from: "island" | "desktop"; home: boolean }>("dog-dropped", (e) => this.onDropped(e.home));
    // Double click on the dog.
    await onEvent<null>("dog-home", () => {
      this.wantOut = false;
      this.sync();
    });
    // The dog's page (re)loaded: tell it again how the dog is.
    await onEvent<null>("dog-ready", () => {
      this.pushed = "";
      this.push();
    });
    State.subscribe(() => this.sync());
  }

  /** The launch greeting is over: back to the desktop if that is where it lived. */
  launch() {
    if (this.launched) return;
    this.launched = true;
    this.wantOut = this.enabled && State.settings.desktopDog?.onDesktop === true;
    this.sync();
  }

  /** Settings changed: switched on → out it goes; off → home, for good. */
  settingsChanged() {
    const on = this.enabled;
    if (on !== this.wasEnabled) {
      this.wasEnabled = on;
      this.wantOut = on;
      if (!on && this.phase === "home") void Bridge.dogForget();
    }
    this.sync();
  }

  /** Ctrl+Alt+D: out to its spot, or home. */
  toggle() {
    if (!this.enabled || this.phase === "carried") return;
    // Wanted out (even if home for an alert right now) → home for good;
    // home → out to its spot.
    this.wantOut = !this.wantOut;
    this.sync();
  }

  /** A task finished: a short visit home. */
  noteFinished() {
    if (this.phase === "home" && !this.wantOut) return;
    this.finishedUntil = performance.now() + FINISHED_VISIT_MS;
    this.sync();
    window.setTimeout(() => this.sync(), FINISHED_VISIT_MS + 50);
  }

  /** The press on the island's dog became a drag. */
  canPickUp(): boolean {
    return this.enabled && this.launched && this.phase === "home" && !State.paused;
  }

  pickUp() {
    if (!this.canPickUp()) return;
    this.setPhase("carried");
    void Bridge.dogPickUp().then((ok) => {
      if (!ok && this.phase === "carried") this.setPhase("home");
    });
  }

  private get alert(): boolean {
    return alertActive({
      approval: State.pendingApproval != null,
      mode: State.mode,
      view: State.view,
      now: performance.now(),
      finishedUntil: this.finishedUntil,
    });
  }

  private input(): LifeInput {
    return { phase: this.phase, enabled: this.enabled, wantOut: this.wantOut, alert: this.alert };
  }

  private onDropped(home: boolean) {
    this.wantOut = !home;
    this.setPhase(home ? "home" : "out");
    this.sync();
  }

  private setPhase(p: Phase) {
    if (p === this.phase) return;
    this.phase = p;
    this.onChange();
  }

  sync() {
    this.push();
    if (!this.launched) return;
    const input = this.input();
    const move = decide(input);
    if (move === "flyOut") void this.fly("out", false);
    else if (move === "flyHome") void this.fly("home", forgetsDesktop(input));
  }

  private async fly(kind: "out" | "home", forget: boolean) {
    const before = this.phase;
    this.setPhase("flying");
    const plan = await Bridge.dogFlightBegin(kind);
    if (!plan) {
      // Nothing to fly. Out: no monitor or no window — it stays home rather
      // than trying again on every state change. Home: no window was out.
      if (kind === "out") this.wantOut = false;
      this.setPhase("home");
      if (kind === "home" && forget) void Bridge.dogForget();
      void Bridge.log(`desktop dog: no ${kind} flight (was ${before})`);
      return;
    }
    await tween(plan.from, plan.to, REDUCED_MOTION.matches ? 0 : FLIGHT_MS);
    await Bridge.dogFlightEnd(kind, forget);
    this.setPhase(kind === "out" ? "out" : "home");
    // The world may have changed during the flight.
    this.sync();
  }

  /** How the dog is doing, for its window. */
  private push() {
    const state = State.effectiveState;
    const key = state;
    if (key === this.pushed) return;
    this.pushed = key;
    void emitToWindow(DOG_WINDOW, "dog-state", { state });
  }
}
