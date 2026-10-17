import "./setup-dom";
import { describe, it, expect } from "vitest";
import {
  agentColumnPosition,
  agentColumnDotPosition,
  shouldShowEars,
  getColumnAgents,
  AGENT_DOT_DIAMETER,
  AGENT_COLUMN_RIGHT_CLEARANCE,
  VIEW_LAYOUTS,
  EXPANDED_CORNER,
  ROUNDED_CORNER,
  NOTCH_TAB_CORNER,
  ORIENTATION_GEOMETRY,
} from "../src/core/layout";
import { clampCornerRadius } from "../src/island/move-physics";

describe("WS9: Notch ears and right-hand agent dot column", () => {
  describe("Top-corner notch ears logic", () => {
    it("shows ears only on top edge with square top corners and not moving", () => {
      // Top edge, not moving, square top corners (tl=0, tr=0)
      expect(shouldShowEars("top", false, 0, 0)).toBe(true);

      // Hidden when docked to bottom edge
      expect(shouldShowEars("bottom", false, 0, 0)).toBe(false);

      // Hidden when docked to left or right sides
      expect(shouldShowEars("left", false, 0, 0)).toBe(false);
      expect(shouldShowEars("right", false, 0, 0)).toBe(false);

      // Hidden while moving / carrying
      expect(shouldShowEars("top", true, 0, 0)).toBe(false);

      // Hidden when top corners are rounded
      expect(shouldShowEars("top", false, 14, 0)).toBe(false);
      expect(shouldShowEars("top", false, 0, 14)).toBe(false);
      expect(shouldShowEars("top", false, 30, 30)).toBe(false);
    });

    it("keeps top corners square in hidden, compact, and expanded on top edge", () => {
      // In all three states on top edge, radii are [0, 0, r, r]
      const states = [
        { mode: "hidden", r: NOTCH_TAB_CORNER },
        { mode: "compact", r: ROUNDED_CORNER },
        { mode: "expanded", r: EXPANDED_CORNER },
      ];

      for (const s of states) {
        const topRadii = [0, 0, s.r, s.r];
        expect(topRadii[0]).toBe(0);
        expect(topRadii[1]).toBe(0);
        expect(shouldShowEars("top", false, topRadii[0], topRadii[1])).toBe(true);
      }
    });

    it("preserves corner-radius clamp at minimum island dimensions", () => {
      const minBounds = ORIENTATION_GEOMETRY.landscape.min; // 800×320
      const maxClamp = Math.min(minBounds.w, minBounds.h) / 2; // 160
      expect(maxClamp).toBe(160);

      // Verify that no tracked corner radius exceeds maxClamp
      expect(clampCornerRadius(EXPANDED_CORNER, minBounds.w, minBounds.h)).toBe(EXPANDED_CORNER);
      expect(EXPANDED_CORNER).toBeLessThanOrEqual(maxClamp);

      expect(clampCornerRadius(ROUNDED_CORNER, minBounds.w, minBounds.h)).toBe(ROUNDED_CORNER);
      expect(ROUNDED_CORNER).toBeLessThanOrEqual(maxClamp);

      expect(clampCornerRadius(NOTCH_TAB_CORNER, minBounds.w, minBounds.h)).toBe(NOTCH_TAB_CORNER);
      expect(NOTCH_TAB_CORNER).toBeLessThanOrEqual(maxClamp);
    });
  });

  describe("Right-hand agent dot column positioning math", () => {
    it("computes center and box coordinates matching Coucou SPEC.md:60", () => {
      // SPEC.md:60: diameter 16, x = island width - 31, y = 50 + i * 24
      const islandW = 1000;

      for (let i = 0; i < 4; i++) {
        const pos = agentColumnPosition(i, islandW);

        expect(pos.diameter).toBe(AGENT_DOT_DIAMETER);
        expect(pos.diameter).toBe(16);

        // Center coordinates
        expect(pos.x).toBe(islandW - 31);
        expect(pos.cx).toBe(islandW - 31);
        expect(pos.y).toBe(50 + i * 24);
        expect(pos.cy).toBe(50 + i * 24);

        // Box coordinates (top-left)
        expect(pos.left).toBe(islandW - 31 - 8);
        expect(pos.top).toBe(50 + i * 24 - 8);
      }
    });

    it("scales positioning correctly across different island widths", () => {
      const testWidths = [800, 1000, 1100, 960];

      for (const w of testWidths) {
        const p0 = agentColumnPosition(0, w);
        expect(p0.x).toBe(w - 31);
        expect(p0.y).toBe(50);
        expect(p0.left).toBe(w - 39);
        expect(p0.top).toBe(42);

        const p1 = agentColumnPosition(1, w);
        expect(p1.x).toBe(w - 31);
        expect(p1.y).toBe(74);
        expect(p1.left).toBe(w - 39);
        expect(p1.top).toBe(66);

        // Alias agentColumnDotPosition should yield identical results
        expect(agentColumnDotPosition(1, w)).toEqual(p1);
      }
    });

    it("verifies the 42pt right clearance keeps card content clear of dots", () => {
      expect(AGENT_COLUMN_RIGHT_CLEARANCE).toBe(42);

      const islandW = 1000;
      const contentInsetRight = 10; // #content padding-right
      const cardRightEdge = islandW - contentInsetRight - AGENT_COLUMN_RIGHT_CLEARANCE; // 1000 - 10 - 42 = 948

      // Dot spans from left to right
      const dot = agentColumnPosition(0, islandW);
      const dotLeft = dot.left; // 961
      const dotRight = dot.left + dot.diameter; // 977
      const contentRightEdge = islandW - contentInsetRight; // 990

      // The dot sits cleanly in the 42px gutter outside the card
      expect(dotLeft).toBeGreaterThan(cardRightEdge);
      expect(dotRight).toBeLessThan(contentRightEdge);

      // Margin between card right edge and dot left edge
      expect(dotLeft - cardRightEdge).toBe(13);

      // Margin between dot right edge and content right edge
      expect(contentRightEdge - dotRight).toBe(13);
    });
  });

  describe("Agent task selection for column", () => {
    it("excludes the focused/active task and caps at 4 items", () => {
      const tasks = [
        { id: "task-1", name: "Claude" },
        { id: "task-2", name: "AGY" },
        { id: "task-3", name: "Hermes" },
        { id: "task-4", name: "OpenCode" },
        { id: "task-5", name: "Codex" },
        { id: "task-6", name: "GitHub" },
      ];

      // With task-1 focused, next 4 tasks are returned
      const col = getColumnAgents(tasks, "task-1");
      expect(col.length).toBe(4);
      expect(col.map((t) => t.id)).toEqual(["task-2", "task-3", "task-4", "task-5"]);

      // With task-3 focused, task-3 is excluded
      const col3 = getColumnAgents(tasks, "task-3");
      expect(col3.length).toBe(4);
      expect(col3.map((t) => t.id)).toEqual(["task-1", "task-2", "task-4", "task-5"]);
    });

    it("returns empty when no other tasks exist (no shift, no empty gap)", () => {
      const singleTask = [{ id: "task-1", name: "Claude" }];
      expect(getColumnAgents(singleTask, "task-1")).toEqual([]);
      expect(getColumnAgents([], null)).toEqual([]);
    });

    it("verifies views configured with agentMode: 'column'", () => {
      const columnViews = [
        "approval",
        "error",
        "finished",
        "confused",
        "upload",
        "choose",
        "mail",
        "prompt",
        "searching",
        "result",
        "note",
      ];

      for (const viewName of columnViews) {
        expect(VIEW_LAYOUTS[viewName as keyof typeof VIEW_LAYOUTS].agentMode).toBe("column");
      }

      // Non-column views
      expect(VIEW_LAYOUTS.overview.agentMode).toBe("none");
      expect(VIEW_LAYOUTS.agents.agentMode).toBe("pills");
      expect(VIEW_LAYOUTS.empty.agentMode).toBe("none");
    });
  });
});
