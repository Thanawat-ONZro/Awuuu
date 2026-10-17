// Pure module registry for Awuuu's notch dashboard.
// Descriptors define identity, icons, sizes and constructors;
// State decides visibility and ordering.

import type { ICONS } from "../views/icons";
import type { IslandViewName } from "./layout";
import type { ViewActions } from "../views/views";
import { State, DEFAULT_SETTINGS } from "./state";
import {
  createDateWidget,
  createNowPlayingWidget,
  createScratchpadWidget,
  createSystemWidget,
  createTodoWidget,
} from "../views/widgets";
import { createWeatherModuleHost } from "../views/modules/weather";
import { createCalendarModuleHost } from "../views/modules/calendar";
import { createTogglesModuleHost } from "../views/modules/toggles";
import { createShelfModuleHost } from "../views/modules/shelf";
import { createScreenTimeModuleHost } from "../views/modules/screentime";
import { createNotificationsModuleHost } from "../views/modules/notifications";
import { createTranslationModuleHost } from "../views/modules/translation";

export type ModuleId =
  | "dashboard"
  | "media"
  | "weather"
  | "todo"
  | "notes"
  | "system"
  | "calendar"
  | "toggles"
  | "shelf"
  | "screentime"
  | "notifications"
  | "translation";

export interface ModuleHost {
  el: HTMLElement;
  refresh?(): void | Promise<void>;
  tick?(nowMs: number): void;
  dispose?(): void;
}

export interface ModuleCtx {
  actions: ViewActions;
  open(view: IslandViewName): void;
  onActiveChange?: (active: boolean) => void;
}

export interface ModuleDescriptor {
  id: ModuleId;
  titleKey: string;
  icon: keyof typeof ICONS;
  minW: number;
  minH: number;
  order: number;
  build(ctx: ModuleCtx): ModuleHost;
}

export const MODULES: ModuleDescriptor[] = [
  {
    id: "dashboard",
    titleKey: "Date",
    icon: "timer",
    minW: 1,
    minH: 1,
    order: 0,
    build(_ctx) {
      const widget = createDateWidget();
      return {
        el: widget.el,
        refresh: () => widget.update(),
        tick: () => widget.update(),
      };
    },
  },
  {
    id: "media",
    titleKey: "Now Playing",
    icon: "play",
    minW: 1,
    minH: 1,
    order: 1,
    build(ctx) {
      const widget = createNowPlayingWidget((active) => {
        ctx.onActiveChange?.(active);
      });
      return {
        el: widget.el,
        refresh: () => widget.refresh(),
        tick(nowMs) {
          widget.tick?.(nowMs);
        },
        dispose: () => widget.dispose?.(),
      };
    },
  },
  {
    id: "weather",
    titleKey: "Weather",
    icon: "cloud",
    minW: 1,
    minH: 1,
    order: 2,
    build(ctx) {
      return createWeatherModuleHost(ctx);
    },
  },
  {
    id: "todo",
    titleKey: "Todo",
    icon: "check",
    minW: 1,
    minH: 1,
    order: 3,
    build(_ctx) {
      const widget = createTodoWidget();
      return { el: widget.el };
    },
  },
  {
    id: "notes",
    titleKey: "Notes",
    icon: "doc",
    minW: 1,
    minH: 1,
    order: 4,
    build(_ctx) {
      const widget = createScratchpadWidget();
      return { el: widget.el };
    },
  },
  {
    id: "system",
    titleKey: "System",
    icon: "tools",
    minW: 1,
    minH: 1,
    order: 5,
    build(ctx) {
      return createSystemWidget(ctx);
    },
  },
  {
    id: "calendar",
    titleKey: "Calendar",
    icon: "calendar",
    minW: 1,
    minH: 1,
    order: 6,
    build(ctx) {
      return createCalendarModuleHost(ctx);
    },
  },
  {
    id: "toggles",
    titleKey: "Quick Toggles",
    icon: "toggle",
    minW: 1,
    minH: 1,
    order: 7,
    build(ctx) {
      return createTogglesModuleHost(ctx);
    },
  },
  {
    id: "shelf",
    titleKey: "Shelf",
    icon: "stack",
    minW: 1,
    minH: 1,
    order: 8,
    build(ctx) {
      return createShelfModuleHost(ctx);
    },
  },
  {
    id: "screentime",
    titleKey: "Screen Time",
    icon: "timer",
    minW: 1,
    minH: 1,
    order: 9,
    build(ctx) {
      return createScreenTimeModuleHost(ctx);
    },
  },
  {
    id: "notifications",
    titleKey: "Notifications",
    icon: "bell",
    minW: 1,
    minH: 1,
    order: 10,
    build(ctx) {
      return createNotificationsModuleHost(ctx);
    },
  },
  {
    id: "translation",
    titleKey: "Translation",
    icon: "translate",
    minW: 1,
    minH: 1,
    order: 11,
    build(ctx) {
      return createTranslationModuleHost(ctx);
    },
  },
];

