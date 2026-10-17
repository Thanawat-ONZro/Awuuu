import { describe, expect, it } from "vitest";
import { pctBar } from "../src/core/format";

describe("pctBar", () => {
  it("renders completely empty bar for 0%", () => {
    expect(pctBar(0, 10)).toBe("░░░░░░░░░░");
  });

  it("renders half-filled bar for 50%", () => {
    expect(pctBar(50, 10)).toBe("█████░░░░░");
  });

  it("clamps values over 100% to full bar", () => {
    expect(pctBar(150, 10)).toBe("██████████");
    expect(pctBar(100, 10)).toBe("██████████");
  });

  it("clamps negative values to empty bar", () => {
    expect(pctBar(-20, 10)).toBe("░░░░░░░░░░");
  });

  it("handles rounding accurately across widths", () => {
    expect(pctBar(20, 10)).toBe("██░░░░░░░░");
    expect(pctBar(70, 10)).toBe("███████░░░");
    expect(pctBar(50, 6)).toBe("███░░░");
    expect(pctBar(0, 0)).toBe("");
    expect(pctBar(NaN, 10)).toBe("░░░░░░░░░░");
  });
});
