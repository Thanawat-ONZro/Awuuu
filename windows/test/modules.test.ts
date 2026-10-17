import { describe, expect, it } from "vitest";
import {
  defaultIslandView,
  isCollapsedStripEligible,
  isModuleInCollapsedStrip,
  MODULES,
  normalizeModuleOrder,
  resolveDefaultModule,
  visibleModules,
  moduleOn,
  collapsedModuleOn,
  type ModuleDescriptor,
} from "../src/core/modules";
import { State } from "../src/core/state";

describe("module registry", () => {
  it("keeps declaration order and filters disabled modules", () => {
    const enabled: Partial<Record<string, boolean>> = {};
    for (const m of MODULES) enabled[m.id] = false;
    enabled.dashboard = true;
    enabled.weather = true;
    const ids = visibleModules(enabled).map((m) => m.id);
    expect(ids).toEqual(["dashboard", "weather"]);
  });

  it("includes notifications and translation in MODULES registry", () => {
    const ids = MODULES.map((m) => m.id);
    expect(ids).toContain("notifications");
    expect(ids).toContain("translation");

    const notify = MODULES.find((m) => m.id === "notifications");
    expect(notify?.icon).toBe("bell");
    expect(notify?.order).toBe(10);

    const trans = MODULES.find((m) => m.id === "translation");
    expect(trans?.icon).toBe("translate");
    expect(trans?.order).toBe(11);
  });

  it("opens the island on the dashboard when nothing waits for an answer", () => {
    expect(defaultIslandView({ approvals: 0, preference: "dashboard" })).toBe("dashboard");
    expect(defaultIslandView({ approvals: 1, preference: "dashboard" })).toBe("approval");
    expect(defaultIslandView({ approvals: 0, preference: "agents" })).toBe("agents");
  });

  it("handles last preference with or without lastView", () => {
    expect(defaultIslandView({ approvals: 0, preference: "last", lastView: "overview" })).toBe("overview");
    expect(defaultIslandView({ approvals: 0, preference: "last" })).toBe("dashboard");
    expect(defaultIslandView({ approvals: 2, preference: "last", lastView: "overview" })).toBe("approval");
  });

  it("exercises State.defaultView() with real lastHomeView tracking (S7)", () => {
    State.openIslandOn = "last";
    State.view = "agents"; // home view
    expect(State.defaultView()).toBe("agents");

    // Navigating into temporary or modal view does NOT corrupt lastHomeView
    State.view = "choose";
    expect(State.defaultView()).toBe("agents");

    State.view = "note";
    expect(State.defaultView()).toBe("agents");

    // Switching to dashboard updates lastHomeView
    State.view = "dashboard";
    expect(State.defaultView()).toBe("dashboard");

    State.view = "confused";
    expect(State.defaultView()).toBe("dashboard");

    // Switching to overview updates lastHomeView
    State.view = "overview";
    expect(State.defaultView()).toBe("overview");

    State.view = "uploading";
    expect(State.defaultView()).toBe("overview");

    // Approval in queue always takes priority
    State.pushApproval({
      sessionId: "test-session",
      requestId: "req-1",
      tool: "Bash",
      command: "ls",
      isQuestion: false,
      createdAt: Date.now(),
    });
    expect(State.defaultView()).toBe("approval");

    State.removeApproval("req-1");
    expect(State.defaultView()).toBe("overview");

    // Reset back to dashboard default
    State.openIslandOn = "dashboard";
    State.view = "dashboard";
  });
});

describe("module order normalisation", () => {
  const allIds = [
    "dashboard", "media", "weather", "todo", "notes", "system",
    "calendar", "toggles", "shelf", "screentime", "notifications", "translation",
  ];

  it("returns all registry modules in default order when saved order is empty or undefined", () => {
    expect(normalizeModuleOrder()).toEqual(allIds);
    expect(normalizeModuleOrder([])).toEqual(allIds);
  });

  it("preserves custom saved order and appends remaining registry modules without losing any", () => {
    const custom = ["weather", "notes", "media"];
    const expected = [
      "weather", "notes", "media",
      "dashboard", "todo", "system", "calendar", "toggles", "shelf", "screentime", "notifications", "translation",
    ];
    expect(normalizeModuleOrder(custom)).toEqual(expected);
  });

  it("prunes unknown or stale modules from saved order without losing valid registry modules", () => {
    const stale = ["notes", "obsolete_calculator", "media", "nonexistent_module"];
    const expected = [
      "notes", "media",
      "dashboard", "weather", "todo", "system", "calendar", "toggles", "shelf", "screentime", "notifications", "translation",
    ];
    expect(normalizeModuleOrder(stale)).toEqual(expected);
  });

  it("deduplicates repeated module ids in saved order", () => {
    const dupes = ["media", "todo", "media", "todo", "weather"];
    const expected = [
      "media", "todo", "weather",
      "dashboard", "notes", "system", "calendar", "toggles", "shelf", "screentime", "notifications", "translation",
    ];
    expect(normalizeModuleOrder(dupes)).toEqual(expected);
  });

  it("works with a custom mock registry", () => {
    const customReg = [
      { id: "alpha" },
      { id: "beta" },
      { id: "gamma" },
    ] as unknown as ModuleDescriptor[];
    expect(normalizeModuleOrder(["gamma", "alpha"], customReg)).toEqual(["gamma", "alpha", "beta"]);
    expect(normalizeModuleOrder(["delta", "gamma", "gamma", "alpha"], customReg)).toEqual(["gamma", "alpha", "beta"]);
  });
});

