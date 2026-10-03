// Did the tests really pass? Reads a command and its output and says
// "passed", "failed", "no-tests" or "unclear", with the counts it found.
//
// The exit status alone lies both ways: `npm test` with zero test files exits
// 0, and a runner can exit 1 because of a lint step after every test passed.
// So the output decides when it can, and "0 tests" never counts as a pass.
// No DOM: tested in node.

export type TestVerdict = "passed" | "failed" | "no-tests" | "unclear";

export interface TestResult {
  verdict: TestVerdict;
  /** The runner, when the output says which. */
  runner?: string;
  passed?: number;
  failed?: number;
}

const TEST_COMMAND =
  /(^|[\s;&|(])(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\b(npx\s+|bunx\s+)?(vitest|jest|mocha|ava|playwright\s+test|cypress\s+run)\b|\bpytest\b|\bpython3?\s+-m\s+(pytest|unittest)\b|\bcargo\s+(test|nextest)\b|\bgo\s+test\b|\bdotnet\s+test\b|\bmvn\b.*\btest\b|\bgradlew?\b.*\btest\b|\b(rspec|phpunit|deno\s+test|swift\s+test|mix\s+test|ctest)\b/i;

/** Is this command a test run? */
export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command);
}

const num = (s: string | undefined) => (s == null ? 0 : Number(s.replace(/,/g, "")) || 0);

interface Counts {
  runner: string;
  passed: number;
  failed: number;
}

/** Each runner's summary line(s). The last match in the output wins. */
const PARSERS: { runner: string; re: RegExp; read: (m: RegExpMatchArray) => Omit<Counts, "runner"> }[] = [
  // cargo: "test result: ok. 81 passed; 0 failed; 1 ignored"
  { runner: "cargo", re: /test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed/g, read: (m) => ({ passed: num(m[1]), failed: num(m[2]) }) },
  // vitest: "Tests  2 failed | 34 passed (36)"
  { runner: "vitest", re: /Tests\s+(?:(\d+) failed\s*\|\s*)?(?:(\d+) passed)?[^\n]*\((\d+)\)/g, read: (m) => ({ failed: num(m[1]), passed: num(m[2]) }) },
  // jest: "Tests:       1 failed, 2 skipped, 12 passed, 15 total"
  { runner: "jest", re: /Tests:\s+(?:(\d+) failed,\s*)?(?:\d+ \w+,\s*)*?(?:(\d+) passed,\s*)?\d+ total/g, read: (m) => ({ failed: num(m[1]), passed: num(m[2]) }) },
  // pytest: "=== 3 failed, 10 passed in 1.2s ===", "=== 5 passed in 0.1s ==="
  { runner: "pytest", re: /=+ (?:(\d+) failed)?(?:, )?(?:(\d+) passed)?[^=\n]* in [\d.]+s(?: \([^)]*\))? =+/g, read: (m) => ({ failed: num(m[1]), passed: num(m[2]) }) },
  // mocha: "  12 passing (30ms)" / "  2 failing"
  { runner: "mocha", re: /^\s*(\d+) passing\b[^\n]*(?:\n(?:[^\n]*\n)*?\s*(\d+) failing)?/gm, read: (m) => ({ passed: num(m[1]), failed: num(m[2]) }) },
  // unittest: "Ran 12 tests in 0.01s" … "OK" / "FAILED (failures=2)"
  { runner: "unittest", re: /Ran (\d+) tests? in [\d.]+s\s+(OK|FAILED \((?:failures|errors)=(\d+)(?:, (?:failures|errors)=(\d+))?\))/g, read: (m) => { const failed = num(m[3]) + num(m[4]); return { passed: num(m[1]) - failed, failed }; } },
  // dotnet: "Failed!  - Failed: 1, Passed: 9," / "Passed!  - Failed: 0, Passed: 10,"
  { runner: "dotnet", re: /(?:Passed|Failed)!\s+-\s+Failed:\s+(\d+), Passed:\s+(\d+)/g, read: (m) => ({ failed: num(m[1]), passed: num(m[2]) }) },
];

function counts(output: string): Counts | null {
  let best: { at: number; c: Counts } | null = null;
  for (const p of PARSERS) {
    for (const m of output.matchAll(p.re)) {
      const at = m.index ?? 0;
      if (!best || at >= best.at) best = { at, c: { runner: p.runner, ...p.read(m) } };
    }
  }
  // cargo prints one "test result" per test binary: add them up.
  if (best?.c.runner === "cargo") {
    let passed = 0;
    let failed = 0;
    for (const m of output.matchAll(PARSERS[0].re)) {
      passed += num(m[1]);
      failed += num(m[2]);
    }
    best.c = { runner: "cargo", passed, failed };
  }
  return best?.c ?? null;
}

const NO_TESTS = /\b(no tests? (were )?(found|ran|to run|collected)|collected 0 items|0 tests? ran|no test files found|Ran 0 tests|testing: warning: no tests to run)\b/i;
const GO_OK = /^ok\s+\S+\s+[\d.]+s/m;
const GO_FAIL = /^(FAIL|--- FAIL)\b/m;

/** What a test command's output says. `ok` is the command's exit status when known. */
export function readTestOutput(output: string, ok?: boolean): TestResult {
  const c = counts(output);
  if (c) {
    if (c.failed > 0) return { verdict: "failed", ...c };
    if (c.passed > 0) return { verdict: "passed", ...c };
    return { verdict: "no-tests", ...c };
  }
  if (NO_TESTS.test(output)) return { verdict: "no-tests" };
  if (GO_FAIL.test(output)) return { verdict: "failed", runner: "go" };
  if (GO_OK.test(output)) return { verdict: "passed", runner: "go" };
  // No summary: a failing exit is a fail; a clean exit says nothing about tests.
  if (ok === false) return { verdict: "failed" };
  return { verdict: "unclear" };
}
