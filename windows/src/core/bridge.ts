// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { Settings } from "./state";
import type { IslandLayout } from "./layout";

/** Agents whose hooks Awuuu installs (Rust hooks::HookAgent). */
export type HookAgentId = "claude" | "agy" | "hermes" | "opencode" | "codex";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[awuuu] ${cmd} failed`, err);
    return null;
  }
}

export interface BootInfo {
  settings: Settings;
  /** Logical screen rect of the monitor the island lives on. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
  hookPath: string;
  layout: IslandLayout | null;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),

  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  setCollapsed: (collapsed: boolean) => call<void>("set_collapsed", { collapsed }),

  /**
   * Pushes the island shape in window coordinates. Rust flips click-through from
   * its own cursor poll, so the flag is never a frame behind a click.
   */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),

  /** Give the window keyboard focus (chat field) and take it away again. */
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),

  reposition: () => call<void>("reposition"),
  /** Moving: the window becomes a work-area overlay; its logical [w, h]. */
  islandOverlayBegin: () => call<[number, number]>("island_overlay_begin"),
  /** Dock on `edge` at `along` ("" = put it back) and end the overlay. */
  islandOverlayEnd: (edge: string, along: number) => call<void>("island_overlay_end", { edge, along }),
  resetPosition: () => call<void>("reset_position"),
  islandResizeMode: (on: boolean) => call<void>("island_resize_mode", { on }),

  openUrl: (url: string) => call<void>("open_url", { url }),

  /** "Open terminal" → opens the folder in VS Code when `code` is on PATH. */
  openInVSCode: (path: string | null) => call<boolean>("open_in_vscode", { path }),

  quit: () => call<void>("quit_app"),

  /** Opens the Awuuu window, optionally at a page ("sessions", "chat", "agents"…). */
  openSettingsWindow: (page?: string) => call<void>("open_settings_window", { page: page ?? null }),

  /** Writes to %LOCALAPPDATA%\Awuuu\awuuu.log, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),

  // ── Agent hooks (Claude, AGY) ───────────────────────────────────────
  agentHooksStatus: (agent: HookAgentId) =>
    call<HookStatus>("agent_hooks_status", { agent }),
  /** Diff to show before anything is written. `install: false` previews removal. */
  agentHooksPreview: (agent: HookAgentId, install: boolean) =>
    callOrThrow<HookPreview>("agent_hooks_preview", { agent, install }),
  /**
   * Writes the agent's config — only ever after an explicit click, and only when
   * the file still matches the preview the user looked at.
   */
  agentHooksApply: (agent: HookAgentId, install: boolean, fingerprint: string) =>
    callOrThrow<string>("agent_hooks_apply", { agent, install, fingerprint }),

  /** `answers` are keyed by question text; `reason` goes back with a deny. */
  approvalDecision: (
    requestId: string,
    decision: "allow" | "deny" | "always",
    answers?: Record<string, string>,
    reason?: string,
  ) => call<void>("approval_decision", { requestId, decision, answers: answers ?? null, reason: reason ?? null }),
  /** Type into a running agent session from the island (AGY for now). */
  /** "queued" = handed over at the session's next step; "started" = resumed now. */
  /** Bring a session's terminal window forward; false = not found. */
  focusTerminal: (hwnd: number | null, pids: number[]) => call<boolean>("focus_terminal", { hwnd, pids }),
  /** Welcome page: agents on this machine and their hook status. */
  detectAgents: () =>
    call<{ id: HookAgentId; name: string; present: boolean; hooksInstalled: boolean }[]>("detect_agents"),
  awPathStatus: () => call<boolean>("aw_path_status"),
  awPathSet: (on: boolean) => callOrThrow<boolean>("aw_path_set", { on }),
  /** Integrations that are set up (their pills show). */
  integrationsConfigured: () => call<string[]>("integrations_configured"),
  /** Settings → Test on an integration: "Connected." or the reason it failed. */
  integrationTest: (id: string) => callOrThrow<string>("integration_test", { id }),
  /** Settings → Test: a provider's model list. */
  providerModels: (baseUrl: string, id: string) => callOrThrow<string[]>("provider_models", { baseUrl, id }),
  /** Settings → Detect local: Ollama / LM Studio, on click only. */
  detectLocalProviders: () =>
    call<{ name: string; baseUrl: string; models: string[] }[]>("detect_local_providers"),
  /** New things the agent said/thought, from its transcript (only new lines). */
  transcriptTail: (agent: string, path: string) =>
    call<{ kind: "prompt" | "say" | "think"; text: string }[]>("transcript_tail", { agent, path }),
  /** "The card is up" — until this lands the relay only waits a moment. */
  approvalAck: (requestId: string) => call<void>("approval_ack", { requestId }),
  /** "Nobody can act on this" — Claude Code asks in the terminal right away. */
  approvalDecline: (requestId: string) => call<void>("approval_decline", { requestId }),

  // ── Chat, files, secrets ──────────────────────────────────────────────────
  /** One chat turn. The API key and any file bytes never leave Rust. */
  chatSend: (query: string, context: ChatContext | null) =>
    callOrThrow<{ text: string; used?: string | null }>("chat_send", { query, context }),
  /** The chat's model picker: Hermes' signed-in providers and their models. */
  hermesModelOptions: () =>
    callOrThrow<{
      model: string;
      provider: string;
      providers: { slug: string; name: string; models: string[]; reasoning: string[] }[];
    }>("hermes_model_options"),
  chatReset: () => call<void>("chat_reset"),
  /** Settings → "Test connection": model ids offered by the Hermes gateway. */
  hermesStatus: () => callOrThrow<string[]>("hermes_status"),
  /** Check GitHub for a newer Awuuu now; Rust shows the result natively. */
  updateCheckNow: () => call<void>("update_check_now"),
  /** Copies a dropped file into the inbox. */
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),
  /** A dropped File (no path in the page): its bytes go straight to the inbox. */
  ingestBytes: async (file: File) =>
    callOrThrowRaw<DroppedFile>("ingest_bytes", new Uint8Array(await file.arrayBuffer()), {
      "x-file-name": encodeURIComponent(file.name),
    }),
  /** Only ever tells you whether a key exists — never its value. */
  secretPresent: (key: string) => call<boolean>("secret_present", { key }),
  secretSet: (key: string, value: string) => callOrThrow<void>("secret_set", { key, value }),
  secretClear: (key: string) => callOrThrow<void>("secret_clear", { key }),

  // ── Integrations ──────────────────────────────────────────────────────────
  refreshIntegration: (id: string) => call<void>("refresh_integration", { id }),
  /** Opens the configured n8n instance in the browser. */
  openN8n: () => call<void>("open_n8n"),

  // ── Usage limits, history (usage.rs, history.rs) ──────────────────────────
  /** Plan limits of the connected agents, read from files on this PC. */
  usageRead: () => call<AgentUsage[]>("usage_read"),
  /** Claude Code's status line feeds the Claude limits (same flow as hooks). */
  statuslineStatus: () => call<HookStatus>("statusline_status"),
  statuslinePreview: (install: boolean) => callOrThrow<HookPreview>("statusline_preview", { install }),
  statuslineApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("statusline_apply", { install, fingerprint }),
  /** Upserts activity entries by id (the island reports what the agents do). */
  historyAppend: (entries: HistoryEntry[], sessions: Record<string, HistorySession>) =>
    call<void>("history_append", { entries, sessions }),
  /** Everything kept, oldest first (`sinceMs` = only entries at or after it). */
  historyQuery: (sinceMs?: number) => call<HistoryData>("history_query", { sinceMs: sinceMs ?? null }),
  /** Forgets everything and deletes history.json. */
  historyClear: () => callOrThrow<void>("history_clear"),
  /** Where history.json lives and how big it is. */
  historyInfo: () => call<{ path: string; bytes: number; entries: number }>("history_info"),
  /** Saves `<name>.md` and `<name>.json` to Downloads; returns the paths. */
  exportFiles: (name: string, markdown: string, json: string) =>
    callOrThrow<string[]>("export_files", { name, markdown, json }),
  /** Shows a file in Explorer. */
  revealFile: (path: string) => call<void>("reveal_file", { path }),

  /** Tray → Pause. Stops the integration pollers, not just the island. */
  setPaused: (paused: boolean) => call<void>("set_paused", { paused }),
};

export interface UsageLimit {
  /** "5-hour", "Week", "Month"… */
  label: string;
  /** 0–100. */
  usedPercent: number;
  /** Epoch ms; null when unknown or already reset. */
  resetsAt: number | null;
}

export interface AgentUsage {
  /** "claude" | "codex". */
  agent: string;
  /** Plan name when the agent reports one ("free", "pro"…). */
  plan: string | null;
  limits: UsageLimit[];
  /** When the numbers were written (epoch ms). */
  updatedAt: number | null;
  /** Set when something must be installed first: "statusline". */
  setup: string | null;
}

export type HistoryKind =
  | "prompt" | "say" | "read" | "edit" | "write" | "run" | "search" | "web"
  | "agent" | "mcp" | "skill" | "plan" | "tool" | "done" | "error";

export type HistoryStatus = "running" | "waiting" | "ok" | "failed" | "stopped" | "info";

/** One thing an agent did. Start and result share an id and are merged. */
export interface HistoryEntry {
  /** `<session>:<tool use id>` or `<session>:<n>`. */
  id: string;
  session: string;
  /** "claude" | "agy" | "hermes" | "opencode" | "codex". */
  agent: string;
  /** Epoch ms. */
  at: number;
  kind: HistoryKind;
  /** Tool name as the agent calls it ("Bash", "Edit"…), "" for prompt/say/done. */
  tool: string;
  /** One line: the prompt, the command, the file, what was said. */
  title: string;
  /** Longer text: command output (clipped), the agent's summary… */
  detail?: string;
  files?: { path: string; change: "read" | "edit" | "write" | "delete" }[];
  status: HistoryStatus;
  /** How long it took. */
  ms?: number;
}

export interface HistorySession {
  cwd?: string;
  /** The name shown in the hub. */
  name?: string;
}

export interface HistoryData {
  entries: HistoryEntry[];
  sessions: Record<string, HistorySession>;
}

export interface IntegrationUpdate {
  id: string;
  data: Record<string, unknown>;
  error: string | null;
  event: { success: boolean; label: string; detail: string | null } | null;
}

export type ChatContext =
  | { kind: "file"; name: string; path: string }
  | { kind: "window"; appName: string; title: string; url?: string };

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
}

export interface HookStatus {
  installed: boolean;
  settingsPath: string;
  hookPath: string;
  hookReady: boolean;
}

export interface HookPreview {
  diff: string;
  backup: string;
  settingsPath: string;
  /** Hand back to agentHooksApply so only the reviewed diff is ever written. */
  fingerprint: string;
}

/** Same as `call`, but surfaces the error so the UI can show what went wrong. */
async function callOrThrowRaw<T>(cmd: string, body: Uint8Array, headers: Record<string, string>): Promise<T> {
  if (!IS_TAURI) throw new Error("not running inside Awuuu");
  return invoke<T>(cmd, body, { headers });
}

async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("not running inside Awuuu");
  return invoke<T>(cmd, args);
}

export type BridgeEvent =
  | { name: "cursor"; payload: { x: number; y: number } }
  | { name: "tray"; payload: string }
  | { name: "hook"; payload: Record<string, unknown> }
  | { name: "screen-changed"; payload: null }
  | { name: "click-outside"; payload: null }
  | { name: "notch-hover"; payload: null }
  | { name: "notch-click"; payload: null };

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

/** Files dragged onto the island. Only reaches us when the window takes the mouse. */
export async function onDragDrop(handler: (e: DragDropPayload) => void) {
  if (!IS_TAURI) return () => {};
  return getCurrentWebview().onDragDropEvent((event) => {
    handler(event.payload as DragDropPayload);
  });
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}
