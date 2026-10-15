import { describe, expect, it } from "vitest";
import {
  AWAKE_FRAME_MS, BODY, FLIGHT_MS, IDLE_TICK_MS, PANEL, SLEEP_AFTER_S, alertActive, arcLift, decide,
  easeInOutCubic, flightPath, flightPoint, forgetsDesktop, frameDelay, gaze, idleAction, isDrag, isOverBody,
  shouldSleep, type LifeInput, type PaceInput,
} from "../src/mochi/desktop-logic";

const life = (o: Partial<LifeInput>): LifeInput => ({ phase: "home", enabled: true, wantOut: true, alert: false, ...o });

describe("desktop dog life cycle", () => {
  it("flies out only when enabled, wanted and nothing calls it home", () => {
    expect(decide(life({}))).toBe("flyOut");
    expect(decide(life({ enabled: false }))).toBe("none");
    expect(decide(life({ wantOut: false }))).toBe("none");
    expect(decide(life({ alert: true }))).toBe("none");
  });

  it("comes home for an alert and goes back out once it is handled", () => {
    expect(decide(life({ phase: "out", alert: true }))).toBe("flyHome");
    // Home for the alert: stays while it is up…
    expect(decide(life({ phase: "home", alert: true }))).toBe("none");
    // …and returns when it is answered.
    expect(decide(life({ phase: "home", alert: false }))).toBe("flyOut");
  });

  it("an alert visit does not forget the desktop; the user sending it home does", () => {
    expect(forgetsDesktop(life({ phase: "out", alert: true }))).toBe(false);
    expect(forgetsDesktop(life({ phase: "out", wantOut: false }))).toBe(true);
    expect(forgetsDesktop(life({ phase: "out", enabled: false }))).toBe(true);
  });

  it("switching the feature off brings it home", () => {
    expect(decide(life({ phase: "out", enabled: false }))).toBe("flyHome");
  });

  it("never interrupts a flight or a drag", () => {
    for (const phase of ["flying", "carried"] as const) {
      expect(decide(life({ phase, alert: true }))).toBe("none");
      expect(decide(life({ phase, enabled: false }))).toBe("none");
    }
  });

  it("stays put when it already is where it belongs", () => {
    expect(decide(life({ phase: "out" }))).toBe("none");
    expect(decide(life({ phase: "home", wantOut: false }))).toBe("none");
  });
});

describe("alerts that call the dog home", () => {
  const base = { approval: false, mode: "compact" as const, view: "overview" as const, now: 1000, finishedUntil: 0 };
  it("a waiting approval, even with the island closed", () => {
    expect(alertActive({ ...base, approval: true, mode: "hidden" })).toBe(true);
  });
  it("the open error, finished or approval card", () => {
    for (const view of ["error", "finished", "approval"] as const) {
      expect(alertActive({ ...base, mode: "expanded", view })).toBe(true);
      expect(alertActive({ ...base, mode: "compact", view })).toBe(false);
    }
    expect(alertActive({ ...base, mode: "expanded", view: "agents" })).toBe(false);
  });
  it("a finished task for a short visit", () => {
    expect(alertActive({ ...base, finishedUntil: 1500 })).toBe(true);
    expect(alertActive({ ...base, now: 1500, finishedUntil: 1500 })).toBe(false);
  });
});

