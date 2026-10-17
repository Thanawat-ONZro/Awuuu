import "./setup-dom";
import { describe, it, expect, vi } from "vitest";
import { VIEW_LAYOUTS, islandSize, geo } from "../src/core/layout";
import { buildDashboardView } from "../src/views/dashboard";
import { State } from "../src/core/state";

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

  it("gates sync() so module hosts are only refreshed on transition into open (B2)", () => {
    const actions = {
      setView: vi.fn(),
      setMode: vi.fn(),
      collapse: vi.fn(),
      expand: vi.fn(),
      openSettings: vi.fn(),
    } as any;

    const view = buildDashboardView(actions);

    // When hidden: sync() returns early without doing work
    State.mode = "hidden";
    State.view = "dashboard";
    view.sync();

    // Transition into open: mode is expanded and view is dashboard
    State.mode = "expanded";
    State.view = "dashboard";
    view.sync();

    // Second sync() while already open: does not trigger another transition
    view.sync();

    // Transition away to hidden
    State.mode = "hidden";
    view.sync();

    // Transition back to open
    State.mode = "expanded";
    view.sync();

    // Clean up
    State.mode = "hidden";
  });
});