describe("default-module selection", () => {
  it("selects preferred module when it is valid and enabled", () => {
    expect(resolveDefaultModule("weather", { weather: true, media: true, dashboard: true })).toBe("weather");
    expect(resolveDefaultModule("notes", { notes: true, dashboard: false })).toBe("notes");
  });

  it("falls back to the first enabled module in normalized order when preferred module is disabled", () => {
    const order = ["weather", "notes", "media", "dashboard"];
    // weather is disabled, so notes (the first enabled in order) should be selected
    expect(resolveDefaultModule("weather", { weather: false, notes: true, media: true, dashboard: true }, order)).toBe("notes");
  });

  it("falls back to first enabled module when preference is undefined or invalid", () => {
    const order = ["media", "system", "dashboard"];
    expect(resolveDefaultModule(undefined, { media: false, system: true, dashboard: true }, order)).toBe("system");
    expect(resolveDefaultModule("unknown_mod", { media: true, dashboard: true }, order)).toBe("media");
  });

  it("falls back to first module in normalized order if all modules are disabled", () => {
    const order = ["calendar", "shelf", "notes"];
    const allDisabled: Partial<Record<string, boolean>> = {};
    for (const m of MODULES) allDisabled[m.id] = false;
    expect(resolveDefaultModule(undefined, allDisabled, order)).toBe("calendar");
  });
});

describe("visibleModules with order", () => {
  it("returns modules sorted according to custom order", () => {
    const order = ["weather", "dashboard", "media"];
    const enabled: Partial<Record<string, boolean>> = {};
    for (const m of MODULES) enabled[m.id] = false;
    enabled.dashboard = true;
    enabled.weather = true;
    const ids = visibleModules(enabled, order).map((m) => m.id);
    expect(ids).toEqual(["weather", "dashboard"]);
  });
});

describe("collapsed strip eligibility", () => {
  it("identifies media, dashboard/timer, and calendar as eligible for collapsed strip", () => {
    expect(isCollapsedStripEligible("media")).toBe(true);
    expect(isCollapsedStripEligible("dashboard")).toBe(true);
    expect(isCollapsedStripEligible("calendar")).toBe(true);
    expect(isCollapsedStripEligible("translation")).toBe(false);
  });

  it("checks whether module is enabled in collapsed strip", () => {
    expect(isModuleInCollapsedStrip("media")).toBe(true);
    expect(isModuleInCollapsedStrip("translation")).toBe(false);
  });
});

describe("moduleOn and collapsedModuleOn helpers (B1 regression)", () => {
  it("returns default-on modules when visibleModules is passed an empty object {}", () => {
    const visible = visibleModules({});
    const visibleIds = visible.map((m) => m.id);
    expect(visibleIds).toEqual([
      "dashboard",
      "media",
      "todo",
      "notes",
      "calendar",
      "toggles",
      "shelf",
      "notifications",
      "translation",
    ]);
    expect(visibleIds).not.toContain("weather");
    expect(visibleIds).not.toContain("system");
    expect(visibleIds).not.toContain("screentime");
  });

  it("evaluates moduleOn correctly with explicit values and fallbacks", () => {
    // Explicit override present
    expect(moduleOn({ weather: true }, "weather")).toBe(true);
    expect(moduleOn({ dashboard: false }, "dashboard")).toBe(false);

    // Empty map falls back to DEFAULT_SETTINGS
    expect(moduleOn({}, "dashboard")).toBe(true);
    expect(moduleOn({}, "weather")).toBe(false);
    expect(moduleOn({}, "system")).toBe(false);
    expect(moduleOn({}, "todo")).toBe(true);

    // Undefined/null map falls back to DEFAULT_SETTINGS
    expect(moduleOn(undefined, "dashboard")).toBe(true);
    expect(moduleOn(null, "weather")).toBe(false);
  });

  it("evaluates collapsedModuleOn correctly with explicit values and fallbacks", () => {
    expect(collapsedModuleOn({ media: false }, "media")).toBe(false);
    expect(collapsedModuleOn({}, "media")).toBe(true);
    expect(collapsedModuleOn({}, "calendar")).toBe(true);
    expect(collapsedModuleOn(undefined, "dashboard")).toBe(true);
    expect(collapsedModuleOn({}, "unknown_module")).toBe(false);
  });
});


