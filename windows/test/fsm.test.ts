import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IslandStateMachine } from "../src/island/fsm";

// The FSM schedules with window.setTimeout; in node, window is the global.
(globalThis as { window?: unknown }).window ??= globalThis;

describe("IslandStateMachine", () => {
  let fsm: IslandStateMachine;
  beforeEach(() => {
    vi.useFakeTimers();
    fsm = new IslandStateMachine();
  });
  afterEach(() => vi.useRealTimers());

  it("greets on launch, then folds to compact", () => {
    fsm.launch();
    expect(fsm.state).toBe("coucou");
    fsm.greetComplete();
    vi.advanceTimersByTime(fsm.greetAutoCollapseDelay * 1000);
    expect(fsm.state).toBe("petit");
  });

  it("hides the compact island after the mouse leaves", () => {
    fsm.mouseEntered();
    expect(fsm.state).toBe("petit");
    fsm.mouseLeft();
    vi.advanceTimersByTime(fsm.hoverLeaveDelay * 1000);
    expect(fsm.state).toBe("hidden");
  });

  it("keeps a pinned alert open until the pin drops", () => {
    fsm.revealPinned();
    fsm.mouseLeft();
    vi.advanceTimersByTime(60_000);
    expect(fsm.state).toBe("petit");
    fsm.dropPin();
    vi.advanceTimersByTime(fsm.hoverLeaveDelay * 1000);
    expect(fsm.state).toBe("hidden");
  });

  it("auto-hides a toast unless something holds it open", () => {
    let hold = true;
    fsm.keepVisible = () => hold;
    fsm.revealToast(2);
    vi.advanceTimersByTime(2000);
    expect(fsm.state).toBe("petit");
    hold = false;
    fsm.revealToast(2);
    vi.advanceTimersByTime(2000);
    expect(fsm.state).toBe("hidden");
  });

  it("collapses home to compact after the delay", () => {
    fsm.forceHome();
    fsm.mouseLeft();
    vi.advanceTimersByTime(fsm.homeToPetitDelay * 1000);
    expect(fsm.state).toBe("petit");
  });

  it("reports every transition", () => {
    const seen: string[] = [];
    fsm.onTransition = (from, to) => seen.push(`${from}>${to}`);
    fsm.forceHome();
    fsm.forcePetit();
    fsm.forceHidden();
    expect(seen).toEqual(["hidden>home", "home>petit", "petit>hidden"]);
  });
});
