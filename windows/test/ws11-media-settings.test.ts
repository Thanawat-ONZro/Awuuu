import "./setup-dom";
import { describe, it, expect, vi } from "vitest";
import { SIZE_PRESETS, page } from "../src/app/pages/island";
import { ORIENTATION_GEOMETRY } from "../src/core/layout";
import { State, DEFAULT_SETTINGS } from "../src/core/state";
import { settings } from "../src/app/ui";
import { buildToolsPanel } from "../src/views/dashboard";

const fs: {
  readFileSync(url: URL, enc: "utf8"): string;
} = await import("node:fs" as string);

describe("WS11: Island Settings Bounds & Presets (Part B)", () => {
  it("defines SIZE_PRESETS within the new landscape bounds (800..1100 x 320..440)", () => {
    expect(SIZE_PRESETS).toBeDefined();
    // Presets should cover small, normal/medium, large
    expect(SIZE_PRESETS.S).toEqual([800, 320]);
    expect(SIZE_PRESETS.M).toEqual([1000, 360]);
    expect(SIZE_PRESETS.L).toEqual([1100, 440]);

    for (const [_name, [w, h]] of Object.entries(SIZE_PRESETS)) {
      expect(w).toBeGreaterThanOrEqual(ORIENTATION_GEOMETRY.landscape.min.w);
      expect(w).toBeLessThanOrEqual(ORIENTATION_GEOMETRY.landscape.max.w);
      expect(h).toBeGreaterThanOrEqual(ORIENTATION_GEOMETRY.landscape.min.h);
      expect(h).toBeLessThanOrEqual(ORIENTATION_GEOMETRY.landscape.max.h);
    }
  });

  it("renders Width and Hub height sliders clamped to the new bounds with new defaults", () => {
    // Reset settings to empty / fallback
    delete (settings as any).islandWidth;
    delete (settings as any).hubHeight;

    const el = page();
    const sliderWrappers = el.querySelectorAll(".slider");
    expect(sliderWrappers.length).toBeGreaterThanOrEqual(2);

    const inputs = Array.from(sliderWrappers).map((w: any) => w.children[0] as HTMLInputElement);
    const widthSlider = inputs.find((s: HTMLInputElement) => s.getAttribute("min") === "800" && s.getAttribute("max") === "1100");
    const heightSlider = inputs.find((s: HTMLInputElement) => s.getAttribute("min") === "320" && s.getAttribute("max") === "440");

    expect(widthSlider).toBeDefined();
    expect(heightSlider).toBeDefined();

    // Defaults when settings.islandWidth / hubHeight are unset
    expect(Number(widthSlider!.value)).toBe(1000);
    expect(Number(heightSlider!.value)).toBe(360);
  });
});

describe("WS11: Now-playing Top Row & Clock Rules (Part A)", () => {
  const css = fs.readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

  it("defines full-width top-row CSS rule for .widget-media (order -1, grid-column 1 / -1)", () => {
    // Media widget must have order: -1 so it sits above other modules
    expect(css).toMatch(/\.widget-media\s*\{[^}]*order:\s*-1/);
    // Media widget must span the full panel width: grid-column: 1 / -1
    expect(css).toMatch(/\.widget-media\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  });

  it("keeps the clock full-width rule when there is no media row", () => {
    expect(css).toMatch(/\.dashboard-grid:not\(\.has-media\)\s+\.widget-date\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  });

  it("tools panel toggles has-media class and places media widget when active", () => {
    const actions = {
      setView: vi.fn(),
      blip: vi.fn(),
    } as any;

    State.settings = { ...DEFAULT_SETTINGS, modules: { ...DEFAULT_SETTINGS.modules }, moduleOrder: [...(DEFAULT_SETTINGS.moduleOrder ?? [])] };
    State.mode = "expanded";
    State.view = "overview";
    const panel = buildToolsPanel(actions);
    panel.sync();
    const mediaEl = panel.grid.querySelector(".widget-media") as HTMLElement;
    const dateEl = panel.grid.querySelector(".widget-date") as HTMLElement;
    expect(mediaEl).toBeDefined();
    expect(dateEl).toBeDefined();

    // When inactive: no has-media class, media widget is hidden
    expect(panel.grid.classList.contains("has-media")).toBe(false);
    expect(mediaEl.getAttribute("style")).toBe("display:none");

    // When media becomes active: has-media class added, media shown
    mediaEl.style.display = "flex";
    panel.grid.classList.add("has-media");

    expect(panel.grid.classList.contains("has-media")).toBe(true);
    expect(mediaEl.style.display).toBe("flex");
  });
});
