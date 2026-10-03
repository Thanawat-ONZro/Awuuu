// One request in one line a person can read at a glance:
//   "Changed 5 files (+42 −7) · tests failed 2× then passed · committed"
// plus warnings worth a look ("changed files after the last test run").
//
// Built only from what the history shows (recap.ts's honesty rule): the
// agent's own words are never used as evidence. No DOM: tested in node.

import type { HistoryEntry } from "../core/bridge";
import type { Turn } from "./recap";
import { isTestCommand, readTestOutput, type TestResult, type TestVerdict } from "./testout";

export interface Story {
  line: string;
  /** The last test run's verdict, null when no test ran. */
  tests: TestVerdict | null;
  warnings: string[];
}

/** The git snapshot entry hooks.ts records at the end of a turn. */
export function isGitEntry(e: HistoryEntry): boolean {
  return e.tool === "git" && e.kind === "tool";
}

/** "+42 −7" out of a git entry's title ("Git: 3 files changed +42 −7"). */
function gitLines(e: HistoryEntry | undefined): string {
  const m = e ? /([+]\d+ −\d+)/.exec(e.title) : null;
  return m ? m[1] : "";
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function testPart(results: TestResult[]): string {
  const last = results[results.length - 1];
  const before = results.slice(0, -1).filter((r) => r.verdict === "failed").length;
  const count = last.passed != null && last.passed > 0 ? ` (${last.passed})` : "";
  switch (last.verdict) {
    case "passed":
      return before > 0 ? `tests failed ${before}× then passed${count}` : `tests passed${count}`;
    case "failed":
      return last.failed ? `${plural(last.failed, "test")} failing` : "tests failing";
    case "no-tests":
      return "the test command found no tests";
    case "unclear":
      return "test result unclear";
  }
}

export function turnStory(turn: Turn): Story {
  const steps = turn.steps;
  const parts: string[] = [];
  const warnings: string[] = [];

  // What changed: the hooks' files, and git's count when it was taken.
  const git = [...steps].reverse().find(isGitEntry);
  const changed = turn.facts.changed.length;
  const lines = gitLines(git);
  if (changed > 0) parts.push(`Changed ${plural(changed, "file")}${lines ? ` (${lines})` : ""}`);
  else if (turn.facts.read > 0) parts.push(`Read ${plural(turn.facts.read, "file")}`);

  // Tests, in order.
  const testRuns = steps
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.kind === "run" && (e.status === "ok" || e.status === "failed") && isTestCommand(e.title));
  const results = testRuns.map(({ e }) => readTestOutput(e.detail ?? "", e.status === "ok"));
  let tests: TestVerdict | null = null;
  if (results.length > 0) {
    parts.push(testPart(results));
    tests = results[results.length - 1].verdict;
    const lastTest = testRuns[testRuns.length - 1].i;
    const editedAfter = steps.slice(lastTest + 1).some((e) => (e.kind === "edit" || e.kind === "write") && e.status !== "failed");
    if (editedAfter) warnings.push("Files changed after the last test run");
    if (tests === "no-tests") warnings.push("The test command ran no tests");
  } else if (steps.some((e) => (e.kind === "edit" || e.kind === "write") && e.status !== "failed" && (e.files ?? []).some((f) => isCode(f.path)))) {
    warnings.push("Code changed, no tests were run");
  }

  // What happened to the work.
  const ran = (re: RegExp) => steps.some((e) => e.kind === "run" && e.status === "ok" && re.test(e.title));
  if (ran(/\bgit\s+commit\b/)) parts.push("committed");
  if (ran(/\bgit\s+push\b/)) parts.push("pushed");
  if (ran(/\bgh\s+pr\s+create\b/)) parts.push("opened a PR");

  const failedCmds = turn.facts.commandsFailed - results.filter((r) => r.verdict === "failed").length;
  if (failedCmds > 0) parts.push(`${plural(failedCmds, "command")} failed`);
  if (turn.end?.kind === "error") parts.push("ended with an error");
  else if (!turn.end && turn.prompt) parts.push("not finished");

  if (parts.length === 0) parts.push(turn.end ? "Answered" : "Nothing recorded yet");
  const line = parts.join(" · ");
  return { line: line[0].toUpperCase() + line.slice(1), tests, warnings };
}

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|rs|py|go|java|kt|cs|cpp|cc|c|h|hpp|rb|php|swift|scala|vue|svelte|dart|lua|sh|ps1)$/i;
function isCode(path: string): boolean {
  return CODE.test(path) && !/(^|[\\/])(docs?|README)/i.test(path);
}
