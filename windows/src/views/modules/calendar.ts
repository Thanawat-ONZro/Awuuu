// Calendar module for Awuuu's notch dashboard.
// Fetches upcoming events from iCal feed (or Rust calendar_upcoming bridge).
// Shows next 3 events with relative countdown (macnotch.io feel).
// Idle = 0 % CPU: refreshes every 15 min only while visible; updates relative time on minute tick.

import { clear, h, svg } from "../dom";
import { ICONS } from "../icons";
import { Bridge } from "../../core/bridge";
import { t } from "../../i18n/i18n";
import type { ModuleCtx, ModuleHost } from "../../core/modules";

export interface CalEvent {
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location?: string;
}

export interface ParseIcsWindow {
  fromMs?: number;
  toMs?: number;
}

function parseIcsDate(value: string): { ms: number; allDay: boolean } | null {
  const v = value.trim();
  const num = (a: number, len: number) => {
    const s = v.slice(a, a + len);
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  };

  const y = num(0, 4);
  const m = num(4, 2);
  const d = num(6, 2);
  if (y === null || m === null || d === null) return null;

  // VALUE=DATE format (YYYYMMDD)
  if (v.length === 8) {
    return {
      ms: Date.UTC(y, m - 1, d, 0, 0, 0),
      allDay: true,
    };
  }

  // YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
  const hour = num(9, 2) ?? 0;
  const min = num(11, 2) ?? 0;
  const sec = num(13, 2) ?? 0;

  return {
    ms: Date.UTC(y, m - 1, d, hour, min, sec),
    allDay: false,
  };
}

/** Pure ICS parser handling unfolding, VALUE=DATE, RRULE (DAILY/WEEKLY), and cancellation. */
export function parseIcs(text: string, win?: ParseIcsWindow): CalEvent[] {
  const now = Date.now();
  const fromMs = win?.fromMs ?? now;
  const toMs = win?.toMs ?? now + 7 * 86400 * 1000;

  // Unfold lines: RFC 5545 specifies lines ending in CRLF followed by space or tab
  const unfolded = text
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "");

  const out: CalEvent[] = [];
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1);

  for (const block of blocks) {
    const eventBody = block.split("END:VEVENT")[0] ?? "";
    const lines = eventBody.split(/\r?\n/);
    const props: Array<{ name: string; params: string; val: string }> = [];

    for (const rawLine of lines) {
      const colonIdx = rawLine.indexOf(":");
      if (colonIdx === -1) continue;
      const head = rawLine.slice(0, colonIdx);
      const val = rawLine.slice(colonIdx + 1);
      const semiIdx = head.indexOf(";");
      const name = (semiIdx === -1 ? head : head.slice(0, semiIdx)).trim().toUpperCase();
      const params = semiIdx === -1 ? "" : head.slice(semiIdx + 1);
      props.push({ name, params, val });
    }

    const get = (n: string) => props.find((p) => p.name === n)?.val;
    const getParam = (n: string) => props.find((p) => p.name === n)?.params ?? "";

    const status = get("STATUS");
    if (status && status.toUpperCase() === "CANCELLED") {
      continue;
    }

    const dtStartVal = get("DTSTART");
    if (!dtStartVal) continue;

    const parsedStart = parseIcsDate(dtStartVal);
    if (!parsedStart) continue;

    const isAllDay = parsedStart.allDay || getParam("DTSTART").includes("VALUE=DATE");
    const startMs = parsedStart.ms;

    let endMs = startMs + (isAllDay ? 86400 * 1000 : 3600 * 1000);
    const dtEndVal = get("DTEND");
    if (dtEndVal) {
      const parsedEnd = parseIcsDate(dtEndVal);
      if (parsedEnd) {
        endMs = parsedEnd.ms;
      }
    }

    const unescape = (s: string) =>
      s
        .replace(/\\n/gi, " ")
        .replace(/\\,/g, ",")
        .replace(/\\;/g, ";")
        .replace(/\\\\/g, "\\");

    const title = unescape(get("SUMMARY") || t("Event"));
    const rawLoc = get("LOCATION");
    const location = rawLoc ? unescape(rawLoc) : undefined;
    const dur = endMs - startMs;

    const rrule = get("RRULE");
    if (!rrule) {
      if (startMs < toMs && endMs > fromMs) {
        out.push({
          title,
          startMs,
          endMs,
          allDay: isAllDay,
          ...(location ? { location } : {}),
        });
      }
      continue;
    }

    // RRULE expansion (DAILY and WEEKLY within the window)
    const ruleParts = rrule.split(";").reduce<Record<string, string>>((acc, part) => {
      const [k, v] = part.split("=");
      if (k && v) acc[k.toUpperCase()] = v;
      return acc;
    }, {});

    const freq = ruleParts["FREQ"];
    if (freq !== "DAILY" && freq !== "WEEKLY") {
      continue;
    }

    const interval = Math.max(1, parseInt(ruleParts["INTERVAL"] || "1", 10) || 1);
    const count = ruleParts["COUNT"] ? parseInt(ruleParts["COUNT"], 10) : undefined;
    const untilParsed = ruleParts["UNTIL"] ? parseIcsDate(ruleParts["UNTIL"]) : null;
    const untilMs = untilParsed ? untilParsed.ms : undefined;

    const stepMs = freq === "DAILY" ? interval * 86400 * 1000 : interval * 7 * 86400 * 1000;

    let n = 0;
    let curStart = startMs;

    while (curStart < toMs && (count === undefined || n < count) && n < 2000) {
      if (untilMs !== undefined && curStart > untilMs) {
        break;
      }

      const curEnd = curStart + dur;
      if (curStart < toMs && curEnd > fromMs) {
        out.push({
          title,
          startMs: curStart,
          endMs: curEnd,
          allDay: isAllDay,
          ...(location ? { location } : {}),
        });
      }

      n++;
      curStart += stepMs;
    }
  }

  out.sort((a, b) => a.startMs - b.startMs);
  return out;
}

