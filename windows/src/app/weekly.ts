// Weekly recap: one calendar week (Monday 00:00 local to the next Monday) of
// the local history, as numbers. Pure — no DOM, no I/O, so it is testable.
//
// Honesty rule (same as recap.ts): only what the entries show. History does not
// record how many lines an edit changed or which permissions were answered, so
// `linesAdded`, `linesRemoved` and `permissions` are null ("not recorded") and
// the card prints a dash instead of an invented zero.

import type { HistoryData, HistoryEntry } from "../core/bridge";
import { entryFiles, folderOf } from "./recap";

/** Gaps between two entries longer than this are idle time, not coding time. */
export const IDLE_GAP_MS = 10 * 60 * 1000;

export interface WeeklyRecap {
  /** Monday 00:00 local, and the next Monday 00:00 local (exclusive). */
  start: number;
  end: number;
  /** False when nothing was recorded in the week. */
  any: boolean;
  codingMs: number;
  sessions: number;
  requests: number;
  filesChanged: number;
  linesAdded: number | null;
  linesRemoved: number | null;
  commands: number;
  permissions: number | null;
  topAgent: { agent: string; requests: number } | null;
  topProject: { cwd: string; name: string; sessions: number } | null;
  /** Day (local midnight) with the most requests; ties go to the earlier day. */
  busiestDay: { start: number; requests: number } | null;
  longestSession: { id: string; name: string; ms: number } | null;
  /** Requests per day, Monday first. */
  days: { start: number; requests: number }[];
}

/** Monday 00:00 local of the week containing `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Local midnight `n` days after `start` (DST safe). */
function addDays(start: number, n: number): number {
  const d = new Date(start);
  d.setDate(d.getDate() + n);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function top<T>(counts: Map<string, number>, make: (key: string, n: number) => T): T | null {
  let best: [string, number] | null = null;
  for (const [k, n] of counts) {
    if (!best || n > best[1] || (n === best[1] && k < best[0])) best = [k, n];
  }
  return best ? make(best[0], best[1]) : null;
}

/** `weeksAgo` 0 = the week containing `now`. */
export function weeklyRecap(data: HistoryData | null | undefined, now = Date.now(), weeksAgo = 0): WeeklyRecap {
  const thisMonday = weekStart(now);
  const start = addDays(thisMonday, -7 * weeksAgo);
  const end = addDays(start, 7);
  const days = Array.from({ length: 7 }, (_, i) => ({ start: addDays(start, i), requests: 0 }));
  const r: WeeklyRecap = {
    start, end, any: false, codingMs: 0, sessions: 0, requests: 0, filesChanged: 0,
    linesAdded: null, linesRemoved: null, commands: 0, permissions: null,
    topAgent: null, topProject: null, busiestDay: null, longestSession: null, days,
  };
  const entries = (data?.entries ?? []).filter((e: HistoryEntry) => e.at >= start && e.at < end);
  if (entries.length === 0) return r;
  r.any = true;

  const sorted = [...entries].sort((a, b) => a.at - b.at);
  const files = new Set<string>();
  const agentReq = new Map<string, number>();
  const bySession = new Map<string, { agent: string; first: number; last: number }>();
  const spans: [number, number][] = [];

  for (const e of sorted) {
    const stop = Math.min(end, e.at + (e.ms && e.ms > 0 ? e.ms : 0));
    spans.push([e.at, stop]);
    const s = bySession.get(e.session);
    if (s) { s.last = Math.max(s.last, stop); s.agent = e.agent; }
    else bySession.set(e.session, { agent: e.agent, first: e.at, last: stop });
    if (e.kind === "prompt") {
      r.requests++;
      agentReq.set(e.agent, (agentReq.get(e.agent) ?? 0) + 1);
      for (let i = days.length - 1; i >= 0; i--) {
        if (e.at >= days[i].start) { days[i].requests++; break; }
      }
    }
    if (e.kind === "run") r.commands++;
    if (e.status !== "failed") {
      for (const f of entryFiles(e)) {
        if (f.change !== "read") files.add(f.path.replace(/\\/g, "/").toLowerCase());
      }
    }
  }
  r.filesChanged = files.size;
  r.sessions = bySession.size;

  // Coding time: spans merged; a gap up to IDLE_GAP_MS still counts as working.
  let curStart = spans[0][0];
  let curEnd = spans[0][1];
  for (let i = 1; i < spans.length; i++) {
    const [a, b] = spans[i];
    if (a - curEnd <= IDLE_GAP_MS) curEnd = Math.max(curEnd, b);
    else {
      r.codingMs += curEnd - curStart;
      curStart = a;
      curEnd = b;
    }
  }
  r.codingMs += curEnd - curStart;

  r.topAgent = top(agentReq, (agent, requests) => ({ agent, requests }));

  const cwdOf = (id: string) => data?.sessions?.[id]?.cwd ?? "";
  const projects = new Map<string, number>();
  for (const id of bySession.keys()) {
    const cwd = cwdOf(id);
    if (cwd) projects.set(cwd, (projects.get(cwd) ?? 0) + 1);
  }
  r.topProject = top(projects, (cwd, n) => ({ cwd, name: folderOf(cwd, 1) || cwd, sessions: n }));

  let busiest: { start: number; requests: number } | null = null;
  for (const d of days) if (d.requests > 0 && (!busiest || d.requests > busiest.requests)) busiest = { ...d };
  r.busiestDay = busiest;

  let longest: WeeklyRecap["longestSession"] = null;
  for (const [id, s] of bySession) {
    const ms = s.last - s.first;
    if (!longest || ms > longest.ms) {
      longest = { id, name: data?.sessions?.[id]?.name || folderOf(cwdOf(id), 1) || s.agent, ms };
    }
  }
  r.longestSession = longest;
  return r;
}
