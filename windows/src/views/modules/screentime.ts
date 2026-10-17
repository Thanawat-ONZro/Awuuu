// Screen Time module: tracks foreground app polling every 5 s while island is visible,
// renders today's donut chart, top 5 apps with duration and percentages, and switch count.
// Idle = 0 % CPU: polls only while island is open and module is enabled.

import { clear, h, svg } from "../dom";
import { ICONS } from "../icons";
import { Bridge, type ScreenTimeDay } from "../../core/bridge";
import type { ModuleCtx, ModuleHost } from "../../core/modules";
import { t } from "../../i18n/i18n";

export interface TopAppItem {
  name: string;
  minutes: number;
  pct: number;
}

export interface TopAppsResult {
  top: TopAppItem[];
  otherMinutes: number;
  totalMinutes: number;
}

/** Reduces app minutes into top N apps with percentage and the rest summed. */
export function reduceTopApps(appMinutes: Record<string, number>, topN = 5): TopAppsResult {
  const entries = Object.entries(appMinutes).filter(([, m]) => m > 0);
  const totalMinutes = entries.reduce((acc, [, m]) => acc + m, 0);

  if (totalMinutes <= 0) {
    return { top: [], otherMinutes: 0, totalMinutes: 0 };
  }

  // Sort descending by minutes, then alphabetically by name
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const topSlice = entries.slice(0, topN);
  const top: TopAppItem[] = topSlice.map(([name, minutes]) => ({
    name,
    minutes,
    pct: Math.round((minutes / totalMinutes) * 100),
  }));

  const otherMinutes = entries.slice(topN).reduce((acc, [, m]) => acc + m, 0);

  return { top, otherMinutes, totalMinutes };
}

/** Formats duration in minutes into a human-readable string (e.g. 0m, 45m, 1h, 2h 5m). */
export function formatScreenTime(minutes: number): string {
  if (minutes <= 0) return "0m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Formats application switch count string. */
export function formatSwitches(count: number): string {
  if (count === 1) return t("1 switch");
  return t("{n} switches", { n: count });
}

const PALETTE = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#6b7280", // gray (other)
];

/** Builds an SVG donut chart representing top apps and other. */
function renderDonut(top: TopAppItem[], otherMinutes: number, totalMinutes: number): SVGSVGElement {
  const size = 68;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const ns = "http://www.w3.org/2000/svg";
  const svgEl = document.createElementNS(ns, "svg");
  svgEl.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svgEl.setAttribute("class", "screentime-donut");

  // Background ring
  const bgCircle = document.createElementNS(ns, "circle");
  bgCircle.setAttribute("cx", String(size / 2));
  bgCircle.setAttribute("cy", String(size / 2));
  bgCircle.setAttribute("r", String(radius));
  bgCircle.setAttribute("fill", "none");
  bgCircle.setAttribute("stroke", "rgba(255, 255, 255, 0.08)");
  bgCircle.setAttribute("stroke-width", String(strokeWidth));
  svgEl.append(bgCircle);

  if (totalMinutes <= 0) {
    return svgEl;
  }

  const segments: { minutes: number; color: string }[] = top.map((item, idx) => ({
    minutes: item.minutes,
    color: PALETTE[idx % (PALETTE.length - 1)],
  }));

  if (otherMinutes > 0) {
    segments.push({
      minutes: otherMinutes,
      color: PALETTE[PALETTE.length - 1],
    });
  }

  let accumulated = 0;
  for (const seg of segments) {
    const fraction = seg.minutes / totalMinutes;
    const dashLength = fraction * circumference;
    const dashOffset = -accumulated * circumference;

    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("cx", String(size / 2));
    circle.setAttribute("cy", String(size / 2));
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", seg.color);
    circle.setAttribute("stroke-width", String(strokeWidth));
    circle.setAttribute("stroke-dasharray", `${dashLength} ${circumference - dashLength}`);
    circle.setAttribute("stroke-dashoffset", String(dashOffset));
    circle.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
    circle.setAttribute("stroke-linecap", "round");
    svgEl.append(circle);

    accumulated += fraction;
  }

  return svgEl;
}

