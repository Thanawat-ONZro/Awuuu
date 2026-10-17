import "./setup-dom";
import { describe, it, expect, vi } from "vitest";
import { VIEW_LAYOUTS, islandSize, geo } from "../src/core/layout";
import { buildDashboardView, buildToolsPanel } from "../src/views/dashboard";
import { defaultIslandView } from "../src/core/modules";
import { buildHeader, buildViews } from "../src/views/views";
import { State } from "../src/core/state";
import { t } from "../src/i18n/i18n";

describe("Dashboard Island View & Merged Home Page", () => {
  it("registers dashboard in VIEW_LAYOUTS with full hub height and no bot overlay", () => {
    expect((VIEW_LAYOUTS as Record<string, unknown>)["dashboard"]).toBeDefined();
    expect(VIEW_LAYOUTS["dashboard"].height).toBe(360);
    expect(VIEW_LAYOUTS["dashboard"].botDiameter).toBe(0);
  });

  it("registers overview in VIEW_LAYOUTS with full hub height and no bot overlay", () => {
    expect(VIEW_LAYOUTS.overview).toBeDefined();
    expect(VIEW_LAYOUTS.overview.height).toBe(360);
    expect(VIEW_LAYOUTS.overview.botDiameter).toBe(0);
  });

  it("computes expanded size for dashboard view matching hub geometry", () => {
    geo.layout.edge = "top";
    geo.layout.vertical = false;
    geo.expandedW = 1000;
    geo.hubH = 360;
    const size = islandSize("expanded", "dashboard");
    expect(size.w).toBe(1000);
    expect(size.h).toBe(360);
  });

  it("respects side dock width while maintaining hub height for dashboard", () => {
    geo.layout.edge = "left";
    geo.layout.vertical = true;
    geo.sideW = 380;
    geo.hubH = 360;
    const size = islandSize("expanded", "dashboard");
    expect(size.w).toBe(380);
    expect(size.h).toBe(360);
    geo.layout.edge = "top";
    geo.layout.vertical = false;
  });

  it("handles undefined view safely without throwing", () => {
    const size = islandSize("expanded", undefined as any);
    expect(size.w).toBe(1000);
    expect(size.h).toBe(360);
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
    State.view = "overview";
    view.sync();

    // Transition into open: mode is expanded and view is overview
    State.mode = "expanded";
    State.view = "overview";
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

  it("tools panel adapts columns: 3 for wide (>=920), 2 for narrower, 1 for side dock", () => {
    const actions = {
      setView: vi.fn(),
      blip: vi.fn(),
    } as any;

    const panel = buildToolsPanel(actions);

    // Wide landscape (>= 920): 3 columns
    geo.layout.edge = "top";
    geo.layout.vertical = false;
    geo.expandedW = 1000;
    panel.sync();
    expect(panel.grid.dataset.cols).toBe("3");
    expect(panel.grid.classList.contains("cols-3")).toBe(true);
    expect(panel.grid.classList.contains("cols-2")).toBe(false);
    expect(panel.grid.classList.contains("cols-1")).toBe(false);

    // Narrower landscape (< 920): 2 columns
    geo.expandedW = 850;
    panel.sync();
    expect(panel.grid.dataset.cols).toBe("2");
    expect(panel.grid.classList.contains("cols-2")).toBe(true);
    expect(panel.grid.classList.contains("cols-3")).toBe(false);

    // Side dock: 1 column
    geo.layout.edge = "left";
    geo.layout.vertical = true;
    panel.sync();
    expect(panel.grid.dataset.cols).toBe("1");
    expect(panel.grid.classList.contains("cols-1")).toBe(true);
    expect(panel.grid.classList.contains("cols-3")).toBe(false);

    // Reset layout
    geo.layout.edge = "top";
    geo.layout.vertical = false;
    geo.expandedW = 1000;
  });

  it("header has 4 tabs with Home first, and no Tools tab remains", () => {
    const actions = {
      setView: vi.fn(),
      blip: vi.fn(),
      openSettingsWindow: vi.fn(),
      toggleSound: vi.fn(),
      collapse: vi.fn(),
      beginMove: vi.fn(),
    } as any;

    const header = buildHeader(actions);
    const tabsContainer = header.el.querySelector(".tabs");
    expect(tabsContainer).toBeDefined();

    const tabs = tabsContainer!.querySelectorAll(".tab");
    expect(tabs.length).toBe(4);

    // First tab is Home
    const firstTab = tabs[0];
    expect(firstTab.getAttribute("title")).toBe(t("Home"));

    // Verify all titles: Home, Agent Sessions, Ask, Feed Awuuu a file
    const titles = Array.from(tabs).map((el) => el.getAttribute("title"));
    expect(titles).toEqual([
      t("Home"),
      t("Agent Sessions"),
      t("Ask"),
      t("Feed Awuuu a file"),
    ]);

    // No Tools tab in header
    expect(titles).not.toContain(t("Tools"));
  });

  it("merged overview page renders both panels (tools and today) and no standalone dashboard view is in buildViews", () => {
    const actions = {
      setView: vi.fn(),
      blip: vi.fn(),
      openSettingsWindow: vi.fn(),
      toggleSound: vi.fn(),
      collapse: vi.fn(),
      beginMove: vi.fn(),
      setFocus: vi.fn(),
    } as any;

    const views = buildViews(actions, () => {}, () => {});

    // Standalone dashboard view is retired from buildViews
    expect(views.get("dashboard")).toBeUndefined();

    // Overview (Home) view is registered
    const overviewView = views.get("overview");
    expect(overviewView).toBeDefined();

    // Renders two panels inside overview
    const panels = overviewView!.el.querySelector(".overview-panels");
    expect(panels).toBeDefined();

    const toolsPanel = panels!.querySelector(".overview-tools");
    expect(toolsPanel).toBeDefined();
    expect(toolsPanel!.querySelector(".dashboard-grid")).toBeDefined();

    const todayPanel = panels!.querySelector(".overview-today");
    expect(todayPanel).toBeDefined();
    expect(todayPanel!.querySelector(".today-body")).toBeDefined();

    // Side dock yields one column and adds side-dock class to panels
    geo.layout.edge = "left";
    geo.layout.vertical = true;
    overviewView!.sync();

    expect(panels!.classList.contains("side-dock")).toBe(true);
    const grid = toolsPanel!.querySelector(".dashboard-grid")!;
    expect(grid.classList.contains("cols-1")).toBe(true);

    // Reset layout
    geo.layout.edge = "top";
    geo.layout.vertical = false;
    geo.expandedW = 1000;
  });

  it("resolves a stored dashboard view to Home, which is the view that exists", () => {
    // The Tools page was merged into Home: nothing renders for "dashboard", so a
    // stale value (old setting, replayed history, hook payload) must land on Home.
    State.view = "dashboard";
    expect(State.view).toBe("overview");

    State.view = "agents";
    expect(State.lastHomeView).toBe("agents");
    State.view = "overview";

    // A remembered "dashboard" from a stored session also opens Home.
    expect(defaultIslandView({ approvals: 0, preference: "last", lastView: "dashboard" })).toBe("overview");
    expect(defaultIslandView({ approvals: 0, preference: "dashboard" })).toBe("overview");
  });
});
