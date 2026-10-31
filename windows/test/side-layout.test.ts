import { describe, it, expect } from "vitest";
import { islandSize, geo } from "../src/core/layout";

describe("Side-docked card layout", () => {
  it("uses the side default width and the shorter Music height on a side dock", () => {
    geo.layout.edge = "left"; geo.layout.vertical = true;
    geo.hubH = 360;
    const size = islandSize("expanded", "overview");
    expect(size.w).toBe(380); // side default width, not the landscape 1000
    expect(size.h).toBe(252); // Music remains 30% shorter on a side dock
    geo.layout.edge = "top"; geo.layout.vertical = false;
  });
  it("keeps a short view short on a side dock", () => {
    geo.layout.edge = "right"; geo.layout.vertical = true;
    const size = islandSize("expanded", "approval");
    expect(size.w).toBe(380);
    expect(size.h).toBe(200); // approvalHeight(0); never stretched to the side default
    geo.layout.edge = "top"; geo.layout.vertical = false;
  });
});
