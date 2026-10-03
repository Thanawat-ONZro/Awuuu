// Island: where it sits, how big it is, what the agents hub shows.

import { Bridge } from "../../core/bridge";
import type { Settings } from "../../core/state";
import { h } from "../../views/dom";
import { layoutRefreshers, pageOf, save, select, settings, slider, toggle } from "../ui";

const SIZE_PRESETS: Record<string, [number, number]> = { M: [640, 290], L: [820, 420], XL: [1000, 560] };

function layoutSection(): HTMLElement {
  const edge = select(
    [["top", "Top"], ["bottom", "Bottom (above the taskbar)"], ["left", "Left"], ["right", "Right"]],
    () => settings.position ?? "top",
    (v) => (settings.position = v as Settings["position"]),
  );
  const presets = h("span", { class: "row-buttons" });
  for (const [name, [w, hh]] of Object.entries(SIZE_PRESETS)) {
    presets.append(h("button", {
      text: name,
      onclick: () => {
        settings.islandWidth = w;
        settings.hubHeight = hh;
        layoutRefreshers.forEach((f) => f());
        void save();
      },
    }));
  }
  const scale = select(
    [["0.9", "Small"], ["1", "Normal"], ["1.15", "Large"], ["1.3", "Extra large"]],
    () => String(settings.hubScale ?? 1),
    (v) => (settings.hubScale = Number(v)),
  );
  const lines = select(
    [["8", "8 lines"], ["15", "15 lines"], ["40", "40 lines"], ["0", "Everything kept (80)"]],
    () => String(settings.logLines ?? 40),
    (v) => (settings.logLines = Number(v)),
  );
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Island layout" })),
    h("div", { class: "row" }, h("label", { text: "Edge" }), edge),
    h("div", { class: "row" },
      h("label", { text: "Move" }),
      h("span", { class: "hint", text: "drag the ⋮⋮ grip on the open island, or Alt + drag it" }),
      h("button", { text: "Reset position", onclick: () => void Bridge.resetPosition() }),
    ),
    h("div", { class: "row" }, h("label", { text: "Size" }), presets,
      h("span", { class: "hint", text: "or drag the island's bottom-right corner" })),
    h("div", { class: "row" }, h("label", { text: "Width" }),
      slider(520, 1100, 10, () => settings.islandWidth ?? 640, (v) => (settings.islandWidth = v))),
    h("div", { class: "row" }, h("label", { text: "Hub height" }),
      slider(220, 640, 10, () => settings.hubHeight ?? 290, (v) => (settings.hubHeight = v))),
    h("h2", {}, h("span", { text: "Agents hub" })),
    h("div", { class: "row" }, h("label", { text: "Text size" }), scale),
    h("div", { class: "row" }, h("label", { text: "Log" }), lines),
    h("div", { class: "row" }, h("label", { text: "Show thinking" }),
      toggle(settings.showThinking ?? true, (v) => { settings.showThinking = v; void save(); })),
    h("div", { class: "row" }, h("label", { text: "Show times" }),
      toggle(settings.showTime ?? true, (v) => { settings.showTime = v; void save(); })),
  );
}


export function page(): HTMLElement {
  return pageOf("Island", "Where the island sits, how big it opens, and how much the agents hub shows.", layoutSection());
}
