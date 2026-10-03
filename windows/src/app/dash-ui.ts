// Small DOM pieces shared by the dashboard pages (Sessions, Stats, Privacy).

import { h, clear } from "../views/dom";
import { agentMeta } from "./recap";

const p2 = (n: number) => String(n).padStart(2, "0");

/** "14:02:11" */
export function clock(ms: number, seconds = true): string {
  const d = new Date(ms);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}${seconds ? `:${p2(d.getSeconds())}` : ""}`;
}

/** "Sat 3 Oct" */
export function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** "Sat 3 Oct 14:02 – 14:40", or both dates when it spans days. */
export function rangeLabel(first: number, last: number): string {
  const a = `${dayLabel(first)} ${clock(first, false)}`;
  return sameDay(first, last) ? `${a} – ${clock(last, false)}` : `${a} – ${dayLabel(last)} ${clock(last, false)}`;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 d ago", "12 Sep". */
export function relTime(ms: number, now = Date.now()): string {
  const diff = now - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 24 * 3_600_000 && sameDay(ms, now)) return `${Math.floor(diff / 3_600_000)} h ago`;
  if (sameDay(ms, now - 24 * 3_600_000)) return "yesterday";
  const days = Math.floor(diff / (24 * 3_600_000));
  if (days < 7) return `${Math.max(1, days)} d ago`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function bytesLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function agentDot(agent: string, size = 8): HTMLElement {
  return h("i", { class: "dot", style: `width:${size}px;height:${size}px;background:${agentMeta(agent).color}` });
}

/** `text` with every occurrence of `query` wrapped in <mark>. */
export function highlight(text: string, query: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const q = query.trim().toLowerCase();
  if (!q) {
    frag.append(text);
    return frag;
  }
  const low = text.toLowerCase();
  // Lower-casing can change a string's length (İ…): then positions don't line up.
  if (low.length !== text.length) {
    frag.append(text);
    return frag;
  }
  let from = 0;
  let marks = 0;
  for (;;) {
    const at = low.indexOf(q, from);
    if (at < 0 || marks >= 400) break;
    if (at > from) frag.append(text.slice(from, at));
    frag.append(h("mark", { text: text.slice(at, at + q.length) }));
    from = at + q.length;
    marks++;
  }
  if (from < text.length) frag.append(text.slice(from));
  return frag;
}

/** A div that behaves like a button (rows that hold more than a label). */
export function clickable<T extends HTMLElement>(el: T, onClick: () => void): T {
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  el.addEventListener("click", onClick);
  el.addEventListener("keydown", (e) => {
    if (e.target !== el) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  });
  return el;
}

/**
 * Copies `text`; the button says "Copied" for a moment. When the clipboard is
 * not available, `fallback` receives a selected textarea to copy from by hand.
 */
export async function copyText(text: string, button: HTMLButtonElement, fallback: HTMLElement): Promise<boolean> {
  const label = button.dataset.label ?? button.textContent ?? "Copy";
  button.dataset.label = label;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied ✓";
    button.classList.add("copied");
    window.setTimeout(() => {
      button.textContent = label;
      button.classList.remove("copied");
    }, 1600);
    return true;
  } catch {
    clear(fallback);
    const area = h("textarea", { class: "copy-area", rows: "8", readonly: true, spellcheck: "false" }) as HTMLTextAreaElement;
    area.value = text;
    fallback.append(h("div", { class: "notice warn copy-fallback" },
      h("div", { class: "row" },
        h("span", { text: "Could not reach the clipboard. The text is selected below — press Ctrl+C." }),
        h("span", { class: "spacer" }),
        h("button", { text: "Close", onclick: () => clear(fallback) })),
      area));
    area.focus();
    area.select();
    return false;
  }
}
