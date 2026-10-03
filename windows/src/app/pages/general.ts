// Sound & behaviour.

import { Bridge } from "../../core/bridge";
import type { Settings } from "../../core/state";
import { h } from "../../views/dom";
import { pageOf, save, settings, toggle } from "../ui";

// ── General section ───────────────────────────────────────────────────────────

function generalSection(): HTMLElement {
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    value: String(settings.soundVolume),
  }) as HTMLInputElement;
  volume.addEventListener("input", () => {
    settings.soundVolume = Number(volume.value);
    void save();
  });

  const autoClose = h("input", {
    type: "number", min: "5", max: "120", step: "1",
    value: String(Math.round(settings.autoCloseInterval)),
    style: "width:72px",
  }) as HTMLInputElement;
  autoClose.addEventListener("change", () => {
    settings.autoCloseInterval = Math.max(5, Math.min(120, Number(autoClose.value) || 15));
    autoClose.value = String(settings.autoCloseInterval);
    void save();
  });

  const hide = h("select", {}) as HTMLSelectElement;
  hide.append(
    h("option", { value: "3", text: "After 3 seconds" }),
    h("option", { value: "5", text: "After 5 seconds (default)" }),
    h("option", { value: "10", text: "After 10 seconds" }),
    h("option", { value: "60", text: "After 1 minute" }),
    h("option", { value: "0", text: "Never — stays on screen" }),
  );
  hide.value = String(settings.hideAfter ?? 5);
  if (hide.value === "") hide.value = "5";
  hide.addEventListener("change", () => {
    settings.hideAfter = Number(hide.value);
    void save();
  });

  const screen = h("select", {}) as HTMLSelectElement;
  screen.append(
    h("option", { value: "primary", text: "Main display" }),
    h("option", { value: "cursor", text: "Display under the cursor" }),
  );
  screen.value = settings.screen;
  screen.addEventListener("change", () => {
    settings.screen = screen.value as Settings["screen"];
    void save();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "General" })),
    h("div", { class: "row" },
      h("label", { text: "Sound" }),
      toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); }),
      volume,
    ),
    h("div", { class: "row" },
      h("label", { text: "Auto-close" }),
      autoClose,
      h("span", { class: "hint", text: "seconds after you leave the island" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Notification auto-hide" }),
      hide,
    ),
    h("div", { class: "row" },
      h("label", { text: "Island lives on" }),
      screen,
    ),
    h("div", { class: "row" },
      h("label", { text: "Updates" }),
      toggle(settings.updateCheck === true, (v) => { settings.updateCheck = v; void save(); }),
      h("span", { class: "hint", text: "check automatically" }),
      h("button", { text: "Check now", onclick: () => void Bridge.updateCheckNow() }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Launch at startup" }),
      toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }),
    ),
  );
}


export function page(): HTMLElement {
  return pageOf("Sound & behaviour", "Sounds, when the island closes by itself, which display it lives on, and start-up.", generalSection());
}
