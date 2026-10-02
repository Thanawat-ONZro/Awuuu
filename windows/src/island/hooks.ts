// Claude Code hook events → island state.
// Port of HookServer.processEvent / processPermissionRequest from the macOS app.
// Difference from macOS: no terminal filter. On Windows the hook fires from any
// terminal (Windows Terminal, VS Code, PowerShell…) and all of them are handled.

import { Bridge, onEvent } from "../core/bridge";
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
}

const KNOWN_SOURCES = new Set<AgentSource>(["claude", "agy", "hermes", "opencode", "codex"]);

function lastPathComponent(p: string): string {
  const cleaned = p.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

/** frenchStep() — same labels as the macOS app. */
const TOOL_LABELS: Record<string, string> = {
  Bash: "Exécute",
  Read: "Lit",
  Write: "Écrit",
  Edit: "Modifie",
  Glob: "Cherche",
  Grep: "Recherche",
  WebSearch: "Recherche web",
  WebFetch: "Récupère",
  TodoWrite: "Tâches",
  Task: "Agent",
  LS: "Liste",
  MultiEdit: "Modifie",
  NotebookEdit: "Notebook",
  PowerShell: "Exécute",
};

function stepLabel(tool: string, input: Record<string, unknown>): string {
  const label = TOOL_LABELS[tool] ?? tool;
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  const cmd = str("command");
  if (cmd) return `${label} · ${cmd.slice(0, 40)}`;
  const path = str("path");
  if (path) return `${label} · ${lastPathComponent(path)}`;
  const file = str("file_path");
  if (file) return `${label} · ${lastPathComponent(file)}`;
  const query = str("query");
  if (query) return `${label} · ${query.slice(0, 40)}`;
  return label;
}

/**
 * What the Allow button actually authorises. Approving "Write" tells you nothing
 * — approving `Write · C:\…\.env` tells you everything, and the difference is
 * the whole point of approving from the island rather than blind.
 *
 * Ordered by how specific the field is, so an unfamiliar tool still shows
 * whatever identifying string it carries instead of falling back to its name.
 */
const APPROVAL_FIELDS = [
  "command", // Bash, PowerShell
  "file_path", // Write, Edit, MultiEdit, NotebookEdit
  "path", // Read, LS
  "url", // WebFetch
  "query", // WebSearch
  "pattern", // Glob, Grep
  "prompt", // Task
] as const;

function approvalTarget(tool: string, input: Record<string, unknown>): string {
  for (const field of APPROVAL_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) {
      return `${tool} · ${value.trim()}`;
    }
  }
  return tool;
}

function queueApprovalRequest(
  island: Island,
  session: ReturnType<typeof State.getOrCreateSession>,
  sessionId: string,
  requestId: string,
  tool: string,
  input: Record<string, unknown>,
) {
  const target = approvalTarget(tool, input);
  const ruleKey = `${tool}:${target}`;

  // 1. Check Always-Allowed rule: auto-approve immediately. A question always
  // needs a human: allowing it blind would send back no answers.
  if (!questionItems(tool, input) && State.isAlwaysAllowed(ruleKey)) {
    void Bridge.log(`Auto-allowed always-rule: ${ruleKey}`);
    void Bridge.approvalAck(requestId);
    void Bridge.approvalDecision(requestId, "allow");
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

  if (State.mode === "expanded") {
    island.setView("approval");
  } else {
    island.alert("approval", false);
  }

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
  void onEvent<HookPayload>("hook", (payload) => handleHook(island, payload));
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

  switch (name) {
    case "SessionStart":
      session.sessionCwd = cwd;
      Sound.play("work");
      break;

    case "PreInvocation":
      session.sessionCwd = cwd;
      session.state = "thinking";
      break;

    case "PostInvocation":
      session.state = "idle";
      break;

    case "UserPromptSubmit": {
      session.sessionCwd = cwd;
      session.state = "thinking";
      const asked = payload.prompt ?? payload.message;
      if (asked) State.appendStep(taskId, asked.slice(0, 80));
      break;
    }

    case "PreToolUse": {
      if (payload.request_id) {
        queueApprovalRequest(island, session, sessionId, payload.request_id, tool, input);
      } else {
        session.sessionCwd = cwd;
        session.state = "working";
        State.appendStep(taskId, stepLabel(tool, input));
      }
      break;
    }

    case "PostToolUse":
      session.state = "working";
      break;

    case "PostToolUseFailure":
      session.state = "working";
      State.appendStep(taskId, "⚠ failed");
      break;

    case "Notification": {
      const message = payload.message ?? "";
      const lower = message.toLowerCase();
      if (lower.includes("rate limit") || lower.includes("limite d")) {
        session.state = "ratelimit";
        Sound.play("rate");
        island.toast("agents", 5);
      } else if (message.endsWith("?")) {
        session.state = "question";
        State.appendStep(taskId, message);
        island.toast("agents", 5);
      }
      break;
    }

    case "Stop":
      session.state = "finished";
      if (payload.message) State.appendStep(taskId, payload.message.slice(0, 80));
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
      State.appendStep(taskId, "+ subagent");
      break;

    case "SubagentStop":
      State.appendStep(taskId, "• subagent done");
      break;

    case "PermissionRequest": {
      if (payload.request_id) {
        queueApprovalRequest(island, session, sessionId, payload.request_id, tool, input);
      }
      break;
    }

    default:
      break;
  }
  State.notify();
}

