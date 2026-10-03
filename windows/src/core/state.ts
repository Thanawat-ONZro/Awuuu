// App state — mirror of AppState.swift (the parts the island needs).

import type { BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../mochi/engine";
import type { AgentUsage } from "./bridge";

export type AgentSource = "claude" | "agy" | "hermes" | "opencode" | "codex" | "integration";

/** Display name, short tag and colour of each agent. */
export const AGENT_INFO: Record<Exclude<AgentSource, "integration">, { name: string; short: string; color: string }> = {
  claude: { name: "Claude Code", short: "Claude", color: "#F06543" },
  agy: { name: "Antigravity CLI", short: "AGY", color: "#4285F4" },
  hermes: { name: "Hermes Agent", short: "Hermes", color: "#8B5CF6" },
  opencode: { name: "OpenCode", short: "OpenCode", color: "#00D26A" },
  codex: { name: "Codex CLI", short: "Codex", color: "#10A37F" },
};

export function agentInfo(source: AgentSource) {
  return source === "integration" ? AGENT_INFO.claude : AGENT_INFO[source];
}
export type PillBadge = "approval" | "finished" | "error";

/** One line of a session's activity log in the Agents hub. */
export type LogKind = "prompt" | "sent" | "tool" | "say" | "think" | "done" | "error" | "info";
export interface LogEntry {
  kind: LogKind;
  text: string;
  /** Date.now() when it happened. */
  at: number;
  /** Identifies a tool call, so the same call reported twice shows once. */
  key?: string;
}
const LOG_MAX = 80;

/** One step of an agent's plan (its todo list). */
export interface PlanItem {
  text: string;
  /** The step as the agent says it while doing it ("Fixing the parser"). */
  active?: string;
  status: "pending" | "in_progress" | "completed";
  /** Claude's task id, for TaskUpdate. */
  id?: string;
}

/** The plan an agent is working through, kept up to date by island/plan.ts. */
export interface Plan {
  items: PlanItem[];
  done: number;
  total: number;
  /** What it is doing now: the step in progress, else the next one. */
  current: string | null;
  /** Tasks created so far (the next TaskCreate gets `created + 1` as its id). */
  created?: number;
}

export interface AgentTask {
  id: string;
  name: string;
  color: string;
  state: BotStateName;
  stepIndex: number;
  steps: string[];
  source: AgentSource;
  isIntegration: boolean;
  emote?: BotEmoteName | null;
  miniEye?: EyeShape | null;
  pillBadge?: PillBadge | null;
  sessionCwd?: string | null;
  /** The terminal window the agent runs in (from awuuu-hook), for "Open terminal". */
  terminalHwnd?: number | null;
  ancestorPids?: number[];
  /** Agent sessions: what happened, newest last. */
  log?: LogEntry[];
  /** Agent sessions: the todo list the agent keeps, when it keeps one. */
  plan?: Plan;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface ApprovalInfo {
  requestId: string;
  sessionId: string;
  tool: string;
  command: string;
  rawInput?: Record<string, unknown>;
  isQuestion?: boolean;
  questions?: QuestionItem[];
  createdAt?: number;
  /** The tool call this card is about (tool_use_id, AGY step, or tool+input). */
  callKey?: string;
  callSig?: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export type PromptContext =
  | { kind: "window"; appName: string; title: string; url?: string }
  | { kind: "file"; name: string; path?: string };

export interface ResultItem {
  label: string;
  detail: string;
  url?: string;
}

export interface SearchResult {
  title: string;
  items: ResultItem[];
  note?: string;
}

const task = (
  id: string, name: string, color: string, source: AgentSource,
): AgentTask => ({
  id, name, color, state: "idle", stepIndex: 0, steps: [], source, isIntegration: true,
});

/** AgentTask.integrationAgents — pure integrations without static VS Code. */
export const INTEGRATION_AGENTS: AgentTask[] = [
  task("integration_calendar", "Calendar", "#4285F4", "integration"),
  task("integration_mail", "Mail", "#EA4335", "integration"),
  task("integration_todoist", "Todoist", "#E44332", "integration"),
  task("integration_uptime", "Uptime", "#22C55E", "integration"),
  task("integration_weather", "Weather", "#38BDF8", "integration"),
  task("integration_feeds", "News", "#F59E0B", "integration"),
  task("integration_resend", "Resend", "#22C55E", "integration"),
  task("integration_n8n", "n8n", "#F29B38", "integration"),
  task("integration_vercel", "Vercel", "#7C5CFF", "integration"),
  task("integration_github", "GitHub", "#F0645A", "integration"),
  task("integration_notion", "Notion", "#8C8C8C", "integration"),
  task("integration_calcom", "Cal.com", "#C9956A", "integration"),
  task("integration_stripe", "Stripe", "#0570DE", "integration"),
];


/** What an integration poller last reported. */
export interface IntegrationInfo {
  data: Record<string, unknown>;
  error: string | null;
  loaded: boolean;
  configured: boolean;
}

/** An OpenAI-compatible chat server added in Settings (key in the Credential Manager). */
export interface ChatProvider {
  id: string;
  name: string;
  /** ".../v1" */
  baseUrl: string;
  model: string;
}

export interface Settings {
  soundEnabled: boolean;
  soundVolume: number;
  autoCloseInterval: number;
  activeIntegrations: string[];
  screen: "primary" | "cursor";
  /** The screen edge the island docks to. */
  position: "top" | "bottom" | "left" | "right";
  /** Where along that edge, 0..1. */
  along: number;
  /** Width of the open island, px. */
  islandWidth: number;
  /** Height of the Agents hub, px. */
  hubHeight: number;
  providers: ChatProvider[];
  /** "" = Hermes / Claude by `model`; else a provider id. */
  chatProvider: string;
  mailHost: string;
  mailUser: string;
  rssFeeds: string[];
  uptimeUrls: string[];
  weatherCity: string;
  /** The Welcome page has been read. */
  onboarded: boolean;
  /** Hermes chat: model + provider for the turn ("" = Hermes' default) and effort. */
  hermesModel: string;
  hermesProvider: string;
  reasoningEffort: string;
  /** Agents hub text size, 1 = normal. */
  hubScale: number;
  /** Log lines kept on screen in the hub; 0 = all. */
  logLines: number;
  showThinking: boolean;
  showTime: boolean;
  autostart: boolean;
  hooksInstalled: boolean;
  /** Claude model used by the chat. */
  model: string;
  /** Seconds before the idle compact island hides; 0 = never. */
  hideAfter: number;
  /** Automatic update checks; null = not asked yet. */
  updateCheck: boolean | null;
  /** Always-allowed tool commands or patterns. */
  alwaysAllowedRules: string[];
  /** Keep what the agents did for the dashboard, and for how many days. */
  historyEnabled: boolean;
  historyDays: number;
  /** Height of the open chat, px (0 = grows with the conversation). */
  chatHeight: number;
  /** How Awuuu looks (mochi/dog.ts DogLook); null = the classic Shiba. */
  dog: Record<string, unknown> | null;
  /** OAuth client ids for "Sign in with…". */
  googleClientId: string;
  microsoftClientId: string;
  githubClientId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  soundVolume: 0.12,
  autoCloseInterval: 15,
  activeIntegrations: [
    "integration_resend", "integration_n8n", "integration_vercel", "integration_github",
  ],
  screen: "primary",
  position: "top",
  along: 0.5,
  islandWidth: 640,
  hubHeight: 290,
  providers: [],
  chatProvider: "",
  mailHost: "",
  mailUser: "",
  rssFeeds: [],
  uptimeUrls: [],
  weatherCity: "",
  onboarded: false,
  hermesModel: "",
  hermesProvider: "",
  reasoningEffort: "",
  hubScale: 1,
  logLines: 40,
  showThinking: true,
  showTime: true,
  autostart: false,
  hooksInstalled: false,
  model: "hermes-agent",
  hideAfter: 5,
  updateCheck: null,
  alwaysAllowedRules: [],
  historyEnabled: true,
  historyDays: 7,
  chatHeight: 0,
  dog: null,
  googleClientId: "",
  microsoftClientId: "",
  githubClientId: "",
};

type Listener = () => void;

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "overview";

  tasks: AgentTask[] = [];
  focusId: string | null = null;

  stateOverride: BotStateName | null = null;

  /** Cursor in logical screen pixels, origin top-left (like AppState.mousePosition). */
  mouse = { x: 0, y: 0 };
  /** Cursor relative to the island's top-left corner. */
  mouseInIsland = { x: 0, y: 0 };

  isPinned = false;
  paused = false;

  uploadProgress = 0;
  uploadDuration = 2.4;
  fileDragOver = false;

  promptContext: PromptContext | null = null;
  droppedFile: { name: string; path: string } | null = null;
  noteMessage: string | null = null;
  searchResult: SearchResult | null = null;
  chatHistory: ChatMessage[] = [];

  agentSessions: AgentTask[] = [];
  agentFocusId: string | null = null;
  approvalQueue: ApprovalInfo[] = [];
  /** Measured content height of the approval card (layout.approvalHeight). */
  approvalFit = 0;
  sessionAlwaysAllowed = new Set<string>();

  get pendingApproval(): ApprovalInfo | null {
    return this.approvalQueue[0] ?? null;
  }
  set pendingApproval(val: ApprovalInfo | null) {
    if (val == null) {
      if (this.approvalQueue.length > 0) this.approvalQueue.shift();
    } else {
      const idx = this.approvalQueue.findIndex((x) => x.requestId === val.requestId);
      if (idx >= 0) this.approvalQueue[idx] = val;
      else this.approvalQueue.unshift(val);
    }
  }

  pushApproval(info: ApprovalInfo) {
    if (!this.approvalQueue.some((x) => x.requestId === info.requestId)) {
      this.approvalQueue.push(info);
      this.notify();
    }
  }

  removeApproval(requestId: string): ApprovalInfo | null {
    const idx = this.approvalQueue.findIndex((x) => x.requestId === requestId);
    if (idx >= 0) {
      const removed = this.approvalQueue.splice(idx, 1)[0];
      this.notify();
      return removed;
    }
    return null;
  }

  /** Plan limits of the connected agents (island/usage.ts refreshUsage()). */
  usage: AgentUsage[] = [];

  integrations: Record<string, IntegrationInfo> = {};
  /** The overview shows Today (true) or the focused integration's card. */
  overviewToday = true;

  lastActivity = performance.now();

  settings: Settings = { ...DEFAULT_SETTINGS };

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Marks the UI dirty; the island re-renders on the next frame. */
  notify() {
    for (const fn of this.listeners) fn();
  }

  get focusTask(): AgentTask | null {
    return this.tasks.find((t) => t.id === this.focusId) ?? this.tasks[0] ?? null;
  }

  /** The task an alert view (error, finished) is about. */
  alertTaskId: string | null = null;
  get alertTask(): AgentTask | null {
    return this.tasks.find((t) => t.id === this.alertTaskId) ?? this.focusTask;
  }

  get effectiveState(): BotStateName {
    return this.stateOverride ?? this.focusTask?.state ?? "idle";
  }

  get otherTasks(): AgentTask[] {
    return this.tasks.filter((t) => t.id !== this.focusId && t.isIntegration);
  }

  get activeAgentSessions(): AgentTask[] {
    return this.agentSessions;
  }

  get focusedAgentSession(): AgentTask | null {
    return this.agentSessions.find((s) => s.id === this.agentFocusId) ?? this.agentSessions[0] ?? null;
  }

  setFocus(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    this.focusId = id;
    t.pillBadge = null;
    this.notify();
  }

  setAgentFocus(id: string) {
    this.agentFocusId = id;
    const s = this.agentSessions.find((x) => x.id === id);
    if (s) s.pillBadge = null;
    this.notify();
  }

  getOrCreateSession(sessionId: string, cwd: string, source: AgentSource = "claude"): AgentTask {
    const id = `session_${sessionId}`;

    let existing = this.agentSessions.find((s) => s.id === id);
    if (!existing) {
      const cleaned = cwd.replace(/[\\/]+$/, "");
      const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
      const dirName = idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
      // The island's own Hermes chat shows up as a session too.
      const name = sessionId.startsWith("awuuu-chat-") ? "Island chat" : dirName || agentInfo(source).short;
      const color = agentInfo(source).color;
      existing = {
        id,
        name,
        color,
        state: "idle",
        stepIndex: 0,
        steps: [],
        source,
        isIntegration: false,
        sessionCwd: cwd,
      };
      this.agentSessions.push(existing);
      this.tasks.push(existing);
      if (!this.agentFocusId) this.agentFocusId = id;
      this.notify();
    } else {
      if (cwd && !existing.sessionCwd) existing.sessionCwd = cwd;
      if (source && existing.source !== source) {
        existing.source = source;
        existing.color = agentInfo(source).color;
      }
    }
    return existing;
  }

  removeSession(sessionId: string) {
    const id = `session_${sessionId}`;
    const sIdx = this.agentSessions.findIndex((s) => s.id === id);
    if (sIdx >= 0) this.agentSessions.splice(sIdx, 1);
    const tIdx = this.tasks.findIndex((t) => t.id === id);
    if (tIdx >= 0) this.tasks.splice(tIdx, 1);
    if (this.agentFocusId === id) {
      this.agentFocusId = this.agentSessions[0]?.id ?? null;
    }
    this.notify();
  }

  isAlwaysAllowed(rule: string): boolean {
    return this.sessionAlwaysAllowed.has(rule) || (this.settings.alwaysAllowedRules || []).includes(rule);
  }

  addAlwaysAllowed(rule: string) {
    this.sessionAlwaysAllowed.add(rule);
    if (!this.settings.alwaysAllowedRules) this.settings.alwaysAllowedRules = [];
    if (!this.settings.alwaysAllowedRules.includes(rule)) {
      this.settings.alwaysAllowedRules.push(rule);
    }
    this.notify();
  }

  clearAlwaysAllowed() {
    this.sessionAlwaysAllowed.clear();
    this.settings.alwaysAllowedRules = [];
    this.notify();
  }

  updateTask(id: string, state: BotStateName) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.state = state;
    this.notify();
  }

  appendStep(id: string, step: string, kind: LogKind = "tool", key?: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    const text = step.trim();
    if (!text) return;
    const log = (t.log ??= []);
    const now = Date.now();
    // The same tool call can arrive twice (Claude's PreToolUse, then its
    // PermissionRequest): keep one line.
    if (key && log.slice(-12).some((e) => e.key === key)) return;
    const last = log.at(-1);
    if (last && last.kind === kind && last.text === text && now - last.at < 3000) return;
    log.push({ kind, text, at: now, key });
    if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
    t.steps.push(text);
    if (t.steps.length > 20) t.steps.shift();
    t.stepIndex = t.steps.length - 1;
    this.notify();
  }

  setPillBadge(id: string, badge: PillBadge | null) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.pillBadge = badge;
    this.notify();
  }

  /** loadIntegrationTasks() — a pill for every integration whose key is saved. */
  loadIntegrationTasks() {
    for (const proto of INTEGRATION_AGENTS) {
      const shouldLoad = this.integrations[proto.id]?.configured === true;
      const idx = this.tasks.findIndex((t) => t.id === proto.id);
      if (shouldLoad && idx < 0) this.tasks.push({ ...proto, steps: [] });
      if (!shouldLoad && idx >= 0) this.tasks.splice(idx, 1);
    }
    // Keep declared order for integrations
    const order = INTEGRATION_AGENTS.map((t) => t.id);
    this.tasks.sort((a, b) => {
      const aIdx = a.isIntegration ? order.indexOf(a.id) : 999;
      const bIdx = b.isIntegration ? order.indexOf(b.id) : 999;
      return aIdx - bIdx;
    });
    if (!this.focusId) {
      const first = this.tasks.find((t) => t.isIntegration);
      if (first) this.focusId = first.id;
    }
    this.notify();
  }

  /** Opening the island always shows a request that waits for an answer first. */
  defaultView(): IslandViewName {
    return this.approvalQueue.length > 0 ? "approval" : "agents";
  }
}

export const State = new AppState();
