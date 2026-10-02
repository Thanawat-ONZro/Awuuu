// App state — mirror of AppState.swift (the parts the island needs).

import type { BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../mochi/engine";

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

export interface Settings {
  soundEnabled: boolean;
  soundVolume: number;
  autoCloseInterval: number;
  activeIntegrations: string[];
  screen: "primary" | "cursor";
  /** Top edge of the screen, or bottom (just above the taskbar). */
  position: "top" | "bottom";
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
  autostart: false,
  hooksInstalled: false,
  model: "hermes-agent",
  hideAfter: 5,
  updateCheck: null,
  alwaysAllowedRules: [],
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

  integrations: Record<string, IntegrationInfo> = {};

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
      const name = dirName || agentInfo(source).short;
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

  appendStep(id: string, step: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.steps.push(step);
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

  /** loadIntegrationTasks() — load enabled integration pollers. */
  loadIntegrationTasks() {
    for (const proto of INTEGRATION_AGENTS) {
      const shouldLoad = this.settings.activeIntegrations.includes(proto.id);
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

  defaultView(): IslandViewName {
    return "agents";
  }
}

export const State = new AppState();
