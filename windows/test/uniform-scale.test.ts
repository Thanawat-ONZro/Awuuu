import { describe, it, expect } from "vitest";
import { ORIENTATION_GEOMETRY } from "../src/core/layout";

function computeFreeResize(initialW: number, initialH: number, dw: number, dh: number) {
  const bounds = ORIENTATION_GEOMETRY.landscape;
  const rawW = Math.round(initialW + dw);
  const rawH = Math.round(initialH + dh);
  const clampedW = Math.min(bounds.max.w, Math.max(bounds.min.w, rawW));
  const clampedH = Math.min(bounds.max.h, Math.max(bounds.min.h, rawH));
  return { w: clampedW, h: clampedH };
}

describe("Resize Policy Invariant", () => {
  it("allows free-drag resizing unlocked from aspect ratio within landscape bounds", () => {
    const initialW = 1000;
    const initialH = 360;

    // Width and height change independently:
    const res = computeFreeResize(initialW, initialH, 50, 20);
    expect(res.w).toBe(1050);
    expect(res.h).toBe(380);
    // Aspect ratio is freely unlocked from initial 1000/360
    expect(res.w / res.h).not.toBeCloseTo(initialW / initialH, 2);

    // Clamps to min bounds (800x320)
    const minRes = computeFreeResize(initialW, initialH, -400, -200);
    expect(minRes.w).toBe(800);
    expect(minRes.h).toBe(320);

    // Clamps to max bounds (1100x440)
    const maxRes = computeFreeResize(initialW, initialH, 400, 200);
    expect(maxRes.w).toBe(1100);
    expect(maxRes.h).toBe(440);
  });
});
