// The dashboard's model: history entries → sessions, requests ("turns"), facts
// and a PR-ready recap. No DOM in here, so every function can be tested alone.
//
// Honesty rule: a recap only states what the entries show. A command is "ran"
// when its entry says ok, "failed" when it says failed, and anything else is
// listed as not finished. Nothing is inferred.

import type { HistoryData, HistoryEntry, HistorySession } from "../core/bridge";
import { AGENT_INFO } from "../core/state";

export type FileChange = "read" | "edit" | "write" | "delete";

export interface FileTouch {
  path: string;
  change: FileChange;
}

export interface Facts {
  /** Distinct files whose last recorded change is an edit / a write / a delete. */
  edited: number;
  written: number;
  deleted: number;
  /** Distinct files that were only read. */
  read: number;
  /** `run` entries, and how many of them failed. */
  commands: number;
  commandsFailed: number;
  /** Every entry that failed or is an error, commands included. */
  failures: number;
  searches: number;
  web: number;
  agents: number;
  mcp: number;
  skills: number;
  /** Every touched file once, with its strongest change (read < edit < write/delete). */
  files: FileTouch[];
  /** `files` without the ones that were only read. */
  changed: FileTouch[];
  /** Wall time covered by the entries, ms. */
  ms: number;
}

export interface Turn {
  /** 0-based position in the session. */
  index: number;
  /** The request; null for what happened before the first recorded prompt. */
  prompt: HistoryEntry | null;
  /** Everything between the prompt and the end. */
  steps: HistoryEntry[];
  /** The `done` / `error` entry that closed the request, if it was recorded. */
  end: HistoryEntry | null;
  facts: Facts;
}

export type SessionState = "running" | "waiting" | "failed" | "";

export interface SessionSummary {
  id: string;
  agent: string;
  name: string;
  cwd: string;
  /** Epoch ms of the first and last recorded activity. */
  first: number;
  last: number;
  entries: HistoryEntry[];
  turns: Turn[];
  facts: Facts;
  /** Requests = turns that start with a prompt. */
  requests: number;
  state: SessionState;
}

/** A step still "running" after this long without news is treated as stale. */
const RUNNING_STALE_MS = 60 * 60 * 1000;
const WAITING_STALE_MS = 24 * 60 * 60 * 1000;

// ── Names ───────────────────────────────────────────────────────────────────

export function agentMeta(agent: string): { name: string; short: string; color: string } {
  const known = (AGENT_INFO as Record<string, { name: string; short: string; color: string }>)[agent];
  return known ?? { name: agent || "Agent", short: agent || "Agent", color: "#a89a8a" };
}

/** The last `n` segments of a path: `C:\a\b\c` → `b\c`. */
export function folderOf(cwd: string | undefined | null, n = 2): string {
  if (!cwd) return "";
  const sep = cwd.includes("\\") ? "\\" : "/";
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-n).join(sep);
}

/** A file path relative to the session folder when it lives under it. */
export function relPath(path: string, cwd: string): string {
  if (!cwd) return path;
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const p = norm(path);
  const c = norm(cwd);
  if (p.startsWith(c + "/")) return path.slice(path.length - (p.length - c.length - 1));
  return path;
}

// ── Time ────────────────────────────────────────────────────────────────────

