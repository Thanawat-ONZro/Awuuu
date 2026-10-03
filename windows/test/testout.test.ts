import { describe, expect, it } from "vitest";
import { isTestCommand, readTestOutput } from "../src/app/testout";

describe("isTestCommand", () => {
  it("knows the common runners", () => {
    for (const c of ["npm test", "npm run test -- --watch=false", "pnpm test", "npx vitest run", "jest --ci", "pytest -q", "python -m pytest tests",
      "cargo test --workspace", "go test ./...", "dotnet test", "cd app && yarn test", "./gradlew test", "bun test"]) {
      expect(isTestCommand(c), c).toBe(true);
    }
  });
  it("leaves other commands alone", () => {
    for (const c of ["npm install", "cargo build", "git commit -m 'add tests'", "ls test/", "cat latest.json"]) expect(isTestCommand(c), c).toBe(false);
  });
});

describe("readTestOutput", () => {
  it("adds up cargo's test binaries", () => {
    const out = "test result: ok. 81 passed; 0 failed; 1 ignored\n...\ntest result: FAILED. 14 passed; 1 failed; 0 ignored";
    expect(readTestOutput(out, false)).toEqual({ verdict: "failed", runner: "cargo", passed: 95, failed: 1 });
  });
  it("reads vitest", () => {
    expect(readTestOutput("      Tests  36 passed (36)", true)).toMatchObject({ verdict: "passed", runner: "vitest", passed: 36 });
    expect(readTestOutput("      Tests  2 failed | 34 passed (36)", false)).toMatchObject({ verdict: "failed", failed: 2, passed: 34 });
  });
  it("reads jest", () => {
    expect(readTestOutput("Tests:       1 failed, 2 skipped, 12 passed, 15 total", false)).toMatchObject({ verdict: "failed", runner: "jest", failed: 1, passed: 12 });
    expect(readTestOutput("Tests:       12 passed, 12 total", true)).toMatchObject({ verdict: "passed", passed: 12 });
  });
  it("reads pytest", () => {
    expect(readTestOutput("===== 3 failed, 10 passed in 1.20s =====", false)).toMatchObject({ verdict: "failed", runner: "pytest", failed: 3, passed: 10 });
    expect(readTestOutput("===== 5 passed in 0.10s =====", true)).toMatchObject({ verdict: "passed", passed: 5 });
    expect(readTestOutput("collected 0 items\n==== no tests ran in 0.01s ====", true).verdict).toBe("no-tests");
  });
  it("reads mocha, unittest, go and dotnet", () => {
    expect(readTestOutput("  12 passing (30ms)\n  2 failing", false)).toMatchObject({ verdict: "failed", failed: 2, passed: 12 });
    expect(readTestOutput("Ran 4 tests in 0.002s\n\nOK", true)).toMatchObject({ verdict: "passed", runner: "unittest", passed: 4 });
    expect(readTestOutput("ok  \texample.com/pkg\t0.012s", true)).toMatchObject({ verdict: "passed", runner: "go" });
    expect(readTestOutput("--- FAIL: TestX (0.00s)\nFAIL\texample.com/pkg", false)).toMatchObject({ verdict: "failed", runner: "go" });
    expect(readTestOutput("Failed!  - Failed:     1, Passed:     9, Skipped: 0", false)).toMatchObject({ verdict: "failed", runner: "dotnet" });
  });
  it("never counts zero tests as a pass", () => {
    expect(readTestOutput("No test files found, exiting with code 0", true).verdict).toBe("no-tests");
    expect(readTestOutput("test result: ok. 0 passed; 0 failed; 0 ignored", true).verdict).toBe("no-tests");
  });
  it("is unclear without a summary, unless the command failed", () => {
    expect(readTestOutput("built in 1s", true).verdict).toBe("unclear");
    expect(readTestOutput("Segmentation fault", false).verdict).toBe("failed");
  });
});
