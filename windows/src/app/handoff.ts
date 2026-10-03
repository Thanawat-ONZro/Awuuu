// A note that lets another agent pick up where this session stopped: what was asked, what the
// agent said it did, what the history shows changed, how the tests stand and what failed.
// Pasted into Claude Code, Codex, Hermes… (Sessions → "Copy handoff"). No DOM.
//
// Same honesty rule as recap.ts: facts come from the entries; what the agent said it did is
// labelled as its own claim.

import type { HistoryEntry } from "../core/bridge";
import { agentMeta, evidence, folderOf, relPath, turnSummary, type SessionSummary, type Turn } from "./recap";
import { turnStory } from "./story";

const MAX_FILES = 15;

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const code = (s: string) => (s.includes("`") ? `\`\` ${s} \`\`` : `\`${s}\``);

/** The newest request that has a prompt (or the newest turn at all). */
function latest(turns: Turn[]): Turn | null {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].prompt) return turns[i];
  return turns[turns.length - 1] ?? null;
}

export function handoffNote(s: SessionSummary): string {
  const turn = latest(s.turns);
  const out: string[] = ["# Handoff: continue this work", ""];
  out.push(`From ${agentMeta(s.agent).name}${s.cwd ? ` in ${code(folderOf(s.cwd))}` : ""}. Another agent is taking over.`, "");
  if (!turn) return `${out.join("\n")}Nothing was recorded for this session.\n`;

  if (turn.prompt) out.push("## What was asked", "", clip(turn.prompt.detail || turn.prompt.title, 800), "");

  const said = turnSummary(turn);
  if (said) out.push("## What the previous agent said it did (its own account)", "", clip(said, 800), "");

  out.push("## What the history shows", "");
  if (turn.facts.changed.length) {
    out.push(`Changed files (${turn.facts.changed.length}):`);
    for (const f of turn.facts.changed.slice(0, MAX_FILES)) out.push(`- ${code(relPath(f.path, s.cwd))} (${f.change === "write" ? "written" : f.change === "delete" ? "deleted" : "edited"})`);
    if (turn.facts.changed.length > MAX_FILES) out.push(`- …and ${turn.facts.changed.length - MAX_FILES} more`);
  } else {
    out.push("No file changes were recorded.");
  }
  const story = turnStory(turn);
  out.push("", `In short: ${story.line}.`);
  if (story.tests == null) out.push("No tests were run by the agent.");
  for (const w of story.warnings) out.push(`Warning: ${w}.`);

  const failed: HistoryEntry[] = turn.steps.filter((e) => e.kind === "run" && e.status === "failed");
  const lastFail = failed[failed.length - 1];
  if (lastFail) out.push("", `Last failed command: ${code(clip(lastFail.title, 160))}${evidence(lastFail) ? ` — ${evidence(lastFail)}` : ""}`);
  if (turn.end?.kind === "error") out.push("", `The request ended with an error: ${clip(turn.end.detail || turn.end.title, 200)}`);
  else if (!turn.end) out.push("", "The request has no recorded end: it may still be running or was interrupted.");

  out.push("", "## What to do", "",
    "Read the changed files and run `git status` and `git diff` first. Check the tests yourself rather than trusting the account above, then continue from where it stopped.", "");
  return out.join("\n");
}
