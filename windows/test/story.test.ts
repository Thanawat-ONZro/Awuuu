import { describe, expect, it } from "vitest";
import { buildTurns } from "../src/app/recap";
import { turnStory } from "../src/app/story";
import type { HistoryEntry } from "../src/core/bridge";

let n = 0;
function e(over: Partial<HistoryEntry>): HistoryEntry {
  n++;
  return { id: `s:${n}`, session: "s", agent: "claude", at: n * 1000, kind: "tool", tool: "", title: "", status: "ok", ...over };
}
const prompt = (t: string) => e({ kind: "prompt", title: t, status: "info" });
const edit = (path: string) => e({ kind: "edit", tool: "Edit", title: path, files: [{ path, change: "edit" }] });
const run = (cmd: string, out: string, ok = true) => e({ kind: "run", tool: "Bash", title: cmd, detail: out, status: ok ? "ok" : "failed" });
const done = () => e({ kind: "done", title: "Done", status: "ok" });

function story(entries: HistoryEntry[]) {
  return turnStory(buildTurns(entries)[0]);
}

describe("turnStory", () => {
  it("tells a fix that took two tries", () => {
    const s = story([
      prompt("fix the bug"), edit("src/a.ts"),
      run("npm test", "Tests  1 failed | 4 passed (5)", false),
      edit("src/a.ts"),
      run("npm test", "Tests  1 failed | 4 passed (5)", false),
      edit("src/b.ts"),
      run("npm test", "Tests  5 passed (5)"),
      run("git commit -m fix", "1 file changed"),
      done(),
    ]);
    expect(s.line).toBe("Changed 2 files · tests failed 2× then passed (5) · committed");
    expect(s.tests).toBe("passed");
    expect(s.warnings).toEqual([]);
  });

  it("warns about edits after the last test and about untested code", () => {
    expect(story([prompt("x"), edit("a.rs"), run("cargo test", "test result: ok. 3 passed; 0 failed"), edit("a.rs"), done()]).warnings)
      .toEqual(["Files changed after the last test run"]);
    expect(story([prompt("x"), edit("main.py"), done()]).warnings).toEqual(["Code changed, no tests were run"]);
    expect(story([prompt("x"), edit("README.md"), done()]).warnings).toEqual([]);
  });

  it("uses git's line count when the snapshot is there", () => {
    const git = e({ kind: "tool", tool: "git", title: "Git: 2 files changed +42 −7", status: "info", files: [{ path: "c.ts", change: "edit" }] });
    expect(story([prompt("x"), edit("a.ts"), git, done()]).line).toMatch(/^Changed 2 files \(\+42 −7\)/);
  });

  it("names failures and unfinished work", () => {
    expect(story([prompt("x"), run("npm run build", "error TS2322", false), e({ kind: "error", title: "boom", status: "failed" })]).line)
      .toBe("1 command failed · ended with an error");
    expect(story([prompt("x"), run("ls", "a")]).line).toBe("Not finished");
    expect(story([prompt("hi"), done()]).line).toBe("Answered");
  });
});