export function createScreenTimeModuleHost(_ctx?: ModuleCtx): ModuleHost {
  const iconEl = svg(ICONS.timer, 13);
  const titleEl = h("span", { class: "screentime-header-title", text: t("Screen Time") });
  const totalBadge = h("span", { class: "screentime-badge", text: "0m" });

  const headerLeft = h("div", { class: "screentime-header-left" }, iconEl, titleEl);
  const headerEl = h("div", { class: "screentime-header" }, headerLeft, totalBadge);

  const donutContainer = h("div", { class: "screentime-donut-wrap" });
  const statsSummary = h("div", { class: "screentime-summary-wrap" });
  const topSection = h("div", { class: "screentime-top-section" }, donutContainer, statsSummary);

  const appsListEl = h("div", { class: "screentime-apps-list" });

  const el = h("div", { class: "widget widget-screentime" }, headerEl, topSection, appsListEl);

  let disposed = false;
  let lastSampleMs = 0;

  function render(day: ScreenTimeDay) {
    if (disposed) return;
    const reduced = reduceTopApps(day.appMinutes);

    totalBadge.textContent = formatScreenTime(reduced.totalMinutes);

    // Donut & Summary
    clear(donutContainer);
    donutContainer.append(renderDonut(reduced.top, reduced.otherMinutes, reduced.totalMinutes));

    clear(statsSummary);
    const timeValue = h("span", { class: "screentime-stat-time", text: formatScreenTime(reduced.totalMinutes) });
    const timeLabel = h("span", { class: "screentime-stat-label", text: t("Today's activity") });
    const switchCount = h("span", { class: "screentime-stat-switches", text: formatSwitches(day.switchCount) });
    statsSummary.append(timeValue, timeLabel, switchCount);

    // Top Apps List
    clear(appsListEl);
    if (reduced.top.length === 0) {
      appsListEl.append(h("div", { class: "screentime-empty-hint", text: t("Tracking active applications") }));
      return;
    }

    reduced.top.forEach((item, idx) => {
      const color = PALETTE[idx % (PALETTE.length - 1)];
      const dot = h("span", { class: "screentime-app-dot", style: `background-color: ${color}` });
      const name = h("span", { class: "screentime-app-name", text: item.name, title: item.name });
      const dur = h("span", { class: "screentime-app-dur", text: `${formatScreenTime(item.minutes)} (${item.pct}%)` });
      const header = h("div", { class: "screentime-app-header" }, h("div", { class: "screentime-app-left" }, dot, name), dur);

      const fill = h("div", { class: "screentime-app-bar-fill", style: `width: ${item.pct}%; background-color: ${color}` });
      const bar = h("div", { class: "screentime-app-bar" }, fill);

      appsListEl.append(h("div", { class: "screentime-app-row" }, header, bar));
    });

    if (reduced.otherMinutes > 0) {
      const otherPct = Math.round((reduced.otherMinutes / reduced.totalMinutes) * 100);
      const otherColor = PALETTE[PALETTE.length - 1];
      const dot = h("span", { class: "screentime-app-dot", style: `background-color: ${otherColor}` });
      const name = h("span", { class: "screentime-app-name", text: t("Other apps") });
      const dur = h("span", { class: "screentime-app-dur", text: `${formatScreenTime(reduced.otherMinutes)} (${otherPct}%)` });
      const header = h("div", { class: "screentime-app-header" }, h("div", { class: "screentime-app-left" }, dot, name), dur);

      const fill = h("div", { class: "screentime-app-bar-fill", style: `width: ${otherPct}%; background-color: ${otherColor}` });
      const bar = h("div", { class: "screentime-app-bar" }, fill);

      appsListEl.append(h("div", { class: "screentime-app-row" }, header, bar));
    }
  }

  async function pollSample() {
    if (disposed) return;
    try {
      const day = await Bridge.screentimeSample();
      if (!disposed && day) {
        render(day);
      }
    } catch {
      /* ignore sampling error */
    }
  }

  async function loadInitial() {
    if (disposed) return;
    try {
      const day = await Bridge.screentimeToday();
      if (!disposed && day) {
        render(day);
      }
    } catch {
      /* ignore */
    }
  }

  void loadInitial();

  return {
    el,
    refresh() {
      return loadInitial();
    },
    tick(nowMs) {
      // Poll every 5s while island is visible
      if (nowMs - lastSampleMs >= 5000) {
        lastSampleMs = nowMs;
        void pollSample();
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
