// Claude Code hook events → island state.
// Port of HookServer.processEvent / processPermissionRequest from the macOS app.
// Difference from macOS: no terminal filter. On Windows the hook fires from any
// terminal (Windows Terminal, VS Code, PowerShell…) and all of them are handled.

import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, type QuestionItem, type AgentSource } from "../core/state";
import type { Island } from "./island";

interface HookPayload {
  hook_event_name?: string;
  request_id?: string;
  session_id?: string;
  conversationId?: string; // AGY
  cwd?: string;
  workspacePaths?: string[]; // AGY
  message?: string;
  /** UserPromptSubmit carries `prompt`; `message` belongs to Notification/Stop. */
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  toolCall?: { name?: string; args?: Record<string, unknown> }; // AGY
  agent_source?: string;
  tool_use_id?: string;
  stepIdx?: number; // AGY
  /** AGY PostToolUse: non-empty when the tool failed. */
  error?: string;
  transcript_path?: string;
  transcriptPath?: string; // AGY
  /** Claude Code Stop: the final answer. */
  last_assistant_message?: string;
}

const KNOWN_SOURCES = new Set<AgentSource>(["claude", "agy", "hermes", "opencode", "codex"]);

function lastPathComponent(p: string): string {
  const cleaned = p.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

/** Verb shown for each tool, Claude Code's and AGY's names alike. */
const TOOL_VERBS: Record<string, string> = {
  Bash: "Run", PowerShell: "Run", run_command: "Run", send_command_input: "Run",
  Read: "Read", view_file: "Read", view_file_outline: "Read", view_code_item: "Read",
  Write: "Write", write_to_file: "Write",
  Edit: "Edit", MultiEdit: "Edit", replace_file_content: "Edit", multi_replace_file_content: "Edit",
  NotebookEdit: "Edit notebook",
  Glob: "Find", find_by_name: "Find",
  Grep: "Search", grep_search: "Search", codebase_search: "Search",
  LS: "List", list_dir: "List",
  WebSearch: "Web search", search_web: "Web search",
  WebFetch: "Fetch", read_url_content: "Fetch",
  TodoWrite: "Plan", Task: "Agent", Agent: "Agent",
  AskUserQuestion: "Ask", ask_question: "Ask", Skill: "Skill",
};

/** Case-insensitive field lookup: AGY says `AbsolutePath`, Claude `file_path`. */
function field(input: Record<string, unknown>, ...names: string[]): string | null {
  const lower = new Map(Object.entries(input).map(([k, v]) => [k.toLowerCase(), v]));
  for (const n of names) {
    const v = lower.get(n.toLowerCase());
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

const COMMAND_FIELDS = ["command", "commandline"];
const FILE_FIELDS = ["file_path", "absolutepath", "targetfile", "notebook_path"];
const PATH_FIELDS = ["path", "directorypath", "searchpath", "searchdirectory"];
const QUERY_FIELDS = ["query", "pattern"];

function toolVerb(tool: string): string {
  if (TOOL_VERBS[tool]) return TOOL_VERBS[tool];
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp) return `${mcp[1]} · ${mcp[2].replace(/_/g, " ")}`;
  const words = tool.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One readable line for a tool call: "Run · npm test", "Read · main.rs". */
export function describeTool(tool: string, input: Record<string, unknown>): string {
  // AGY writes its own summary of every call ("Read hello.txt").
  const summary = field(input, "toolSummary");
  if (summary) return summary;
  const verb = toolVerb(tool);
  if (tool === "TodoWrite" && Array.isArray(input.todos)) {
    const todos = input.todos as { status?: string; activeForm?: string; content?: string }[];
    const now = todos.find((t) => t.status === "in_progress");
    const done = todos.filter((t) => t.status === "completed").length;
    return now ? `${verb} · ${now.activeForm ?? now.content ?? ""} (${done}/${todos.length})` : `${verb} · ${done}/${todos.length} done`;
  }
  // Claude's Bash/Task carry a plain-words description: the clearest line.
  const said = field(input, "description");
  if (said) return said;
  const cmd = field(input, ...COMMAND_FIELDS);
  if (cmd) return `${verb} · ${cmd}`;
  const file = field(input, ...FILE_FIELDS, ...PATH_FIELDS);
  if (file) return `${verb} · ${lastPathComponent(file)}`;
  const query = field(input, ...QUERY_FIELDS, "url", "skill", "prompt");
  if (query) return `${verb} · ${query}`;
  return verb;
}

/**
 * What the Allow button actually authorises. Approving "Write" tells you nothing
 * — approving `Write · C:\…\.env` tells you everything, and the difference is
 * the whole point of approving from the island rather than blind.
 *
 * Ordered by how specific the field is, so an unfamiliar tool still shows
 * whatever identifying string it carries instead of falling back to its name.
 */
function approvalTarget(tool: string, input: Record<string, unknown>): string {
  const value = field(input, ...COMMAND_FIELDS, ...FILE_FIELDS, ...PATH_FIELDS, "url", ...QUERY_FIELDS, "prompt");
  return value ? `${tool} · ${value}` : tool;
}

/** Identifies one tool call across the events that report it. */
function callKey(payload: HookPayload, tool: string, input: Record<string, unknown>): string {
  if (payload.tool_use_id) return payload.tool_use_id;
  if (payload.stepIdx != null) return `step-${payload.stepIdx}`;
  return `${tool}:${JSON.stringify(input).slice(0, 200)}`;
}

/** Agents answer in Markdown; the log shows plain words. */
export function plainText(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) → text
    .replace(/<\/?[a-zA-Z][^>]*>/g, "") // stray tags
    .replace(/(\*\*|__|`+)/g, "")
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/(^|\s)[-*]\s+/g, "$1• ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reads what the agent said/thought since last time, in order per session. */
const transcriptChains = new Map<string, Promise<void>>();
function pullTranscript(
  taskId: string, source: AgentSource, path: string | undefined, fallback?: string, then?: () => void,
) {
  if (!path || (source !== "claude" && source !== "agy")) {
    if (fallback) State.appendStep(taskId, fallback, "say");
    then?.();
    return;
  }
  const prev = transcriptChains.get(taskId) ?? Promise.resolve();
  const next = prev.then(async () => {
    try {
      const steps = (await Bridge.transcriptTail(source, path)) ?? [];
      for (const st of steps) State.appendStep(taskId, plainText(st.text), st.kind);
      if (steps.length === 0 && fallback) State.appendStep(taskId, plainText(fallback), "say");
    } catch {
      if (fallback) State.appendStep(taskId, fallback, "say");
    }
    then?.();
  });
  transcriptChains.set(taskId, next);
}

function queueApprovalRequest(
  island: Island,
  session: ReturnType<typeof State.getOrCreateSession>,
  sessionId: string,
  requestId: string,
  tool: string,
  input: Record<string, unknown>,
  key: string,
) {
  // Every tool call shows in the log, whether it ends up auto-allowed or not.
  State.appendStep(session.id, describeTool(tool, input), "tool", key);
  const target = approvalTarget(tool, input);
  const ruleKey = `${tool}:${target}`;

  // 1. Check Always-Allowed rule: auto-approve immediately. A question always
  // needs a human: allowing it blind would send back no answers.
  if (!questionItems(tool, input) && State.isAlwaysAllowed(ruleKey)) {
    void Bridge.log(`Auto-allowed always-rule: ${ruleKey}`);
    void Bridge.approvalAck(requestId);
    void Bridge.approvalDecision(requestId, "allow");
    session.state = "working";
    return;
  }

  // 2. Ack immediately so relay timeout doesn't expire
  void Bridge.approvalAck(requestId);

  // 3. Questions: Claude's AskUserQuestion, AGY's ask_question.
  const questions = questionItems(tool, input);
  const isQuestion = !!questions?.length;

  // 4. Queue the approval
  State.pushApproval({
    requestId,
    sessionId,
    tool,
    command: target,
    rawInput: input,
    isQuestion,
    questions,
    createdAt: performance.now(),
  });

  session.state = "approval";
  session.pillBadge = "approval";
  State.isPinned = true;
  Sound.play("approval");

  // Open straight on the card: the agent is blocked until someone answers,
  // and answering from the island is the point (Coucou #117/#120).
  island.alert("approval", true);

  // 5. Per-request safety timeout
  window.setTimeout(() => {
    const removed = State.removeApproval(requestId);
    if (removed && State.approvalQueue.length === 0) {
      State.isPinned = false;
      island.dropPin();
      session.state = "working";
      session.pillBadge = null;
      if (State.view === "approval") island.setView(State.defaultView());
      State.notify();
    }
  }, 110_000);
}

/**
 * The questions a tool call asks, in the island's shape. AGY's ask_question
 * carries `{question, options: string[], is_multi_select}`.
 */
function questionItems(tool: string, input: Record<string, unknown>): QuestionItem[] | undefined {
  if (!Array.isArray(input.questions)) return undefined;
  if (tool === "AskUserQuestion") return input.questions as QuestionItem[];
  if (tool === "ask_question") {
    return (input.questions as Record<string, unknown>[]).map((q) => ({
      question: String(q.question ?? ""),
      options: (Array.isArray(q.options) ? q.options : []).map((o) =>
        typeof o === "string" ? { label: o } : { label: String((o as { label?: unknown }).label ?? o) },
      ),
      multiSelect: q.is_multi_select === true,
    }));
  }
  return undefined;
}

export function registerHookHandlers(island: Island) {
  void onEvent<HookPayload>("hook", (payload) => {
    try {
      handleHook(island, payload);
    } catch (err) {
      void Bridge.log(`hook handler failed (${payload.hook_event_name}): ${String(err)}`);
    }
  });
  // `npm run dev` in a browser: feed hook payloads by hand to check the views.
  if (!IS_TAURI) (window as unknown as { __hook: (p: HookPayload) => void }).__hook = (p) => handleHook(island, p);
}

function handleHook(island: Island, payload: HookPayload) {
  if (State.paused) {
    if (payload.request_id) void Bridge.approvalDecline(payload.request_id);
    return;
  }

  const name = payload.hook_event_name ?? "";
  let cwd = payload.cwd ?? "";
  if (!cwd && Array.isArray(payload.workspacePaths) && payload.workspacePaths.length > 0) {
    cwd = payload.workspacePaths[0];
  }

  // awuuu-hook always says who is calling (`--agent`, or Claude Code for
  // installs that predate the flag).
  const source: AgentSource = KNOWN_SOURCES.has(payload.agent_source as AgentSource)
    ? (payload.agent_source as AgentSource)
    : "claude";

  const sessionId = payload.session_id || payload.conversationId || "default";
  const session = State.getOrCreateSession(sessionId, cwd, source);
  const taskId = session.id;

  let tool = payload.tool_name ?? "";
  let input = payload.tool_input ?? {};
  if (!tool && payload.toolCall?.name) {
    tool = payload.toolCall.name;
    input = payload.toolCall.args ?? {};
  }
  if (!tool) tool = "Tool";

  const transcript = payload.transcript_path || payload.transcriptPath;
  const key = callKey(payload, tool, input);

  switch (name) {
    case "SessionStart":
      session.sessionCwd = cwd;
      Sound.play("work");
      break;

    // AGY: one model call. The prompt and what the model said/thought are in
    // its transcript.
    case "PreInvocation":
      session.sessionCwd = cwd;
      session.state = "thinking";
      pullTranscript(taskId, source, transcript);
      break;

    case "PostInvocation":
      // Not idle: the turn goes on until Stop.
      pullTranscript(taskId, source, transcript);
      break;

    case "UserPromptSubmit": {
      session.sessionCwd = cwd;
      session.state = "thinking";
      pullTranscript(taskId, source, transcript);
      const asked = payload.prompt ?? payload.message;
      if (asked) State.appendStep(taskId, asked.slice(0, 600), "prompt");
      break;
    }

    case "PreToolUse": {
      session.sessionCwd = cwd;
      if (payload.request_id) {
        queueApprovalRequest(island, session, sessionId, payload.request_id, tool, input, key);
      } else {
        session.state = "working";
        State.appendStep(taskId, describeTool(tool, input), "tool", key);
      }
      break;
    }

    case "PostToolUse":
      if (session.state !== "approval") session.state = "working";
      if (payload.error) State.appendStep(taskId, `${toolVerb(tool)} failed · ${payload.error.slice(0, 300)}`, "error");
      pullTranscript(taskId, source, transcript);
      break;

    case "PostToolUseFailure":
      session.state = "working";
      State.appendStep(taskId, `${toolVerb(tool)} failed`, "error");
      break;

    case "Notification": {
      const message = payload.message ?? "";
      const lower = message.toLowerCase();
      if (lower.includes("rate limit")) {
        session.state = "ratelimit";
        State.appendStep(taskId, message, "error");
        Sound.play("rate");
        island.toast("agents", 5);
      } else if (message.endsWith("?")) {
        session.state = "question";
        State.appendStep(taskId, message, "info");
        island.toast("agents", 5);
      }
      break;
    }

    case "Stop":
      session.state = "finished";
      pullTranscript(taskId, source, transcript, payload.last_assistant_message ?? payload.message, () =>
        State.appendStep(taskId, "Done", "done"),
      );
      Sound.play("finish");
      session.pillBadge = "finished";
      if (State.mode === "expanded" && State.view === "agents") {
        // stay on agents
      } else {
        island.toast("agents", 5);
      }
      window.setTimeout(() => {
        if (session.state === "finished") {
          session.state = "idle";
          session.pillBadge = null;
          State.notify();
        }
      }, 5200);
      break;

    case "StopFailure":
      session.state = "error";
      State.appendStep(taskId, payload.message ? `Stopped · ${payload.message}` : "Stopped with an error", "error");
      Sound.play("error");
      session.pillBadge = "error";
      island.alert("error", true);
      break;

    case "SessionEnd":
      session.state = "idle";
      window.setTimeout(() => {
        State.removeSession(sessionId);
      }, 3000);
      break;

    case "SubagentStart":
      State.appendStep(taskId, "Subagent started", "info");
      break;

    case "SubagentStop":
      State.appendStep(taskId, "Subagent done", "info");
      break;

    case "PermissionRequest": {
      if (payload.request_id) {
        queueApprovalRequest(island, session, sessionId, payload.request_id, tool, input, key);
      }
      break;
    }

    default:
      break;
  }
  State.notify();
}

