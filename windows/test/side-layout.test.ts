import { describe, it, expect } from "vitest";
import { islandSize, geo } from "../src/core/layout";

describe("Side-docked card layout", () => {
  it("uses the side default width but keeps the hub height on a side dock", () => {
    geo.layout.edge = "left"; geo.layout.vertical = true;
    geo.hubH = 460;
    const size = islandSize("expanded", "overview");
    expect(size.w).toBe(380); // side default width, not the landscape 900
    expect(size.h).toBe(460); // the hub height, not a fixed side slab
    geo.layout.edge = "top"; geo.layout.vertical = false;
  });
  it("keeps a short view short on a side dock", () => {
    geo.layout.edge = "right"; geo.layout.vertical = true;
    const size = islandSize("expanded", "approval");
    expect(size.w).toBe(380);
    expect(size.h).toBe(220); // approvalHeight(0); never stretched to the side default
    geo.layout.edge = "top"; geo.layout.vertical = false;
  });
});
