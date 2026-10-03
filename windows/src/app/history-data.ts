// Where the dashboard pages get their data: the Bridge inside Awuuu, or
// fixtures set on `window` when the pages are opened in a plain browser
// (headless tests): `__historyFixture`, `__usageFixture`, `__historyInfoFixture`.

import { Bridge, IS_TAURI, onEvent, type AgentUsage, type HistoryData } from "../core/bridge";

export interface HistoryInfo {
  path: string;
  bytes: number;
  entries: number;
}

interface Fixtures {
  __historyFixture?: HistoryData;
  __usageFixture?: AgentUsage[];
  __historyInfoFixture?: HistoryInfo;
  /** Tests read what an export would have written. */
  __lastExport?: { name: string; markdown: string; json: string };
}

const fx = (): Fixtures => window as unknown as Fixtures;

const EMPTY: HistoryData = { entries: [], sessions: {} };

/** Everything kept, oldest first. Never null: no backend means no history. */
export async function loadHistory(sinceMs?: number): Promise<HistoryData> {
  const fixture = fx().__historyFixture;
  if (fixture) {
    const entries = sinceMs == null ? fixture.entries : fixture.entries.filter((e) => e.at >= sinceMs);
    return { entries, sessions: fixture.sessions ?? {} };
  }
  const data = await Bridge.historyQuery(sinceMs);
  if (!data || !Array.isArray(data.entries)) return EMPTY;
  return { entries: data.entries, sessions: data.sessions ?? {} };
}

export async function loadUsage(): Promise<AgentUsage[]> {
  return fx().__usageFixture ?? (await Bridge.usageRead()) ?? [];
}

export async function loadHistoryInfo(): Promise<HistoryInfo | null> {
  return fx().__historyInfoFixture ?? (await Bridge.historyInfo());
}

export async function clearHistory(): Promise<void> {
  if (!IS_TAURI && fx().__historyFixture) {
    fx().__historyFixture = { entries: [], sessions: {} };
    if (fx().__historyInfoFixture) fx().__historyInfoFixture = { ...fx().__historyInfoFixture!, bytes: 0, entries: 0 };
    return;
  }
  await Bridge.historyClear();
}

/** Writes `<name>.md` and `<name>.json` to Downloads; returns the paths. */
export async function exportFiles(name: string, markdown: string, json: string): Promise<string[]> {
  if (!IS_TAURI && fx().__historyFixture) {
    fx().__lastExport = { name, markdown, json };
    return [`C:\\Users\\you\\Downloads\\${name}.md`, `C:\\Users\\you\\Downloads\\${name}.json`];
  }
  return Bridge.exportFiles(name, markdown, json);
}

/**
 * Calls `fn` when Rust says the history changed (burst-safe: at most once per
 * `wait` ms). Returns the function that stops listening.
 */
export function onHistoryChanged(fn: () => void, wait = 700): () => void {
  let timer = 0;
  let stopped = false;
  let unlisten: (() => void) | null = null;
  void onEvent<unknown>("history-changed", () => {
    if (stopped || timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      if (!stopped) fn();
    }, wait);
  }).then((un) => {
    if (stopped) un();
    else unlisten = un;
  }).catch(() => { /* no event in this build: the Refresh button still works */ });
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    unlisten?.();
  };
}
