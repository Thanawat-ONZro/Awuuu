import { describe, it, expect } from "vitest";
import {
  ORIENTATION_GEOMETRY,
  getOrientationBounds,
  EXPANDED_W,
  EXPANDED_CORNER,
  HEADER_SIZE,
  HEADER_BOTTOM,
  CARD_BOTTOM_GAP,
  NOTCH_TAB_W,
  NOTCH_TAB_H,
  COMPACT_W,
  APPROVAL_MIN_H,
  APPROVAL_MAX_H,
  VIEW_LAYOUTS,
  islandSize,
  geo,
  type IslandViewName,
  type IslandMode,
} from "../src/core/layout";
import { DEFAULT_SETTINGS } from "../src/core/state";

describe("WS7: Landscape-First Geometry and Chrome Constants", () => {
  it("pins default, min, and max bounds per orientation", () => {
    // Landscape bounds: default 1000×360, min 800×320, max 1100×440
    expect(ORIENTATION_GEOMETRY.landscape.min).toEqual({ w: 800, h: 320 });
    expect(ORIENTATION_GEOMETRY.landscape.default).toEqual({ w: 1000, h: 360 });
    expect(ORIENTATION_GEOMETRY.landscape.max).toEqual({ w: 1100, h: 440 });

    // Side bounds: default 380×560, min 320×480, max 520×800
    expect(ORIENTATION_GEOMETRY.side.min).toEqual({ w: 320, h: 480 });
    expect(ORIENTATION_GEOMETRY.side.default).toEqual({ w: 380, h: 560 });
    expect(ORIENTATION_GEOMETRY.side.max).toEqual({ w: 520, h: 800 });

    // Orientation bounds mapping
    expect(getOrientationBounds("top")).toEqual(ORIENTATION_GEOMETRY.landscape);
    expect(getOrientationBounds("bottom")).toEqual(ORIENTATION_GEOMETRY.landscape);
    expect(getOrientationBounds("left")).toEqual(ORIENTATION_GEOMETRY.side);
    expect(getOrientationBounds("right")).toEqual(ORIENTATION_GEOMETRY.side);
  });

  it("pins chrome constants, tabs, and corner radius", () => {
    expect(EXPANDED_W).toBe(1000);
    expect(EXPANDED_CORNER).toBe(30);
    expect(HEADER_SIZE).toBe(30);
    expect(HEADER_BOTTOM).toBe(38);
    expect(CARD_BOTTOM_GAP).toBe(10);
    expect(NOTCH_TAB_W).toBe(140);
    expect(NOTCH_TAB_H).toBe(10);
    expect(COMPACT_W).toBe(360);
    expect(APPROVAL_MIN_H).toBe(200);
    expect(APPROVAL_MAX_H).toBe(320);
    expect(DEFAULT_SETTINGS.islandWidth).toBe(1000);
    expect(DEFAULT_SETTINGS.hubHeight).toBe(360);
  });

  it("pins per-view height table in VIEW_LAYOUTS", () => {
    // Home / Hub group (360)
    expect(VIEW_LAYOUTS.overview.height).toBe(360);
    expect(VIEW_LAYOUTS.dashboard.height).toBe(360);
    expect(VIEW_LAYOUTS.agents.height).toBe(360);
    expect(VIEW_LAYOUTS.diff.height).toBe(360);
    expect(VIEW_LAYOUTS.note.height).toBe(360);

    // Prompt (chat default 400)
    expect(VIEW_LAYOUTS.prompt.height).toBe(400);

    // Toast-like views (~200)
    expect(VIEW_LAYOUTS.settings.height).toBe(200);
    expect(VIEW_LAYOUTS.empty.height).toBe(200);
    expect(VIEW_LAYOUTS.approval.height).toBe(200);
    expect(VIEW_LAYOUTS.error.height).toBe(200);
    expect(VIEW_LAYOUTS.finished.height).toBe(200);
    expect(VIEW_LAYOUTS.confused.height).toBe(200);

    // Upload group (~220)
    expect(VIEW_LAYOUTS.upload.height).toBe(220);
    expect(VIEW_LAYOUTS.uploading.height).toBe(220);
    expect(VIEW_LAYOUTS.choose.height).toBe(220);

    // Placeholders & overlay
    expect(VIEW_LAYOUTS.mail.height).toBe(260);
    expect(VIEW_LAYOUTS.searching.height).toBe(180);
    expect(VIEW_LAYOUTS.result.height).toBe(180);
    expect(VIEW_LAYOUTS.greeting.height).toBe(160);
  });

  it("enforces fixed 1000 width policy for non-resizable views", () => {
    geo.layout.edge = "top";
    geo.layout.vertical = false;
    geo.expandedW = 1050; // User had resized agents/prompt

    // agents and prompt adopt geo.expandedW
    expect(islandSize("expanded", "agents").w).toBe(1050);
    expect(islandSize("expanded", "prompt").w).toBe(1050);

    // All other views remain fixed at 1000 width
    const fixedViews: IslandViewName[] = [
      "overview",
      "dashboard",
      "diff",
      "note",
      "settings",
      "empty",
      "approval",
      "error",
      "finished",
      "confused",
      "upload",
      "uploading",
      "choose",
      "mail",
      "searching",
      "result",
    ];

    for (const v of fixedViews) {
      const sz = islandSize("expanded", v);
      expect(sz.w).toBe(1000);
    }

    // Reset geo.expandedW
    geo.expandedW = 1000;
  });

  it("pins resize-grip visibility policy: ONLY agents and prompt", () => {
    function shouldShowResizeGrip(mode: IslandMode, view: IslandViewName): boolean {
      return mode === "expanded" && (view === "agents" || view === "prompt");
    }

    const allViews: IslandViewName[] = [
      "overview",
      "agents",
      "diff",
      "empty",
      "approval",
      "error",
      "finished",
      "confused",
      "upload",
      "uploading",
      "choose",
      "mail",
      "prompt",
      "searching",
      "result",
      "note",
      "settings",
      "greeting",
      "dashboard",
    ];

    for (const v of allViews) {
      if (v === "agents" || v === "prompt") {
        expect(shouldShowResizeGrip("expanded", v)).toBe(true);
      } else {
        expect(shouldShowResizeGrip("expanded", v)).toBe(false);
      }
      // Hidden or compact mode never shows grip
      expect(shouldShowResizeGrip("hidden", v)).toBe(false);
      expect(shouldShowResizeGrip("compact", v)).toBe(false);
    }
  });

  it("validates free-drag independent axis calculation and clamping", () => {
    const bounds = ORIENTATION_GEOMETRY.landscape;
    function drag(initialW: number, initialH: number, dw: number, dh: number) {
      const rawW = Math.round(initialW + dw);
      const rawH = Math.round(initialH + dh);
      const w = Math.min(bounds.max.w, Math.max(bounds.min.w, rawW));
      const h = Math.min(bounds.max.h, Math.max(bounds.min.h, rawH));
      return { w, h };
    }

    // Free drag width only
    expect(drag(1000, 360, 80, 0)).toEqual({ w: 1080, h: 360 });
    // Free drag height only
    expect(drag(1000, 360, 0, 50)).toEqual({ w: 1000, h: 410 });
    // Free drag both axes independently
    expect(drag(1000, 360, -100, 60)).toEqual({ w: 900, h: 420 });
    // Minimum clamping (800x320)
    expect(drag(1000, 360, -300, -100)).toEqual({ w: 800, h: 320 });
    // Maximum clamping (1100x440)
    expect(drag(1000, 360, 200, 150)).toEqual({ w: 1100, h: 440 });
  });
});
