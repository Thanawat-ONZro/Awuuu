// Tests for the handoff note (src/app/handoff.ts).  node dev/test-handoff.mjs
import assert from "node:assert/strict";
import { handoffNote } from "../src/app/handoff.ts";
import { buildTurns } from "../src/app/recap.ts";

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`ok  ${name}`); }

const e = (at, kind, title, extra = {}) => ({ id: `s:${at}`, session: "s", agent: "claude", at, kind, tool: "", title, status: "ok", ...extra });
const session = (entries) => ({ id: "s", agent: "claude", name: "x", cwd: "C:/proj/app", first: 0, last: 9, entries, turns: buildTurns(entries), facts: {}, requests: 1, state: "" });

test("asks, claims, files, tests and the last failure all show", () => {
  const entries = [
    e(1, "prompt", "Fix the billing bug"),
    e(2, "edit", "C:/proj/app/src/billing.ts", { files: [{ path: "C:/proj/app/src/billing.ts", change: "edit" }] }),
    e(3, "run", "npm test", { status: "failed", tool: "Bash", detail: "Tests: 1 failed, 3 passed, 4 total\nError: expected 2" }),
    e(4, "done", "Fixed it", { detail: "Fixed the rounding." }),
  ];
  const note = handoffNote(session(entries));
  assert.match(note, /Fix the billing bug/);
  assert.match(note, /its own account\)\n\nFixed the rounding\./);
  assert.match(note, /`src\/billing\.ts` \(edited\)/);
  assert.match(note, /Tests failed \(1 failed, 3 passed\)/);
  assert.match(note, /Last failed command: `npm test`/);
  assert.match(note, /run `git status`/);
});

test("no tests and no changes are said plainly; an empty session still reads", () => {
  const note = handoffNote(session([e(1, "prompt", "Explain the code"), e(2, "done", "Explained")]));
  assert.match(note, /No file changes were recorded/);
  assert.match(note, /No tests were run by the agent/);
  assert.match(handoffNote(session([])), /Nothing was recorded/);
});

console.log(`\n${passed} passed`);
