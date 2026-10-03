// Hook events → history entries (history.rs keeps them in history.json).
//
// hooks.ts tells this module what happened in the words the island already
// uses; here it becomes `HistoryEntry` objects and goes to Rust in batches. A
// tool's start and its result share an id, so the second lands on the first.
//
// There is no idle timer: the 200 ms flush timer only exists while entries are
// waiting to be sent. Pure apart from that timer — the sink and the on/off
// switch are handed in by hooks.ts, so this runs under plain `node` too.

import type { HistoryEntry, HistoryKind, HistorySession, HistoryStatus } from "../core/bridge";

type Input = Record<string, unknown>;
type FileRef = NonNullable<HistoryEntry["files"]>[number];

/** Who did it: the session as the agent names it, and which agent. */
export interface HistoryCtx {
  session: string;
  agent: string;
  cwd?: string | null;
  /** The name shown in the hub. */
  name?: string | null;
}

export interface HistoryCall {
  /** Identifies the call across its events (hooks.ts callKey). */
  key: string;
  /** The agent's own id for the call, when it gives one. */
  toolUseId?: string;
  tool: string;
  input: Input;
  /** describeTool()'s line. */
  title: string;
}

const FLUSH_MS = 200;
const TITLE_MAX = 300;
/** Rust clips to 3000 keeping head and tail; this only bounds the message. */
const DETAIL_MAX = 12_000;
/** Calls remembered while they run, so their result finds them. */
const OPEN_MAX = 400;

const KINDS: [HistoryKind, RegExp][] = [
  ["plan", /^(TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet|update_plan|todowrite|write_todos|todo|ExitPlanMode)$/],
  ["search", /^(Grep|Glob|grep_search|codebase_search|find_by_name|search_files|glob|grep)$/],
  ["read", /^(Read|LS|view_file|view_file_outline|view_code_item|read_file|view_image|list_dir|read|list)$/],
  ["edit", /^(Edit|MultiEdit|NotebookEdit|replace_file_content|multi_replace_file_content|patch|apply_patch|edit)$/],
  ["write", /^(Write|write_to_file|write_file|write)$/],
  ["run", /^(Bash|PowerShell|run_command|send_command_input|terminal|execute_code|shell|shell_command|local_shell|exec_command|bash)$/],
  ["web", /^(WebFetch|WebSearch|search_web|read_url_content|web_search|web_extract|webfetch|websearch|browser_navigate)$/],
  ["agent", /^(Task|Agent|delegate_task|spawn_agent|task)$/],
  ["skill", /^(Skill|skill_view|skill)$/],
];

/** Which kind of thing a tool call is, across the agents' tool names. */
export function toolKind(tool: string): HistoryKind {
  if (tool.startsWith("mcp__")) return "mcp";
  for (const [kind, names] of KINDS) if (names.test(tool)) return kind;
  return "tool";
}

/** Case-insensitive lookup: AGY says `AbsolutePath`, OpenCode `filePath`. */
function pick(input: Input, ...names: string[]): unknown {
  const lower = new Map(Object.entries(input).map(([k, v]) => [k.toLowerCase(), v]));
  for (const n of names) {
    const v = lower.get(n);
    if (v != null && v !== "") return v;
  }
  return undefined;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** One spelling of a path: forward slashes, lower case. */
const pathKey = (p: string) => p.replace(/\\/g, "/").toLowerCase();

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** The command a run tool was given. Codex sends it as an argv array. */
export function commandOf(input: Input): string | null {
  const v = pick(input, "command", "commandline", "cmd", "code", "script");
  if (typeof v === "string") return v.trim() || null;
  if (Array.isArray(v)) {
    const argv = v.filter((a): a is string => typeof a === "string");
    // ["bash", "-lc", "npm test"] → the part a person would recognise.
    const line = argv.length >= 3 && /^(-l?c|-command|\/c)$/i.test(argv[1]) ? argv.slice(2).join(" ") : argv.join(" ");
    return line.trim() || null;
  }
  return null;
}

/** The files a call reads or changes, from the paths in its input. */
export function toolFiles(tool: string, input: Input, kind: HistoryKind = toolKind(tool)): FileRef[] {
  const files: FileRef[] = [];
  const add = (path: string, change: FileRef["change"]) => {
    const p = path.trim();
    if (p && !files.some((f) => f.path === p)) files.push({ path: p, change });
  };
  if (tool === "apply_patch") {
    // Codex's patch names every file it touches.
    const patch = [str(pick(input, "input")), str(pick(input, "patch")), commandOf(input) ?? ""].join("\n");
    for (const m of patch.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)) {
      add(m[2], m[1] === "Add" ? "write" : m[1] === "Delete" ? "delete" : "edit");
    }
    if (files.length) return files;
  }
  if (kind !== "read" && kind !== "edit" && kind !== "write") return files;
  const path = str(pick(input, "file_path", "filepath", "absolutepath", "targetfile", "notebook_path", "path"));
  // A folder listing is a read of nothing in particular.
  if (path && !/^(LS|list_dir|list)$/.test(tool)) add(path, kind);
  return files;
}

