import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HermesWatch, nextDelay, type HermesHealth } from "../src/island/hermes-watch";

describe("nextDelay", () => {
  it("checks a live Hermes every 2 minutes", () => {
    expect(nextDelay("online", 0)).toBe(120_000);
  });
  it("backs off while Hermes is down, up to 5 minutes", () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => nextDelay("offline", n))).toEqual([15_000, 30_000, 60_000, 120_000, 300_000, 300_000]);
  });
});

describe("HermesWatch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(results: HermesHealth[]) {
    const seen: HermesHealth[] = [];
    let calls = 0;
    const watch = new HermesWatch({
      probe: async () => results[Math.min(calls++, results.length - 1)],
      onChange: (h) => seen.push(h),
    });
    return { watch, seen, calls: () => calls };
  }

  it("reports changes only, and recovers on its own", async () => {
    const { watch, seen } = setup(["offline", "offline", "online"]);
    watch.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(seen).toEqual(["offline", "online"]);
    watch.stop();
  });

  it("does nothing while stopped (hidden island)", async () => {
    const { watch, calls } = setup(["online"]);
    watch.start();
    await vi.advanceTimersByTimeAsync(0);
    watch.stop();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(calls()).toBe(1);
  });

  it("checks again at once when poked", async () => {
    const { watch, calls } = setup(["online"]);
    watch.start();
    await vi.advanceTimersByTimeAsync(0);
    watch.poke();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(2);
    watch.stop();
  });

  it("treats a probe that throws as offline", async () => {
    const seen: HermesHealth[] = [];
    const watch = new HermesWatch({ probe: () => Promise.reject(new Error("boom")), onChange: (h) => seen.push(h) });
    watch.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual(["offline"]);
    watch.stop();
  });
});
