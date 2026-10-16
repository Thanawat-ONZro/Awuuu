import { describe, it, expect } from "vitest";
import { ORIENTATION_GEOMETRY, getOrientationBounds } from "../src/core/layout";

describe("Orientation Geometry Table", () => {
  it("provides landscape bounds with the owner's minimum", () => {
    expect(ORIENTATION_GEOMETRY.landscape.min).toEqual({ w: 780, h: 400 });
    expect(ORIENTATION_GEOMETRY.landscape.default).toEqual({ w: 900, h: 460 });
    expect(ORIENTATION_GEOMETRY.landscape.max).toEqual({ w: 1100, h: 640 });
    const top = getOrientationBounds("top");
    expect(top.min).toEqual({ w: 780, h: 400 });
    expect(top.default).toEqual({ w: 900, h: 460 });
  });
  it("provides portrait/side bounds with a narrow vertical card", () => {
    expect(ORIENTATION_GEOMETRY.side.min).toEqual({ w: 320, h: 480 });
    expect(ORIENTATION_GEOMETRY.side.default).toEqual({ w: 380, h: 560 });
    expect(ORIENTATION_GEOMETRY.side.max).toEqual({ w: 520, h: 800 });
    const left = getOrientationBounds("left");
    expect(left.min).toEqual({ w: 320, h: 480 });
    expect(left.default).toEqual({ w: 380, h: 560 });
  });
});
