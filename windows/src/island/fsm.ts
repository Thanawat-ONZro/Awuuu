// Island open/close FSM — port of IslandStateMachine.swift.
// No DOM, no Tauri: it only reports transitions.

export type FsmState = "hidden" | "petit" | "home" | "coucou";

export class IslandStateMachine {
  state: FsmState = "hidden";

  onTransition: ((from: FsmState, to: FsmState) => void) | null = null;

  /** home → petit delay, seconds. */
  homeToPetitDelay = 15;
  /** petit → hidden delay for edge hover leave, seconds. */
  hoverLeaveDelay = 1.0;
  /** Toast display duration, seconds; 0 = never auto-hide. */
  toastDelay = 5;
  /** petit → hidden delay, seconds; 0 = the compact island never hides. */
  petitToHiddenDelay = 5;
  /** While this says true (e.g. pinned approval), the hide timer will not hide. */
  keepVisible: (() => boolean) | null = null;
  /** coucou → petit once the greeting animation ends (no hover). */
  greetAutoCollapseDelay = 0.6;
  /** coucou → petit while the mouse hovers the greeting. */
  greetHoverCollapseDelay = 10;
  /** An alert waiting for an answer stays open, even when the mouse leaves. */
  pinned = false;

  private petitHide: number | null = null;
  private toastHide: number | null = null;
  private homeCollapse: number | null = null;
  private greetCollapse: number | null = null;

  // ── Inputs ──────────────────────────────────────────────────────────────────

  launch() {
    this.cancelTimers();
    this.transition("coucou");
  }

  mouseEntered() {
    switch (this.state) {
      case "hidden":
        this.cancelTimers();
        this.transition("petit");
        break;
      case "petit":
        this.clear("petitHide");
        this.clear("toastHide");
        break;
      case "home":
        this.clear("homeCollapse");
        break;
      case "coucou":
        this.scheduleGreetCollapse(this.greetHoverCollapseDelay);
        break;
    }
  }

  mouseLeft() {
    switch (this.state) {
      case "hidden":
        break;
      case "petit":
        if (!this.pinned) {
          this.schedulePetitHide(this.hoverLeaveDelay);
        }
        break;
      case "home":
        this.scheduleHomeCollapse();
        break;
      case "coucou":
        this.clear("greetCollapse");
        this.transition("petit");
        break;
    }
  }

  click() {
    if (this.state !== "petit") return;
    this.cancelTimers();
    this.transition("home");
  }

  /** Greeting animation finished (T.end). Doesn't override a running hover timer. */
  greetComplete() {
    if (this.state !== "coucou") return;
    if (this.greetCollapse == null) this.scheduleGreetCollapse(this.greetAutoCollapseDelay);
  }

  /** Toast event (finished, integration update): show compact from hidden and auto-hide after duration. */
  revealToast(durationSec = this.toastDelay) {
    if (this.state === "home" || this.state === "coucou") return;
    this.clear("petitHide");
    this.clear("toastHide");
    if (this.state === "hidden") {
      this.transition("petit");
    }
    if (!this.pinned && durationSec > 0) {
      this.toastHide = window.setTimeout(() => {
        this.toastHide = null;
        if (this.state !== "petit") return;
        if (this.pinned || this.keepVisible?.()) return;
        this.transition("hidden");
      }, durationSec * 1000);
    }
  }

  /** Pinned alert (approval or choice question): show compact and never auto-hide. */
  revealPinned() {
    this.pinned = true;
    this.cancelTimers();
    if (this.state === "hidden") {
      this.transition("petit");
    }
  }

  /** Non-alert work event: show compact from hidden. */
  reveal() {
    if (this.state !== "hidden") return;
    this.cancelTimers();
    this.transition("petit");
    this.schedulePetitHide();
  }

  /** Alert or explicit request: open straight to expanded. */
  forceHome() {
    this.cancelTimers();
    this.transition("home");
  }

  /// Explicit close (OK button, Escape, an alert being answered).
  forcePetit() {
    this.cancelTimers();
    this.transition("petit");
  }

  forceHidden() {
    this.cancelTimers();
    this.transition("hidden");
  }

  dropPin() {
    this.pinned = false;
    this.clear("toastHide");
    if (this.state === "petit") {
      this.schedulePetitHide(this.hoverLeaveDelay);
    }
  }

  // ── Timers ──────────────────────────────────────────────────────────────────

  private schedulePetitHide(delay = this.petitToHiddenDelay) {
    this.clear("petitHide");
    if (this.pinned) return;
    if (delay <= 0) return;
    this.petitHide = window.setTimeout(() => {
      this.petitHide = null;
      if (this.state !== "petit") return;
      if (this.pinned || this.keepVisible?.()) {
        this.schedulePetitHide(delay);
      } else {
        this.transition("hidden");
      }
    }, delay * 1000);
  }

  private scheduleHomeCollapse() {
    this.clear("homeCollapse");
    if (this.pinned) return;
    this.homeCollapse = window.setTimeout(() => {
      this.homeCollapse = null;
      if (this.state === "home") this.transition("petit");
    }, this.homeToPetitDelay * 1000);
  }

  private scheduleGreetCollapse(delay: number) {
    this.clear("greetCollapse");
    this.greetCollapse = window.setTimeout(() => {
      this.greetCollapse = null;
      if (this.state === "coucou") this.transition("petit");
    }, delay * 1000);
  }

  private clear(which: "petitHide" | "toastHide" | "homeCollapse" | "greetCollapse") {
    const id = this[which];
    if (id != null) window.clearTimeout(id);
    this[which] = null;
  }

  cancelTimers() {
    this.clear("petitHide");
    this.clear("toastHide");
    this.clear("homeCollapse");
    this.clear("greetCollapse");
  }

  private transition(next: FsmState) {
    if (next === this.state) return;
    const from = this.state;
    this.state = next;
    this.onTransition?.(from, next);
  }
}
