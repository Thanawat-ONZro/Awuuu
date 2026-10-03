import { describe, expect, it } from "vitest";
import { isPlanTool, planHeadline, reducePlan } from "../src/island/plan";

describe("reducePlan", () => {
  it("reads Claude Code's TodoWrite list", () => {
    const plan = reducePlan(undefined, "TodoWrite", {
      todos: [
        { content: "Read the code", activeForm: "Reading the code", status: "completed" },
        { content: "Write the fix", activeForm: "Writing the fix", status: "in_progress" },
        { content: "Run the tests", status: "pending" },
      ],
    });
    expect(plan).toMatchObject({ done: 1, total: 3, current: "Writing the fix" });
  });

  it("reads Codex's update_plan, nested or not", () => {
    const flat = reducePlan(undefined, "update_plan", { plan: [{ step: "A", status: "done" }, { step: "B", status: "active" }] });
    const nested = reducePlan(undefined, "update_plan", { args: { plan: [{ step: "A", status: "done" }, { step: "B", status: "active" }] } });
    expect(flat).toEqual(nested);
    expect(flat).toMatchObject({ done: 1, total: 2, current: "B" });
  });

  it("drops cancelled steps", () => {
    const plan = reducePlan(undefined, "todowrite", { todos: [{ content: "keep", status: "pending" }, { content: "gone", status: "cancelled" }] });
    expect(plan?.items.map((i) => i.text)).toEqual(["keep"]);
  });

  it("builds a plan from TaskCreate and TaskUpdate", () => {
    let plan = reducePlan(undefined, "TaskCreate", { subject: "First" });
    plan = reducePlan(plan, "TaskCreate", { subject: "Second", activeForm: "Doing second" });
    plan = reducePlan(plan, "TaskUpdate", { taskId: "1", status: "completed" });
    plan = reducePlan(plan, "TaskUpdate", { taskId: 2, status: "in_progress" });
    expect(plan).toMatchObject({ done: 1, total: 2, current: "Doing second" });
    plan = reducePlan(plan, "TaskUpdate", { taskId: "2", status: "deleted" });
    expect(plan?.total).toBe(1);
  });

  it("starts a new list after a finished one", () => {
    let plan = reducePlan(undefined, "TaskCreate", { subject: "Old" });
    plan = reducePlan(plan, "TaskUpdate", { taskId: "1", status: "completed" });
    plan = reducePlan(plan, "TaskCreate", { subject: "New" });
    expect(plan?.items.map((i) => i.text)).toEqual(["New"]);
  });

  it("returns the same plan for calls that say nothing about it", () => {
    const plan = reducePlan(undefined, "TaskCreate", { subject: "x" });
    expect(reducePlan(plan, "Bash", { command: "ls" })).toBe(plan);
    expect(reducePlan(plan, "TodoWrite", {})).toBe(plan);
  });
});

describe("isPlanTool", () => {
  it("knows every agent's todo tool", () => {
    for (const t of ["TodoWrite", "TaskCreate", "TaskUpdate", "update_plan", "todowrite", "write_todos"]) expect(isPlanTool(t)).toBe(true);
    expect(isPlanTool("Bash")).toBe(false);
  });
});

describe("planHeadline", () => {
  it("shows the step number and the current step, clipped", () => {
    const plan = reducePlan(undefined, "TodoWrite", {
      todos: [{ content: "a", status: "completed" }, { content: "b".repeat(80), status: "in_progress" }],
    });
    const line = planHeadline(plan)!;
    expect(line.startsWith("2/2 · ")).toBe(true);
    expect(line.endsWith("…")).toBe(true);
  });

  it("is null when there is nothing left to do", () => {
    expect(planHeadline(null)).toBeNull();
    expect(planHeadline(reducePlan(undefined, "TodoWrite", { todos: [{ content: "a", status: "done" }] }))).toBeNull();
  });
});