/** Formats relative countdown string for event start. */
export function formatCountdown(startMs: number, endMs: number, allDay: boolean, nowMs = Date.now()): string {
  if (allDay) {
    const today = new Date(nowMs);
    today.setHours(0, 0, 0, 0);
    const eventDay = new Date(startMs);
    eventDay.setHours(0, 0, 0, 0);
    const diffDays = Math.round((eventDay.getTime() - today.getTime()) / (86400 * 1000));
    if (diffDays === 0) return t("Today");
    if (diffDays === 1) return t("Tomorrow");
    return diffDays > 0 ? t("in {d} days", { d: diffDays }) : t("Today");
  }

  if (nowMs >= startMs && nowMs < endMs) {
    return t("Now");
  }

  const diffMs = startMs - nowMs;
  if (diffMs <= 0) {
    return t("Ended");
  }

  const diffMin = Math.round(diffMs / 60000);
  if (diffMin <= 1) {
    return t("in 1 min");
  }
  if (diffMin < 60) {
    return t("in {m} min", { m: diffMin });
  }

  const hours = Math.floor(diffMin / 60);
  if (hours < 24) {
    const remMin = diffMin % 60;
    if (remMin === 0) {
      return t("in {h}h", { h: hours });
    }
    return t("in {h}h {m}m", { h: hours, m: remMin });
  }

  const days = Math.floor(hours / 24);
  if (days === 1) {
    return t("Tomorrow");
  }
  return t("in {d} days", { d: days });
}

