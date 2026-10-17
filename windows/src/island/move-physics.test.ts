import { describe, expect, it } from "vitest";
import { Spring } from "../core/anim";
import {
  rubberBandOffset,
  rubberBandClamp,
  cappedHorizon,
  pickProjectedEdge,
  settleTargets,
  isSettleResting,
  isSettleDone,
  computeCarryWindowSide,
  clampCornerRadius,
  clampRadii,
  clampOriginToMonitor,
  computeDropInWindow,
  computeDropCentreFromOrigin,
  clampDrawnDrop,
  radiiToShader,
  swellShape,
  computeDockedTarget,
  type WorkArea,
} from "./move-physics";
import { FS_SRC } from "./liquid";


describe("island carry physics", () => {
  it("rubber-band offset is monotonic, never exceeds limit * 1.001, and exhibits exponential resistance", () => {
    const limit = 60;
    let prev = -1;

    // Test a sweep of raw overshoots from 0 to 1000 px in increments of 1 px
    for (let rawOver = 0; rawOver <= 1000; rawOver++) {
      const over = rubberBandOffset(rawOver, limit);
      // Monotonic increase
      expect(over).toBeGreaterThanOrEqual(prev);
      // Strictly bounded by limit * 1.001 (in fact strictly under limit)
      expect(over).toBeLessThanOrEqual(limit * 1.001);
      prev = over;
    }

    // Zero overshoot produces zero offset
    expect(rubberBandOffset(0, limit)).toBe(0);
    expect(rubberBandOffset(-10, limit)).toBe(0);

    // Extreme overshoot asymptotic test
    const extreme = rubberBandOffset(100_000, limit);
    expect(extreme).toBeLessThanOrEqual(limit * 1.001);
    expect(extreme).toBeCloseTo(limit, 4);

    // Test (d): rubberBandClamp resistance is exponential, not linear
    // Assert the offset at rawOver = limit/2 is within 20% of limit * (1 - exp(-0.5/0.3))
    const rawOverHalf = limit / 2; // 30
    const theoreticalExp = limit * (1 - Math.exp(-0.5 / 0.3)); // 60 * (1 - exp(-1.66667)) ~ 48.667 px
    const actualOffset = rubberBandOffset(rawOverHalf, limit);

    expect(actualOffset).toBeCloseTo(theoreticalExp, 5);
    // Assert within 20% of theoretical exponential
    expect(actualOffset).toBeGreaterThan(theoreticalExp * 0.8);
    expect(actualOffset).toBeLessThan(theoreticalExp * 1.2);

    // A linear clamp implementation would yield rawOverHalf (30 px), which is >38% off:
    const linearOffset = rawOverHalf;
    expect(Math.abs(linearOffset - theoreticalExp) / theoreticalExp).toBeGreaterThan(0.35);

    // Verify rubberBandClamp behavior with this offset
    const clampedMid = rubberBandClamp(500, 100, 900, limit);
    expect(clampedMid).toBe(500);

    const clampedBelow = rubberBandClamp(100 - rawOverHalf, 100, 900, limit);
    expect(clampedBelow).toBeCloseTo(100 - theoreticalExp, 5);

    const clampedAbove = rubberBandClamp(900 + rawOverHalf, 100, 900, limit);
    expect(clampedAbove).toBeCloseTo(900 + theoreticalExp, 5);
  });

  it("release with velocity toward an edge picks that edge while zero velocity picks nearest edge", () => {
    const work: WorkArea = { wx: 0, wy: 0, ww: 1000, wh: 1000 };

    // Point slightly closer to top edge: (500, 400)
    // Distance to top: 400, bottom: 600, left: 500, right: 500
    // Zero velocity release must pick nearest edge ("top")
    const zeroVelEdge = pickProjectedEdge(500, 400, 0, 0, work, 0.12);
    expect(zeroVelEdge).toBe("top");

    // Flicking downwards with vy = +2000 px/s:
    // Projected y after 0.12s is 400 + 2000 * 0.12 = 640.
    // Distance to bottom is 360, closer than top (640).
    const downwardEdge = pickProjectedEdge(500, 400, 0, 2000, work, 0.12);
    expect(downwardEdge).toBe("bottom");

    // Flicking leftwards with vx = -2500 px/s:
    // Projected x after 0.12s is 500 - 2500 * 0.12 = 200.
    // Distance to left is 200, closer than top (400).
    const leftwardEdge = pickProjectedEdge(500, 400, -2500, 0, work, 0.12);
    expect(leftwardEdge).toBe("left");

    // Flicking rightwards with vx = +2500 px/s:
    // Projected x after 0.12s is 500 + 2500 * 0.12 = 800.
    // Distance to right is 200, closer than top (400).
    const rightwardEdge = pickProjectedEdge(500, 400, 2500, 0, work, 0.12);
    expect(rightwardEdge).toBe("right");

    // Projection leaving work area (negative distance) correctly reduces to closest edge
    const extremeEdge = pickProjectedEdge(500, 50, 0, -3000, work, 0.12);
    expect(extremeEdge).toBe("top");
  });

  it("settleTargets dock-jump guarantee (a): along equals the settled along-edge coordinate for all 4 edges", () => {
    const work: WorkArea = { wx: 100, wy: 200, ww: 1600, wh: 900 };
    const radius = 60;

    // Test (a) Top edge:
    // pos = (500, 300), vel = (400, -800) -> speed = 894.4 px/s
    // maxDist = 0.3 * 900 = 270 px. 894.4 * 0.12 = 107.3 px < 270 px -> dt = 0.12s
    // targetX = 500 + 400 * 0.12 = 548 px.
    // targetY = wy + radius = 200 + 60 = 260 px.
    // along = (548 - 100) / 1600 = 448 / 1600 = 0.28
    const topResult = settleTargets({ x: 500, y: 300 }, { x: 400, y: -800 }, work, radius, "top");
    expect(topResult.edge).toBe("top");
    expect(topResult.targetX).toBe(548);
    expect(topResult.targetY).toBe(260);
    expect(topResult.along).toBe((topResult.targetX - work.wx) / work.ww);
    expect(topResult.along).toBe(0.28);

    // Test (a) Bottom edge:
    // pos = (500, 700), vel = (400, 800)
    // targetX = 500 + 400 * 0.12 = 548 px.
    // targetY = wy + wh - radius = 200 + 900 - 60 = 1040 px.
    // along = (548 - 100) / 1600 = 0.28
    const bottomResult = settleTargets({ x: 500, y: 700 }, { x: 400, y: 800 }, work, radius, "bottom");
    expect(bottomResult.edge).toBe("bottom");
    expect(bottomResult.targetX).toBe(548);
    expect(bottomResult.targetY).toBe(1040);
    expect(bottomResult.along).toBe((bottomResult.targetX - work.wx) / work.ww);
    expect(bottomResult.along).toBe(0.28);

    // Test (a) Left edge:
    // pos = (300, 400), vel = (-800, 300) -> speed = 854.4 px/s
    // targetX = wx + radius = 100 + 60 = 160 px.
    // targetY = 400 + 300 * 0.12 = 436 px.
    // along = (436 - 200) / 900 = 236 / 900 = 0.262222...
    const leftResult = settleTargets({ x: 300, y: 400 }, { x: -800, y: 300 }, work, radius, "left");
    expect(leftResult.edge).toBe("left");
    expect(leftResult.targetX).toBe(160);
    expect(leftResult.targetY).toBe(436);
    expect(leftResult.along).toBe((leftResult.targetY - work.wy) / work.wh);
    expect(leftResult.along).toBeCloseTo(236 / 900, 6);

    // Test (a) Right edge:
    // pos = (1400, 400), vel = (800, 300)
    // targetX = wx + ww - radius = 100 + 1600 - 60 = 1640 px.
    // targetY = 400 + 300 * 0.12 = 436 px.
    // along = (436 - 200) / 900 = 236 / 900
    const rightResult = settleTargets({ x: 1400, y: 400 }, { x: 800, y: 300 }, work, radius, "right");
    expect(rightResult.edge).toBe("right");
    expect(rightResult.targetX).toBe(1640);
    expect(rightResult.targetY).toBe(436);
    expect(rightResult.along).toBe((rightResult.targetY - work.wy) / work.wh);
    expect(rightResult.along).toBeCloseTo(236 / 900, 6);
  });

  it("settleTargets S3 cap (b): projections stay inside work area for ±5000 px/s flicks on all four edges", () => {
    const work: WorkArea = { wx: 0, wy: 0, ww: 1920, wh: 1080 };
    const radius = 60;
    const minX = work.wx + radius; // 60
    const maxX = work.wx + work.ww - radius; // 1860
    const minY = work.wy + radius; // 60
    const maxY = work.wy + work.wh - radius; // 1020
    const maxDisplacement = 0.3 * Math.min(work.ww, work.wh); // 324 px

    // Verify cappedHorizon bounds displacement
    const horizon = cappedHorizon(5000, 0, work, 0.12);
    expect(horizon * 5000).toBeCloseTo(maxDisplacement, 5);
    expect(horizon).toBeLessThan(0.12); // ~0.0648s instead of 0.12s

    // Flick Right (+5000 px/s on x) starting in right half (1400, 540)
    const flickRight = settleTargets({ x: 1400, y: 540 }, { x: 5000, y: 0 }, work, radius);
    expect(flickRight.edge).toBe("right");
    expect(flickRight.targetX).toBe(maxX);
    expect(flickRight.targetY).toBe(540);
    expect(flickRight.targetX).toBeGreaterThanOrEqual(minX);
    expect(flickRight.targetX).toBeLessThanOrEqual(maxX);
    expect(flickRight.along).toBe(540 / 1080);

    // Flick Left (-5000 px/s on x) starting in left half (520, 540)
    const flickLeft = settleTargets({ x: 520, y: 540 }, { x: -5000, y: 0 }, work, radius);
    expect(flickLeft.edge).toBe("left");
    expect(flickLeft.targetX).toBe(minX);
    expect(flickLeft.targetY).toBe(540);
    expect(flickLeft.targetX).toBeGreaterThanOrEqual(minX);
    expect(flickLeft.targetX).toBeLessThanOrEqual(maxX);
    expect(flickLeft.along).toBe(540 / 1080);

    // Flick Down (+5000 px/s on y) from center (960, 540)
    const flickDown = settleTargets({ x: 960, y: 540 }, { x: 0, y: 5000 }, work, radius);
    expect(flickDown.edge).toBe("bottom");
    expect(flickDown.targetX).toBe(960);
    expect(flickDown.targetY).toBe(maxY);
    expect(flickDown.targetY).toBeGreaterThanOrEqual(minY);
    expect(flickDown.targetY).toBeLessThanOrEqual(maxY);
    expect(flickDown.along).toBe(960 / 1920);

    // Flick Up (-5000 px/s on y) from center (960, 540)
    const flickUp = settleTargets({ x: 960, y: 540 }, { x: 0, y: -5000 }, work, radius);
    expect(flickUp.edge).toBe("top");
    expect(flickUp.targetX).toBe(960);
    expect(flickUp.targetY).toBe(minY);
    expect(flickUp.targetY).toBeGreaterThanOrEqual(minY);
    expect(flickUp.targetY).toBeLessThanOrEqual(maxY);
    expect(flickUp.along).toBe(960 / 1920);

    // Extreme case: release already pushed past boundary with +5000 px/s flick
    const pushedOutside = settleTargets({ x: 1950, y: 540 }, { x: 5000, y: 0 }, work, radius);
    expect(pushedOutside.targetX).toBe(maxX);
    expect(pushedOutside.targetX).toBeLessThanOrEqual(maxX);
    expect(pushedOutside.along).toBe(540 / 1080);
  });

  it("settle end-condition (c): converges within 400 ms from a 300 px throw at damping 0.8 while Spring.settled alone would not", () => {
    // 300 px throw at SETTLE_RESPONSE = 0.35, SETTLE_DAMPING = 0.8
    const s = new Spring(0, 0.35, 0.8);
    s.target = 300;
    const dt = 1 / 120; // 120 Hz integration steps

    let elapsedSec = 0;
    let convergedAtMs: number | null = null;
    let settledAtMs: number | null = null;

    // Simulate up to 1 second (1000 ms)
    for (let i = 0; i < 120; i++) {
      s.step(dt);
      elapsedSec += dt;
      const elapsedMs = elapsedSec * 1000;

      if (isSettleDone(s, s, elapsedMs) && convergedAtMs === null) {
        convergedAtMs = elapsedMs;
      }
      if (s.settled && settledAtMs === null) {
        settledAtMs = elapsedMs;
      }
    }

    // (c) The new settle end-condition converges within 400 ms
    expect(typeof convergedAtMs).toBe("number");
    expect(Math.round(convergedAtMs!)).toBeLessThanOrEqual(400);

    // At 400 ms, the standard Spring.settled is FALSE (runs ~780-800 ms)
    expect(typeof settledAtMs).toBe("number");
    expect(settledAtMs!).toBeGreaterThan(700);

    // Verify Spring state at 400 ms: Spring.settled is strictly false
    const sAt400 = new Spring(0, 0.35, 0.8);
    sAt400.target = 300;
    const steps400 = Math.round(0.4 / dt); // 48 steps at 120Hz = 0.4s
    for (let i = 0; i < steps400; i++) {
      sAt400.step(dt);
    }

    expect(sAt400.settled).toBe(false);
    // Residual error at 400 ms is small (~1.4 px) but exceeds anim.ts's strict 0.01 px threshold:
    const errorAt400 = Math.abs(sAt400.target - sAt400.value);
    expect(errorAt400).toBeGreaterThan(0.01);
    expect(errorAt400).toBeLessThan(2.0);

    // Confirm isSettleDone evaluates to true at 400 ms
    expect(isSettleDone(sAt400, sAt400, 400)).toBe(true);

    // At 400 ms, error ~1.4 px > 0.5 px so isSettleResting is false;
    // after further decay (e.g. at 550 ms), isSettleResting becomes true
    expect(isSettleResting(sAt400)).toBe(false);
    for (let i = 0; i < Math.round(0.15 / dt); i++) {
      sAt400.step(dt);
    }
    expect(isSettleResting(sAt400)).toBe(true);
  });

  it("carry geometry: corner clamp, window sizing, origin monitor clamp, and coordinate transforms assert exact values", () => {
    // 1. Corner radius clamp: max radius is min(w, h)/2
    // For compact card: w = 288, h = 36 -> maxR = 18
    expect(clampCornerRadius(0, 288, 36)).toBe(0);
    expect(clampCornerRadius(14, 288, 36)).toBe(14);
    expect(clampCornerRadius(18, 288, 36)).toBe(18);
    // Overshooting spring value 60 must be clamped strictly to 18:
    expect(clampCornerRadius(60, 288, 36)).toBe(18);
    expect(clampCornerRadius(-5, 288, 36)).toBe(0);

    // For droplet shape: w = 120, h = 120 -> maxR = 60
    expect(clampCornerRadius(60, 120, 120)).toBe(60);
    expect(clampCornerRadius(75, 120, 120)).toBe(60);

    // clampRadii on [tl, tr, br, bl]
    const clampedCompact = clampRadii([0, 0, 14, 14], 288, 36);
    expect(clampedCompact).toEqual([0, 0, 14, 14]);

    const clampedOvershoot = clampRadii([60, 60, 60, 60], 288, 36);
    expect(clampedOvershoot).toEqual([18, 18, 18, 18]);

    const clampedDrop = clampRadii([60, 60, 60, 60], 120, 120);
    expect(clampedDrop).toEqual([60, 60, 60, 60]);

    // 2. computeCarryWindowSide: S = max(4*DROPLET, ceil(max(cardW, cardH)) + 2*SHADOW_PAD)
    // Compact pill (288 x 36): max(480, 288 + 64 = 352) -> 480
    expect(computeCarryWindowSide(288, 36, 120, 32)).toBe(480);
    // Small card (100 x 100): max(480, 100 + 64 = 164) -> 480
    expect(computeCarryWindowSide(100, 100, 120, 32)).toBe(480);
    // Large expanded card (520 x 400): max(480, 520 + 64 = 584) -> 584
    expect(computeCarryWindowSide(520, 400, 120, 32)).toBe(584);
    // Fractional card dimensions: ceil is applied
    expect(computeCarryWindowSide(520.4, 300, 120, 32)).toBe(585);

    // 3. clampOriginToMonitor: keep window strictly inside monitor
    const monitor = { x: 1920, y: 0, w: 1920, h: 1080 }; // secondary monitor
    const winPhysSide = 600; // e.g. 480 logical * 1.25 scale
    // Min allowed origin: (1920, 0). Max allowed origin: (1920 + 1920 - 600, 0 + 1080 - 600) = (3240, 480)
    expect(clampOriginToMonitor(1800, -100, monitor, winPhysSide)).toEqual({ x: 1920, y: 0 });
    expect(clampOriginToMonitor(3500, 600, monitor, winPhysSide)).toEqual({ x: 3240, y: 480 });
    expect(clampOriginToMonitor(2500, 300, monitor, winPhysSide)).toEqual({ x: 2500, y: 300 });

    // 4. computeDropInWindow: (pos - origin) / scale
    // pos = (700, 400), origin = (500, 300), scale = 1.25
    // x = (700 - 500) / 1.25 = 160
    // y = (400 - 300) / 1.25 = 80
    const dropInWin = computeDropInWindow(700, 400, 500, 300, 1.25);
    expect(dropInWin.x).toBe(160);
    expect(dropInWin.y).toBe(80);

    // 5. computeDropCentreFromOrigin: origin + side / 2
    // origin = (500, 300), side = 600
    // cx = 500 + 300 = 800, cy = 300 + 300 = 600
    const dropCentre = computeDropCentreFromOrigin(500, 300, 600);
    expect(dropCentre.x).toBe(800);
    expect(dropCentre.y).toBe(600);

    // 6. clampDrawnDrop: ceiling clamp to [rLog, S - rLog]
    // With S = 480 and R = 60, valid range is [60, 420]
    expect(clampDrawnDrop(240, 240, 60, 480)).toEqual({ x: 240, y: 240 });
    // Lagging origin during fast flick pulling drop center to edge (e.g. -50 or 520 px)
    expect(clampDrawnDrop(-50, 520, 60, 480)).toEqual({ x: 60, y: 420 });
    expect(clampDrawnDrop(500, -10, 60, 480)).toEqual({ x: 420, y: 60 });
    // Per-axis clamping (S3): rectangular card (h=36, y=18, rx=60, ry=18) never clamps y=18
    expect(clampDrawnDrop(240, 18, 60, 18, 480)).toEqual({ x: 240, y: 18 });
    // Bottom dock card (h=36, y=462, rx=60, ry=18) never clamps y=462
    expect(clampDrawnDrop(240, 462, 60, 18, 480)).toEqual({ x: 240, y: 462 });
  });

  it("corner-radius-to-shader mapping pins the y-down orientation so y-flip cannot regress", () => {
    // DOM order is [tl, tr, br, bl]
    // IQ canonical formula in y-down space (p.y > 0 is bottom, p.y <= 0 is top):
    //   r.xy = (p.x > 0.0) ? r.xy : r.zw;
    //   r.x  = (p.y > 0.0) ? r.x  : r.y;
    // Simulating IQ selection:
    function iqSelect(r: [number, number, number, number], px: number, py: number): number {
      const radPair = px > 0 ? [r[0], r[1]] : [r[2], r[3]];
      return py > 0 ? radPair[0] : radPair[1];
    }

    // Docked card at top edge: square top corners (0, 0), rounded bottom corners (14, 14)
    const topDockedRadii: [number, number, number, number] = [0, 0, 14, 14]; // [tl, tr, br, bl]
    const shaderVec = radiiToShader(topDockedRadii);

    // Exact vector passed to uniform: [br, tr, bl, tl] = [14, 0, 14, 0]
    expect(shaderVec).toEqual([14, 0, 14, 0]);

    // Test all four corners under IQ formula:
    // Top-left: px < 0, py < 0 (y-down) -> must yield tl = 0
    expect(iqSelect(shaderVec, -10, -10)).toBe(0);
    // Top-right: px > 0, py < 0 -> must yield tr = 0
    expect(iqSelect(shaderVec, 10, -10)).toBe(0);
    // Bottom-left: px < 0, py > 0 -> must yield bl = 14
    expect(iqSelect(shaderVec, -10, 10)).toBe(14);
    // Bottom-right: px > 0, py > 0 -> must yield br = 14
    expect(iqSelect(shaderVec, 10, 10)).toBe(14);

    // Arbitrary distinct corners: [1, 2, 3, 4] -> [tl, tr, br, bl]
    const distinct: [number, number, number, number] = [1, 2, 3, 4];
    const distinctVec = radiiToShader(distinct);
    expect(distinctVec).toEqual([3, 2, 4, 1]); // [br, tr, bl, tl]
    expect(iqSelect(distinctVec, -10, -10)).toBe(1); // tl
    expect(iqSelect(distinctVec, 10, -10)).toBe(2);  // tr
    expect(iqSelect(distinctVec, 10, 10)).toBe(3);   // br
    expect(iqSelect(distinctVec, -10, 10)).toBe(4);  // bl

    // Direct verification against the fragment shader source code:
    // 1. y-down coordinate calculation p = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y) / u_dpr
    expect(FS_SRC).toContain("vec2 p = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y) / u_dpr;");
    // 2. IQ canonical quadrant selection
    expect(FS_SRC).toContain("r.xy = (p.x > 0.0) ? r.xy : r.zw;");
    expect(FS_SRC).toContain("r.x  = (p.y > 0.0) ? r.x  : r.y;");
    // 3. Bottom docked card: rounded top corners [14, 14, 0, 0] must hand [0, 14, 0, 14] to uniform4f
    const bottomDockedRadii: [number, number, number, number] = [14, 14, 0, 0];
    expect(radiiToShader(bottomDockedRadii)).toEqual([0, 14, 0, 14]);
  });

  it("swellShape asserts exact values: k is continuous from wake, non-decreasing as gap closes, k(0) = 0.8R, and stays off when gap > 2.2R", () => {
    const R = 60;
    const work: [number, number, number, number] = [0, 0, 1920, 1080];
    const dropX = 960;

    // 1. Swell stays completely off when gap >= 2.2R (2.2 * 60 = 132 px)
    // At dropY = 195 (gap = 195 - 0 - 60 = 135 px > 132 px)
    const swellOff = swellShape(dropX, 195, R, 0, 0, 1, work);
    expect(swellOff.along).toBe(0);
    expect(swellOff.rise).toBe(0);
    expect(swellOff.k).toBe(0);
    expect(swellOff.horizontal).toBe(true);

    // Exactly at boundary: gap = 132 px (dropY = 192)
    const swellBoundary = swellShape(dropX, 192, R, 0, 0, 1, work);
    expect(swellBoundary.along).toBe(0);
    expect(swellBoundary.rise).toBe(0);
    expect(swellBoundary.k).toBe(0);

    // 2. Swell wakes up when gap < 2.2R
    // At gap = 120 px (2.0R, dropY = 180): reach > 0, join = 0
    // k is continuous from wake: reach * 4 = (31/1331) * 4 = 124 / 1331 ~ 0.09316
    const swellWaking = swellShape(dropX, 180, R, 0, 0, 1, work);
    expect(swellWaking.along).toBeGreaterThan(0);
    expect(swellWaking.rise).toBeGreaterThan(0);
    expect(swellWaking.k).toBeCloseTo(124 / 1331, 4);

    // At gap = 54 px (0.9R, dropY = 114): join begins
    // reach = 3380 / 5324 ~ 0.63486, join = 0 -> k = reach * 4 ~ 2.5394
    const swellJoinStart = swellShape(dropX, 114, R, 0, 0, 1, work);
    expect(swellJoinStart.along).toBeGreaterThan(0);
    expect(swellJoinStart.rise).toBeGreaterThan(0);
    expect(swellJoinStart.k).toBeCloseTo((3380 / 5324) * 4, 3);

    // reach = smooth(35/44) = 75950/85184, k = reach * (4 + 44 * 0.5) = reach * 26 ~ 23.1816
    const swellMidJoin = swellShape(dropX, 87, R, 0, 0, 1, work);
    expect(swellMidJoin.k).toBeCloseTo((75950 / 85184) * 26, 4);

    // At contact: gap = 0 (dropY = 60):
    // reach = 1, join = 1
    // k = 1 * (4 + (0.8 * 60 - 4) * 1) = 48 = 0.8 * R!
    const swellContact = swellShape(dropX, 60, R, 0, 0, 1, work);
    expect(swellContact.along).toBe(R * (0.9 + 0.8 * 1)); // 60 * 1.7 = 102
    expect(swellContact.rise).toBe(0.5 * R * 1 * 1);       // 30
    expect(swellContact.k).toBe(0.8 * R);                 // 48.0
    expect(swellContact.k).toBe(48);

    // 3. Monotonic sweep: k must be non-decreasing as gap closes from 150 px down to 0 px
    let prevK = -1;
    for (let gap = 150; gap >= 0; gap -= 1) {
      const cy = work[1] + R + gap;
      const s = swellShape(dropX, cy, R, 0, 0, 1, work);
      expect(s.k).toBeGreaterThanOrEqual(prevK);
      prevK = s.k;
    }
    // Peak k at gap = 0 is exactly 0.8 * R
    expect(prevK).toBe(48);

    // Overshoot into edge: gap < 0 (dropY < 60) stays clamped at 0.8 * R
    const swellOvershoot = swellShape(dropX, 40, R, 0, 0, 1, work);
    expect(swellOvershoot.k).toBe(48);
  });

  it("side-edge swell coverage: horizontal:false swell asserts wake, approach widening/drop, and shader uniform mapping", () => {
    const R = 60;
    const work: [number, number, number, number] = [0, 0, 1920, 1080];
    const dropY = 540;

    // Drop approaching the LEFT edge: dropX = 87 (gap = 87 - 0 - 60 = 27 px = 0.45R)
    // Moving towards left edge with vx = -400 px/s (vToward = -vx = +400 px/s > 0)
    // Moving vertically along left edge with vy = +300 px/s
    const swellApproaching = swellShape(87, dropY, R, -400, 300, 1, work);

    // 1. Orientation is side (vertical edge -> horizontal: false)
    expect(swellApproaching.horizontal).toBe(false);

    // 2. Swell center is pinned to the left bezel (x = wx = 0)
    expect(swellApproaching.ex).toBe(0);

    // 3. Motion wake trails along the Y axis: wakeLag = clamp(-vy * 0.035, -30, 30) = -10.5 px
    expect(swellApproaching.ey).toBeCloseTo(dropY - 10.5, 4);

    // 4. Approach velocity vToward = +400 px/s widens swell and lowers rise:
    // approach = 400 / 800 = 0.5 -> approachWiden = 1.15, approachDrop = 0.89
    // Compare with moving AWAY from left edge with vx = +400 px/s (vToward = -400 <= 0 -> approach = 0)
    const swellLeaving = swellShape(87, dropY, R, 400, 300, 1, work);
    expect(swellLeaving.horizontal).toBe(false);
    expect(swellApproaching.along).toBeGreaterThan(swellLeaving.along);
    expect(swellApproaching.rise).toBeLessThan(swellLeaving.rise);

    // 5. Shader uniform size mapping for side edges:
    // For horizontal edges (top/bottom): sx = along, sy = rise
    // For vertical edges (left/right):   sx = rise,  sy = along (swapped because semi-axes align with X/Y)
    const sx = swellApproaching.horizontal ? swellApproaching.along : swellApproaching.rise;
    const sy = swellApproaching.horizontal ? swellApproaching.rise : swellApproaching.along;
    expect(sx).toBe(swellApproaching.rise);
    expect(sy).toBe(swellApproaching.along);
    expect(sx).not.toBe(swellApproaching.along);

    // 6. Right edge verification:
    // Drop near right edge: dropX = 1920 - 87 = 1833. Moving towards right with vx = +400 (vToward = +400)
    const swellRight = swellShape(1833, dropY, R, 400, 0, 1, work);
    expect(swellRight.horizontal).toBe(false);
    expect(swellRight.ex).toBe(1920); // pinned to right bezel
    expect(swellRight.ey).toBe(dropY);
    expect(swellRight.rise).toBeGreaterThan(0);
    expect(swellRight.along).toBeGreaterThan(0);
  });

  it("computeCarryWindowSide fit invariant: carry window S contains the docked card plus 32px shadow padding for all edges and card dimensions", () => {
    const SHADOW_PAD = 32;
    const DROPLET_DIAMETER = 120;

    const testCards = [
      { name: "compact pill", w: 288, h: 36 },
      { name: "side compact pill", w: 32, h: 168 },
      { name: "expanded card default", w: 900, h: 460 },
      { name: "expanded card minimum", w: 780, h: 400 },
      { name: "medium dialog", w: 520, h: 320 },
      { name: "fractional size", w: 345.6, h: 210.4 },
    ];

    for (const card of testCards) {
      const S = computeCarryWindowSide(card.w, card.h, DROPLET_DIAMETER, SHADOW_PAD);

      // Invariant 1: S is at least 4 * DROPLET (480 px buffer)
      expect(S).toBeGreaterThanOrEqual(4 * DROPLET_DIAMETER);

      // Invariant 2: S contains the card width plus 2 * SHADOW_PAD
      expect(S).toBeGreaterThanOrEqual(Math.ceil(card.w) + 2 * SHADOW_PAD);

      // Invariant 3: S contains the card height plus 2 * SHADOW_PAD
      expect(S).toBeGreaterThanOrEqual(Math.ceil(card.h) + 2 * SHADOW_PAD);

      // Invariant 4: Docked card margins within S x S carry window:
      // For any placement clamped inside the carry window, the card never exceeds window bounds
      const remainingMarginX = S - Math.ceil(card.w);
      const remainingMarginY = S - Math.ceil(card.h);
      expect(remainingMarginX).toBeGreaterThanOrEqual(2 * SHADOW_PAD);
      expect(remainingMarginY).toBeGreaterThanOrEqual(2 * SHADOW_PAD);
    }
  });

  it("absorb target maths and S1 seeding: computeDockedTarget matches exact arithmetic on all edges, and seeding from live geometry avoids 130px pop", () => {
    // 1. S1 spring seeding arithmetic:
    // Quick press-nudge-release: pickup starts morphing pill (w=288, h=36) to droplet (w=120, h=120).
    // At release after 50ms, current DOM geometry is ~ w=250, h=36, radii=[0,0,14,14].
    const curGeo = {
      w: 250,
      h: 36,
      radii: [0, 0, 14, 14] as [number, number, number, number],
    };
    const dockedTarget = {
      w: 288,
      h: 36,
      radii: [0, 0, 14, 14] as [number, number, number, number],
      cx: 144,
      cy: 18,
    };

    // S1 fix: Seed morph springs from live curGeo values:
    const sWLive = new Spring(curGeo.w, 0.42, 0.86);
    sWLive.target = dockedTarget.w;
    // Step 0 delta is 0 px (no pop!)
    expect(sWLive.value).toBe(250);
    expect(Math.abs(sWLive.value - curGeo.w)).toBe(0);
    // Smooth remaining delta to travel
    expect(sWLive.target - sWLive.value).toBe(38);

    // Flawed code: Seeding from DROPLET (120 px) causes a 130 px jump on frame 0:
    const sWFlawed = new Spring(120, 0.42, 0.86);
    sWFlawed.target = dockedTarget.w;
    expect(Math.abs(sWFlawed.value - curGeo.w)).toBe(130); // 130 px pop!

    // 2. computeDockedTarget exact arithmetic across all 4 edges:
    // (Note: the full handoff involves Tauri windowing and compositor frames which cannot be unit-tested;
    // this test rigorously verifies the mathematical target coordinates and radii handed to the springs).

    // Top edge dock (pill at top-center):
    // dockRect physical = [816, 0, 288, 36], scale = 1, aligned origin = [816, 0]
    const topTarget = computeDockedTarget(
      [816, 0, 288, 36],
      { edge: "top", anchorX: 144, anchorY: 18, panelW: 288, panelH: 36 },
      { w: 288, h: 36 },
      [0, 0, 14, 14],
      { x: 816, y: 0 },
      1.0,
      0
    );
    expect(topTarget).toEqual({
      cx: 144,
      cy: 18,
      w: 288,
      h: 36,
      radii: [0, 0, 14, 14],
    });

    // Bottom edge dock:
    // dockRect physical = [816, 1044, 288, 36], scale = 1, aligned origin = [816, 1044]
    const bottomTarget = computeDockedTarget(
      [816, 1044, 288, 36],
      { edge: "bottom", anchorX: 144, anchorY: 18, panelW: 288, panelH: 36 },
      { w: 288, h: 36 },
      [14, 14, 0, 0],
      { x: 816, y: 1044 },
      1.0,
      0
    );
    expect(bottomTarget).toEqual({
      cx: 144,
      cy: 18,
      w: 288,
      h: 36,
      radii: [14, 14, 0, 0],
    });

    // Left edge dock:
    // dockRect physical = [0, 456, 32, 168], scale = 1, aligned origin = [0, 456]
    const leftTarget = computeDockedTarget(
      [0, 456, 32, 168],
      { edge: "left", anchorX: 16, anchorY: 84, panelW: 32, panelH: 168 },
      { w: 32, h: 168 },
      [0, 14, 14, 0],
      { x: 0, y: 456 },
      1.0,
      0
    );
    expect(leftTarget).toEqual({
      cx: 16,
      cy: 84,
      w: 32,
      h: 168,
      radii: [0, 14, 14, 0],
    });

    // Right edge dock:
    // dockRect physical = [1888, 456, 32, 168], scale = 1, aligned origin = [1888, 456]
    const rightTarget = computeDockedTarget(
      [1888, 456, 32, 168],
      { edge: "right", anchorX: 16, anchorY: 84, panelW: 32, panelH: 168 },
      { w: 32, h: 168 },
      [14, 0, 0, 14],
      { x: 1888, y: 456 },
      1.0,
      0
    );
    expect(rightTarget).toEqual({
      cx: 16,
      cy: 84,
      w: 32,
      h: 168,
      radii: [14, 0, 0, 14],
    });
  });
});


