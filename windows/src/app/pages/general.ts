// Sound & behaviour.

import { Bridge } from "../../core/bridge";
import { SOUND_NAMES } from "../../core/sound";
import type { Settings } from "../../core/state";
import { h } from "../../views/dom";
import { pageOf, save, select, settings, toggle } from "../ui";
import { rebuildShell } from "../shell";
import { setLanguage } from "../../i18n/i18n";
import { t } from "../../i18n/i18n";

// ── General section ───────────────────────────────────────────────────────────

const quiet = (): [string, string][] => [
  ["", t("Off")],
  ["22:00-07:00", "22:00 – 07:00"],
  ["23:00-08:00", "23:00 – 08:00"],
  ["21:00-08:00", "21:00 – 08:00"],
  ["12:00-13:00", t("Lunch, 12:00 – 13:00")],
];

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
    h("option", { value: "3", text: t("After 3 seconds") }),
    h("option", { value: "5", text: t("After 5 seconds (default)") }),
    h("option", { value: "10", text: t("After 10 seconds") }),
    h("option", { value: "60", text: t("After 1 minute") }),
    h("option", { value: "0", text: t("Never — stays on screen") }),
  );
  hide.value = String(settings.hideAfter ?? 5);
  if (hide.value === "") hide.value = "5";
  hide.addEventListener("change", () => {
    settings.hideAfter = Number(hide.value);
    void save();
  });

  const screen = h("select", {}) as HTMLSelectElement;
  screen.append(
    h("option", { value: "primary", text: t("Main display") }),
    h("option", { value: "cursor", text: t("Display under the cursor") }),
  );
  screen.value = settings.screen;
  screen.addEventListener("change", () => {
    settings.screen = screen.value as Settings["screen"];
    void save();
  });

  const replaced = h("span", { class: "hint" }) as HTMLElement;
  const countReplaced = async () => {
    const found = await Bridge.userSounds(SOUND_NAMES);
    const n = found?.custom.length ?? 0;
    replaced.textContent = n ? t("{n} replaced by your files", { n }) : "";
  };
  void countReplaced();

  const openSounds = h("button", { text: t("Open sounds folder"), onclick: () => void Bridge.revealSoundsFolder() });
  const reloadSounds = h("button", {
    text: t("Reload sounds"),
    onclick: async () => {
      await Bridge.reloadSounds();
      await countReplaced();
    },
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: t("General") })),
    h("div", { class: "row" },
      h("label", { text: t("Language") }),
      select(
        [["auto", t("Automatic (follow Windows)")], ["en", "English"], ["th", "ไทย"]],
        () => settings.language ?? "auto",
        (v) => {
          settings.language = v as Settings["language"];
          setLanguage(settings.language);
          window.setTimeout(rebuildShell, 0);
        },
      ),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Sound") }),
      toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); }),
      volume,
    ),
    h("div", { class: "row" },
      h("label", { text: t("Your sounds") }),
      openSounds,
      reloadSounds,
      replaced,
      h("span", { class: "hint", text: t("a file named like a sound (finish.wav, approve.mp3…) replaces it") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Auto-close") }),
      autoClose,
      h("span", { class: "hint", text: t("seconds after you leave the island") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Notification auto-hide") }),
      hide,
    ),
    h("div", { class: "row" },
      h("label", { text: t("Quiet hours") }),
      select(quiet(), () => settings.quietHours ?? "", (v) => (settings.quietHours = v)),
      h("span", { class: "hint", text: t("no finish pop-ups or sounds; approvals still show") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Island lives on") }),
      screen,
    ),
    h("div", { class: "row" },
      h("label", { text: t("Updates") }),
      toggle(settings.updateCheck === true, (v) => { settings.updateCheck = v; void save(); }),
      h("span", { class: "hint", text: t("check automatically") }),
      h("button", { text: t("Check now"), onclick: () => void Bridge.updateCheckNow() }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Open on hover") }),
      toggle(settings.openOnHover === true, (v) => { settings.openOnHover = v; void save(); }),
      h("span", { class: "hint", text: t("rest the pointer on the island to open it; click inside to keep it open") }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Dog on desktop") }),
      toggle(settings.desktopDog?.enabled === true, (v) => {
        settings.desktopDog = { ...settings.desktopDog, enabled: v };
        void save();
      }),
      h("span", {
        class: "hint",
        text: t("drag the dog out of the open island, or Ctrl+Alt+D; double-click it or drop it on the island to bring it home"),
      }),
    ),
    h("div", { class: "row" },
      h("label", { text: t("Launch at startup") }),
      toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }),
    ),
  );
}


export function page(): HTMLElement {
  return pageOf(t("Sound & behaviour"), t("Sounds, when the island closes by itself, which display it lives on, and start-up."), generalSection());
}