function formatEventTime(startMs: number, allDay: boolean): string {
  if (allDay) return t("All day");
  const d = new Date(startMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function createCalendarModuleHost(ctx: ModuleCtx): ModuleHost {
  const el = h("div", { class: "widget widget-calendar", style: "user-select:none;" });

  let events: CalEvent[] = [];
  let lastFetchMs = 0;
  let isFetching = false;
  let lastMinute = -1;

  const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

  function render() {
    clear(el);

    const now = Date.now();
    // Filter out events that ended more than 15 minutes ago
    const upcoming = events.filter((e) => e.endMs > now - 15 * 60 * 1000).slice(0, 3);

    // Header row
    const head = h(
      "div",
      {
        class: "cal-head",
        style: "display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;",
      },
      h(
        "div",
        { style: "display:flex; align-items:center; gap:6px;" },
        svg(ICONS.timer, 14),
        h("span", { text: t("Calendar"), style: "font-weight:600; font-size:12px; letter-spacing:0.02em;" }),
      ),
      h(
        "button",
        {
          class: "cal-refresh-btn",
          title: t("Refresh"),
          style: "background:none; border:none; color:inherit; cursor:pointer; opacity:0.6; padding:2px;",
          onclick: (e: Event) => {
            e.stopPropagation();
            void forceRefresh();
          },
        },
        svg(ICONS.refresh, 12),
      ),
    );
    el.append(head);

    if (upcoming.length === 0) {
      const emptyRow = h(
        "div",
        {
          class: "cal-empty",
          style: "padding:8px 0; opacity:0.6; font-size:12px; text-align:center; cursor:pointer;",
          onclick: () => {
            ctx.actions.openSettingsWindow("integrations");
          },
        },
        h("span", { text: t("No upcoming events") }),
      );
      el.append(emptyRow);
      return;
    }

    const list = h("div", { class: "cal-list", style: "display:flex; flex-direction:column; gap:6px;" });

    for (const ev of upcoming) {
      const countdown = formatCountdown(ev.startMs, ev.endMs, ev.allDay, now);
      const isNow = countdown === t("Now");
      const timeStr = formatEventTime(ev.startMs, ev.allDay);

      const row = h(
        "div",
        {
          class: `cal-item${isNow ? " is-now" : ""}`,
          style: `display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12px; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.06);`,
        },
        h(
          "div",
          { style: "display:flex; flex-direction:column; min-width:0; flex:1;" },
          h("span", {
            text: ev.title,
            style: `font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; ${isNow ? "color:var(--accent,#38bdf8);" : ""}`,
          }),
          ev.location
            ? h("span", {
                text: ev.location,
                style: "font-size:10px; opacity:0.6; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;",
              })
            : null,
        ),
        h(
          "div",
          { style: "display:flex; flex-direction:column; align-items:flex-end; flex-shrink:0;" },
          h("span", {
            text: countdown,
            style: `font-weight:600; font-size:11px; ${isNow ? "color:var(--accent,#38bdf8);" : "opacity:0.85;"}`,
          }),
          h("span", { text: timeStr, style: "font-size:10px; opacity:0.5;" }),
        ),
      );
      list.append(row);
    }

    el.append(list);
  }

  async function fetchCalendar(force = false) {
    const now = Date.now();
    if (!force && lastFetchMs > 0 && now - lastFetchMs < FIFTEEN_MINUTES_MS) {
      render();
      return;
    }
    if (isFetching) return;
    isFetching = true;

    try {
      const fetched = await Bridge.calendarUpcoming(7);
      if (fetched && Array.isArray(fetched)) {
        events = fetched;
        lastFetchMs = now;
      }
    } catch {
      // Keep existing events on error; never crash
    } finally {
      isFetching = false;
      render();
    }
  }

  async function forceRefresh() {
    try {
      await Bridge.calendarRefresh();
    } catch {
      // ignore
    }
    await fetchCalendar(true);
  }

  return {
    el,
    refresh() {
      void fetchCalendar(false);
    },
    tick(nowMs: number) {
      const currentMin = Math.floor(nowMs / 60000);
      if (currentMin !== lastMinute) {
        lastMinute = currentMin;
        render();
      }
    },
    dispose() {
      events = [];
    },
  };
}