/** Text out of whatever shape a result arrives in. */
export function outputText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(outputText).filter(Boolean).join("\n");
  if (typeof v === "object") {
    const o = v as Input;
    const parts = [o.stdout, o.output, o.text, o.content, o.result, o.stderr].map(outputText).filter(Boolean);
    return parts.join("\n");
  }
  return String(v);
}

interface Open {
  entry: HistoryEntry;
  /** performance.now() at the start. */
  started: number;
}

class HistoryFeed {
  /** Where batches go (Bridge.historyAppend). Null: nothing is recorded. */
  sink: ((entries: HistoryEntry[], sessions: Record<string, HistorySession>) => void) | null = null;
  /** Settings → history on/off, asked on every event. */
  enabled: () => boolean = () => true;

  // Seeded with the clock so ids never repeat after a restart: history.json
  // still holds the last run's `<session>:<n>` entries.
  private seq = Date.now();
  private pending = new Map<string, HistoryEntry>();
  private sessions: Record<string, HistorySession> = {};
  private open = new Map<string, Open>();
  private lastPrompt = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  private on(): boolean {
    return this.sink != null && this.enabled();
  }

  /** Whether entries are being kept (the history is on and has somewhere to go). */
  active(): boolean {
    return this.on();
  }

  /** Files each session's tool calls named this request, so git only adds the others. */
  private named = new Map<string, Set<string>>();

  private nextId(session: string): string {
    return `${session}:${++this.seq}`;
  }

  private push(ctx: HistoryCtx, entry: HistoryEntry) {
    entry.title = clip(entry.title.replace(/\s+/g, " ").trim(), TITLE_MAX);
    if (entry.detail != null) entry.detail = clip(entry.detail, DETAIL_MAX);
    if (entry.ms != null) entry.ms = Math.max(0, Math.round(entry.ms));
    // A later report of the same id in the same batch replaces the earlier one.
    this.pending.set(entry.id, { ...this.pending.get(entry.id), ...entry });
    const info: HistorySession = {};
    if (ctx.cwd) info.cwd = ctx.cwd;
    if (ctx.name) info.name = ctx.name;
    this.sessions[ctx.session] = { ...this.sessions[ctx.session], ...info };
    this.timer ??= setTimeout(() => this.flush(), FLUSH_MS);
  }

