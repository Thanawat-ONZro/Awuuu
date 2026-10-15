// The diff view: one file edit from the session ticker, read-only. Back (or Esc,
// see island.ts) returns to Agents. The diff is held in memory only.

import { h, svg } from "./dom";
import { ICONS } from "./icons";
import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import { baseName, diffCounts, type FileDiff } from "../core/diff";
import type { ViewActions, ViewHost } from "./views";

let current: FileDiff | null = null;

/** Picks the diff the diff view shows (call before switching to it). */
export function showDiff(diff: FileDiff) {
  current = diff;
}

export function buildDiffView(actions: ViewActions): ViewHost {
  const back = h("button", { class: "diff-btn", title: "Back (Esc)", onclick: () => { actions.blip(); actions.setView("agents"); } },
    svg(ICONS.chevronLeft, 12, { stroke: 2.4 }));
  const name = h("span", { class: "diff-name" });
  const counts = h("span", { class: "diff-counts" });
  const open = h("button", { class: "diff-btn", title: "Open in VS Code", onclick: () => {
    if (current) void Bridge.openInVSCode(current.path);
  } }, svg(ICONS.arrowUpRight, 12, { stroke: 2 }));
  const body = h("div", { class: "diff-body" });
  const el = h("div", { class: "view" },
    h("div", { class: "card diff-card" }, h("div", { class: "diff-head" }, back, name, counts, open), body));

  let shown: FileDiff | null = null;
  return {
    el,
    sync() {
      if (State.view !== "diff" || current === shown) return;
      shown = current;
      body.replaceChildren();
      body.scrollTop = 0;
      if (!shown) return;
      name.textContent = baseName(shown.path);
      name.title = shown.path;
      counts.textContent = `${shown.isNew ? "new file · " : ""}${diffCounts(shown)}`;
      shown.hunks.forEach((hk, i) => {
        if (i > 0) body.append(h("div", { class: "diff-gap", text: "⋯" }));
        body.append(h("div", { class: "diff-hunk", text: `@@ -${hk.oldStart} +${hk.newStart} @@` }));
        for (const l of hk.lines) {
          const mark = l.kind === "added" ? "+" : l.kind === "removed" ? "-" : " ";
          body.append(h("div", { class: `diff-line ${l.kind}`, text: `${mark} ${l.text}` }));
        }
      });
      if (shown.truncated) {
        body.append(h("div", { class: "diff-note", text: shown.hunks.length ? "Diff cut short: too big to show in full." : "Too big to show; only the counts are kept." }));
      }
    },
  };
}
