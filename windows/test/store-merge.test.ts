import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounceMs, mergeById } from "../src/core/store";

interface TestItem {
  id: string;
  text: string;
  done?: boolean;
  deleted?: boolean;
}

describe("mergeById", () => {
  it("preserves current order and appends new incoming items", () => {
    const current: TestItem[] = [
      { id: "2", text: "Two", done: false },
      { id: "1", text: "One", done: true },
    ];
    const incoming: TestItem[] = [
      { id: "1", text: "One updated", done: true },
      { id: "2", text: "Two updated", done: false },
      { id: "3", text: "Three", done: false },
    ];

    const result = mergeById(current, incoming);

    expect(result).toEqual([
      { id: "2", text: "Two", done: false },
      { id: "1", text: "One", done: true },
      { id: "3", text: "Three", done: false },
    ]);
  });

  it("prevents a stale write from resurrecting a deleted id", () => {
    const current: TestItem[] = [
      { id: "2", text: "Two", done: false },
    ];
    // incoming still has id "1" which was deleted locally
    const incoming: TestItem[] = [
      { id: "1", text: "One (stale/deleted)", done: true },
      { id: "2", text: "Two", done: false },
      { id: "3", text: "Three", done: false },
    ];
    const deletedIds = new Set(["1"]);

    const result = mergeById(current, incoming, deletedIds);

    expect(result).toEqual([
      { id: "2", text: "Two", done: false },
      { id: "3", text: "Three", done: false },
    ]);
  });

  it("filters out items explicitly flagged as deleted in current or incoming", () => {
    const current: TestItem[] = [
      { id: "1", text: "Deleted item", deleted: true },
      { id: "2", text: "Keep item", done: false },
    ];
    const incoming: TestItem[] = [
      { id: "1", text: "Deleted item in incoming", done: false },
      { id: "3", text: "Another deleted in incoming", deleted: true },
      { id: "4", text: "Fresh item", done: true },
    ];

    const result = mergeById(current, incoming);

    expect(result).toEqual([
      { id: "2", text: "Keep item", done: false },
      { id: "4", text: "Fresh item", done: true },
    ]);
  });

  it("merges properties when current item has partial overrides", () => {
    const current: TestItem[] = [
      { id: "1", text: "Local edit" },
    ];
    const incoming: TestItem[] = [
      { id: "1", text: "Remote text", done: true },
    ];

    const result = mergeById(current, incoming);

    expect(result).toEqual([
      { id: "1", text: "Local edit", done: true },
    ]);
  });
});

describe("debounceMs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces rapid calls to the final call after delay", () => {
    const spy = vi.fn();
    const debounced = debounceMs(spy, 300);

    debounced("call-1");
    debounced("call-2");
    debounced("call-3");

    expect(spy).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(299);
    expect(spy).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("call-3");
  });

  it("can cancel pending debounced call", () => {
    const spy = vi.fn();
    const debounced = debounceMs(spy, 300);

    debounced("save-data");
    vi.advanceTimersByTime(100);
    debounced.cancel();
    vi.advanceTimersByTime(300);

    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("can flush pending debounced call immediately", () => {
    const spy = vi.fn();
    const debounced = debounceMs(spy, 300);

    debounced("immediate-save");
    expect(spy).toHaveBeenCalledTimes(0);

    debounced.flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("immediate-save");

    vi.advanceTimersByTime(400);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
