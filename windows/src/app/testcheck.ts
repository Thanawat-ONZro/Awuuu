// Was the code tested? Reads the test runs inside one request (turn) and says whether
// the latest result passed, failed or can't be told, and whether files changed after it.
//
// Same honesty rule as recap.ts: only what the output shows. A run with no recognisable
// summary is "unclear", never "passed"; "0 tests" is unclear too. Pure, no DOM.

import type { HistoryEntry } from "../core/bridge";
import type { Turn } from "./recap";

export interface TestCounts {
  passed: number;
  failed: number;
  skipped: number;
  /** Which runner's summary line it was read from. */
  runner: string;
}

const TEST_COMMAND = /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test|vitest|jest|pytest|cargo\s+test|go\s+test|dotnet\s+test|node\s+(?:\S+\s+)*--test|mocha|phpunit|rspec|mvn\s+(?:\S+\s+)*test|gradle\s+test|ctest)\b/i;

export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command);
}

const num = (s: string | undefined) => (s === undefined ? 0 : Number(s));

/** "4 passed" → 4, looked up in one summary line. */
const count = (line: string, word: string) => num(new RegExp(`(\\d+) ${word}`).exec(line)?.[1]);

/** The counts in a runner's own summary, or null when no known summary is there. */
export function parseTestOutput(output: string): TestCounts | null {
  const text = output ?? "";
  let m: RegExpExecArray | null;

  // cargo: "test result: ok. 7 passed; 0 failed; 1 ignored" (one per binary: add them up)
  const cargo = [...text.matchAll(/test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored/g)];
  if (cargo.length) {
    return {
      runner: "cargo",
      passed: cargo.reduce((a, c) => a + num(c[1]), 0),
      failed: cargo.reduce((a, c) => a + num(c[2]), 0),
      skipped: cargo.reduce((a, c) => a + num(c[3]), 0),
    };
  }
  // node:test: "# pass 5" "# fail 0" "# skipped 1"
  if ((m = /^# pass (\d+)$/m.exec(text))) {
    return {
      runner: "node:test",
      passed: num(m[1]),
      failed: num(/^# fail (\d+)$/m.exec(text)?.[1]),
      skipped: num(/^# (?:skipped|todo) (\d+)$/m.exec(text)?.[1]),
    };
  }
  // jest / vitest: "Tests:  1 failed, 2 skipped, 4 passed, 7 total" or "Tests  1 failed | 4 passed (5)"
  if ((m = /^\s*Tests:?\s+(.*)$/m.exec(text)) && /\b(passed|failed)\b/.test(m[1])) {
    return { runner: "jest/vitest", passed: count(m[1], "passed"), failed: count(m[1], "failed"), skipped: count(m[1], "(?:skipped|todo)") };
  }
  // pytest: "=== 1 failed, 3 passed, 2 skipped in 0.5s ===" (also bare "3 passed in 0.2s")
  if ((m = /^=*\s*((?:\d+ (?:passed|failed|skipped|errors?|xfailed|xpassed|deselected|warnings?)(?:, )?)+)\s+in [\d.]+s/m.exec(text))) {
    return { runner: "pytest", passed: count(m[1], "passed"), failed: count(m[1], "failed") + count(m[1], "errors?"), skipped: count(m[1], "skipped") };
  }
  // dotnet: "Passed!  - Failed: 0, Passed: 5, Skipped: 0, Total: 5"
  if ((m = /(?:Passed|Failed)!\s+- Failed:\s+(\d+), Passed:\s+(\d+), Skipped:\s+(\d+)/.exec(text))) {
    return { runner: "dotnet", failed: num(m[1]), passed: num(m[2]), skipped: num(m[3]) };
  }
  // go: package lines "ok  pkg 0.3s" / "FAIL pkg"; no per-test count without -v, so packages are counted
  const ok = [...text.matchAll(/^ok\s+\S+/gm)].length;
  const fail = [...text.matchAll(/^FAIL\s+\S+/gm)].length;
  if (ok + fail > 0) return { runner: "go", passed: ok, failed: fail, skipped: 0 };
  return null;
}

export type Verdict = "passed" | "failed" | "unclear";

export interface TestRun {
  entry: HistoryEntry;
  verdict: Verdict;
  counts: TestCounts | null;
  /** Where the verdict came from: a runner's summary, or only the exit status. */
  basis: "summary" | "exit";
}

/** One test run: its summary when it has one, else only the exit status (and a clean exit with
 *  nothing to read is "unclear", not "passed"). */
export function judgeRun(e: HistoryEntry): TestRun {
  const counts = parseTestOutput(e.detail ?? "");
  if (counts) {
    const tests = counts.passed + counts.failed;
    const verdict: Verdict = counts.failed > 0 || e.status === "failed" ? "failed" : tests > 0 ? "passed" : "unclear";
    return { entry: e, verdict, counts, basis: "summary" };
  }
  return { entry: e, verdict: e.status === "failed" ? "failed" : "unclear", counts: null, basis: "exit" };
}

export interface TestStatus {
  /** Every test run in the request, oldest first. */
  runs: TestRun[];
  last: TestRun | null;
  /** Files edited or written after the last test run (git-found changes carry no time to tell, so they don't count). */
  changedAfter: number;
  /** How many times in a row the last run's command was tried. */
  tries: number;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** The state of the tests in one request. `last` is null when the agent ran none. */
export function testStatus(turn: Turn): TestStatus {
  const runs = turn.steps
    .filter((e) => e.kind === "run" && isTestCommand(e.title) && e.status !== "running" && e.status !== "waiting")
    .map(judgeRun);
  const last = runs[runs.length - 1] ?? null;
  if (!last) return { runs, last, changedAfter: 0, tries: 0 };

  const changed = new Set<string>();
  for (const e of turn.steps) {
    if (e.at <= last.entry.at || e.status === "failed" || (e.kind !== "edit" && e.kind !== "write") || e.tool === "git") continue;
    for (const f of e.files?.length ? e.files : [{ path: e.title }]) changed.add(f.path.replace(/\\/g, "/").toLowerCase());
  }
  let tries = 0;
  for (let i = runs.length - 1; i >= 0 && norm(runs[i].entry.title) === norm(last.entry.title); i--) tries++;
  return { runs, last, changedAfter: changed.size, tries };
}

const plural = (k: number, word: string) => `${k} ${word}${k === 1 ? "" : "s"}`;

/** One plain line, or "" when no tests were run. */
export function testLine(s: TestStatus): string {
  const r = s.last;
  if (!r) return "";
  const c = r.counts;
  const detail = c && c.passed + c.failed > 0 ? ` (${c.failed > 0 ? `${c.failed} failed, ` : ""}${c.passed} passed)` : "";
  const retry = s.tries > 1 ? (r.verdict === "passed" ? `, fixed on try ${s.tries}` : `, still failing after ${s.tries} tries`) : "";
  const basis = r.basis === "exit" ? " (exit status only)" : "";
  let head: string;
  if (r.verdict === "passed") head = `Tests passed${detail}${retry}`;
  else if (r.verdict === "failed") head = `Tests failed${detail}${retry}`;
  else head = c ? "Tests unclear: no tests actually ran" : "Tests unclear: the output has no result to read";
  const stale = s.changedAfter > 0 ? ` · ${plural(s.changedAfter, "file")} changed since: not tested again` : "";
  return `${head}${basis}${stale}`;
}
