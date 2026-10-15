import { describe, expect, it } from "vitest";
import { OUTFITS, normalizeOutfit, resolveOutfit, seasonOutfit } from "../src/mochi/outfits";

describe("outfits", () => {
  it("picks seasonal outfits", () => {
    expect(seasonOutfit(new Date(2026, 9, 15))).toBe("witch");
    expect(seasonOutfit(new Date(2026, 11, 24))).toBe("santa");
    expect(seasonOutfit(new Date(2026, 0, 10))).toBe("scarf");
    expect(seasonOutfit(new Date(2026, 3, 10))).toBe("flowers");
    expect(["none", "sunglasses"]).toContain(seasonOutfit(new Date(2026, 6, 15)));
  });
  it("is deterministic and always valid", () => {
    for (let m = 0; m < 12; m++) {
      const d = new Date(2026, m, 15);
      const r = seasonOutfit(d);
      expect(seasonOutfit(new Date(d))).toBe(r);
      expect(r === "none" || OUTFITS.some((o) => o.id === r)).toBe(true);
    }
  });
  it("normalizes selections", () => {
    expect(normalizeOutfit(undefined)).toBe("auto");
    expect(normalizeOutfit("bogus")).toBe("auto");
    expect(normalizeOutfit("none")).toBe("none");
    expect(normalizeOutfit("bowtie")).toBe("bowtie");
    expect(resolveOutfit("auto", new Date(2026, 9, 1))).toBe("witch");
    expect(resolveOutfit("halo", new Date(2026, 9, 1))).toBe("halo");
  });
});
