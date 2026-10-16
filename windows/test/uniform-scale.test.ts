import { describe, it, expect } from "vitest";

function computeUniformResize(initialW: number, initialH: number, dw: number, _dh: number) {
  const aspect = initialW / initialH;
  const clampedW = Math.min(1100, Math.max(580, initialW + dw));
  const clampedH = Math.min(640, Math.max(260, Math.round(clampedW / aspect)));
  return { w: Math.round(clampedH * aspect), h: clampedH };
}

describe("Uniform Scale Invariant", () => {
  it("maintains aspect ratio when resizing", () => {
    const res = computeUniformResize(680, 300, 68, 30);
    expect(res.w / res.h).toBeCloseTo(680 / 300, 2);
  });
});