describe("flights", () => {
  const from = { x: 900, y: -53 };
  const to = { x: 1788, y: 900 };

  it("ease starts at 0, ends at 1, is monotonic and clamps", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const v = easeInOutCubic(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("starts and ends exactly where asked", () => {
    expect(flightPoint(from, to, 0)).toEqual(from);
    expect(flightPoint(from, to, 1)).toEqual(to);
    const path = flightPath(from, to);
    expect(path).toHaveLength(Math.round(FLIGHT_MS / 16));
    expect(path[path.length - 1]).toEqual(to);
  });

  it("hops: the middle of the flight is above the straight line, by a bounded amount", () => {
    const mid = flightPoint(from, to, 0.5);
    expect(mid.y).toBeLessThan((from.y + to.y) / 2);
    expect(arcLift(from, to)).toBeLessThanOrEqual(160);
    expect(arcLift(from, from)).toBe(0);
    // A flight to where it already is stays put.
    for (const p of flightPath(from, from)) {
      expect(p.x).toBeCloseTo(from.x, 9);
      expect(p.y).toBeCloseTo(from.y, 9);
    }
  });

  it("x moves monotonically toward the target", () => {
    const path = flightPath(from, to);
    for (let i = 1; i < path.length; i++) expect(path[i].x).toBeGreaterThanOrEqual(path[i - 1].x);
  });
});

describe("frame pacing of the dog's window", () => {
  const pace = (o: Partial<PaceInput>): PaceInput => ({
    visible: true, near: false, flying: false, tweening: false, asleep: false, ...o,
  });
  it("draws nothing while parked, whatever else is true", () => {
    expect(frameDelay(pace({ visible: false, near: true, flying: true, tweening: true }))).toBeNull();
  });
  it("full rate only while watched, flying or animating", () => {
    expect(frameDelay(pace({ near: true }))).toBe(AWAKE_FRAME_MS);
    expect(frameDelay(pace({ flying: true }))).toBe(AWAKE_FRAME_MS);
    expect(frameDelay(pace({ tweening: true, asleep: true }))).toBe(AWAKE_FRAME_MS);
  });
  it("a slow idle tick otherwise, and nothing at all asleep", () => {
    expect(frameDelay(pace({}))).toBe(IDLE_TICK_MS);
    expect(IDLE_TICK_MS).toBeGreaterThanOrEqual(250);
    expect(frameDelay(pace({ asleep: true }))).toBeNull();
  });
});

describe("idle rules", () => {
  it("dozes off only when idle, alone, and long enough", () => {
    expect(shouldSleep(SLEEP_AFTER_S, false, "idle")).toBe(true);
    expect(shouldSleep(SLEEP_AFTER_S - 1, false, "idle")).toBe(false);
    expect(shouldSleep(SLEEP_AFTER_S * 3, true, "idle")).toBe(false);
    expect(shouldSleep(SLEEP_AFTER_S * 3, false, "working")).toBe(false);
  });
  it("watches a near cursor, fidgets now and then otherwise", () => {
    expect(idleAction(true, 99, 5)).toBe("watch");
    expect(idleAction(false, 6, 5)).toBe("fidget");
    expect(idleAction(false, 2, 5)).toBe("rest");
  });
});

describe("hit test, gaze, drag", () => {
  it("only the body takes the mouse", () => {
    const c = { x: PANEL * BODY.cx, y: PANEL * BODY.cy };
    const r = PANEL * BODY.r;
    expect(isOverBody(c)).toBe(true);
    expect(isOverBody({ x: c.x + r - 0.5, y: c.y })).toBe(true);
    expect(isOverBody({ x: c.x + r + 0.5, y: c.y })).toBe(false);
    expect(isOverBody({ x: 0, y: 0 })).toBe(false);
  });
  it("looks toward the cursor, straight ahead without one", () => {
    expect(gaze(null)).toEqual({ lookX: 0, lookY: 0 });
    const right = gaze({ x: 600, y: PANEL * BODY.cy });
    expect(right.lookX).toBeGreaterThan(0.9);
    expect(Math.abs(right.lookY)).toBeLessThan(1e-9);
    const above = gaze({ x: PANEL * BODY.cx, y: -400 });
    expect(above.lookY).toBeGreaterThan(0.9);
    expect(Math.abs(gaze({ x: -1e6, y: 1e6 }).lookX)).toBeLessThanOrEqual(1);
  });
  it("a small wobble is still a click", () => {
    expect(isDrag({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(false);
    expect(isDrag({ x: 0, y: 0 }, { x: 9, y: 0 })).toBe(true);
  });
});
