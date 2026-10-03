// Is Hermes up? Checked only while the chat is on screen, so a hidden island
// costs nothing: every 2 minutes while it answers, and with a growing pause
// (15 s → 5 min) while it doesn't, so a gateway coming back shows up soon
// without hammering one that is off.
//
// No DOM, no Tauri: the probe and the timers are handed in (tested in node).

export type HermesHealth = "unknown" | "online" | "offline" | "nokey";

const ONLINE_EVERY = 120_000;
const OFFLINE_STEPS = [15_000, 30_000, 60_000, 120_000, 300_000];

/** How long to wait before the next check. */
export function nextDelay(health: HermesHealth, failures: number): number {
  if (health === "online") return ONLINE_EVERY;
  // No key: nothing changes until the user saves one ("secrets-changed").
  if (health === "nokey") return OFFLINE_STEPS[OFFLINE_STEPS.length - 1];
  return OFFLINE_STEPS[Math.min(Math.max(failures - 1, 0), OFFLINE_STEPS.length - 1)];
}

export interface WatchDeps {
  probe: () => Promise<HermesHealth>;
  onChange: (health: HermesHealth) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export class HermesWatch {
  health: HermesHealth = "unknown";
  private failures = 0;
  private timer: unknown = null;
  private running = false;
  private inFlight = false;

  constructor(private deps: WatchDeps) {}

  /** The chat came on screen: check now, then on the schedule. */
  start() {
    if (this.running) return;
    this.running = true;
    void this.check();
  }

  /** The chat left the screen: no more checks until it comes back. */
  stop() {
    this.running = false;
    this.clear();
  }

  /** Something changed (a key saved, a send failed): look again now. */
  poke() {
    if (!this.running) return;
    this.clear();
    void this.check();
  }

  private clear() {
    if (this.timer != null) (this.deps.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>);
    this.timer = null;
  }

  private async check() {
    if (this.inFlight) return;
    this.inFlight = true;
    let next: HermesHealth;
    try {
      next = await this.deps.probe();
    } catch {
      next = "offline";
    }
    this.inFlight = false;
    this.failures = next === "online" ? 0 : this.failures + 1;
    if (next !== this.health) {
      this.health = next;
      this.deps.onChange(next);
    }
    if (!this.running) return;
    this.clear();
    this.timer = (this.deps.setTimer ?? setTimeout)(() => {
      this.timer = null;
      void this.check();
    }, nextDelay(next, this.failures));
  }
}
