import "./setup-dom";
import { describe, expect, it } from "vitest";
import {
  formatShelfAge,
  formatShelfRetention,
  formatShelfFileSize,
} from "../src/views/modules/shelf";

describe("Shelf age and retention logic", () => {
  const NOW = 1_700_000_000_000;

  describe("formatShelfAge", () => {
    it("formats immediate or negative time differences as 'Just now'", () => {
      expect(formatShelfAge(NOW, NOW)).toBe("Just now");
      expect(formatShelfAge(NOW - 30_000, NOW)).toBe("Just now");
      expect(formatShelfAge(NOW + 10_000, NOW)).toBe("Just now");
    });

    it("formats minutes ago with exact values", () => {
      expect(formatShelfAge(NOW - 60_000, NOW)).toBe("1m ago");
      expect(formatShelfAge(NOW - 5 * 60_000, NOW)).toBe("5m ago");
      expect(formatShelfAge(NOW - 59 * 60_000, NOW)).toBe("59m ago");
    });

    it("formats hours ago with exact values", () => {
      expect(formatShelfAge(NOW - 60 * 60_000, NOW)).toBe("1h ago");
      expect(formatShelfAge(NOW - 2 * 3600_000, NOW)).toBe("2h ago");
      expect(formatShelfAge(NOW - 23 * 3600_000, NOW)).toBe("23h ago");
    });

    it("formats days ago with exact values", () => {
      expect(formatShelfAge(NOW - 24 * 3600_000, NOW)).toBe("1d ago");
      expect(formatShelfAge(NOW - 3 * 86400_000, NOW)).toBe("3d ago");
      expect(formatShelfAge(NOW - 7 * 86400_000, NOW)).toBe("7d ago");
    });
  });

  describe("formatShelfRetention", () => {
    it("formats singular day correctly", () => {
      expect(formatShelfRetention(1)).toBe("Kept for 1 day");
    });

    it("formats plural days correctly", () => {
      expect(formatShelfRetention(7)).toBe("Kept for 7 days");
      expect(formatShelfRetention(14)).toBe("Kept for 14 days");
    });
  });

  describe("formatShelfFileSize", () => {
    it("formats bytes accurately", () => {
      expect(formatShelfFileSize(0)).toBe("0 B");
      expect(formatShelfFileSize(512)).toBe("512 B");
    });

    it("formats kilobytes accurately", () => {
      expect(formatShelfFileSize(1024)).toBe("1 KB");
      expect(formatShelfFileSize(2500)).toBe("2 KB");
      expect(formatShelfFileSize(10240)).toBe("10 KB");
    });

    it("formats megabytes accurately", () => {
      expect(formatShelfFileSize(1048576)).toBe("1.0 MB");
      expect(formatShelfFileSize(2621440)).toBe("2.5 MB");
    });
  });
});
