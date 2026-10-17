import { describe, it, expect } from "vitest";
import {
  VIEW_LAYOUTS,
  botPosition,
  geo,
  islandSize,
  uploadingBarRange,
} from "../src/core/layout";
import { setUploadBox, USC } from "../src/upload/sequence";
import { getGreetingBox, setGreetingBox } from "../src/mochi/greeting";

describe("WS10: Uploading sequence maths and dog travel scaling", () => {
  it("scales the upload bar X range with island width (800, 1000, 1100)", () => {
    // Width 800: track starts at 46 (cardInset 10 + trackLeft 36), ends at 680 (800 - 120)
    const range800 = uploadingBarRange(800);
    expect(range800.x0).toBe(46);
    expect(range800.x1).toBe(680);
    expect(range800.x1 - range800.x0).toBe(634);

    // Width 1000: track starts at 46, ends at 880 (1000 - 120)
    const range1000 = uploadingBarRange(1000);
    expect(range1000.x0).toBe(46);
    expect(range1000.x1).toBe(880);
    expect(range1000.x1 - range1000.x0).toBe(834);

    // Width 1100: track starts at 46, ends at 980 (1100 - 120)
    const range1100 = uploadingBarRange(1100);
    expect(range1100.x0).toBe(46);
    expect(range1100.x1).toBe(980);
    expect(range1100.x1 - range1100.x0).toBe(934);
  });

  it("scales riding dog travel across 800, 1000, and 1100 widths instead of assuming 526", () => {
    // Width 800: travel start = 46, midpoint = 363, end = 680
    const bot800Start = botPosition("expanded", "uploading", 220, 0, 800);
    const bot800Mid = botPosition("expanded", "uploading", 220, 0.5, 800);
    const bot800End = botPosition("expanded", "uploading", 220, 1, 800);
    expect(bot800Start.cx).toBe(46);
    expect(bot800Mid.cx).toBe(363);
    expect(bot800End.cx).toBe(680);

    // Width 1100: travel start = 46, midpoint = 513, end = 980
    const bot1100Start = botPosition("expanded", "uploading", 220, 0, 1100);
    const bot1100Mid = botPosition("expanded", "uploading", 220, 0.5, 1100);
    const bot1100End = botPosition("expanded", "uploading", 220, 1, 1100);
    expect(bot1100Start.cx).toBe(46);
    expect(bot1100Mid.cx).toBe(513);
    expect(bot1100End.cx).toBe(980);

    // Width 1000: travel start = 46, midpoint = 463, end = 880
    const bot1000Start = botPosition("expanded", "uploading", 220, 0, 1000);
    const bot1000Mid = botPosition("expanded", "uploading", 220, 0.5, 1000);
    const bot1000End = botPosition("expanded", "uploading", 220, 1, 1000);
    expect(bot1000Start.cx).toBe(46);
    expect(bot1000Mid.cx).toBe(463);
    expect(bot1000End.cx).toBe(880);
  });

  it("derives USC constants dynamically from box width", () => {
    // At width 800 (card.w = 780, box.w = 800)
    setUploadBox({ x: 10, y: 38, w: 780, h: 172 });
    expect(USC.W).toBe(800);
    expect(USC.BAR_X0).toBe(46);
    expect(USC.BAR_X1).toBe(680);
    expect(USC.REST_X).toBe(175);
    expect(USC.TEXT_X).toBe(245);
    expect(USC.FOLLOW_MAX).toBe(740);

    // At width 1100 (card.w = 1080, box.w = 1100)
    setUploadBox({ x: 10, y: 38, w: 1080, h: 172 });
    expect(USC.W).toBe(1100);
    expect(USC.BAR_X0).toBe(46);
    expect(USC.BAR_X1).toBe(980);
    expect(USC.REST_X).toBe(241);
    expect(USC.TEXT_X).toBe(337);
    expect(USC.FOLLOW_MAX).toBe(1040);

    // At width 1000 (card.w = 980, box.w = 1000)
    setUploadBox({ x: 10, y: 38, w: 980, h: 172 });
    expect(USC.W).toBe(1000);
    expect(USC.BAR_X0).toBe(46);
    expect(USC.BAR_X1).toBe(880);
    expect(USC.REST_X).toBe(219);
    expect(USC.TEXT_X).toBe(306);
    expect(USC.FOLLOW_MAX).toBe(940);
  });
});

