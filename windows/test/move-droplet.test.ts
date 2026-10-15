import { describe, expect, it } from "vitest";
import { roundness, squash } from "../src/island/move";

describe("droplet near an edge", () => {
  it("is a full circle until it touches the edge", () => {
    expect(roundness(1000, 480)).toBe(1);
    expect(roundness(240, 480)).toBe(1);
  });
  it("flattens as it is pushed in, never below the flat limit", () => {
    expect(roundness(120, 480)).toBeCloseTo(0.5);
    expect(roundness(0, 480)).toBe(0.3);
  });
  it("squashes across the edge and spreads along it", () => {
    expect(squash("top", 0.3).sy).toBe(0.3);
    expect(squash("top", 0.3).sx).toBeGreaterThan(1);
    expect(squash("left", 0.3).sx).toBe(0.3);
    expect(squash("left", 1)).toEqual({ sx: 1, sy: 1 });
  });
});