export function moduleOn(
  map: Partial<Record<string, boolean>> | undefined | null,
  id: string,
): boolean {
  if (map && id in map) {
    return Boolean(map[id]);
  }
  return Boolean(DEFAULT_SETTINGS.modules?.[id as keyof typeof DEFAULT_SETTINGS.modules] ?? false);
}

export function collapsedModuleOn(
  map: Partial<Record<string, boolean>> | undefined | null,
  id: string,
): boolean {
  if (map && id in map) {
    return Boolean(map[id]);
  }
  return Boolean(DEFAULT_SETTINGS.collapsedModules?.[id as keyof typeof DEFAULT_SETTINGS.collapsedModules] ?? false);
}

export function isModuleEnabled(id: ModuleId): boolean {
  return moduleOn(State.settings?.modules, id);
}

export function setModuleEnabled(id: ModuleId, on: boolean): void {
  State.settings.modules = {
    ...State.settings.modules,
    [id]: on,
  };
  State.notify();
}

/**
 * Normalises a saved order against a registry (defaults to MODULES):
 * 1. Preserves ordering of existing valid modules.
 * 2. Prunes any unknown/stale ids not in registry.
 * 3. Deduplicates ids (keeps first occurrence).
 * 4. Appends any missing registry modules in declaration order.
 * Never loses or duplicates any registry module.
 */
export function normalizeModuleOrder(
  savedOrder?: readonly (string | ModuleId)[],
  registry: ModuleDescriptor[] = MODULES,
): ModuleId[] {
  const regIds = registry.map((m) => m.id as ModuleId);
  const regSet = new Set<string>(regIds);
  const result: ModuleId[] = [];
  const seen = new Set<string>();

  if (savedOrder && savedOrder.length > 0) {
    for (const rawId of savedOrder) {
      const id = rawId as ModuleId;
      if (regSet.has(id) && !seen.has(id)) {
        result.push(id);
        seen.add(id);
      }
    }
  }

  for (const id of regIds) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }

  return result;
}

export function setModuleOrder(order: (string | ModuleId)[]): void {
  State.settings.moduleOrder = normalizeModuleOrder(order);
  State.notify();
}

/**
 * Resolves the default module:
 * - Returns preference if it is valid and enabled.
 * - Otherwise falls back to the first enabled module in normalized order.
 * - If all modules are disabled, falls back to the first module in order.
 */
export function resolveDefaultModule(
  preference?: string,
  enabled?: Partial<Record<string, boolean>>,
  order?: readonly (string | ModuleId)[],
  registry: ModuleDescriptor[] = MODULES,
): ModuleId {
  const normOrder = normalizeModuleOrder(order, registry);
  const map = enabled !== undefined ? enabled : State.settings?.modules;
  const isEnabled = (id: ModuleId): boolean => {
    return moduleOn(map, id);
  };

  if (preference && (normOrder as string[]).includes(preference)) {
    const prefId = preference as ModuleId;
    if (isEnabled(prefId)) {
      return prefId;
    }
  }

  for (const id of normOrder) {
    if (isEnabled(id)) {
      return id;
    }
  }

  return normOrder[0] ?? "dashboard";
}

export function setDefaultModule(id: ModuleId): void {
  State.settings.defaultModule = id;
  State.notify();
}

export const COLLAPSED_STRIP_MODULE_IDS: readonly ModuleId[] = [
  "media",
  "dashboard",
  "calendar",
  "weather",
];

export function isCollapsedStripEligible(id: ModuleId): boolean {
  return (COLLAPSED_STRIP_MODULE_IDS as readonly string[]).includes(id);
}

export function isModuleInCollapsedStrip(id: ModuleId): boolean {
  if (!isCollapsedStripEligible(id)) return false;
  if (!isModuleEnabled(id)) return false;
  return collapsedModuleOn(State.settings?.collapsedModules, id);
}

export function setModuleInCollapsedStrip(id: ModuleId, on: boolean): void {
  State.settings.collapsedModules = {
    ...State.settings.collapsedModules,
    [id]: on,
  };
  State.notify();
}

/** Orders modules by normalized order, drops disabled modules. */
export function visibleModules(
  enabled?: Partial<Record<string, boolean>>,
  order?: readonly (string | ModuleId)[],
): ModuleDescriptor[] {
  const normOrder = normalizeModuleOrder(order ?? State.settings?.moduleOrder);
  const byId = new Map(MODULES.map((m) => [m.id, m]));
  const ordered = normOrder.map((id) => byId.get(id)!).filter(Boolean);

  const map = enabled !== undefined ? enabled : State.settings?.modules;
  return ordered.filter((m) => moduleOn(map, m.id));
}

export interface DefaultIslandViewOptions {
  approvals: number;
  preference: "dashboard" | "agents" | "last";
  lastView?: IslandViewName;
}

/** Decides the view shown on a fresh island expansion. */
export function defaultIslandView(opts: DefaultIslandViewOptions): IslandViewName {
  if (opts.approvals > 0) return "approval";
  if (opts.preference === "agents") return "agents";
  if (opts.preference === "last" && opts.lastView) return opts.lastView;
  return "dashboard";
}

