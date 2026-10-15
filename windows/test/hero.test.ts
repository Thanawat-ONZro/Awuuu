import { describe, expect, it } from "vitest";
import { heroTone, makeParticles, parseHex, stepParticles } from "../src/app/hero";

describe("hero helpers", () => {
  it("maps pages to tokens, caramel by default", () => {
    expect(heroTone("agents").token).toBe("--state-agent");
    expect(heroTone("chat").token).toBe("--state-info");
    expect(heroTone("stats").token).toBe("--state-done");
    expect(heroTone("integrations").token).toBe("--state-wait");
    expect(heroTone("privacy").strength).toBeLessThan(heroTone("agents").strength);
    expect(heroTone("about").token).toBe("--accent-caramel");
    expect(heroTone(null).token).toBe("--accent-caramel");
  });
  it("parses hex colours", () => {
    expect(parseHex("#e4a871")).toEqual([228, 168, 113]);
    expect(parseHex(" #fff ")).toEqual([255, 255, 255]);
    expect(parseHex("nope")).toBeNull();
  });
  it("pushes particles away from the pointer and keeps them in bounds", () => {
    const ps = [{ x: 100, y: 30, vx: 0, vy: 0, r: 1, a: 0.1 }];
    stepParticles(ps, 0.05, 400, 72, { x: 90, y: 30 });
    expect(ps[0].x).toBeGreaterThan(100);
    const many = makeParticles(300, 72, () => 0.5);
    for (let i = 0; i < 200; i++) stepParticles(many, 0.05, 300, 72, null);
    expect(many.every((p) => p.x >= -4 && p.x <= 304 && p.y >= -4 && p.y <= 76)).toBe(true);
  });
});
