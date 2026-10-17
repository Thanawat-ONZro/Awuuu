import "./setup-dom";
import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_LAYOUT,
  getColumnAgents,
  VIEW_LAYOUTS,
} from "../src/core/layout";
import { State } from "../src/core/state";
import { page as renderGeneralPage } from "../src/app/pages/general";
import { settings as appSettings } from "../src/app/ui";
import { setLanguage, t } from "../src/i18n/i18n";

const fs: {
  readFileSync(url: URL, enc: "utf8"): string;
} = await import("node:fs" as string);

describe("WS12: Audit Fixes Verification", () => {
  describe("D1: Tools panel row template and scrolling without widget clipping", () => {
    const css = fs.readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

    it("defines grid-auto-rows with a 64px floor and auto content sizing", () => {
      // Must use minmax(64px, auto) for auto rows
      expect(css).toMatch(/\.dashboard-grid\s*\{[^}]*grid-auto-rows:\s*minmax\(64px,\s*auto\)/);
      // Explicit rows must also follow content with minmax(64px, auto)
      expect(css).toMatch(/\.dashboard-grid\s*\{[^}]*grid-template-rows:\s*minmax\(64px,\s*auto\)\s+minmax\(64px,\s*auto\)/);
      // No minmax(0, 1fr) in row templates starving the grid rows
      expect(css).not.toMatch(/\.dashboard-grid\s*\{[^}]*grid-(?:template|auto)-rows:[^}]*minmax\(0,\s*1fr\)/);
    });

    it("defines 64px content floor for cols-1 side-dock variant", () => {
      expect(css).toMatch(/grid-template-rows:\s*auto\s+auto\s+minmax\(64px,\s*auto\)\s+minmax\(64px,\s*auto\)/);
      expect(css).toMatch(/\.dashboard-grid\.cols-1[\s\S]*?grid-auto-rows:\s*minmax\(64px,\s*auto\)/);
    });

    it("uses min-height: 100% and align-content: start so the grid expands and overview-tools scrolls", () => {
      expect(css).toMatch(/\.dashboard-grid\s*\{[^}]*min-height:\s*100%/);
      expect(css).toMatch(/\.dashboard-grid\s*\{[^}]*align-content:\s*start/);
      expect(css).toMatch(/\.overview-tools\s*\{[^}]*overflow-y:\s*auto/);
    });
  });

  describe("D2: TS default panel dimensions and ear clamping", () => {
    it("aligns DEFAULT_LAYOUT with maximum island box (1100x440 -> panel 1180x470)", () => {
      expect(DEFAULT_LAYOUT.panelW).toBe(1180);
      expect(DEFAULT_LAYOUT.panelH).toBe(470);
      expect(DEFAULT_LAYOUT.anchorX).toBe(590);
      expect(DEFAULT_LAYOUT.anchorY).toBe(235);
    });

    it("ensures ears never leave window at maximum width 1100", () => {
      const L = DEFAULT_LAYOUT;
      const w = 1100;
      const earMargin = L.edge === "top" ? 14 : 0;
      const minX = earMargin;
      const maxX = Math.max(minX, L.panelW - w - earMargin);
      const x = Math.min(Math.max(L.anchorX - w / 2, minX), maxX);

      // Island x is centered in 1180 panel: 590 - 550 = 40
      expect(x).toBe(40);
      const earLeftX = x - 14;
      const earRightX = x + w + 14;
      expect(earLeftX).toBeGreaterThanOrEqual(0);
      expect(earRightX).toBeLessThanOrEqual(L.panelW);
    });

    it("clamps island x with 14px earMargin so left ear never lands at negative x even with constrained panel", () => {
      const L = { ...DEFAULT_LAYOUT, panelW: 1080 };
      const w = 1100;
      const earMargin = L.edge === "top" ? 14 : 0;
      const minX = earMargin;
      const maxX = Math.max(minX, L.panelW - w - earMargin);
      const x = Math.min(Math.max(L.anchorX - w / 2, minX), maxX);

      // Clamped to at least minX = 14px, so earLeftX (x - 14) is exactly 0px, never -13px
      expect(x).toBe(14);
      expect(x - 14).toBe(0);
    });
  });

  describe("D3: getColumnAgents session counting", () => {
    it("returns all 3 sessions when no activeId is provided instead of dropping task[0]", () => {
      const tasks = [
        { id: "task-1", name: "Claude" },
        { id: "task-2", name: "Hermes" },
        { id: "task-3", name: "OpenCode" },
      ];

      const withNull = getColumnAgents(tasks, null);
      expect(withNull.length).toBe(3);
      expect(withNull.map((t) => t.id)).toEqual(["task-1", "task-2", "task-3"]);

      const withUndefined = getColumnAgents(tasks, undefined);
      expect(withUndefined.length).toBe(3);
      expect(withUndefined.map((t) => t.id)).toEqual(["task-1", "task-2", "task-3"]);
    });

    it("returns remaining 2 sessions when a focused session is excluded", () => {
      const tasks = [
        { id: "task-1", name: "Claude" },
        { id: "task-2", name: "Hermes" },
        { id: "task-3", name: "OpenCode" },
      ];

      const col = getColumnAgents(tasks, "task-1");
      expect(col.length).toBe(2);
      expect(col.map((t) => t.id)).toEqual(["task-2", "task-3"]);
    });

    it("respects the 4-dot column cap", () => {
      const tasks = [
        { id: "task-1", name: "T1" },
        { id: "task-2", name: "T2" },
        { id: "task-3", name: "T3" },
        { id: "task-4", name: "T4" },
        { id: "task-5", name: "T5" },
      ];

      const col = getColumnAgents(tasks, null);
      expect(col.length).toBe(4);
      expect(col.map((t) => t.id)).toEqual(["task-1", "task-2", "task-3", "task-4"]);
    });
  });

  describe("D4: Settings 'Open the island on' label", () => {
    beforeEach(() => {
      setLanguage("en");
    });

    it("offers Home (overview) instead of Dashboard in general settings", () => {
      appSettings.openIslandOn = "overview";
      const el = renderGeneralPage();

      const rows = Array.from(el.querySelectorAll(".row")) as any[];
      const openRow = rows.find((r: any) =>
        r.children.some((c: any) => c.tagName === "LABEL" && c.textContent.includes(t("Open the island on"))),
      );
      expect(openRow).toBeDefined();

      const dropdown = openRow!.querySelector(".aw-select") as HTMLElement;
      expect(dropdown).toBeDefined();

      const label = dropdown.querySelector(".aw-select-label");
      expect(label?.textContent).toBe(t("Home"));

      // Open the dropdown and inspect options
      if (!(document as any).body) {
        (document as any).body = document.createElement("body");
      }
      const btn = dropdown.querySelector(".aw-select-btn") as HTMLButtonElement;
      btn.dispatchEvent({ type: "click", stopPropagation() {} } as any);

      const pop = document.querySelector(".aw-select-pop");
      expect(pop).toBeDefined();
      const items = Array.from(pop!.querySelectorAll(".aw-select-opt")) as any[];
      const optionTexts = items.map((it: any) => it.textContent?.trim());

      expect(optionTexts).toContain(t("Home"));
      expect(optionTexts).not.toContain("Dashboard");

      // Clean up popup
      pop?.remove?.();
    });

    it("maps legacy dashboard value to Home in settings dropdown", () => {
      appSettings.openIslandOn = "dashboard" as any;
      const el = renderGeneralPage();

      const rows = Array.from(el.querySelectorAll(".row")) as any[];
      const openRow = rows.find((r: any) =>
        r.children.some((c: any) => c.tagName === "LABEL" && c.textContent.includes(t("Open the island on"))),
      );
      expect(openRow).toBeDefined();
      const label = openRow!.querySelector(".aw-select-label");
      expect(label?.textContent).toBe(t("Home"));
    });
  });

  describe("D5: Clean types and legacy dashboard retention", () => {
    it("allows setting openIslandOn without any casts", () => {
      State.openIslandOn = "overview";
      expect(State.openIslandOn).toBe("overview");

      State.openIslandOn = "agents";
      expect(State.openIslandOn).toBe("agents");

      State.openIslandOn = "last";
      expect(State.openIslandOn).toBe("last");

      // Reset
      State.openIslandOn = "overview";
    });

    it("retains legacy dashboard in VIEW_LAYOUTS for backwards compatibility", () => {
      expect(VIEW_LAYOUTS["dashboard"]).toBeDefined();
      expect(VIEW_LAYOUTS["dashboard"].height).toBe(360);
      expect(VIEW_LAYOUTS["dashboard"].botDiameter).toBe(0);
    });
  });
});
