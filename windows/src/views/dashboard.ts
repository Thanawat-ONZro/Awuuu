import { h } from "./dom";
import { createCardShell } from "./card-shell";
import type { ViewActions, ViewHost } from "./views";
import {
  resolveDefaultModule,
  visibleModules,
  type ModuleDescriptor,
  type ModuleHost,
  type ModuleCtx,
} from "../core/modules";
import { State } from "../core/state";
import { t } from "../i18n/i18n";

export function buildDashboardView(actions: ViewActions): ViewHost {
  const grid = h("div", { class: "dashboard-grid" });
  let hosts: { mod: ModuleDescriptor; host: ModuleHost }[] = [];
  let renderedKey = "";
  let wasOpen = false;

  const ctx: ModuleCtx = {
    actions,
    open: (view) => actions.setView(view),
    onActiveChange: (active) => {
      grid.classList.toggle("has-media", active);
    },
  };

  function updateModules(): boolean {
    const mods = visibleModules(State.settings.modules, State.settings.moduleOrder);
    const defaultId = resolveDefaultModule(State.settings.defaultModule, State.settings.modules, State.settings.moduleOrder);
    const key = `${mods.map((m) => m.id).join(",")}:def=${defaultId}`;
    if (key === renderedKey) return false;
    renderedKey = key;

    for (const item of hosts) {
      item.host.dispose?.();
    }
    hosts = [];
    grid.innerHTML = "";

    const WASH_MAP: Partial<Record<string, string>> = {
      media: "wash-indigo",
      weather: "wash-cyan",
      system: "wash-amber",
      calendar: "wash-green",
      shelf: "wash-soft",
      screentime: "wash-indigo",
      notifications: "wash-pink",
      translation: "wash-cyan",
      toggles: "wash-soft",
      notes: "wash-amber",
      todo: "wash-soft",
    };

    for (const mod of mods) {
      const host = mod.build(ctx);
      if (!host.el.classList.contains("widget")) {
        host.el.classList.add("widget", `widget-${mod.id}`);
      }
      const washClass = WASH_MAP[mod.id];
      if (washClass) {
        host.el.classList.add(washClass);
      }
      if (mod.id === defaultId) {
        host.el.classList.add("default-module");
      }
      hosts.push({ mod, host });
      grid.append(host.el);
    }
    return true;
  }

  updateModules();

  const shell = createCardShell({ title: t("Tools"), wash: "soft", body: grid });
  const el = h("div", { class: "view dashboard-view" }, shell.el);

  return {
    el,
    sync() {
      const open = State.mode === "expanded" && State.view === "dashboard";
      if (!open) {
        wasOpen = false;
        return;
      }
      const changed = updateModules();
      if (!wasOpen || changed) {
        wasOpen = true;
        for (const item of hosts) {
          void item.host.refresh?.();
        }
      }
    },
    tick(nowMs) {
      for (const item of hosts) {
        item.host.tick?.(nowMs);
      }
    },
  };
}
