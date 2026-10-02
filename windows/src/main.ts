// Entry point: boot the bridge, wire the island, start the greeting.

import "./style.css";
import { Bridge, IS_TAURI, onEvent } from "./core/bridge";
import { Sound } from "./core/sound";
import { State, type Settings } from "./core/state";
import { Island } from "./island/island";
import type { IslandLayout } from "./core/layout";
import { registerHookHandlers } from "./island/hooks";
import { registerIntegrationHandlers, refreshConfigured } from "./island/integrations";

// A script error must leave a trace in awuuu.log, or a broken view is a mystery.
window.addEventListener("error", (e) => void Bridge.log(`js error: ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => void Bridge.log(`js rejection: ${String(e.reason)}`));

async function main() {
  const root = document.getElementById("root");
  if (!root) return;

  void Sound.preload();

  const island = new Island(root);

  const boot = await Bridge.boot();
  if (boot) {
    State.settings = { ...State.settings, ...boot.settings };
  }
  island.applySettings();
  if (boot?.layout) island.setLayout(boot.layout);
  await onEvent<IslandLayout>("layout", (l) => island.setLayout(l));
  // Moving the island (grip or Alt + drag): a click must not also land on a button.
  await onEvent<boolean>("island-drag", (on) => root.classList.toggle("dragging", on));
  root.addEventListener("click", (e) => { if (e.altKey) { e.stopPropagation(); e.preventDefault(); } }, true);
  State.loadIntegrationTasks();

  await onEvent<{ x: number; y: number }>("cursor", ({ x, y }) => island.onCursor(x, y));

  /** Pause has to reach Rust too, or the pollers keep calling out. */
  const setPaused = (on: boolean) => {
    if (State.paused === on) return;
    State.paused = on;
    void Bridge.setPaused(on);
  };

  await onEvent<string>("tray", (what) => {
    switch (what) {
      case "settings":
        setPaused(false);
        island.alert("settings");
        break;
      case "open":
        setPaused(false);
        island.alert(State.defaultView());
        break;
      case "pause":
        setPaused(!State.paused);
        if (State.paused) island.fsm.forceHidden();
        else island.reveal();
        break;
    }
  });

  await onEvent<null>("screen-changed", () => void Bridge.reposition());

  // Win32 cursor poll detected notch hover or click while collapsed
  await onEvent<null>("notch-hover", () => island.onNotchHover());
  await onEvent<null>("notch-click", () => island.onNotchClick());

  // A click anywhere off the island closes it; alerts waiting for an answer stay.
  await onEvent<null>("click-outside", () => {
    if (State.mode === "expanded" && !State.isPinned) island.collapse();
  });

  // The settings window writes preferences; apply them here without a restart.
  await onEvent<Settings>("settings-changed", (s) => {
    State.settings = { ...State.settings, ...s };
    island.applySettings();
    State.loadIntegrationTasks();
    void refreshConfigured();
  });

  registerHookHandlers(island);
  registerIntegrationHandlers(island);

  island.launch();

  // In a plain browser there is no wake strip behind the cursor: make the whole
  // page wake the island so the visuals can be checked with `npm run dev`.
  if (!IS_TAURI) {
    (window as unknown as Record<string, unknown>).__awuuu = { island, State };
    document.addEventListener("click", () => Sound.resume(), { once: true });
  }
}

void main();
