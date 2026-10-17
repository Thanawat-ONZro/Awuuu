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
import { onSide, geo } from "../core/layout";

export interface ToolsPanelHost {
  el: HTMLElement;
  grid: HTMLElement;
  sync(): void;
  tick(nowMs: number): void;
  dispose?(): void;
}

export function buildToolsPanel(actions: ViewActions): ToolsPanelHost {
  const grid = h("div", { class: "dashboard-grid" });
  const el = h("div", { class: "overview-tools" }, grid);
  let hosts: { mod: ModuleDescriptor; host: ModuleHost }[] = [];
  let renderedKey = "";
  let wasOpen = false;

  // Several modules call onActiveChange (translation included) but only the
  // media widget's activity should drive the .has-media grid rule, so track
  // each module's reported state separately rather than taking the last caller's word.
  const activeById = new Map<string, boolean>();
  function moduleCtxFor(moduleId: string): ModuleCtx {
    return {
      actions,
      open: (view) => actions.setView(view),
      onActiveChange: (active) => {
        activeById.set(moduleId, active);
        grid.classList.toggle("has-media", activeById.get("media") === true);
      },
    };
  }

  function syncCols() {
    const side = onSide();
    const wide = !side && geo.expandedW >= 920;
    const cols = side ? "1" : (wide ? "3" : "2");
    grid.setAttribute("data-cols", cols);
    if (grid.dataset) grid.dataset.cols = cols;
    grid.classList.toggle("cols-3", cols === "3");
    grid.classList.toggle("cols-2", cols === "2");
    grid.classList.toggle("cols-1", cols === "1");
  }

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
      const host = mod.build(moduleCtxFor(mod.id));
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
  syncCols();

  return {
    el,
    grid,
    sync() {
      const open = State.mode === "expanded" && (State.view === "overview" || State.view === "dashboard");
      syncCols();
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
    dispose() {
      for (const item of hosts) {
        item.host.dispose?.();
      }
      hosts = [];
    },
  };
}

export function buildDashboardView(actions: ViewActions): ViewHost {
  const panel = buildToolsPanel(actions);
  const shell = createCardShell({ title: t("Tools"), wash: "soft", body: panel.el });
  const el = h("div", { class: "view dashboard-view" }, shell.el);

  return {
    el,
    sync: () => panel.sync(),
    tick: (nowMs) => panel.tick(nowMs),
  };
}
