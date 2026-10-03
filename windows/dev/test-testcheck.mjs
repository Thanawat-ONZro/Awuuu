// Tests for the test-result reader (src/app/testcheck.ts).  node dev/test-testcheck.mjs
import assert from "node:assert/strict";
import { parseTestOutput, isTestCommand, judgeRun, testStatus, testLine } from "../src/app/testcheck.ts";

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`ok  ${name}`); }

const run = (title, detail, status, at) => ({ id: `s:${at}`, session: "s", agent: "claude", at, kind: "run", tool: "Bash", title, detail, status });
const edit = (path, at, status = "ok") => ({ id: `s:${at}`, session: "s", agent: "claude", at, kind: "edit", tool: "Edit", title: path, files: [{ path, change: "edit" }], status });
const turn = (steps) => ({ index: 0, prompt: null, steps, end: null, facts: {} });

test("runners' summaries", () => {
  assert.deepEqual(parseTestOutput("Tests:       1 failed, 2 skipped, 4 passed, 7 total"), { runner: "jest/vitest", passed: 4, failed: 1, skipped: 2 });
  assert.deepEqual(parseTestOutput(" Tests  1 failed | 4 passed (5)"), { runner: "jest/vitest", passed: 4, failed: 1, skipped: 0 });
  assert.deepEqual(parseTestOutput("===== 1 failed, 3 passed, 2 skipped in 0.51s ====="), { runner: "pytest", passed: 3, failed: 1, skipped: 2 });
  assert.deepEqual(parseTestOutput("test result: ok. 7 passed; 0 failed; 1 ignored\ntest result: ok. 2 passed; 0 failed; 0 ignored"), { runner: "cargo", passed: 9, failed: 0, skipped: 1 });
  assert.deepEqual(parseTestOutput("# tests 6\n# pass 5\n# fail 1\n# skipped 0"), { runner: "node:test", passed: 5, failed: 1, skipped: 0 });
  assert.deepEqual(parseTestOutput("Passed!  - Failed: 0, Passed: 5, Skipped: 1, Total: 6"), { runner: "dotnet", passed: 5, failed: 0, skipped: 1 });
  assert.equal(parseTestOutput("ok  \texample.com/a\t0.2s\nFAIL\texample.com/b").failed, 1);
  assert.equal(parseTestOutput("compiled fine"), null);
});

test("which commands are test runs", () => {
  for (const c of ["npm test", "pnpm run test", "npx vitest run", "cargo test --lib", "python -m pytest -q", "node --test dev/", "go test ./..."]) assert.ok(isTestCommand(c), c);
  for (const c of ["npm install", "cargo build", "git status", "echo test"]) assert.ok(!isTestCommand(c), c);
});

test("zero tests or no summary never read as passed", () => {
  assert.equal(judgeRun(run("pytest", "no tests ran in 0.01s", "ok", 1)).verdict, "unclear");
  assert.equal(judgeRun(run("cargo test", "test result: ok. 0 passed; 0 failed; 0 ignored", "ok", 1)).verdict, "unclear");
  assert.equal(judgeRun(run("npm test", "", "ok", 1)).verdict, "unclear");
  assert.equal(judgeRun(run("npm test", "", "failed", 1)).verdict, "failed");
  assert.equal(judgeRun(run("cargo test", "test result: ok. 3 passed; 0 failed; 0 ignored", "ok", 1)).verdict, "passed");
  assert.equal(judgeRun(run("cargo test", "test result: ok. 3 passed; 0 failed; 0 ignored", "failed", 1)).verdict, "failed");
});

test("retries and edits after the last run", () => {
  const ok = "Tests: 4 passed, 4 total";
  const bad = "Tests: 1 failed, 3 passed, 4 total";
  const t = turn([run("npm test", bad, "failed", 1), edit("a.ts", 2), run("npm test", ok, "ok", 3), edit("b.ts", 4), edit("b.ts", 5), edit("c.ts", 6, "failed")]);
  const s = testStatus(t);
  assert.equal(s.tries, 2);
  assert.equal(s.changedAfter, 1);
  assert.equal(testLine(s), "Tests passed (4 passed), fixed on try 2 · 1 file changed since: not tested again");
  const stuck = testStatus(turn([run("npm test", bad, "failed", 1), run("npm test", bad, "failed", 2), run("npm test", bad, "failed", 3)]));
  assert.equal(testLine(stuck), "Tests failed (1 failed, 3 passed), still failing after 3 tries");
});

test("no test run, no line", () => {
  assert.equal(testLine(testStatus(turn([edit("a.ts", 1)]))), "");
});

console.log(`\n${passed} passed`);
