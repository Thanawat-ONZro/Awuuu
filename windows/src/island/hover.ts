// Open on hover — the timing only. Resting the pointer on the compact island
// opens it after a short dwell; when the pointer leaves an island opened this
// way, it folds again after a grace period, unless the user clicked inside it
// (then it is an ordinary open island). No DOM, no Tauri: the island feeds
// pointer events in and gets open / fold calls out. Ported from Coucou's
// IslandHoverTests (MIT).

export const HOVER_DWELL_MS = 350;
export const HOVER_FOLD_MS = 1200;

/** Timers are injected so the timing can be tested without a DOM. */
export interface HoverTimers {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

const defaultTimers: HoverTimers = {
  set: (fn, ms) => globalThis.setTimeout(fn, ms),
  clear: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

export interface HoverOptions {
  /** Read on every event, so a settings change applies at once. */
  enabled: () => boolean;
  /** Open the compact island. Returns true only if this call opened it from compact. */
  open: () => boolean;
  /** Fold the island back to compact (the island checks for holds itself). */
  fold: () => void;
  dwellMs?: number;
  foldMs?: number;
  timers?: HoverTimers;
}

export class HoverOpen {
  private dwell: unknown = null;
  private fold: unknown = null;
  private owns = false;
  private readonly dwellMs: number;
  private readonly foldMs: number;
  private readonly timers: HoverTimers;

  constructor(private readonly o: HoverOptions) {
    this.dwellMs = o.dwellMs ?? HOVER_DWELL_MS;
    this.foldMs = o.foldMs ?? HOVER_FOLD_MS;
    this.timers = o.timers ?? defaultTimers;
  }

  /** The island is open because of a hover, and the user has not clicked inside it. */
  get openedByHover(): boolean {
    return this.owns;
  }

  /** The pointer came onto the island. Starts the dwell when compact. */
  enter(): void {
    if (!this.o.enabled()) return;
    this.cancelFold();
    if (this.owns || this.dwell != null) return;
    this.dwell = this.timers.set(() => {
      this.dwell = null;
      if (this.o.open()) this.owns = true;
    }, this.dwellMs);
  }

  /** The pointer left the island. Cancels a pending dwell; folds a hover-opened island later. */
  leave(): void {
    this.cancelDwell();
    if (!this.owns || this.fold != null) return;
    this.fold = this.timers.set(() => {
      this.fold = null;
      this.owns = false;
      this.o.fold();
    }, this.foldMs);
  }

  /** The user clicked inside the island: a hover-opened island now stays open like a click-open one. */
  clicked(): void {
    this.cancelDwell();
    this.cancelFold();
    this.owns = false;
  }

  /** Drop every pending timer (island torn down or state changed under us). */
  cancel(): void {
    this.cancelDwell();
    this.cancelFold();
    this.owns = false;
  }

  private cancelDwell(): void {
    if (this.dwell != null) this.timers.clear(this.dwell);
    this.dwell = null;
  }

  private cancelFold(): void {
    if (this.fold != null) this.timers.clear(this.fold);
    this.fold = null;
  }
}
