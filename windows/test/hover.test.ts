import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOVER_DWELL_MS, HOVER_FOLD_MS, HoverOpen } from "../src/island/hover";

describe("HoverOpen", () => {
  let on: boolean;
  let compact: boolean;
  let open: ReturnType<typeof vi.fn>;
  let fold: ReturnType<typeof vi.fn>;
  let hover: HoverOpen;

  beforeEach(() => {
    vi.useFakeTimers();
    on = true;
    compact = true;
    // The island opens only from compact, as IslandStateMachine.click() does.
    open = vi.fn(() => {
      if (!compact) return false;
      compact = false;
      return true;
    });
    fold = vi.fn(() => {
      compact = true;
    });
    hover = new HoverOpen({ enabled: () => on, open, fold });
  });
  afterEach(() => vi.useRealTimers());

  it("opens after the dwell, not before", () => {
    hover.enter();
    vi.advanceTimersByTime(HOVER_DWELL_MS - 1);
    expect(open).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(hover.openedByHover).toBe(true);
  });

  it("is cancelled when the pointer leaves before the dwell", () => {
    hover.enter();
    vi.advanceTimersByTime(HOVER_DWELL_MS / 2);
    hover.leave();
    vi.advanceTimersByTime(HOVER_FOLD_MS * 5);
    expect(open).not.toHaveBeenCalled();
    expect(fold).not.toHaveBeenCalled();
    expect(hover.openedByHover).toBe(false);
  });

  it("folds again after the leave delay", () => {
    hover.enter();
    vi.advanceTimersByTime(HOVER_DWELL_MS);
    hover.leave();
    vi.advanceTimersByTime(HOVER_FOLD_MS - 1);
    expect(fold).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fold).toHaveBeenCalledTimes(1);
    expect(hover.openedByHover).toBe(false);
  });

  it("is still open when the pointer comes back before the fold", () => {
    hover.enter();
    vi.advanceTimersByTime(HOVER_DWELL_MS);
    hover.leave();
    vi.advanceTimersByTime(HOVER_FOLD_MS / 2);
    hover.enter();
    vi.advanceTimersByTime(HOVER_FOLD_MS * 5);
    expect(fold).not.toHaveBeenCalled();
    expect(hover.openedByHover).toBe(true);
  });

  it("stays open after a click inside, even once the pointer leaves", () => {
    hover.enter();
    vi.advanceTimersByTime(HOVER_DWELL_MS);
    hover.clicked();
    hover.leave();
    vi.advanceTimersByTime(HOVER_FOLD_MS * 10);
    expect(fold).not.toHaveBeenCalled();
    expect(hover.openedByHover).toBe(false);
  });

  it("does not take ownership of an island that was already open", () => {
    compact = false; // opened by a click or an alert, not by hover
    hover.enter();
    vi.advanceTimersByTime(HOVER_DWELL_MS);
    expect(open).toHaveBeenCalledTimes(1);
    expect(hover.openedByHover).toBe(false);
    hover.leave();
    vi.advanceTimersByTime(HOVER_FOLD_MS * 5);
    expect(fold).not.toHaveBeenCalled();
  });

  it("never acts when the setting is off", () => {
    on = false;
    hover.enter();
    vi.advanceTimersByTime(HOVER_DWELL_MS * 10);
    hover.leave();
    vi.advanceTimersByTime(HOVER_FOLD_MS * 10);
    expect(open).not.toHaveBeenCalled();
    expect(fold).not.toHaveBeenCalled();
    expect(hover.openedByHover).toBe(false);
  });

  it("cancel() drops a pending dwell and fold", () => {
    hover.enter();
    vi.advanceTimersByTime(HOVER_DWELL_MS);
    hover.leave();
    hover.cancel();
    vi.advanceTimersByTime(HOVER_FOLD_MS * 5);
    expect(fold).not.toHaveBeenCalled();
    expect(hover.openedByHover).toBe(false);
  });
});