  /** Sends what is waiting now. */
  flush() {
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.size === 0) return;
    const entries = [...this.pending.values()];
    const sessions = this.sessions;
    this.pending = new Map();
    this.sessions = {};
    if (this.on()) this.sink?.(entries, sessions);
  }

  private plain(ctx: HistoryCtx, kind: HistoryKind, status: HistoryStatus, title: string, detail?: string) {
    const entry: HistoryEntry = {
      id: this.nextId(ctx.session), session: ctx.session, agent: ctx.agent, at: Date.now(), kind, tool: "", title, status,
    };
    if (detail) entry.detail = detail;
    this.push(ctx, entry);
  }

  /** What the user asked. The same prompt twice in a row is one entry. */
  prompt(ctx: HistoryCtx, text: string) {
    const asked = text.trim();
    if (!this.on() || !asked) return;
    if (this.lastPrompt.get(ctx.session) === asked) return;
    this.lastPrompt.set(ctx.session, asked);
    this.named.delete(ctx.session);
    this.plain(ctx, "prompt", "info", asked, asked.length > TITLE_MAX ? asked : undefined);
  }

  /** What the agent said (from its transcript). */
  say(ctx: HistoryCtx, text: string) {
    const said = text.trim();
    if (!this.on() || !said) return;
    this.plain(ctx, "say", "info", said, said.length > TITLE_MAX ? said : undefined);
  }

  /** A tool call begins — or, with `waiting`, asks for permission first. */
  toolStart(ctx: HistoryCtx, call: HistoryCall, waiting = false) {
    if (!this.on()) return;
    const openKey = `${ctx.session}\n${call.key}`;
    const known = this.open.get(openKey);
    if (known) {
      // The same call again: PreToolUse, then its PermissionRequest.
      const status: HistoryStatus = waiting ? "waiting" : "running";
      if (known.entry.status !== status) {
        known.entry.status = status;
        this.push(ctx, { ...known.entry });
      }
      return;
    }
    const entry = this.entryFor(ctx, call, waiting ? "waiting" : "running");
    this.open.set(openKey, { entry, started: performance.now() });
    if (this.open.size > OPEN_MAX) this.open.delete(this.open.keys().next().value as string);
    // A new turn's prompt may repeat the last one word for word.
    this.lastPrompt.delete(ctx.session);
    this.push(ctx, { ...entry });
  }

  /** The call's result. `output` is whatever the event carried, if anything. */
  toolEnd(ctx: HistoryCtx, call: HistoryCall, failed: boolean, output?: unknown) {
    if (!this.on()) return;
    const openKey = `${ctx.session}\n${call.key}`;
    const known = this.open.get(openKey);
    this.open.delete(openKey);
    const entry = known ? { ...known.entry } : this.entryFor(ctx, call, "ok");
    entry.status = failed ? "failed" : "ok";
    if (known) entry.ms = performance.now() - known.started;
    const detail = outputText(output).trim();
    if (detail) entry.detail = detail;
    this.push(ctx, entry);
  }

  /** The turn ended. `detail` is the agent's last message when known. */
  done(ctx: HistoryCtx, detail?: string | null) {
    if (!this.on()) return;
    this.settle(ctx, "stopped");
    const said = (detail ?? "").trim();
    this.plain(ctx, "done", "ok", said ? said.replace(/\s+/g, " ") : "Done", said || undefined);
  }

  error(ctx: HistoryCtx, title: string, detail?: string) {
    if (!this.on()) return;
    this.plain(ctx, "error", "failed", title, detail);
  }

  /**
   * Calls of a session that never got their result (denied, interrupted, the
   * session ended) stop being "running".
   */
  settle(ctx: HistoryCtx, status: HistoryStatus = "stopped") {
    const prefix = `${ctx.session}\n`;
    for (const [key, known] of [...this.open]) {
      if (!key.startsWith(prefix)) continue;
      this.open.delete(key);
      if (this.on()) this.push(ctx, { ...known.entry, status });
    }
  }

  private entryFor(ctx: HistoryCtx, call: HistoryCall, status: HistoryStatus): HistoryEntry {
    const kind = toolKind(call.tool);
    const command = kind === "run" ? commandOf(call.input) : null;
    const entry: HistoryEntry = {
      id: call.toolUseId ? `${ctx.session}:${call.toolUseId}` : this.nextId(ctx.session),
      session: ctx.session,
      agent: ctx.agent,
      at: Date.now(),
      kind,
      tool: call.tool,
      title: command ?? call.title,
      status,
    };
    const files = toolFiles(call.tool, call.input, kind);
    if (files.length) {
      entry.files = files;
      if (kind === "edit" || kind === "write") {
        const named = this.named.get(ctx.session) ?? new Set<string>();
        for (const f of files) named.add(pathKey(f.path));
        this.named.set(ctx.session, named);
      }
    }
    return entry;
  }

  /** Files git says changed that no tool call of this request named (a script, `sed -i`, a commit). */
  gitChanges(ctx: HistoryCtx, changes: { path: string; change: "edit" | "write" | "delete" }[]) {
    if (!this.on()) return;
    const named = this.named.get(ctx.session);
    for (const c of changes) {
      if (named?.has(pathKey(c.path))) continue;
      this.push(ctx, {
        id: this.nextId(ctx.session), session: ctx.session, agent: ctx.agent, at: Date.now(),
        kind: c.change === "write" ? "write" : "edit", tool: "git", title: c.path, status: "ok",
        files: [c], detail: "Changed outside the agent's file tools (found by git)",
      });
    }
  }
}

export const History = new HistoryFeed();