/** "850 ms", "12s", "4m 12s", "2h 14m", "3d 4h". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const hh = Math.floor(m / 60);
  if (hh < 24) return m % 60 ? `${hh}h ${m % 60}m` : `${hh}h`;
  const d = Math.floor(hh / 24);
  return hh % 24 ? `${d}d ${hh % 24}h` : `${d}d`;
}

function entryEnd(e: HistoryEntry): number {
  return e.at + (e.ms && e.ms > 0 ? e.ms : 0);
}

function span(entries: HistoryEntry[]): number {
  if (entries.length === 0) return 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const e of entries) {
    if (e.at < lo) lo = e.at;
    const end = entryEnd(e);
    if (end > hi) hi = end;
  }
  return Math.max(0, hi - lo);
}

// ── Facts ───────────────────────────────────────────────────────────────────

const RANK: Record<FileChange, number> = { read: 0, edit: 1, write: 2, delete: 2 };

/** The files an entry touched. Falls back to the title for file-only kinds. */
export function entryFiles(e: HistoryEntry): FileTouch[] {
  if (e.files && e.files.length > 0) return e.files;
  if ((e.kind === "read" || e.kind === "edit" || e.kind === "write") && e.title.trim()) {
    return [{ path: e.title.trim(), change: e.kind }];
  }
  return [];
}

function fileKey(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

/** Counts of what a list of entries shows. Prompt/done entries are ignored. */
export function facts(steps: HistoryEntry[]): Facts {
  const f: Facts = {
    edited: 0, written: 0, deleted: 0, read: 0,
    commands: 0, commandsFailed: 0, failures: 0,
    searches: 0, web: 0, agents: 0, mcp: 0, skills: 0,
    files: [], changed: [], ms: span(steps),
  };
  const seen = new Map<string, FileTouch>();
  for (const e of steps) {
    if (e.status === "failed" || e.kind === "error") f.failures++;
    switch (e.kind) {
      case "run":
        f.commands++;
        if (e.status === "failed") f.commandsFailed++;
        break;
      case "search": f.searches++; break;
      case "web": f.web++; break;
      case "agent": f.agents++; break;
      case "mcp": f.mcp++; break;
      case "skill": f.skills++; break;
      default: break;
    }
    // A failed edit changed nothing; don't claim the file.
    if (e.status === "failed") continue;
    for (const file of entryFiles(e)) {
      const key = fileKey(file.path);
      const had = seen.get(key);
      if (!had) seen.set(key, { path: file.path, change: file.change });
      else if (RANK[file.change] > RANK[had.change]) had.change = file.change;
      else if (file.change === "delete" && had.change === "write") had.change = "delete";
      else if (file.change === "write" && had.change === "delete") had.change = "write";
    }
  }
  f.files = [...seen.values()];
  for (const file of f.files) {
    if (file.change === "edit") f.edited++;
    else if (file.change === "write") f.written++;
    else if (file.change === "delete") f.deleted++;
    else f.read++;
  }
  f.changed = f.files.filter((x) => x.change !== "read");
  return f;
}

// ── Turns and sessions ──────────────────────────────────────────────────────

/** Splits one session's entries (oldest first) at each prompt. */
export function buildTurns(entries: HistoryEntry[]): Turn[] {
  const turns: Turn[] = [];
  let cur: { prompt: HistoryEntry | null; steps: HistoryEntry[]; end: HistoryEntry | null } | null = null;
  const close = () => {
    if (!cur) return;
    if (cur.prompt || cur.steps.length > 0 || cur.end) {
      const all = [...(cur.prompt ? [cur.prompt] : []), ...cur.steps, ...(cur.end ? [cur.end] : [])];
      const fx = facts(cur.steps);
      fx.ms = span(all);
      if (cur.end && cur.end.kind === "error") fx.failures++;
      turns.push({ index: turns.length, prompt: cur.prompt, steps: cur.steps, end: cur.end, facts: fx });
    }
    cur = null;
  };
  for (const e of entries) {
    if (e.kind === "prompt") {
      close();
      cur = { prompt: e, steps: [], end: null };
      continue;
    }
    if (!cur) cur = { prompt: null, steps: [], end: null };
    if (e.kind === "done" || e.kind === "error") {
      // Only the last one closes the turn; an earlier one stays a step.
      if (cur.end) cur.steps.push(cur.end);
      cur.end = e;
    } else {
      // Work after a `done` without a new prompt still belongs to this turn.
      if (cur.end) {
        cur.steps.push(cur.end);
        cur.end = null;
      }
      cur.steps.push(e);
    }
  }
  close();
  return turns;
}

function sessionState(turns: Turn[], fx: Facts, last: number, now: number): SessionState {
  const t = turns[turns.length - 1];
  if (t) {
    const idle = now - last;
    if (idle < WAITING_STALE_MS && t.steps.some((s) => s.status === "waiting")) return "waiting";
    const open = !t.end && (t.steps.some((s) => s.status === "running") || t.prompt?.status === "running");
    if (open && idle < RUNNING_STALE_MS) return "running";
  }
  return fx.failures > 0 ? "failed" : "";
}

/** Every session with its turns and facts, newest activity first. */
export function summarizeSessions(data: HistoryData | null | undefined, now = Date.now()): SessionSummary[] {
  if (!data) return [];
  const groups = new Map<string, HistoryEntry[]>();
  for (const e of data.entries) {
    const list = groups.get(e.session);
    if (list) list.push(e);
    else groups.set(e.session, [e]);
  }
  const out: SessionSummary[] = [];
  for (const [id, list] of groups) {
    // The contract says oldest first; sort only when it is not.
    let sorted = true;
    for (let i = 1; i < list.length; i++) {
      if (list[i].at < list[i - 1].at) { sorted = false; break; }
    }
    const entries = sorted ? list : [...list].sort((a, b) => a.at - b.at);
    const meta: HistorySession = data.sessions?.[id] ?? {};
    const cwd = meta.cwd ?? "";
    const agent = entries[entries.length - 1].agent;
    const turns = buildTurns(entries);
    const fx = facts(entries.filter((e) => e.kind !== "prompt"));
    const first = entries[0].at;
    let last = first;
    for (const e of entries) last = Math.max(last, entryEnd(e));
    out.push({
      id, agent, cwd,
      name: meta.name || folderOf(cwd, 1) || agentMeta(agent).short,
      first, last, entries, turns, facts: fx,
      requests: turns.filter((t) => t.prompt).length,
      state: sessionState(turns, fx, last, now),
    });
  }
  out.sort((a, b) => b.last - a.last);
  return out;
}

// ── Search ──────────────────────────────────────────────────────────────────

const haystacks = new WeakMap<HistoryEntry, string>();

function haystack(e: HistoryEntry): string {
  let s = haystacks.get(e);
  if (s === undefined) {
    s = `${e.title}\n${e.detail ?? ""}\n${e.tool}\n${(e.files ?? []).map((f) => f.path).join("\n")}`.toLowerCase();
    haystacks.set(e, s);
  }
  return s;
}

/** Case-insensitive substring over title, detail, tool and file paths. */
export function entryMatches(e: HistoryEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || haystack(e).includes(q);
}

/** How a session matches: by its own name/folder, and the entries that match. */
export function searchSession(s: SessionSummary, query: string): { meta: boolean; hits: HistoryEntry[] } {
  const q = query.trim().toLowerCase();
  if (!q) return { meta: true, hits: [] };
  const meta = s.name.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q);
  const hits = s.entries.filter((e) => haystack(e).includes(q));
  return { meta, hits };
}

