import "./setup-dom";
import { describe, expect, it } from "vitest";
import { formatCountdown } from "../src/views/modules/calendar";

describe("formatCountdown (S9 local midnight & countdown values)", () => {
  it("formats all-day events using local midnight boundaries", () => {
    // Construct local dates
    const now = new Date(2026, 9, 17, 14, 30, 0); // 2026-10-17 14:30 local
    const nowMs = now.getTime();

    // Today all-day event (starts at today's local midnight)
    const todayStart = new Date(2026, 9, 17, 0, 0, 0).getTime();
    const todayEnd = new Date(2026, 9, 18, 0, 0, 0).getTime();
    expect(formatCountdown(todayStart, todayEnd, true, nowMs)).toBe("Today");

    // Tomorrow all-day event (starts at tomorrow's local midnight)
    // In UTC+7 (e.g. Bangkok), tomorrow's local midnight is 17:00 UTC today.
    // With local midnight setHours(0,0,0,0), it correctly computes diffDays = 1 ("Tomorrow").
    const tomorrowStart = new Date(2026, 9, 18, 0, 0, 0).getTime();
    const tomorrowEnd = new Date(2026, 9, 19, 0, 0, 0).getTime();
    expect(formatCountdown(tomorrowStart, tomorrowEnd, true, nowMs)).toBe("Tomorrow");

    // Event 3 days in the future
    const in3DaysStart = new Date(2026, 9, 20, 0, 0, 0).getTime();
    const in3DaysEnd = new Date(2026, 9, 21, 0, 0, 0).getTime();
    expect(formatCountdown(in3DaysStart, in3DaysEnd, true, nowMs)).toBe("in 3 days");
  });

  it("formats timed events with accurate relative countdowns", () => {
    const nowMs = 1_700_000_000_000;

    // Currently happening event
    expect(formatCountdown(nowMs - 60_000, nowMs + 1800_000, false, nowMs)).toBe("Now");

    // Event starting in 1 minute
    expect(formatCountdown(nowMs + 45_000, nowMs + 1800_000, false, nowMs)).toBe("in 1 min");

    // Event starting in 25 minutes
    expect(formatCountdown(nowMs + 25 * 60_000, nowMs + 3600_000, false, nowMs)).toBe("in 25 min");

    // Event starting in 2 hours exact
    expect(formatCountdown(nowMs + 2 * 3600_000, nowMs + 3 * 3600_000, false, nowMs)).toBe("in 2h");

    // Past event that already ended
    expect(formatCountdown(nowMs - 3600_000, nowMs - 60_000, false, nowMs)).toBe("Ended");
  });
});
