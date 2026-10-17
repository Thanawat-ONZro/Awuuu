// Quick toggles module for Awuuu's notch dashboard.
// Bluetooth, Wi-Fi, Do-not-disturb, Never sleep.
// Idle = 0 % CPU: polls nothing — reads state on open and on click.
// Toggles must never lie: displays the real state read back after a change.

import { clear, h, svg } from "../dom";
import { ICONS } from "../icons";
import { Bridge } from "../../core/bridge";
import { t } from "../../i18n/i18n";
import type { ModuleCtx, ModuleHost } from "../../core/modules";

// NOTE: Do-Not-Disturb (DND) was removed because toggles must never lie or write
// outside %LOCALAPPDATA%\Awuuu\ without an owner decision on Focus Assist APIs.

export type ToggleKind = "bluetooth" | "wifi" | "never_sleep";

export function createTogglesModuleHost(_ctx?: ModuleCtx): ModuleHost {
  const el = h("div", { class: "widget widget-toggles", style: "user-select:none;" });

  const state: Record<ToggleKind, boolean> = {
    bluetooth: false,
    wifi: false,
    never_sleep: false,
  };

  const pending: Partial<Record<ToggleKind, boolean>> = {};

  const items: Array<{ kind: ToggleKind; label: string; icon: keyof typeof ICONS }> = [
    { kind: "bluetooth", label: t("Bluetooth"), icon: "bluetooth" },
    { kind: "wifi", label: t("Wi-Fi"), icon: "wifi" },
    { kind: "never_sleep", label: t("Never Sleep"), icon: "coffee" },
  ];

  function render() {
    clear(el);

    const head = h(
      "div",
      {
        class: "toggles-head",
        style: "display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;",
      },
      h(
        "div",
        { style: "display:flex; align-items:center; gap:6px;" },
        svg(ICONS.toggle, 14),
        h("span", { text: t("Quick Toggles"), style: "font-weight:600; font-size:12px; letter-spacing:0.02em;" }),
      ),
    );
    el.append(head);

    const grid = h("div", {
      class: "toggles-grid",
      style: "display:grid; grid-template-columns:repeat(3, 1fr); gap:6px;",
    });

    for (const item of items) {
      const active = state[item.kind];
      const isPending = pending[item.kind];

      const btn = h(
        "button",
        {
          class: `toggle-btn toggle-${item.kind}${active ? " is-active" : ""}${isPending ? " is-pending" : ""}`,
          title: item.label,
          style: `display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; padding:8px 4px; border-radius:8px; border:1px solid ${
            active ? "var(--accent,#38bdf8)" : "rgba(255,255,255,0.08)"
          }; background:${
            active ? "rgba(56, 189, 248, 0.16)" : "rgba(255,255,255,0.04)"
          }; color:${
            active ? "var(--accent,#38bdf8)" : "inherit"
          }; cursor:pointer; opacity:${isPending ? "0.5" : "1"};`,
          onclick: () => {
            void toggle(item.kind);
          },
        },
        svg(ICONS[item.icon] ?? ICONS.toggle, 16),
        h("span", {
          text: item.label,
          style: "font-size:10px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100%;",
        }),
      );

      grid.append(btn);
    }

    el.append(grid);
  }

  async function toggle(kind: ToggleKind) {
    if (pending[kind]) return;
    const target = !state[kind];
    pending[kind] = true;
    render();

    try {
      const realState = await Bridge.toggleSet(kind, target);
      if (typeof realState === "boolean") {
        state[kind] = realState;
      }
    } catch {
      // Toggle refused or error: re-read real state
      try {
        const current = await Bridge.toggleGet(kind);
        if (typeof current === "boolean") {
          state[kind] = current;
        }
      } catch {
        // keep as is
      }
    } finally {
      delete pending[kind];
      render();
    }
  }

  async function readAll() {
    try {
      const [bt, wf, ns] = await Promise.all([
        Bridge.toggleGet("bluetooth"),
        Bridge.toggleGet("wifi"),
        Bridge.toggleGet("never_sleep"),
      ]);

      if (typeof bt === "boolean") state.bluetooth = bt;
      if (typeof wf === "boolean") state.wifi = wf;
      if (typeof ns === "boolean") state.never_sleep = ns;
    } catch {
      // Keep existing state
    }
    render();
  }

  render();

  return {
    el,
    refresh() {
      return readAll();
    },
    dispose() {
      // no background resources to dispose
    },
  };
}
