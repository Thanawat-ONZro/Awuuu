// "Today": what needs you next, from every connected integration, in one list
// you can act on — the next meeting (Join), unread mail, pull requests waiting
// for your review, tasks due, sites down, failed payments and CI runs, news.
// Plus the cards for the integrations that need no OAuth (extras.rs).

import { h, svg, dot } from "./dom";
import { ICONS } from "./icons";
import { State } from "../core/state";
import { Bridge } from "../core/bridge";
import { timeAgo } from "./integrations";

type Row = {
  /** Lower comes first. */
  rank: number;
  color: string;
  icon: string;
  title: string;
  sub?: string;
  url?: string | null;
  action?: { label: string; url: string };
  bad?: boolean;
};

function data(id: string): Record<string, unknown> {
  return (State.integrations[id]?.data ?? {}) as Record<string, unknown>;
}

function list(id: string, key: string): Record<string, unknown>[] {
  const v = data(id)[key];
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function gmailLink(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#search/rfc822msgid:${encodeURIComponent(messageId)}`;
}

/** Everything worth a glance, most urgent first. */
export function todayRows(): Row[] {
  const rows: Row[] = [];
  const now = Date.now();

  // Calendar: what's on now and next.
  for (const e of list("integration_calendar", "events")) {
    const start = Number(e.start);
    const end = Number(e.end);
    if (end < now) continue;
    const soon = start - now;
    const allDay = e.allDay === true;
    const when = allDay ? "All day" : start <= now ? `Now · until ${clock(end)}` : soon < 3600_000 ? `In ${Math.max(1, Math.round(soon / 60_000))} min` : clock(start);
    rows.push({
      rank: allDay ? 40 : start <= now ? 1 : soon < 3600_000 ? 2 : 20 + start / 1e13,
      color: "#4285F4",
      icon: "📅",
      title: str(e.title),
      sub: [when, str(e.location)].filter(Boolean).join(" · "),
      action: e.join ? { label: "Join", url: str(e.join) } : undefined,
    });
    if (rows.filter((r) => r.icon === "📅").length >= 3) break;
  }

  // Mail: unread, newest first.
  const mail = data("integration_mail");
  for (const m of list("integration_mail", "messages").slice(0, 3)) {
    rows.push({
      rank: 10,
      color: "#EA4335",
      icon: "✉️",
      title: str(m.subject) || "(no subject)",
      sub: str(m.from),
      url: m.url ? str(m.url) : mail.gmail === true && m.messageId ? gmailLink(str(m.messageId)) : null,
    });
  }

  // GitHub: reviews waiting for you, failing CI.
  for (const pr of list("integration_github", "reviewRequests").slice(0, 3)) {
    rows.push({ rank: 5, color: "#F0645A", icon: "👀", title: str(pr.title), sub: `Review requested · ${str(pr.repo)}`, url: str(pr.url) });
  }
  for (const f of list("integration_github", "failingRuns").slice(0, 2)) {
    rows.push({ rank: 4, color: "#F4505E", icon: "✗", title: `${str(f.workflow)} failed`, sub: str(f.repo), url: str(f.url), bad: true });
  }

  // Todoist: due today / overdue.
  for (const t of list("integration_todoist", "tasks").slice(0, 4)) {
    rows.push({ rank: 12, color: "#E44332", icon: "☐", title: str(t.content), sub: t.due ? `Due ${str(t.due)}` : "Today", url: str(t.url) });
  }

  // Uptime: only what's down.
  for (const s of list("integration_uptime", "sites")) {
    if (s.up !== true) rows.push({ rank: 0, color: "#F4505E", icon: "⚠", title: `${str(s.url)} is down`, sub: str(s.status), url: str(s.url), bad: true });
  }

  // Stripe failed payments, Vercel failed deploys.
  for (const p of list("integration_stripe", "payments")) {
    if (p.status === "failed") {
      rows.push({ rank: 3, color: "#F4505E", icon: "$", title: `Payment failed · ${str(p.description) || "payment"}`, url: `https://dashboard.stripe.com/payments/${str(p.id)}`, bad: true });
    }
  }
  const deploy = list("integration_vercel", "deployments")[0];
  if (deploy && deploy.state === "ERROR") {
    rows.push({ rank: 3, color: "#F4505E", icon: "▲", title: `${str(deploy.projectName)} deploy failed`, url: `https://${str(deploy.url)}`, bad: true });
  }

  // News, last.
  for (const it of list("integration_feeds", "items").slice(0, 3)) {
    rows.push({ rank: 60, color: "#F59E0B", icon: "📰", title: str(it.title), sub: [str(it.feed), it.time ? timeAgo(Number(it.time)) : ""].filter(Boolean).join(" · "), url: str(it.link) });
  }

  return rows.sort((a, b) => a.rank - b.rank);
}

function rowEl(r: Row): HTMLElement {
  const main = h("div", { class: "today-main" },
    h("span", { class: "today-title", text: r.title }),
    r.sub ? h("span", { class: "today-sub", text: r.sub }) : null,
  );
  const el = h("div", { class: `today-row${r.bad ? " bad" : ""}${r.url ? " link" : ""}` },
    h("span", { class: "today-icon", style: `color:${r.color}`, text: r.icon }),
    main,
  );
  if (r.action) {
    const btn = h("button", { class: "today-action", text: r.action.label });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      void Bridge.openUrl(r.action!.url);
    });
    el.append(btn);
  }
  if (r.url) {
    el.title = r.url;
    el.addEventListener("click", () => void Bridge.openUrl(r.url!));
  }
  return el;
}

