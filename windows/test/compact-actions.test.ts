import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCompactMediaButtonPress } from "../src/island/compact-actions";

class FakeElement {
  constructor(private readonly button: boolean) {}
  closest(selector: string) {
    return this.button && selector === ".compact-media-btn" ? this : null;
  }
}

describe("compact media quick actions", () => {
  beforeEach(() => vi.stubGlobal("Element", FakeElement));
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the compact island open for a button or its icon", () => {
    expect(isCompactMediaButtonPress("compact", new FakeElement(true) as unknown as EventTarget)).toBe(true);
  });

  it("allows ordinary compact presses to open Music", () => {
    expect(isCompactMediaButtonPress("compact", new FakeElement(false) as unknown as EventTarget)).toBe(false);
    expect(isCompactMediaButtonPress("expanded", new FakeElement(true) as unknown as EventTarget)).toBe(false);
  });
});
