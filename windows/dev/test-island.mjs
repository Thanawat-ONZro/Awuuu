// Tests for the pure island modules (plan.ts, history.ts). No framework:
//   node dev/test-island.mjs        (Node 22.18+ strips the types itself)
import assert from "node:assert/strict";
import { reducePlan, planHeadline, isPlanTool } from "../src/island/plan.ts";
import { History, toolKind, toolFiles, commandOf, outputText } from "../src/island/history.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

// ── plan.ts ───────────────────────────────────────────────────────────────────

test("TodoWrite replaces the whole list", () => {
  const p = reducePlan(undefined, "TodoWrite", { todos: [
    { content: "Read the code", activeForm: "Reading the code", status: "completed" },
    { content: "Detect the system setting", activeForm: "Detecting the system setting", status: "in_progress" },
    { content: "Write tests", activeForm: "Writing tests", status: "pending" },
    { content: "Ship", status: "pending" },
  ] });
  assert.deepEqual([p.done, p.total, p.current], [1, 4, "Detecting the system setting"]);
  assert.equal(p.items[1].active, "Detecting the system setting");
  assert.equal(planHeadline(p), "2/4 · Detecting the system setting");
  const q = reducePlan(p, "TodoWrite", { todos: [{ content: "Only one", status: "pending" }] });
  assert.equal(q.total, 1);
  assert.equal(planHeadline(q), "1/1 · Only one");
});

test("TaskCreate appends with positional ids, TaskUpdate changes and deletes", () => {
  let p = reducePlan(undefined, "TaskCreate", { subject: "Parse the file", activeForm: "Parsing the file" });
  p = reducePlan(p, "TaskCreate", { subject: "Render it" });
  p = reducePlan(p, "TaskCreate", { subject: "Test it" });
  assert.deepEqual(p.items.map((i) => i.id), ["1", "2", "3"]);
  assert.equal(planHeadline(p), "1/3 · Parse the file");
  p = reducePlan(p, "TaskUpdate", { taskId: "1", status: "in_progress" });
  assert.equal(planHeadline(p), "1/3 · Parsing the file");
  p = reducePlan(p, "TaskUpdate", { taskId: "1", status: "completed" });
  p = reducePlan(p, "TaskUpdate", { taskId: "2", status: "in_progress", subject: "Render it nicely" });
  assert.equal(planHeadline(p), "2/3 · Render it nicely");
  p = reducePlan(p, "TaskUpdate", { taskId: "3", status: "deleted" });
  assert.deepEqual([p.done, p.total], [1, 2]);
  // Ids are not reused after a delete, and unknown ids change nothing.
  p = reducePlan(p, "TaskCreate", { subject: "Document it" });
  assert.equal(p.items.at(-1).id, "4");
  assert.equal(reducePlan(p, "TaskUpdate", { taskId: "99", status: "completed" }), p);
  // A finished list is over: the next task starts a new one, numbering goes on.
  p = reducePlan(p, "TaskUpdate", { taskId: "2", status: "completed" });
  p = reducePlan(p, "TaskUpdate", { taskId: "4", status: "completed" });
  assert.equal(planHeadline(p), null);
  p = reducePlan(p, "TaskCreate", { subject: "Next thing" });
  assert.deepEqual([p.total, p.done, p.items[0].id], [1, 0, "5"]);
});

test("Codex, OpenCode and Gemini dialects", () => {
  const codex = reducePlan(undefined, "update_plan", { explanation: "x", plan: [
    { step: "Look around", status: "completed" }, { step: "Fix it", status: "in_progress" }, { step: "Verify", status: "pending" },
  ] });
  assert.equal(planHeadline(codex), "2/3 · Fix it");
  assert.equal(planHeadline(reducePlan(undefined, "update_plan", { args: { plan: [{ step: "Nested", status: "pending" }] } })), "1/1 · Nested");
  const oc = reducePlan(undefined, "todowrite", { todos: [
    { content: "a", status: "completed" }, { content: "b", status: "cancelled" }, { content: "c", status: "in_progress" },
  ] });
  assert.deepEqual([oc.done, oc.total, oc.current], [1, 2, "c"]);
  const gem = reducePlan(undefined, "write_todos", { todos: [{ description: "Survey", status: "in_progress" }, { description: "Build", status: "pending" }] });
  assert.equal(planHeadline(gem), "1/2 · Survey");
});

test("headline edge cases and unrelated tools", () => {
  assert.equal(planHeadline(undefined), null);
  assert.equal(planHeadline(reducePlan(undefined, "TodoWrite", { todos: [] })), null);
  const done = reducePlan(undefined, "TodoWrite", { todos: [{ content: "a", status: "completed" }] });
  assert.equal(planHeadline(done), null);
  const long = reducePlan(undefined, "TodoWrite", { todos: [{ content: "x".repeat(200), status: "pending" }] });
  const head = planHeadline(long);
  assert.ok(head.endsWith("…") && head.length === "1/1 · ".length + 48, head);
  assert.equal(reducePlan(done, "Bash", { command: "ls" }), done);
  assert.equal(reducePlan(done, "TodoWrite", {}), done);
  assert.ok(isPlanTool("update_plan") && !isPlanTool("Bash"));
});

// ── history.ts ────────────────────────────────────────────────────────────────

test("tools map to kinds", () => {
  const kinds = { Read: "read", Grep: "search", Glob: "search", Edit: "edit", MultiEdit: "edit", NotebookEdit: "edit",
    Write: "write", Bash: "run", shell: "run", WebFetch: "web", WebSearch: "web", Task: "agent", Agent: "agent",
    mcp__github__list_issues: "mcp", Skill: "skill", TodoWrite: "plan", update_plan: "plan", apply_patch: "edit", Whatever: "tool" };
  for (const [tool, kind] of Object.entries(kinds)) assert.equal(toolKind(tool), kind, tool);
});