/** The weather, as a chip in the Today header. */
export function weatherChip(): HTMLElement | null {
  const w = data("integration_weather");
  if (w.temp == null) return null;
  return h("span", { class: "today-weather", title: `${str(w.place)} · ${str(w.text)} · ${str(w.min)}–${str(w.max)}°` },
    `${str(w.icon)} ${Math.round(Number(w.temp))}°  ·  rain ${str(w.rain)}%`);
}

export function renderToday(openSettings: () => void): HTMLElement {
  const rows = todayRows();
  const box = h("div", { class: "today" });
  if (rows.length === 0) {
    const anything = Object.values(State.integrations).some((i) => i.configured);
    box.append(
      h("div", { class: "today-empty" },
        h("div", { class: "title", text: anything ? "All clear for now." : "Nothing connected yet." }),
        h("div", {
          class: "sub",
          text: anything
            ? "Meetings, mail, reviews, tasks and alerts show up here as they come."
            : "Connect your mail, calendar, GitHub, Todoist, sites to watch or news in Settings — Awuuu brings what needs you here.",
        }),
        anything ? null : h("button", { class: "link-btn", text: "Open Settings…", onclick: openSettings }),
      ),
    );
    return box;
  }
  for (const r of rows.slice(0, 12)) box.append(rowEl(r));
  return box;
}

// ── Cards for a single extra integration (tap its pill) ─────────────────────

function head(color: string, name: string, kind: string, id: string): HTMLElement {
  const refresh = h("button", { class: "int-refresh", title: "Refresh" }, svg(ICONS.refresh, 9, { stroke: 2.2 }));
  refresh.addEventListener("click", (e) => {
    e.stopPropagation();
    void Bridge.refreshIntegration(id);
  });
  return h("div", { class: "int-head" }, dot(color, 7), h("b", { text: name }), h("span", { text: kind }), refresh);
}

function card(color: string, name: string, kind: string, id: string, rows: Row[], empty: string): HTMLElement {
  const body = h("div", { class: "today" });
  if (rows.length === 0) body.append(h("div", { class: "today-sub", text: empty }));
  for (const r of rows) body.append(rowEl(r));
  return h("div", { class: "int-card" }, head(color, name, kind, id), body);
}

export const EXTRA_IDS = new Set([
  "integration_mail", "integration_calendar", "integration_feeds",
  "integration_uptime", "integration_weather", "integration_todoist",
]);

export function hasExtraData(id: string): boolean {
  const info = State.integrations[id];
  return !!info && !info.error && info.loaded;
}

export function renderExtraCard(id: string): HTMLElement {
  const all = todayRows();
  switch (id) {
    case "integration_mail": {
      const d = data(id);
      const rows = list(id, "messages").map((m) => ({
        rank: 0, color: "#EA4335", icon: "✉️", title: str(m.subject) || "(no subject)", sub: str(m.from),
        url: m.url ? str(m.url) : d.gmail === true && m.messageId ? gmailLink(str(m.messageId)) : null,
      }));
      return card("#EA4335", "Mail", `${str(d.unread)} unread`, id, rows, "Inbox zero.");
    }
    case "integration_calendar":
      return card("#4285F4", "Calendar", "Today", id, all.filter((r) => r.icon === "📅"), "Nothing on the calendar.");
    case "integration_feeds":
      return card("#F59E0B", "News", "Latest", id,
        list(id, "items").slice(0, 8).map((it) => ({ rank: 0, color: "#F59E0B", icon: "📰", title: str(it.title), sub: str(it.feed), url: str(it.link) })),
        "No items yet.");
    case "integration_uptime":
      return card("#22C55E", "Uptime", "Sites", id,
        list(id, "sites").map((s) => ({
          rank: 0, color: s.up === true ? "#22C55E" : "#F4505E", icon: s.up === true ? "●" : "⚠",
          title: str(s.url), sub: s.up === true ? `${str(s.status)} · ${str(s.ms)} ms` : `down · ${str(s.status)}`, url: str(s.url), bad: s.up !== true,
        })),
        "No sites yet.");
    case "integration_todoist":
      return card("#E44332", "Todoist", "Today", id, all.filter((r) => r.icon === "☐"), "Nothing due today.");
    case "integration_weather": {
      const w = data(id);
      return h("div", { class: "int-card" }, head("#38BDF8", "Weather", str(w.place), id),
        h("div", { class: "today-weather-big" },
          h("span", { class: "big", text: `${str(w.icon)} ${Math.round(Number(w.temp ?? 0))}°` }),
          h("span", { class: "today-sub", text: `${str(w.text)} · ${str(w.min)}–${str(w.max)}° · rain ${str(w.rain)}%` }),
        ));
    }
    default:
      return h("div");
  }
}
