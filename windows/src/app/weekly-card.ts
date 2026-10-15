// The "Weekly recap" card (Stats page) and its 1080x1920 share image.
// Local only: the image is drawn with Canvas 2D from the design tokens' current
// values (read from the CSS variables) and saved or copied, never uploaded.

import { h } from "../views/dom";
import { agentMeta, formatDuration } from "./recap";
import { plural } from "./dash-ui";
import { weeklyRecap, type WeeklyRecap } from "./weekly";
import type { HistoryData } from "../core/bridge";
import { t } from "../i18n/i18n";

export const SHARE_W = 1080;
export const SHARE_H = 1920;

const dayName = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { weekday: "long" });
const dayShort = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export function rangeText(r: WeeklyRecap): string {
  return `${dayShort(r.start)} – ${dayShort(r.end - 1)}`;
}

/** Label/value rows shared by the card and the image. */
export function recapRows(r: WeeklyRecap): [string, string][] {
  const dash = "—";
  return [
    ["Time coding", r.any ? formatDuration(r.codingMs) : dash],
    ["Sessions", String(r.sessions)],
    ["Requests", String(r.requests)],
    ["Files changed", String(r.filesChanged)],
    ["Lines +/−", r.linesAdded == null || r.linesRemoved == null ? dash : `+${r.linesAdded} / −${r.linesRemoved}`],
    ["Commands", String(r.commands)],
    ["Permissions answered", r.permissions == null ? dash : String(r.permissions)],
    ["Top agent", r.topAgent ? `${agentMeta(r.topAgent.agent).name} · ${plural(r.topAgent.requests, "request")}` : dash],
    ["Top project", r.topProject ? r.topProject.name : dash],
    ["Busiest day", r.busiestDay ? `${dayName(r.busiestDay.start)} · ${plural(r.busiestDay.requests, "request")}` : dash],
    ["Longest session", r.longestSession ? `${r.longestSession.name} · ${formatDuration(r.longestSession.ms)}` : dash],
  ];
}

function token(name: string, fallbackVar?: string): string {
  const cs = getComputedStyle(document.documentElement);
  return cs.getPropertyValue(name).trim() || (fallbackVar ? cs.getPropertyValue(fallbackVar).trim() : "") || "currentColor";
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Draws the share image. Colours come from the CSS variables at call time. */
export function drawShare(canvas: HTMLCanvasElement, r: WeeklyRecap): void {
  canvas.width = SHARE_W;
  canvas.height = SHARE_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  const bg = token("--bg-window", "--bg-nose");
  const card = token("--bg-kibble");
  const ink = token("--ink-cream");
  const accent = token("--accent-caramel");
  const done = token("--state-done");
  const dim = token("--dim", "--ink-cream-2");
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";
  const pad = 80;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SHARE_W, SHARE_H);
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = accent;
  ctx.font = `700 40px ${font}`;
  ctx.fillText("AWUUU", pad, 150);
  ctx.fillStyle = ink;
  ctx.font = `700 96px ${font}`;
  ctx.fillText("My week", pad, 270);
  ctx.fillStyle = dim;
  ctx.font = `500 40px ${font}`;
  ctx.fillText(rangeText(r), pad, 335);

  // Hero numbers
  const hero: [string, string][] = [[r.any ? formatDuration(r.codingMs) : "—", "time coding"], [String(r.sessions), "sessions"]];
  hero.forEach(([value, label], i) => {
    const w = (SHARE_W - pad * 2 - 30) / 2;
    const x = pad + i * (w + 30);
    ctx.fillStyle = card;
    ctx.beginPath();
    ctx.roundRect(x, 400, w, 230, 32);
    ctx.fill();
    ctx.fillStyle = i === 0 ? accent : done;
    ctx.font = `700 84px ${font}`;
    ctx.fillText(fit(ctx, value, w - 60), x + 30, 530);
    ctx.fillStyle = dim;
    ctx.font = `500 34px ${font}`;
    ctx.fillText(label, x + 30, 590);
  });

  // The rest as rows
  const rows = recapRows(r).slice(2);
  const rowH = 118;
  const top = 680;
  ctx.fillStyle = card;
  ctx.beginPath();
  ctx.roundRect(pad, top, SHARE_W - pad * 2, rows.length * rowH + 40, 32);
  ctx.fill();
  rows.forEach(([label, value], i) => {
    const y = top + 20 + i * rowH + 72;
    ctx.fillStyle = dim;
    ctx.font = `500 32px ${font}`;
    ctx.textAlign = "left";
    ctx.fillText(label, pad + 40, y);
    ctx.fillStyle = ink;
    ctx.font = `650 36px ${font}`;
    ctx.textAlign = "right";
    ctx.fillText(fit(ctx, value, 520), SHARE_W - pad - 40, y);
  });
  ctx.textAlign = "left";

  ctx.fillStyle = dim;
  ctx.font = `500 30px ${font}`;
  ctx.fillText("Counted on this PC. Nothing was uploaded.", pad, SHARE_H - 100);
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not make the image"))), "image/png"));
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function weeklyCard(data: HistoryData | null, now = Date.now()): HTMLElement {
  const r = weeklyRecap(data, now);
  const status = h("div", { class: "hint", role: "status" });
  const say = (t: string) => { status.textContent = t; };
  const fileName = `awuuu-week-${new Date(r.start).toISOString().slice(0, 10)}.png`;

  const render = async () => {
    const canvas = document.createElement("canvas");
    drawShare(canvas, r);
    return toBlob(canvas);
  };
  const save = async () => {
    try {
      saveBlob(await render(), fileName);
      say(t("Image saved (look in Downloads)."));
    } catch (err) {
      say(t("Could not save the image: {v}", { v: String(err).replace(/^Error:\s*/, "") }));
    }
  };
  const copy = async () => {
    try {
      const blob = await render();
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("no clipboard images");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      say(t("Image copied."));
    } catch {
      say(t("The clipboard refused the image, so it was saved instead."));
      void save();
    }
  };

  const list = h("div", { class: "stat-table", style: "grid-template-columns:minmax(140px,1fr) 2fr" });
  for (const [label, value] of recapRows(r)) {
    list.append(h("span", { class: "who", text: label }), h("span", { text: value, style: "text-align:left" }));
  }
  return h("section", { id: "weekly-recap" },
    h("h2", {}, h("span", { text: t("Weekly recap") }), h("span", { class: "plan", text: rangeText(r) })),
    r.any ? list : h("div", { class: "hint", text: t("Nothing recorded yet this week.") }),
    r.any && (r.linesAdded == null || r.permissions == null)
      ? h("div", { class: "hint", text: t("Lines changed and permissions answered are not kept in history, so they show a dash.") }) : null,
    h("div", { class: "row" },
      h("button", { class: "primary", text: t("Save image"), disabled: !r.any, onclick: () => void save() }),
      h("button", { text: t("Copy image"), disabled: !r.any, onclick: () => void copy() })),
    status);
}
