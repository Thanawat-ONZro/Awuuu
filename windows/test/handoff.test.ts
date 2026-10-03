import { describe, expect, it } from "vitest";
import { handoffNote } from "../src/app/handoff";
import { summarizeSessions } from "../src/app/recap";
import type { HistoryEntry } from "../src/core/bridge";

let n = 0;
const e = (over: Partial<HistoryEntry>): HistoryEntry => ({ id: `s:${++n}`, session: "s", agent: "claude", at: n * 1000, kind: "tool", tool: "", title: "", status: "ok", ...over });

describe("handoffNote", () => {
  it("hands over what was asked, what changed and how the tests stand", () => {
    const entries = [
      e({ kind: "prompt", title: "Fix the login bug", status: "info" }),
      e({ kind: "edit", tool: "Edit", title: "C:/app/src/login.ts", files: [{ path: "C:/app/src/login.ts", change: "edit" }] }),
      e({ kind: "run", tool: "Bash", title: "npm test", detail: "Tests  1 failed | 9 passed (10)", status: "failed" }),
      e({ kind: "done", title: "I fixed it", detail: "I fixed the login bug.", status: "ok" }),
    ];
    const [s] = summarizeSessions({ entries, sessions: { s: { cwd: "C:/app" } } }, n * 1000 + 10);
    const note = handoffNote(s);
    expect(note).toContain("Fix the login bug");
    expect(note).toContain("(its own account)");
    expect(note).toContain("`src/login.ts` (edited)");
    expect(note).toContain("In short: Changed 1 file · 1 test failing.");
    expect(note).toContain("Last failed command: `npm test`");
  });
});
