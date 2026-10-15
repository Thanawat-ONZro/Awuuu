// Island: where it sits, how big it is, what the agents hub shows.

import { Bridge } from "../../core/bridge";
import type { Settings } from "../../core/state";
import { h } from "../../views/dom";
import { layoutRefreshers, pageOf, save, select, settings, slider, toggle } from "../ui";
import { t } from "../../i18n/i18n";

const SIZE_PRESETS: Record<string, [number, number]> = { M: [640, 290], L: [820, 420], XL: [1000, 560] };

function layoutSection(): HTMLElement {
  const edge = select(
    [["top", t("Top")], ["bottom", t("Bottom (above the taskbar)")], ["left", t("Left")], ["right", t("Right")]],
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
    [["0.9", t("Small")], ["1", t("Normal")], ["1.15", t("Large")], ["1.3", t("Extra large")]],
    () => String(settings.hubScale ?? 1),
    (v) => (settings.hubScale = Number(v)),
  );
  const lines = select(
    [["8", t("{n} lines", { n: 8 })], ["15", t("{n} lines", { n: 15 })], ["40", t("{n} lines", { n: 40 })], ["0", t("Everything kept (80)")]],
    () => String(settings.logLines ?? 40),
    (v) => (settings.logLines = Number(v)),
  );
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("Island layout") })),
    h("div", { class: "row" }, h("label", { text: t("Edge") }), edge),
    h("div", { class: "row" },
      h("label", { text: t("Move") }),
      h("span", { class: "hint", text: t("drag the ⋮⋮ grip on the open island, or Alt + drag it") }),
      h("button", { text: t("Reset position"), onclick: () => void Bridge.resetPosition() }),
    ),
    h("div", { class: "row" }, h("label", { text: t("Size") }), presets,
      h("span", { class: "hint", text: t("or drag the island's bottom-right corner") })),
    h("div", { class: "row" }, h("label", { text: t("Width") }),
      slider(520, 1100, 10, () => settings.islandWidth ?? 640, (v) => (settings.islandWidth = v))),
    h("div", { class: "row" }, h("label", { text: t("Hub height") }),
      slider(220, 640, 10, () => settings.hubHeight ?? 290, (v) => (settings.hubHeight = v))),
    h("h2", {}, h("span", { text: t("Agents hub") })),
    h("div", { class: "row" }, h("label", { text: t("Text size") }), scale),
    h("div", { class: "row" }, h("label", { text: t("Log") }), lines),
    h("div", { class: "row" }, h("label", { text: t("Show thinking") }),
      toggle(settings.showThinking ?? true, (v) => { settings.showThinking = v; void save(); })),
    h("div", { class: "row" }, h("label", { text: t("Show times") }),
      toggle(settings.showTime ?? true, (v) => { settings.showTime = v; void save(); })),
  );
}


export function page(): HTMLElement {
  return pageOf(t("Island"), t("Where the island sits, how big it opens, and how much the agents hub shows."), layoutSection());
}
