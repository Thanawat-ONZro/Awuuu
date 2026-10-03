// "What Awuuu can see right now": a short note that rides along with a chat
// turn, so the answer knows about the next meeting, the PR waiting for review
// and the agent that just failed. Settings → Privacy → Chat awareness.
//
// Pure: no DOM, no Tauri. Everything passes through redact() first.

import type { AgentTask } from "../core/state";

/** What the Today list shows, reduced to words. */
export interface SeenRow {
  icon: string;
  title: string;
  sub?: string;
  bad?: boolean;
}

const MAX_ROWS = 6;
const MAX_AGENTS = 4;
const MAX_CHARS = 900;

/**
 * Removes what should never leave the island in a prompt: e-mail addresses,
 * keys and tokens, long hex/base64 runs, and the user's home folder.
 */
export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/\b(sk|pk|rk|ghp|gho|ghs|github_pat|xox[abpr]|AKIA)[-_A-Za-z0-9]{10,}/g, "[key]")
    .replace(/\b(eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,})/g, "[token]")
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, "[hex]")
    .replace(/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, "[secret]")
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, "~")
    .replace(/\/(home|Users)\/[^/\s]+/g, "~");
}

function folder(cwd: string | null | undefined): string {
  if (!cwd) return "";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

const STATE_WORDS: Partial<Record<AgentTask["state"], string>> = {
  working: "working",
  thinking: "thinking",
  searching: "searching",
  approval: "waiting for your approval",
  question: "asking you a question",
  error: "hit an error",
  finished: "finished",
  ratelimit: "hit a rate limit",
};

function agentLine(t: AgentTask): string | null {
  const state = STATE_WORDS[t.state];
  if (!state) return null;
  const where = folder(t.sessionCwd);
  const step = t.plan?.current ?? t.steps[t.stepIndex] ?? t.steps[t.steps.length - 1] ?? "";
  const lastError = t.state === "error" ? [...(t.log ?? [])].reverse().find((l) => l.kind === "error")?.text : undefined;
  let line = `${t.name}${where ? ` in ${where}` : ""}: ${state}`;
  if (lastError) line += ` (${lastError.slice(0, 120)})`;
  else if (step && t.state !== "finished") line += ` (${step.slice(0, 80)})`;
  if (t.plan && t.plan.total > 0) line += `, plan ${t.plan.done}/${t.plan.total}`;
  return line;
}

/**
 * The note, or "" when there is nothing worth saying. `now` is the local time
 * as the user reads it, e.g. "Sat 3 Oct, 14:05".
 */
export function awarenessNote(rows: SeenRow[], tasks: AgentTask[], now: string): string {
  const lines: string[] = [];
  const agents = tasks
    .filter((t) => !t.isIntegration)
    .map(agentLine)
    .filter((l): l is string => !!l)
    .slice(0, MAX_AGENTS);
  if (agents.length) lines.push("Coding agents:", ...agents.map((a) => `- ${a}`));
  const seen = rows.slice(0, MAX_ROWS).map((r) => `- ${r.icon} ${r.title}${r.sub ? ` · ${r.sub}` : ""}${r.bad ? " (needs attention)" : ""}`);
  if (seen.length) lines.push("Today:", ...seen);
  if (!lines.length) return "";
  let note = redact([`Local time: ${now}.`, ...lines].join("\n"));
  if (note.length > MAX_CHARS) note = `${note.slice(0, MAX_CHARS - 1)}…`;
  return note;
}
