import { describe, expect, it } from "vitest";
import { attachedEdge, attachedCenter, edgeTrackPoint, edgeTrackPosition, unwrapEdgeTrack, carryShape } from "../src/island/move-physics";
import { Spring } from "../src/core/anim";

describe("edge-only island travel", () => {
  const work = { wx: -1920, wy: 30, ww: 1920, wh: 1000 };
  it("bounds elastic deformation and keeps stretched capsules on every edge", () => {
    for (const edge of ["top", "bottom", "left", "right"] as const) {
      for (const speed of [0, 200, -1200, 10000, NaN]) {
        const shape = carryShape(edge, speed);
        expect(Math.max(shape.w, shape.h)).toBeLessThanOrEqual(132);
        expect(Math.min(shape.w, shape.h)).toBeGreaterThanOrEqual(25);
        const point = edgeTrackPoint(edgeTrackPosition(-700, 500, work, edge), work);
        const center = attachedCenter(point, work, shape.w / 2, shape.h / 2);
        const distances = [center.x - shape.w / 2 - work.wx, work.wx + work.ww - center.x - shape.w / 2,
          center.y - shape.h / 2 - work.wy, work.wy + work.wh - center.y - shape.h / 2];
        expect(Math.min(...distances)).toBeCloseTo(0, 6);
      }
    }
  });
  it("keeps every interpolated frame touching an edge and inside the work area", () => {
    const spring = new Spring(500, .18, 1);
    for (const target of [1900, 2100, 3300, 4800, 5800, 50]) {
      spring.target = unwrapEdgeTrack(target, spring.value, work);
      for (let i = 0; i < 90; i++) {
        spring.step(1 / 60);
        const point = edgeTrackPoint(spring.value, work);
        const side = point.edge === "left" || point.edge === "right";
        const hw = side ? 16 : 52, hh = side ? 52 : 16;
        const center = attachedCenter(point, work, hw, hh);
        const distances = [center.x - hw - work.wx, work.wx + work.ww - center.x - hw,
          center.y - hh - work.wy, work.wy + work.wh - center.y - hh];
        expect(Math.min(...distances)).toBeCloseTo(0, 6);
        expect(distances.every(value => value >= -1e-6)).toBe(true);
      }
    }
  });
  it("keeps the previous edge near a corner, then deliberately switches", () => {
    expect(attachedEdge(-5, 35, work, "top", 36)).toBe("top");
    expect(attachedEdge(-5, 200, work, "top", 36)).toBe("right");
  });
  it("takes the short path around the top-left corner instead of crossing the screen", () => {
    const perimeter = 2 * (work.ww + work.wh);
    expect(unwrapEdgeTrack(5, perimeter - 5, work)).toBe(perimeter + 5);
    expect(edgeTrackPosition(work.wx, work.wy, work, "top")).toBe(0);
  });
});