// ── Activity (Stats page) ───────────────────────────────────────────────────

export interface Activity {
  sessions: number;
  requests: number;
  filesChanged: number;
  commands: number;
  failures: number;
}

/** Totals over entries with `since <= at < until`. */
export function activity(entries: HistoryEntry[], since: number, until = Infinity): Activity {
  const sessions = new Set<string>();
  const files = new Set<string>();
  const a: Activity = { sessions: 0, requests: 0, filesChanged: 0, commands: 0, failures: 0 };
  for (const e of entries) {
    if (e.at < since || e.at >= until) continue;
    sessions.add(e.session);
    if (e.kind === "prompt") a.requests++;
    if (e.kind === "run") a.commands++;
    if (e.status === "failed" || e.kind === "error") a.failures++;
    if (e.status !== "failed") {
      for (const f of entryFiles(e)) if (f.change !== "read") files.add(fileKey(f.path));
    }
  }
  a.sessions = sessions.size;
  a.filesChanged = files.size;
  return a;
}

/** Local midnight `daysAgo` days before `now`. */
export function dayStart(now: number, daysAgo = 0): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

/** Requests per local day, oldest first, ending today. */
export function requestsPerDay(entries: HistoryEntry[], days: number, now = Date.now()): { start: number; requests: number }[] {
  const out: { start: number; requests: number }[] = [];
  for (let i = days - 1; i >= 0; i--) out.push({ start: dayStart(now, i), requests: 0 });
  for (const e of entries) {
    if (e.kind !== "prompt" || e.at < out[0].start) continue;
    for (let i = out.length - 1; i >= 0; i--) {
      if (e.at >= out[i].start) { out[i].requests++; break; }
    }
  }
  return out;
}

