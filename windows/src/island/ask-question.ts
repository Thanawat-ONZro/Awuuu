// Pure parsing / answer assembly for agent questions (Claude Code's
// AskUserQuestion, AGY's ask_question). No DOM, no state.
import type { QuestionItem } from "../core/state";

export const MAX_QUESTIONS = 4;

function option(o: unknown): { label: string; description?: string } | null {
  if (typeof o === "string") return o.trim() ? { label: o } : null;
  if (o && typeof o === "object") {
    const r = o as { label?: unknown; description?: unknown };
    const label = String(r.label ?? "").trim();
    if (!label) return null;
    return typeof r.description === "string" && r.description
      ? { label, description: r.description }
      : { label };
  }
  return null;
}

/** The questions a tool call asks, in the island's shape; undefined if it asks none. */
export function parseQuestions(tool: string, input: Record<string, unknown>): QuestionItem[] | undefined {
  if (!Array.isArray(input.questions)) return undefined;
  if (tool !== "AskUserQuestion" && tool !== "ask_question") return undefined;
  const out: QuestionItem[] = [];
  for (const raw of input.questions as Record<string, unknown>[]) {
    if (!raw || typeof raw !== "object") continue;
    const question = String(raw.question ?? "").trim();
    if (!question) continue;
    out.push({
      question,
      header: typeof raw.header === "string" && raw.header ? raw.header : undefined,
      options: (Array.isArray(raw.options) ? raw.options : []).map(option).filter((o) => o !== null),
      multiSelect: raw.multiSelect === true || raw.is_multi_select === true,
    });
    if (out.length >= MAX_QUESTIONS) break;
  }
  return out.length ? out : undefined;
}

/** One question's answer: a pick-several answer is the labels joined by ", ". */
export function assembleAnswer(picked: Iterable<string>): string {
  return [...picked].map((s) => s.trim()).filter(Boolean).join(", ");
}

/** Toggle a label in a pick-several set (returns a new set). */
export function togglePick(picked: ReadonlySet<string>, label: string): Set<string> {
  const next = new Set(picked);
  if (!next.delete(label)) next.add(label);
  return next;
}