test("files and commands come out of the input", () => {
  assert.deepEqual(toolFiles("Read", { file_path: "C:/p/a.ts" }), [{ path: "C:/p/a.ts", change: "read" }]);
  assert.deepEqual(toolFiles("write", { filePath: "b.ts" }), [{ path: "b.ts", change: "write" }]);
  assert.deepEqual(toolFiles("view_file", { AbsolutePath: "C:/x/n.txt" }), [{ path: "C:/x/n.txt", change: "read" }]);
  assert.deepEqual(toolFiles("Grep", { pattern: "x", path: "src" }), []);
  assert.deepEqual(toolFiles("LS", { path: "src" }), []);
  assert.deepEqual(
    toolFiles("apply_patch", { input: "*** Begin Patch\n*** Update File: src/a.rs\n@@\n*** Add File: src/b.rs\n*** Delete File: old.rs\n*** End Patch" }),
    [{ path: "src/a.rs", change: "edit" }, { path: "src/b.rs", change: "write" }, { path: "old.rs", change: "delete" }],
  );
  assert.equal(commandOf({ command: " npm test " }), "npm test");
  assert.equal(commandOf({ command: ["bash", "-lc", "cargo build"] }), "cargo build");
  assert.equal(commandOf({ CommandLine: "Get-ChildItem" }), "Get-ChildItem");
  assert.equal(commandOf({ file_path: "x" }), null);
  assert.equal(outputText({ stdout: "out", stderr: "err" }), "out\nerr");
  assert.equal(outputText([{ type: "text", text: "hi" }]), "hi");
});

test("events become entries, batched, and a result lands on its start", async () => {
  const batches = [];
  let on = true;
  History.sink = (entries, sessions) => batches.push({ entries, sessions });
  History.enabled = () => on;
  const who = { session: "s1", agent: "claude", cwd: "C:\\p", name: "p" };

  History.prompt(who, "Fix the failing test");
  History.prompt(who, "Fix the failing test"); // reported twice: once
  History.toolStart(who, { key: "t1", toolUseId: "t1", tool: "Bash", input: { command: "npm test", description: "Run the tests" }, title: "Run the tests" });
  History.toolStart(who, { key: "t1", toolUseId: "t1", tool: "Bash", input: { command: "npm test" }, title: "x" }, true);
  History.toolStart(who, { key: "Edit:{}", tool: "Edit", input: { file_path: "a.ts" }, title: "Edit · a.ts" });
  assert.equal(batches.length, 0, "nothing is sent before the flush");
  History.flush();
  assert.equal(batches.length, 1);
  let { entries, sessions } = batches[0];
  assert.deepEqual(sessions, { s1: { cwd: "C:\\p", name: "p" } });
  assert.deepEqual(entries.map((e) => [e.kind, e.status, e.title]), [
    ["prompt", "info", "Fix the failing test"], ["run", "waiting", "npm test"], ["edit", "running", "Edit · a.ts"],
  ]);
  assert.equal(entries[1].id, "s1:t1");
  assert.match(entries[2].id, /^s1:\d+$/);
  assert.deepEqual(entries[2].files, [{ path: "a.ts", change: "edit" }]);
  const editId = entries[2].id;

  History.toolEnd(who, { key: "t1", toolUseId: "t1", tool: "Bash", input: { command: "npm test" }, title: "x" }, false, { stdout: "3 passed" });
  History.toolEnd(who, { key: "Edit:{}", tool: "Edit", input: { file_path: "a.ts" }, title: "Edit · a.ts" }, true, "old_string not found");
  History.say(who, "All green now.");
  // A call still open when the turn ends is stopped; then the done entry.
  History.toolStart(who, { key: "t9", toolUseId: "t9", tool: "Read", input: { file_path: "z" }, title: "Read · z" });
  History.done(who, "Fixed the parser.");
  History.error(who, "Stopped · overloaded");
  History.flush();
  ({ entries } = batches[1]);
  assert.deepEqual(entries.map((e) => [e.id === editId ? "edit" : e.id.replace(/:\d{6,}$/, ":n"), e.kind, e.status]), [
    ["s1:t1", "run", "ok"], ["edit", "edit", "failed"], ["s1:n", "say", "info"], ["s1:t9", "read", "stopped"],
    ["s1:n", "done", "ok"], ["s1:n", "error", "failed"],
  ]);
  assert.equal(entries[0].detail, "3 passed");
  assert.ok(Number.isInteger(entries[0].ms) && entries[0].ms >= 0);
  assert.equal(entries[1].detail, "old_string not found");
  assert.deepEqual([entries[4].title, entries[4].detail], ["Fixed the parser.", "Fixed the parser."]);
  assert.equal(new Set(batches.flatMap((b) => b.entries.map((e) => e.id))).size, 7, "ids are unique apart from start/result pairs");

  // The debounce sends on its own, and only while something is waiting.
  History.say(who, "later");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(batches.length, 3);

  // Turned off: nothing is recorded.
  on = false;
  History.prompt(who, "secret");
  History.toolStart(who, { key: "t2", toolUseId: "t2", tool: "Bash", input: { command: "x" }, title: "x" });
  History.toolEnd(who, { key: "t2", toolUseId: "t2", tool: "Bash", input: { command: "x" }, title: "x" }, false);
  History.done(who, "x");
  History.flush();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(batches.length, 3);
});

console.log(`${passed} passed`);
