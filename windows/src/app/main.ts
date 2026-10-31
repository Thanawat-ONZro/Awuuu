// The Awuuu window — dashboard and settings in one place. Anything that writes
// to disk outside Awuuu's own folder is confirmed here first.

import "../core/tokens.css";
import "../core/motion.css";
import "../settings/settings.css";
import "./app.css";
import { Bridge, onEvent } from "../core/bridge";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
import { resolveModuleSettings } from "../core/module-settings";
import { layoutRefreshers, settings } from "./ui";
import { applyAccent } from "../core/accent";
import { setLanguage, currentLanguage } from "../i18n/i18n";
import { setOutfitSelection } from "../mochi/outfits";
import { mountShell, rebuildShell, navigateFromEvent, type PageId } from "./shell";

async function main() {
  const boot = await Bridge.boot();
  if (boot) {
    Object.assign(settings, boot.settings, {
      modules: resolveModuleSettings(boot.settings),
      collapsedModules: { ...DEFAULT_SETTINGS.collapsedModules, ...(boot.settings?.collapsedModules ?? {}) },
    });
  }

  let first: PageId = settings.onboarded ? "sessions" : "welcome";
  try {
    const last = localStorage.getItem("awuuu_page") as PageId | null;
    if (last && settings.onboarded) first = last;
  } catch {
    /* private mode */
  }
  setLanguage(settings.language);
  applyAccent(settings.dog);
  setOutfitSelection(settings.outfit);
  mountShell(document.getElementById("settings-root")!, boot?.version ?? "", first);

  // `aw setup <agent>`, the tray and the island's gear: open at a page.
  void onEvent<string>("settings-focus", (target) => navigateFromEvent(target));

  void onEvent<Settings>("settings-changed", (s) => {
    Object.assign(settings, s, {
      modules: resolveModuleSettings(s),
      collapsedModules: { ...DEFAULT_SETTINGS.collapsedModules, ...(s?.collapsedModules ?? {}) },
    });
    const before = currentLanguage();
    if (setLanguage(settings.language) !== before) rebuildShell();
    applyAccent(settings.dog);
    setOutfitSelection(settings.outfit);
    layoutRefreshers.forEach((f) => f());
  });
}

void main();
