import { describe, expect, it } from "vitest";
import { awarenessNote, redact } from "../src/island/awareness";
import type { AgentTask } from "../src/core/state";

function task(over: Partial<AgentTask>): AgentTask {
  return { id: "1", name: "Claude Code", color: "#f00", state: "working", stepIndex: 0, steps: ["Edit billing.ts"], source: "claude", isIntegration: false, ...over };
}

describe("redact", () => {
  it("removes e-mails, keys, tokens and the home folder", () => {
    const out = redact("mail owen@example.com key sk-ant-abcdefghijklmnop ghp_abcdefghijklmnopqrstu in C:\\Users\\owen\\code and /home/owen/x");
    expect(out).not.toMatch(/owen@|sk-ant|ghp_|\\Users\\owen|\/home\/owen/);
    expect(out).toContain("[email]");
    expect(out).toContain("[key]");
    expect(out).toContain("~\\code");
  });

  it("leaves ordinary words alone", () => {
    expect(redact("ประชุมทีม 14:00 · Review requested · awuuu")).toBe("ประชุมทีม 14:00 · Review requested · awuuu");
  });
});

describe("awarenessNote", () => {
  it("is empty when there is nothing to say", () => {
    expect(awarenessNote([], [], "now")).toBe("");
    expect(awarenessNote([], [task({ state: "idle" })], "now")).toBe("");
  });

  it("lists agents and today's rows", () => {
    const note = awarenessNote(
      [{ icon: "📅", title: "Standup", sub: "In 10 min" }, { icon: "✗", title: "CI failed", sub: "awuuu", bad: true }],
      [task({ sessionCwd: "C:\\Users\\owen\\code\\awuuu", plan: { items: [], done: 1, total: 3, current: "Run tests" } })],
      "Sat 3 Oct, 14:05",
    );
    expect(note).toContain("Local time: Sat 3 Oct, 14:05.");
    expect(note).toContain("- Claude Code in awuuu: working (Run tests), plan 1/3");
    expect(note).toContain("- 📅 Standup · In 10 min");
    expect(note).toContain("CI failed · awuuu (needs attention)");
  });

  it("names the error of a failed agent and skips integrations", () => {
    const note = awarenessNote([], [
      task({ state: "error", log: [{ kind: "error", text: "tests failed: 2", at: 1 }] }),
      task({ name: "GitHub", isIntegration: true }),
    ], "now");
    expect(note).toContain("hit an error (tests failed: 2)");
    expect(note).not.toContain("GitHub");
  });

  it("stays short", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ icon: "•", title: "x".repeat(200) + i }));
    expect(awarenessNote(rows, [], "now").length).toBeLessThanOrEqual(900);
  });
});
