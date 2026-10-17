import "./setup-dom";
import { describe, expect, it } from "vitest";
import {
  reduceTopApps,
  formatScreenTime,
  formatSwitches,
} from "../src/views/modules/screentime";

describe("Screen time logic", () => {
  describe("reduceTopApps", () => {
    it("returns empty result when total time is 0", () => {
      const res = reduceTopApps({});
      expect(res).toEqual({
        top: [],
        otherMinutes: 0,
        totalMinutes: 0,
      });
    });

    it("keeps all apps and reports otherMinutes as 0 when fewer than 5 apps exist", () => {
      const usage = {
        "Visual Studio Code": 120,
        "Google Chrome": 60,
        "Slack": 20,
      };
      const res = reduceTopApps(usage, 5);
      expect(res.totalMinutes).toBe(200);
      expect(res.otherMinutes).toBe(0);
      expect(res.top).toEqual([
        { name: "Visual Studio Code", minutes: 120, pct: 60 },
        { name: "Google Chrome", minutes: 60, pct: 30 },
        { name: "Slack", minutes: 20, pct: 10 },
      ]);
    });

    it("reduces to top 5 apps and sums the rest into otherMinutes with exact percentages", () => {
      const usage = {
        "Code": 100,
        "Chrome": 80,
        "Slack": 40,
        "Spotify": 30,
        "Terminal": 20,
        "Notion": 15,
        "Discord": 15,
      };
      // Total = 100 + 80 + 40 + 30 + 20 + 15 + 15 = 300
      const res = reduceTopApps(usage, 5);
      expect(res.totalMinutes).toBe(300);
      expect(res.otherMinutes).toBe(30); // Notion (15) + Discord (15)
      expect(res.top).toEqual([
        { name: "Code", minutes: 100, pct: 33 },
        { name: "Chrome", minutes: 80, pct: 27 },
        { name: "Slack", minutes: 40, pct: 13 },
        { name: "Spotify", minutes: 30, pct: 10 },
        { name: "Terminal", minutes: 20, pct: 7 },
      ]);
    });
  });

  describe("formatScreenTime", () => {
    it("formats 0 minutes as 0m", () => {
      expect(formatScreenTime(0)).toBe("0m");
    });

    it("formats minutes only under 1 hour", () => {
      expect(formatScreenTime(45)).toBe("45m");
      expect(formatScreenTime(59)).toBe("59m");
    });

    it("formats exact hours without redundant 0m", () => {
      expect(formatScreenTime(60)).toBe("1h");
      expect(formatScreenTime(180)).toBe("3h");
    });

    it("formats combined hours and minutes", () => {
      expect(formatScreenTime(65)).toBe("1h 5m");
      expect(formatScreenTime(142)).toBe("2h 22m");
    });
  });

  describe("formatSwitches", () => {
    it("formats singular switch", () => {
      expect(formatSwitches(1)).toBe("1 switch");
    });

    it("formats plural switches", () => {
      expect(formatSwitches(0)).toBe("0 switches");
      expect(formatSwitches(42)).toBe("42 switches");
    });
  });
});
