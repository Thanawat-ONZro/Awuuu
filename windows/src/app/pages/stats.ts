// Stats & limits: how much of each plan is left, and how much the agents did.
// Everything is read from files on this PC; nothing is polled — the numbers
// are read when the page opens and when Refresh is clicked.

import "../dashboard.css";
import type { AgentUsage, HistoryEntry, UsageLimit } from "../../core/bridge";
import { h, clear } from "../../views/dom";
import { navigate, onLeave } from "../shell";
import { pageOf, settings } from "../ui";
import { loadHistory, loadUsage, onHistoryChanged } from "../history-data";
import { agentDot, clock, plural, relTime } from "../dash-ui";
import { activity, agentMeta, dayStart, formatDuration, requestsPerDay, type Activity } from "../recap";

/** "resets in 2h 14m" within a day, else "resets Thu 09:00". */
export function resetLabel(resetsAt: number | null, now = Date.now()): string {
  if (resetsAt == null) return "";
  const left = resetsAt - now;
  if (left <= 0) return "reset time passed — waiting for new numbers";
  if (left < 60_000) return "resets in under a minute";
  if (left < 24 * 3_600_000) return `resets in ${formatDuration(Math.floor(left / 60_000) * 60_000)}`;
  const day = new Date(resetsAt).toLocaleDateString("en-GB", { weekday: "short" });
  const far = left >= 7 * 24 * 3_600_000
    ? ` ${new Date(resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "";
  return `resets ${day}${far} ${clock(resetsAt, false)}`;
}

function limitRow(l: UsageLimit, ticking: (() => void)[]): HTMLElement {
  const pct = Math.max(0, Math.min(100, Number(l.usedPercent) || 0));
  const reset = h("span", { class: "limit-reset" });
  const tick = () => { reset.textContent = resetLabel(l.resetsAt); };
  tick();
  if (l.resetsAt != null) ticking.push(tick);
  return h("div", { class: `limit${pct >= 90 ? " hot" : pct >= 70 ? " warm" : ""}` },
    h("div", { class: "limit-top" },
      h("span", { class: "limit-label", text: l.label }),
      reset,
      h("span", { class: "limit-pct", text: `${Math.round(pct)}% used` })),
    h("div", { class: "bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(pct), "aria-label": `${l.label} limit` },
      h("i", { style: `width:${pct}%` })));
}

function usageCard(u: AgentUsage, ticking: (() => void)[]): HTMLElement {
  const updated = h("span", { class: "updated" });
  const tick = () => { updated.textContent = u.updatedAt ? `updated ${relTime(u.updatedAt)}` : ""; };
  tick();
  if (u.updatedAt) ticking.push(tick);
  const card = h("section", { class: "usage-card" },
    h("h2", {}, agentDot(u.agent), h("span", { text: agentMeta(u.agent).name }),
      u.plan ? h("span", { class: "plan", text: u.plan }) : null, updated));
  for (const l of u.limits ?? []) card.append(limitRow(l, ticking));
  if (u.setup === "statusline") {
    card.append(
      h("div", { class: "hint", text: "Claude Code reports its limits through its status line. Add Awuuu's status line once and the numbers show up here — you see the exact change before anything is written." }),
      h("div", { class: "row" }, h("button", { class: "primary", text: "Set up the status line", onclick: () => void navigate("agents", "agent-statusline") })));
  } else if (u.setup) {
    card.append(h("div", { class: "hint", text: `Needs setting up first (${u.setup}).` }),
      h("div", { class: "row" }, h("button", { text: "Open Agents", onclick: () => void navigate("agents") })));
  } else if (!u.limits?.length) {
    card.append(h("div", { class: "hint", text: "No limits reported yet. They appear after the agent's next reply." }));
  }
  return card;
}

const COLS: [keyof Activity, string][] = [
  ["sessions", "Sessions"], ["requests", "Requests"], ["filesChanged", "Files changed"], ["commands", "Commands"], ["failures", "Failures"],
];

function activityCards(entries: HistoryEntry[]): HTMLElement[] {
  const now = Date.now();
  const today = activity(entries, dayStart(now));
  const weekStart = dayStart(now, 6);
  const week = activity(entries, weekStart);

  const tiles = h("div", { class: "tiles" });
  for (const [key, label] of COLS) {
    tiles.append(h("div", { class: key === "failures" && today[key] > 0 ? "tile bad" : "tile" },
      h("b", { text: String(today[key]) }), h("span", { text: label }), h("em", { text: `${week[key]} in 7 days` })));
  }

  const table = h("div", { class: "stat-table" }, h("span", { class: "th who", text: "Agent · 7 days" }));
  for (const [, label] of COLS) table.append(h("span", { class: "th", text: label }));
  const byAgent = new Map<string, HistoryEntry[]>();
  for (const e of entries) {
    if (e.at < weekStart) continue;
    const list = byAgent.get(e.agent);
    if (list) list.push(e);
    else byAgent.set(e.agent, [e]);
  }
  const rows = [...byAgent].map(([agent, list]) => ({ agent, a: activity(list, weekStart) }))
    .sort((x, y) => y.a.requests - x.a.requests || x.agent.localeCompare(y.agent));
  for (const { agent, a } of rows) {
    table.append(h("span", { class: "who" }, agentDot(agent), h("span", { text: agentMeta(agent).name })));
    for (const [key] of COLS) {
      table.append(h("span", { class: a[key] === 0 ? "zero" : key === "failures" ? "bad" : "", text: String(a[key]) }));
    }
  }

  const days = requestsPerDay(entries, 7, now);
  const max = Math.max(1, ...days.map((d) => d.requests));
  const chart = h("div", { class: "chart", role: "img", "aria-label": `Requests per day: ${days.map((d) => d.requests).join(", ")}` });
  days.forEach((d, i) => {
    const isToday = i === days.length - 1;
    chart.append(h("div", { class: `chart-col${isToday ? " today" : ""}${d.requests === 0 ? " none" : ""}`,
      title: `${new Date(d.start).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}: ${plural(d.requests, "request")}` },
      h("span", { class: "chart-val", text: String(d.requests) }),
      h("div", { class: "chart-bar", style: `height:${d.requests === 0 ? 0 : Math.max(3, (d.requests / max) * 100)}%` }),
      h("span", { class: "chart-day", text: isToday ? "Today" : new Date(d.start).toLocaleDateString("en-GB", { weekday: "short" }) })));
  });

  const keeps = Math.round(settings.historyDays || 7);
  const note = settings.historyEnabled === false
    ? "History is turned off, so nothing new is counted."
    : keeps < 7 ? `History keeps ${plural(keeps, "day")}, so older days are empty here.` : "";

  return [
    h("section", {}, h("h2", {}, h("span", { text: "Today and the last 7 days" })), tiles,
      rows.length > 0 ? table : null,
      note ? h("div", { class: "hint", text: note }) : null),
    h("section", {}, h("h2", {}, h("span", { text: "Requests per day" })), chart),
  ];
}

export function page(): HTMLElement {
  const usageBox = h("div", { class: "usage-grid" });
  const activityBox = h("div", { style: "display:flex;flex-direction:column;gap:14px" });
  const refreshBtn = h("button", { text: "Refresh", onclick: () => void load() });
  let alive = true;
  let timer = 0;
  let ticking: (() => void)[] = [];

  function schedule() {
    window.clearTimeout(timer);
    if (!alive || ticking.length === 0) return;
    timer = window.setTimeout(() => {
      ticking.forEach((f) => f());
      schedule();
    }, 30_000);
  }

  async function load() {
    refreshBtn.disabled = true;
    let usage: AgentUsage[] = [];
    let entries: HistoryEntry[] = [];
    let usageErr = "";
    try {
      usage = await loadUsage();
    } catch (err) {
      usageErr = String(err).replace(/^Error:\s*/, "");
    }
    try {
      entries = (await loadHistory(dayStart(Date.now(), 6))).entries;
    } catch {
      /* no history: the activity cards say so */
    }
    refreshBtn.disabled = false;
    if (!alive) return;

    ticking = [];
    clear(usageBox);
    usageBox.classList.toggle("usage-grid", usage.length > 0);
    if (usageErr) {
      usageBox.append(h("section", {}, h("div", { class: "notice err", text: `The limits could not be read: ${usageErr}` })));
    } else if (usage.length === 0) {
      usageBox.append(h("section", {}, h("div", { class: "empty-state" },
        h("strong", { text: "No limits to show yet." }),
        h("span", { text: "Connect Claude Code or Codex and their plan limits appear here, read from files on this PC." }),
        h("button", { text: "Connect an agent", onclick: () => void navigate("agents") }))));
    } else {
      for (const u of usage) usageBox.append(usageCard(u, ticking));
    }

    clear(activityBox);
    if (entries.length === 0) {
      activityBox.append(h("section", {}, h("h2", {}, h("span", { text: "Activity" })), h("div", { class: "empty-state" },
        h("strong", { text: settings.historyEnabled === false ? "History is turned off." : "No activity in the last 7 days." }),
        h("span", { text: settings.historyEnabled === false
          ? "Turn it on to count sessions, requests and commands."
          : "Requests, changed files and commands are counted here once an agent has worked." }),
        settings.historyEnabled === false ? h("button", { text: "Open Privacy & history", onclick: () => void navigate("privacy") }) : null)));
    } else {
      activityBox.append(...activityCards(entries));
    }
    schedule();
  }

  const stop = onHistoryChanged(() => void load(), 2000);
  onLeave(() => {
    alive = false;
    window.clearTimeout(timer);
    stop();
  });

  const root = pageOf("Stats & limits", "How much of each plan is left, and what your agents did over the last 7 days.",
    h("div", { class: "dash-toolbar" },
      h("span", { class: "label", text: "Usage limits" }), h("span", { class: "spacer" }), refreshBtn),
    usageBox, h("div", { class: "label", text: "Activity" }), activityBox);
  root.classList.add("dash");
  void load();
  return root;
}
