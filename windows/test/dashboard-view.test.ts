import { describe, it, expect } from "vitest";
import { VIEW_LAYOUTS, islandSize, geo } from "../src/core/layout";

describe("Dashboard Island View", () => {
  it("registers dashboard in VIEW_LAYOUTS with full hub height and no bot overlay", () => {
    expect((VIEW_LAYOUTS as Record<string, unknown>)["dashboard"]).toBeDefined();
    expect(VIEW_LAYOUTS["dashboard"].height).toBe(460);
    expect(VIEW_LAYOUTS["dashboard"].botDiameter).toBe(0);
  });

  it("computes expanded size for dashboard view matching hub geometry", () => {
    geo.layout.edge = "top";
    geo.layout.vertical = false;
    geo.expandedW = 900;
    geo.hubH = 460;
    const size = islandSize("expanded", "dashboard");
    expect(size.w).toBe(900);
    expect(size.h).toBe(460);
  });

  it("respects side dock width while maintaining hub height for dashboard", () => {
    geo.layout.edge = "left";
    geo.layout.vertical = true;
    geo.sideW = 380;
    geo.hubH = 460;
    const size = islandSize("expanded", "dashboard");
    expect(size.w).toBe(380);
    expect(size.h).toBe(460);
    geo.layout.edge = "top";
    geo.layout.vertical = false;
  });

  it("handles undefined view safely without throwing", () => {
    const size = islandSize("expanded", undefined as any);
    expect(size.w).toBe(900);
    expect(size.h).toBe(460);
  });
});