// ── Markdown ────────────────────────────────────────────────────────────────

function firstLine(text: string, max = 110): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "") ?? "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

function inlineCode(text: string): string {
  const fence = text.includes("`") ? "``" : "`";
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

const ERROR_LINE = /\b(error|failed|failure|exception|fatal|panic|denied|not found|cannot|exit code|traceback)\b/i;

/** One short line of a command's output: the first error-looking line when it
 *  failed, else the last non-empty line. Always a verbatim line of the output. */
export function evidence(e: HistoryEntry, max = 120): string {
  const lines = (e.detail ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  if (lines.length === 0) return "";
  const line = (e.status === "failed" ? lines.find((l) => ERROR_LINE.test(l)) : undefined) ?? lines[lines.length - 1];
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** What the agent itself said it did: the `done` detail, else its last `say`. */
export function turnSummary(turn: Turn): string {
  const end = turn.end;
  if (end && end.kind === "done" && end.detail?.trim()) return end.detail.trim();
  for (let i = turn.steps.length - 1; i >= 0; i--) {
    const s = turn.steps[i];
    if (s.kind === "say") return (s.detail?.trim() || s.title).trim();
  }
  return "";
}

const CHANGE_WORD: Record<FileChange, string> = { read: "read", edit: "edited", write: "written", delete: "deleted" };

function commandLine(e: HistoryEntry): string {
  const cmd = firstLine(e.title, 160) || e.tool || "(command)";
  const bits: string[] = [];
  const ev = evidence(e);
  if (ev) bits.push(ev);
  if (e.ms && e.ms > 0) bits.push(formatDuration(e.ms));
  return `- ${inlineCode(cmd)}${bits.length ? ` — ${bits.join(" · ")}` : ""}`;
}

function footer(session: Pick<SessionSummary, "agent" | "cwd">, ms: number): string {
  const parts = [agentMeta(session.agent).name, folderOf(session.cwd), ms > 0 ? formatDuration(ms) : ""].filter(Boolean);
  return `_${parts.join(" · ")}_`;
}

function turnBody(turn: Turn, session: Pick<SessionSummary, "agent" | "cwd">): string[] {
  const out: string[] = [];
  const title = turn.prompt ? firstLine(turn.prompt.title || turn.prompt.detail || "") : "";
  out.push(`### ${title || (turn.prompt ? "(empty request)" : "Before the first recorded request")}`, "");

  const summary = turnSummary(turn);
  if (summary) out.push(summary, "");
  if (turn.end?.kind === "error") {
    const why = firstLine(turn.end.detail || turn.end.title || "", 200);
    out.push(`**Ended with an error${why ? `:** ${why}` : ".**"}`, "");
  } else if (!turn.end && turn.prompt) {
    out.push("_No end of this request was recorded — it may still be running or was interrupted._", "");
  }

  if (turn.facts.changed.length > 0) {
    out.push("**Changed files**", "");
    for (const f of turn.facts.changed) out.push(`- ${inlineCode(relPath(f.path, session.cwd))} — ${CHANGE_WORD[f.change]}`);
    out.push("");
  }

  const runs = turn.steps.filter((s) => s.kind === "run");
  if (runs.length > 0) {
    const ok = runs.filter((r) => r.status === "ok");
    const bad = runs.filter((r) => r.status === "failed");
    const open = runs.filter((r) => r.status !== "ok" && r.status !== "failed");
    out.push("**Commands**", "");
    if (ok.length) out.push("✅ Ran", ...ok.map(commandLine), "");
    if (bad.length) out.push("❌ Failed", ...bad.map(commandLine), "");
    if (open.length) out.push("⏳ Not finished", ...open.map((r) => `${commandLine(r)} (${r.status})`), "");
  }
  return out;
}

/** One request as Markdown, ready to paste in a PR. */
export function turnMarkdown(turn: Turn, session: Pick<SessionSummary, "agent" | "cwd">): string {
  return [...turnBody(turn, session), footer(session, turn.facts.ms)].join("\n").trim() + "\n";
}

/** Several requests under one title, with one footer for the lot. */
export function recapMarkdown(title: string, turns: Turn[], session: Pick<SessionSummary, "agent" | "cwd">): string {
  const out: string[] = [];
  if (title.trim()) out.push(`## ${firstLine(title, 140)}`, "");
  if (turns.length === 0) out.push("_Nothing was recorded._", "");
  for (const t of turns) out.push(...turnBody(t, session));
  const ms = turns.reduce((sum, t) => sum + t.facts.ms, 0);
  out.push(footer(session, ms));
  return out.join("\n").trim() + "\n";
}

/** Requests worth a recap: work before the first prompt counts only when it
 *  changed a file or ran a command. */
export function recapTurns(s: SessionSummary): Turn[] {
  return s.turns.filter((t) => t.prompt || t.facts.changed.length > 0 || t.facts.commands > 0);
}

export function sessionTitle(s: SessionSummary): string {
  return `${s.name} — ${agentMeta(s.agent).name}`;
}

export function sessionMarkdown(s: SessionSummary): string {
  return recapMarkdown(sessionTitle(s), recapTurns(s), s);
}

// ── Export ──────────────────────────────────────────────────────────────────

function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function slug(text: string): string {
  return text.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).toLowerCase();
}

function sessionJsonObject(s: SessionSummary) {
  return {
    id: s.id,
    agent: s.agent,
    name: s.name,
    cwd: s.cwd,
    first: new Date(s.first).toISOString(),
    last: new Date(s.last).toISOString(),
    requests: s.requests,
    facts: { ...s.facts, files: undefined, changed: undefined },
    files: s.facts.files,
    entries: s.entries,
  };
}

export interface ExportBundle {
  name: string;
  markdown: string;
  json: string;
}

/** One session as `<name>.md` + `<name>.json`. */
export function exportSession(s: SessionSummary, now = Date.now()): ExportBundle {
  const name = ["awuuu", slug(agentMeta(s.agent).short), slug(s.name), stamp(s.first)].filter(Boolean).join("-");
  const json = JSON.stringify({ app: "Awuuu", exportedAt: new Date(now).toISOString(), session: sessionJsonObject(s) }, null, 2);
  return { name, markdown: sessionMarkdown(s), json };
}

/** Several sessions in one pair of files. */
export function exportAll(sessions: SessionSummary[], now = Date.now()): ExportBundle {
  const md: string[] = [`# Awuuu history — ${sessions.length} session${sessions.length === 1 ? "" : "s"}`, ""];
  for (const s of sessions) md.push(sessionMarkdown(s).trim(), "", "---", "");
  const json = JSON.stringify(
    { app: "Awuuu", exportedAt: new Date(now).toISOString(), sessions: sessions.map(sessionJsonObject) }, null, 2);
  return { name: `awuuu-history-${stamp(now)}`, markdown: md.join("\n").trim() + "\n", json };
}
