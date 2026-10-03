// The Awuuu window — dashboard and settings in one place. Anything that writes
// to disk outside Awuuu's own folder is confirmed here first.

import "../settings/settings.css";
import "./app.css";
import { Bridge, onEvent } from "../core/bridge";
import type { Settings } from "../core/state";
import { layoutRefreshers, settings } from "./ui";
import { mountShell, navigateFromEvent, type PageId } from "./shell";

async function main() {
  const boot = await Bridge.boot();
  if (boot) Object.assign(settings, boot.settings);

  let first: PageId = settings.onboarded ? "sessions" : "welcome";
  try {
    const last = localStorage.getItem("awuuu_page") as PageId | null;
    if (last && settings.onboarded) first = last;
  } catch {
    /* private mode */
  }
  mountShell(document.getElementById("settings-root")!, boot?.version ?? "", first);

  // `aw setup <agent>`, the tray and the island's gear: open at a page.
  void onEvent<string>("settings-focus", (target) => navigateFromEvent(target));

  void onEvent<Settings>("settings-changed", (s) => {
    Object.assign(settings, s);
    layoutRefreshers.forEach((f) => f());
  });
}

void main();
