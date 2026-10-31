import { describe, expect, it } from "vitest";
import { displayedPosition } from "../src/views/music-timeline";
import { geo, islandSize } from "../src/core/layout";
import { setLanguage, t } from "../src/i18n/i18n";

describe("music timeline", () => {
  it("advances locally while playing and stops immediately when paused", () => {
    expect(displayedPosition(12_000, 90_000, true, 1_000, 1_750)).toBe(12_750);
    expect(displayedPosition(12_000, 90_000, false, 1_000, 1_750)).toBe(12_000);
  });

  it("clamps stale samples to the track duration", () => {
    expect(displayedPosition(89_500, 90_000, true, 1_000, 3_000)).toBe(90_000);
  });

  it("keeps Music 30% shorter than the default 360px hub without resizing other views", () => {
    const before = geo.hubH;
    geo.hubH = 360;
    try {
      expect(islandSize("expanded", "overview").h).toBe(252);
      expect(islandSize("expanded", "agents").h).toBe(360);
    } finally {
      geo.hubH = before;
    }
  });

  it("shows the empty music message in the selected interface language", () => {
    setLanguage("en");
    expect(t("No music playing")).toBe("No music playing");
    setLanguage("th");
    expect(t("No music playing")).toBe("ยังไม่มีเพลงที่กำลังเล่น");
    setLanguage("en");
  });
});
