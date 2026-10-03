// Tests for the two-agents-one-file check (src/island/overlap.ts).  node dev/test-overlap.mjs
import assert from "node:assert/strict";
import { noteEdit, overlapMessage, resetOverlap, OVERLAP_WINDOW_MS } from "../src/island/overlap.ts";

let passed = 0;
function test(name, fn) { resetOverlap(); fn(); passed++; console.log(`ok  ${name}`); }

const MIN = 60_000;

test("another session's recent change is reported", () => {
  assert.equal(noteEdit("a", "Claude", "C:\\p\\Billing.ts", 0), null);
  const prev = noteEdit("b", "Codex", "c:/p/billing.ts", 2 * MIN);
  assert.equal(prev?.who, "Claude");
  assert.equal(overlapMessage("c:/p/billing.ts", prev, 2 * MIN), "⚠ Claude changed billing.ts 2 minutes ago. Make sure this agent has read the latest version.");
});

test("the same session asking twice is silent", () => {
  noteEdit("a", "Claude", "x.ts", 0);
  assert.equal(noteEdit("a", "Claude", "x.ts", 1000), null);
});

test("an old change is not a conflict", () => {
  noteEdit("a", "Claude", "x.ts", 0);
  assert.equal(noteEdit("b", "Codex", "x.ts", OVERLAP_WINDOW_MS + 1), null);
});

test("other files are unaffected, and the latest editor is the one remembered", () => {
  noteEdit("a", "Claude", "x.ts", 0);
  assert.equal(noteEdit("b", "Codex", "y.ts", 1000), null);
  noteEdit("b", "Codex", "x.ts", 2000); // reported, then b owns it
  assert.equal(noteEdit("a", "Claude", "x.ts", 3000)?.who, "Codex");
});

console.log(`\n${passed} passed`);
