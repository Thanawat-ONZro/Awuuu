import { describe, it, expect } from "vitest";
import { ORIENTATION_GEOMETRY, getOrientationBounds } from "../src/core/layout";

describe("Orientation Geometry Table", () => {
  it("provides landscape bounds with increased minimum size", () => {
    expect(ORIENTATION_GEOMETRY.landscape.min).toEqual({ w: 580, h: 260 });
    expect(ORIENTATION_GEOMETRY.landscape.default).toEqual({ w: 680, h: 300 });
    expect(ORIENTATION_GEOMETRY.landscape.max).toEqual({ w: 1100, h: 640 });
    const top = getOrientationBounds("top");
    expect(top.min).toEqual({ w: 580, h: 260 });
    expect(top.default).toEqual({ w: 680, h: 300 });
  });
  it("provides portrait/side bounds with narrow vertical card", () => {
    expect(ORIENTATION_GEOMETRY.side.min).toEqual({ w: 260, h: 420 });
    expect(ORIENTATION_GEOMETRY.side.default).toEqual({ w: 320, h: 520 });
    expect(ORIENTATION_GEOMETRY.side.max).toEqual({ w: 480, h: 800 });
    const left = getOrientationBounds("left");
    expect(left.min).toEqual({ w: 260, h: 420 });
    expect(left.default).toEqual({ w: 320, h: 520 });
  });
});
