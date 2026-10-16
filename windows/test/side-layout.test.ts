import { describe, it, expect } from "vitest";
import { islandSize, geo } from "../src/core/layout";

describe("Side-docked card layout", () => {
  it("returns vertical dimensions when expanded on side dock", () => {
    geo.layout.edge = "left"; geo.layout.vertical = true;
    const size = islandSize("expanded", "overview");
    expect(size.w).toBe(320); expect(size.h).toBe(520);
    geo.layout.edge = "top"; geo.layout.vertical = false;
  });
});