describe("WS10: Greeting overlay sizing, proportions, and centering", () => {
  it("gives greeting view a height of 360 consistent with content views", () => {
    expect(VIEW_LAYOUTS.greeting.height).toBe(360);

    geo.layout.edge = "top";
    geo.layout.vertical = false;
    geo.expandedW = 1000;
    geo.hubH = 360;

    const sz = islandSize("expanded", "greeting");
    expect(sz.w).toBe(1000);
    expect(sz.h).toBe(360);

    // Follows expandedW when resized
    geo.expandedW = 1100;
    expect(islandSize("expanded", "greeting").w).toBe(1100);
    expect(islandSize("expanded", "greeting").h).toBe(360);

    geo.expandedW = 800;
    expect(islandSize("expanded", "greeting").w).toBe(800);
    expect(islandSize("expanded", "greeting").h).toBe(360);

    // Side edge uses side geometry width and 360 height
    geo.layout.edge = "left";
    geo.sideW = 380;
    const sideSz = islandSize("expanded", "greeting");
    expect(sideSz.w).toBe(380);
    expect(sideSz.h).toBe(360);

    // Restore layout
    geo.layout.edge = "top";
    geo.expandedW = 1000;
  });

  it("centers the dog and card on the island while preserving 620×104 card proportions at 800, 1000, 1100", () => {
    // 1000 × 360 landscape
    setGreetingBox({ w: 1000, h: 360 }, undefined, "top");
    const b1000 = getGreetingBox();
    expect(b1000.w).toBe(1000);
    expect(b1000.h).toBe(360);
    expect(b1000.cx).toBe(500); // 1000 / 2
    expect(b1000.cy).toBe(194); // 38 + (360 - 48)/2
    expect(b1000.cardW).toBe(620); // Not stretched to 980
    expect(b1000.cardH).toBe(104); // Proportions preserved
    expect(b1000.cardX).toBe(190); // 500 - 310
    expect(b1000.cardY).toBe(142); // 194 - 52
    expect(b1000.cardX + b1000.cardW / 2).toBe(b1000.cx); // Card centered on island

    // 800 × 320 landscape
    setGreetingBox({ w: 800, h: 320 }, undefined, "top");
    const b800 = getGreetingBox();
    expect(b800.w).toBe(800);
    expect(b800.h).toBe(320);
    expect(b800.cx).toBe(400); // 800 / 2
    expect(b800.cy).toBe(174); // 38 + (320 - 48)/2
    expect(b800.cardW).toBe(620);
    expect(b800.cardH).toBe(104);
    expect(b800.cardX).toBe(90); // 400 - 310
    expect(b800.cardY).toBe(122); // 174 - 52
    expect(b800.cardX + b800.cardW / 2).toBe(b800.cx);

    // 1100 × 440 landscape
    setGreetingBox({ w: 1100, h: 440 }, undefined, "top");
    const b1100 = getGreetingBox();
    expect(b1100.w).toBe(1100);
    expect(b1100.h).toBe(440);
    expect(b1100.cx).toBe(550); // 1100 / 2
    expect(b1100.cy).toBe(234); // 38 + (440 - 48)/2
    expect(b1100.cardW).toBe(620);
    expect(b1100.cardH).toBe(104);
    expect(b1100.cardX).toBe(240); // 550 - 310
    expect(b1100.cardY).toBe(182); // 234 - 52
    expect(b1100.cardX + b1100.cardW / 2).toBe(b1100.cx);
  });

  it("handles docked edges properly (bottom and side)", () => {
    // Bottom edge: header is at bottom, card and dog centered in content above header
    setGreetingBox({ w: 1000, h: 360 }, undefined, "bottom");
    const bBottom = getGreetingBox();
    expect(bBottom.cx).toBe(500);
    expect(bBottom.cy).toBe(166); // 10 + (360 - 48)/2
    expect(bBottom.earY).toBe(344); // 360 - 16
    expect(bBottom.cardX).toBe(190);
    expect(bBottom.cardY).toBe(114); // 166 - 52

    // Left edge (380 × 560): content width is 332 (narrower than 620), scales proportionally
    setGreetingBox({ w: 380, h: 560 }, undefined, "left");
    const bSide = getGreetingBox();
    expect(bSide.cx).toBe(204); // 38 + (380 - 48)/2
    expect(bSide.cy).toBe(280); // 10 + (560 - 20)/2
    expect(bSide.cardW).toBe(332); // Fits within available width
    expect(bSide.cardH).toBe(56); // Math.round(332 * 104 / 620) = 56
    expect(bSide.cardX).toBe(38);
    expect(bSide.cardY).toBe(252); // 280 - 28
    expect(bSide.cardX + bSide.cardW / 2).toBe(bSide.cx);
  });
});
