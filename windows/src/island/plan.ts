// The plan an agent keeps while it works, rebuilt from its tool calls.
//
// Every agent has a todo tool and each speaks its own dialect:
//   Claude Code  TodoWrite   { todos: [{ content, activeForm, status }] }   whole list each time
//                TaskCreate  { subject, activeForm }                        one step added
//                TaskUpdate  { taskId, status, subject }                    one step changed ("deleted" removes)
//   Codex        update_plan { plan: [{ step, status }] }
//   OpenCode     todowrite   { todos: [{ content, status }] }               "cancelled" steps are dropped
//   Gemini-style write_todos { todos: [{ description, status }] }
//
// Pure: no imports at run time, so it can be exercised with plain `node`.

import type { Plan, PlanItem } from "../core/state";

type Input = Record<string, unknown>;

const HEADLINE_MAX = 48;

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** The agents' words for a step's state → ours; null = the step is gone. */
function statusOf(v: unknown): PlanItem["status"] | null {
  const s = text(v).toLowerCase().replace(/[-\s]/g, "_");
  if (s === "in_progress" || s === "active" || s === "running" || s === "doing") return "in_progress";
  if (s === "completed" || s === "complete" || s === "done") return "completed";
  if (s === "cancelled" || s === "canceled" || s === "deleted") return null;
  return "pending";
}

/** Recounts `done`, `total` and `current` after the items changed. */
function summed(items: PlanItem[], created?: number): Plan {
  const now = items.find((i) => i.status === "in_progress") ?? items.find((i) => i.status === "pending");
  const plan: Plan = {
    items,
    done: items.filter((i) => i.status === "completed").length,
    total: items.length,
    current: now ? (now.status === "in_progress" && now.active) || now.text : null,
  };
  if (created != null) plan.created = created;
  return plan;
}

/** A whole list, as TodoWrite / update_plan / todowrite / write_todos send it. */
function fromList(list: unknown[], created?: number): Plan {
  const items: PlanItem[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Input;
    const label = text(t.content) || text(t.description) || text(t.step) || text(t.subject) || text(t.title);
    const status = statusOf(t.status);
    if (!label || !status) continue;
    const item: PlanItem = { text: label, status };
    const active = text(t.activeForm) || text(t.active_form);
    if (active) item.active = active;
    items.push(item);
  }
  return summed(items, created);
}

/** Is this one of the tools that carry a plan? */
export function isPlanTool(tool: string): boolean {
  return /^(TodoWrite|TaskCreate|TaskUpdate|update_plan|todowrite|write_todos)$/.test(tool);
}

/**
 * The plan after one tool call. Returns the same object when the call says
 * nothing about the plan, so callers can tell whether anything changed.
 */
export function reducePlan(plan: Plan | undefined, tool: string, input: Input): Plan | undefined {
  switch (tool) {
    case "TodoWrite":
    case "todowrite":
    case "write_todos":
      return Array.isArray(input.todos) ? fromList(input.todos, plan?.created) : plan;

    case "update_plan": {
      // Codex's hook hands over the arguments; some builds nest them.
      const args = (input.args && typeof input.args === "object" ? input.args : input) as Input;
      return Array.isArray(args.plan) ? fromList(args.plan, plan?.created) : plan;
    }

    case "TaskCreate": {
      const subject = text(input.subject) || text(input.description);
      if (!subject) return plan;
      // A list that was finished is over: the new task starts the next one.
      const finished = !!plan && plan.total > 0 && plan.done === plan.total;
      const items = plan && !finished ? plan.items.slice() : [];
      // Claude Code numbers its tasks 1, 2, 3… in the order they are created.
      const created = Math.max(plan?.created ?? 0, plan?.items.length ?? 0) + 1;
      const item: PlanItem = { text: subject, status: "pending", id: String(created) };
      const active = text(input.activeForm);
      if (active) item.active = active;
      items.push(item);
      return summed(items, created);
    }

    case "TaskUpdate": {
      const id = text(input.taskId) || (typeof input.taskId === "number" ? String(input.taskId) : "");
      if (!plan || !id) return plan;
      const at = plan.items.findIndex((i, n) => (i.id ?? String(n + 1)) === id);
      if (at < 0) return plan;
      const items = plan.items.slice();
      const status = input.status == null ? items[at].status : statusOf(input.status);
      if (status === null) {
        items.splice(at, 1);
      } else {
        const next: PlanItem = { ...items[at], status };
        const subject = text(input.subject);
        if (subject) next.text = subject;
        const active = text(input.activeForm);
        if (active) next.active = active;
        items[at] = next;
      }
      return summed(items, plan.created);
    }

    default:
      return plan;
  }
}

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/**
 * "2/4 · Detecting the system setting": which step it is on, then the step.
 * Null when there is no plan or all of it is done.
 */
export function planHeadline(plan: Plan | null | undefined): string | null {
  if (!plan || plan.total === 0 || plan.done >= plan.total) return null;
  const item = plan.items.find((i) => i.status === "in_progress") ?? plan.items.find((i) => i.status === "pending");
  const label = item ? (item.status === "in_progress" && item.active) || item.text : (plan.current ?? "");
  const step = `${Math.min(plan.done + 1, plan.total)}/${plan.total}`;
  return label ? `${step} · ${clip(label, HEADLINE_MAX)}` : step;
}
