// What the island already knows, as a few lines for the first message of a Hermes chat:
// the agents that need attention and the top of the Today list. Local only: it is sent
// to the Hermes the user chose, never anywhere else (chat.ts checks the backend).

import { State } from "../core/state";
import { todayRows } from "./today";

const MAX_ROWS = 4;

/** "" when there is nothing worth saying (or the user turned it off). */
export function awarenessNote(): string {
  if (State.settings.chatAwareness === false) return "";
  const lines: string[] = [];

  for (const t of State.tasks) {
    if (t.isIntegration) continue;
    if (t.state === "error") lines.push(`- ${t.name} reported an error`);
    else if (t.pillBadge === "approval") lines.push(`- ${t.name} is waiting for the user's approval`);
    else if (t.state === "working" || t.state === "thinking") lines.push(`- ${t.name} is working${t.plan?.current ? `: ${t.plan.current}` : ""}`);
  }
  for (const r of todayRows().slice(0, MAX_ROWS)) {
    lines.push(`- ${r.title}${r.sub ? ` (${r.sub})` : ""}`);
  }
  if (lines.length === 0) return "";
  return `[What Awuuu sees on the user's screen right now:\n${lines.join("\n")}]\n\n`;
}
