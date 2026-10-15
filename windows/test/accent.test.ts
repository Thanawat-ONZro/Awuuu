import { describe, expect, it } from "vitest";
import { accentForLook, contrast, BG } from "../src/core/accent";
import { CLASSIC, PRESETS, normalizeLook } from "../src/mochi/looks";

const ok = (look: unknown) => {
  const a = accentForLook(normalizeLook(look));
  expect(contrast(a.ink, a.accent)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(a.accent, BG)).toBeGreaterThanOrEqual(4.5);
  expect(a.accent).toMatch(/^#[0-9a-f]{6}$/);
  return a;
};

describe("accentForLook", () => {
  it("default Shiba is unchanged", () => {
    expect(accentForLook(CLASSIC)).toEqual({
      accent: "#e4a871", hover: "#edb985", ink: "#2b1e14", rgb: "228, 168, 113",
    });
    expect(accentForLook(null).accent).toBe("#e4a871");
  });
  for (const p of PRESETS) it(`preset ${p.id} passes contrast`, () => void ok(p.look));
  it.each(["#FFFFFF", "#000000", "#0000FF", "#FF0000", "#00FF00", "#808080"])("custom %s", (c) => {
    ok({ preset: "custom", coat: c, patch: c });
    ok({ preset: "custom", coat: "#FFFFFF", patch: c });
  });
});
