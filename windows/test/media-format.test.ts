import "./setup-dom";
import { describe, expect, it } from "vitest";
import { formatTime } from "../src/views/widgets";

describe("formatTime", () => {
  it("formats 0 ms as 0:00", () => {
    expect(formatTime(0)).toBe("0:00");
  });

  it("formats 65000 ms as 1:05", () => {
    expect(formatTime(65000)).toBe("1:05");
  });

  it("formats 3600000 ms as 60:00", () => {
    expect(formatTime(3600000)).toBe("60:00");
  });

  it("clamps negative ms to 0:00", () => {
    expect(formatTime(-1)).toBe("0:00");
  });

  it("handles non-finite or edge durations safely", () => {
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(Infinity)).toBe("0:00");
    expect(formatTime(59000)).toBe("0:59");
    expect(formatTime(60000)).toBe("1:00");
    expect(formatTime(125000)).toBe("2:05");
  });
});
