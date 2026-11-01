import { describe, it, expect } from "vitest";
import { islandSize, geo } from "../src/core/layout";

describe("Side-docked card layout", () => {
  it("uses a portrait player on a side dock without changing landscape Music height", () => {
    geo.layout.edge = "left"; geo.layout.vertical = true;
    geo.hubH = 360;
    geo.layout.panelH = 590;
    geo.sideH = 560;
    const size = islandSize("expanded", "overview");
    expect(size.w).toBe(380); // side default width, not the landscape 1000
    expect(size.h).toBe(560);
    geo.layout.edge = "top"; geo.layout.vertical = false;
  });
  it("gives alerts enough portrait space for navigation and actions", () => {
    geo.layout.edge = "right"; geo.layout.vertical = true;
    const size = islandSize("expanded", "approval");
    expect(size.w).toBe(380);
    expect(size.h).toBe(560);
    geo.layout.edge = "top"; geo.layout.vertical = false;
  });
  it("clamps portrait content to the actual available native window height", () => {
    geo.layout.edge = "left";
    geo.layout.panelH = 510;
    geo.sideH = 800;
    expect(islandSize("expanded", "shelf").h).toBe(480);
    geo.sideH = 560; geo.layout.panelH = 590; geo.layout.edge = "top";
  });
});
