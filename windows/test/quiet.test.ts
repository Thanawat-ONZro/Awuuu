import { describe, expect, it } from "vitest";
import { Nudger, inQuietHours, parseQuiet } from "../src/island/quiet";

const at = (h: number, m = 0, s = 0) => new Date(2026, 9, 3, h, m, s);

describe("quiet hours", () => {
  it("parses a range and turns off on nonsense", () => {
    expect(parseQuiet("22:00-07:00")).toEqual({ start: 1320, end: 420 });
    expect(parseQuiet("")).toBeNull();
    expect(parseQuiet("25:00-07:00")).toBeNull();
    expect(parseQuiet("08:00-08:00")).toBeNull();
    expect(parseQuiet("8-9")).toBeNull();
  });
  it("wraps past midnight", () => {
    expect(inQuietHours("22:00-07:00", at(23, 30))).toBe(true);
    expect(inQuietHours("22:00-07:00", at(6, 59))).toBe(true);
    expect(inQuietHours("22:00-07:00", at(7, 0))).toBe(false);
    expect(inQuietHours("22:00-07:00", at(12))).toBe(false);
  });
  it("works inside one day", () => {
    expect(inQuietHours("12:00-13:00", at(12, 30))).toBe(true);
    expect(inQuietHours("12:00-13:00", at(13, 0))).toBe(false);
  });
});

describe("Nudger", () => {
  it("lets one pop through every 20 s and none in quiet hours", () => {
    const n = new Nudger();
    expect(n.allow("", at(10))).toBe(true);
    expect(n.allow("", at(10, 0, 5))).toBe(false);
    expect(n.allow("", at(10, 0, 21))).toBe(true);
    expect(n.allow("22:00-07:00", at(23))).toBe(false);
  });
});
