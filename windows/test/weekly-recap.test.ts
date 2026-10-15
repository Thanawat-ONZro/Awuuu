import { describe, expect, it } from "vitest";
import { weekStart, weeklyRecap } from "../src/app/weekly";
import type { HistoryData, HistoryEntry } from "../src/core/bridge";

// Local-time fixtures: Mon 2026-10-12 is the week start. "Now" is Thu 15 Oct.
const at = (day: number, h = 0, m = 0) => new Date(2026, 9, day, h, m).getTime();
const MON = at(12);
const NEXT_MON = at(19);
const NOW = at(15, 12);

let n = 0;
function e(over: Partial<HistoryEntry>): HistoryEntry {
  n++;
  return { id: `x:${n}`, session: "s1", agent: "claude", at: MON, kind: "tool", tool: "", title: "", status: "ok", ...over };
}
const min = 60_000;

const data: HistoryData = {
  sessions: { s1: { cwd: "C:\\code\\awuuu", name: "Awuuu work" }, s2: { cwd: "C:\\code\\site" }, s3: { cwd: "C:\\code\\awuuu" } },
  entries: [
    e({ at: at(5, 23, 0), kind: "prompt", session: "s9" }), // previous week
    e({ at: NEXT_MON, kind: "prompt", session: "s9" }), // next Monday 00:00: excluded
    e({ at: MON, kind: "prompt", session: "s1" }), // Monday 00:00: included
    e({ at: MON + 5 * min, kind: "edit", session: "s1", title: "a.ts", files: [{ path: "a.ts", change: "edit" }] }),
    e({ at: MON + 6 * min, kind: "write", session: "s1", title: "A.ts", files: [{ path: "A.ts", change: "write" }] }),
    e({ at: MON + 7 * min, kind: "read", session: "s1", title: "r.ts", files: [{ path: "r.ts", change: "read" }] }),
    e({ at: MON + 8 * min, kind: "edit", session: "s1", status: "failed", title: "f.ts", files: [{ path: "f.ts", change: "edit" }] }),
    e({ at: MON + 9 * min, kind: "run", session: "s1", ms: 3 * min }),
    e({ at: at(14, 10), kind: "prompt", session: "s2", agent: "codex" }),
    e({ at: at(14, 10, 1), kind: "prompt", session: "s2", agent: "codex" }),
    e({ at: at(14, 10, 2), kind: "run", session: "s2", agent: "codex" }),
    e({ at: at(14, 15), kind: "prompt", session: "s3" }),
    e({ at: at(14, 17), kind: "done", session: "s3", ms: 30 * min }),
  ],
};

describe("weekStart", () => {
  it("is Monday 00:00 local", () => {
    expect(weekStart(at(15, 12))).toBe(MON);
    expect(weekStart(MON)).toBe(MON);
    expect(weekStart(at(18, 23, 59))).toBe(MON);
    expect(weekStart(at(18, 23, 59) + 2 * min)).toBe(NEXT_MON);
    expect(weekStart(at(11, 23, 59))).toBe(at(5));
  });
});

describe("weeklyRecap", () => {
  const r = weeklyRecap(data, NOW);

  it("covers Monday 00:00 (inclusive) to the next Monday (exclusive)", () => {
    expect([r.start, r.end]).toEqual([MON, NEXT_MON]);
    expect(r.requests).toBe(4);
    expect(r.sessions).toBe(3);
  });

  it("counts files, commands", () => {
    expect(r.filesChanged).toBe(1); // a.ts/A.ts same file; read and failed edit ignored
    expect(r.commands).toBe(2);
  });

  it("does not invent lines or permissions", () => {
    expect([r.linesAdded, r.linesRemoved, r.permissions]).toEqual([null, null, null]);
  });

  it("finds the tops", () => {
    expect(r.topAgent).toEqual({ agent: "claude", requests: 2 });
    expect(r.topProject).toEqual({ cwd: "C:\\code\\awuuu", name: "awuuu", sessions: 2 });
    expect(r.busiestDay).toEqual({ start: at(14), requests: 3 });
    expect(r.longestSession?.id).toBe("s3");
    expect(r.longestSession?.ms).toBe(2 * 60 * min + 30 * min);
    expect(r.days.map((d) => d.requests)).toEqual([1, 0, 3, 0, 0, 0, 0]);
  });

  it("merges coding time with a 10 minute idle tolerance", () => {
    // Mon 0:00-0:12, Wed 10:00-10:02, 15:00 alone, 17:00-17:30 (2 h gaps split).
    expect(r.codingMs).toBe((12 + 2 + 0 + 30) * min);
  });

  it("looks back by weeks and handles an empty week", () => {
    const prev = weeklyRecap(data, NOW, 1);
    expect(prev.start).toBe(at(5));
    expect(prev.requests).toBe(1);
    const none = weeklyRecap(data, NOW, 3);
    expect(none.any).toBe(false);
    expect(none.topAgent).toBeNull();
    expect(none.busiestDay).toBeNull();
    expect(weeklyRecap(null, NOW).any).toBe(false);
  });
});
