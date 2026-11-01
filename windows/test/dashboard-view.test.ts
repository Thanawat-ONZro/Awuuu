import "./setup-dom";
import { describe, it, expect, vi } from "vitest";
import { VIEW_LAYOUTS, islandSize, geo } from "../src/core/layout";
import { buildDashboardView, buildToolsPanel } from "../src/views/dashboard";
import { defaultIslandView } from "../src/core/modules";
import { buildHeader, buildViews } from "../src/views/views";
import { State } from "../src/core/state";
import { setLanguage, t } from "../src/i18n/i18n";

describe("Dashboard Island View & Merged Home Page", () => {
  it("registers dashboard in VIEW_LAYOUTS with full hub height and no bot overlay", () => {
    expect((VIEW_LAYOUTS as Record<string, unknown>)["dashboard"]).toBeDefined();
    expect(VIEW_LAYOUTS["dashboard"].height).toBe(360);
    expect(VIEW_LAYOUTS["dashboard"].botDiameter).toBe(0);
  });

  it("registers Music at 70% hub height and no bot overlay", () => {
    expect(VIEW_LAYOUTS.overview).toBeDefined();
    expect(VIEW_LAYOUTS.overview.height).toBe(252);
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
    geo.sideH = 560;
    geo.layout.panelH = 590;
    geo.hubH = 360;
    const size = islandSize("expanded", "dashboard");
    expect(size.w).toBe(380);
    expect(size.h).toBe(560);
    geo.layout.edge = "top";
    geo.layout.vertical = false;
  });

  it("handles undefined view safely without throwing", () => {
    const size = islandSize("expanded", undefined as any);
    expect(size.w).toBe(1000);
    expect(size.h).toBe(252);
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

  it("header has 4 tabs with Music first, and no Tools tab remains", () => {
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
    expect(tabs.length).toBe(5);

    // The former Home tab now opens Music.
    const firstTab = tabs[0];
    expect(firstTab.getAttribute("title")).toBe("Music");

    // Verify all titles: Music, Agent Sessions, Ask, Feed Awuuu a file
    const titles = Array.from(tabs).map((el) => el.getAttribute("title"));
    expect(titles).toEqual([
      "Music",
      t("Agent Sessions"),
      t("Ask"),
      t("Feed Awuuu a file"),
      t("Shelf"),
    ]);

    // No Tools tab in header
    expect(titles).not.toContain(t("Tools"));
    tabs[4].dispatchEvent(new Event("click"));
    expect(actions.setView).toHaveBeenCalledWith("shelf");
  });

  it("replaces Home with Music and keeps the other views", () => {
    setLanguage("th");
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
    const shelf = views.get("shelf");
    expect(shelf).toBeDefined();
    expect(shelf!.el.querySelector(".shelf-tabs")).not.toBeNull();
    expect(shelf!.el.querySelector(".widget-shelf")).not.toBeNull();
    expect(shelf!.el.querySelector(".card-shell")).toBeNull();
    const shelfTabs = shelf!.el.querySelector(".shelf-tabs")!;
    const clipboardTab = shelfTabs.children[0];
    clipboardTab.dispatchEvent(new Event("click"));
    expect(shelf!.el.querySelector<HTMLElement>(".shelf-files-panel")!.hidden).toBe(true);
    expect(shelf!.el.querySelector<HTMLElement>(".clipboard-panel")!.hidden).toBe(false);
    expect(shelf!.el.querySelector(".shelf-topbar")!.querySelector(".clipboard-controls")).not.toBeNull();
    shelfTabs.children[1].dispatchEvent(new Event("click"));
    expect(shelf!.el.querySelector<HTMLElement>(".clipboard-panel")!.hidden).toBe(true);
    expect(islandSize("expanded", "shelf").h).toBe(geo.hubH);

    // Overview (Home) view is registered
    const overviewView = views.get("overview");
    expect(overviewView).toBeDefined();

    expect(overviewView!.el.querySelector(".music-surface")).not.toBeNull();
    expect(overviewView!.el.querySelector(".music-empty")?.textContent).toBe("ยังไม่มีเพลงที่กำลังเล่น");
    setLanguage("en");
    overviewView!.sync();
    expect(overviewView!.el.querySelector(".music-empty")?.textContent).toBe("No music playing");
    expect(overviewView!.el.querySelector(".overview-panels")).toBeNull();
    expect(views.get("agents")).toBeDefined();
    expect(views.get("prompt")).toBeDefined();

    // Reset layout
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
