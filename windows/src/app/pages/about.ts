// About Awuuu, and aw — the command-line companion.

import { Bridge } from "../../core/bridge";
import { h } from "../../views/dom";
import { pageOf } from "../ui";
import { version } from "../shell";

// ── aw: the command-line companion ──────────────────────────────────────────

function awSection(): HTMLElement {
  const state = h("span", { class: "hint" });
  const btn = h("button", {});
  let on = false;
  const draw = () => {
    state.textContent = on
      ? "aw is on your PATH — open a new terminal and run `aw claude`, `aw agy`, `aw hermes` or `aw setup <agent>`."
      : "Add Awuuu's bin folder to your user PATH to use `aw` from any terminal.";
    btn.textContent = on ? "Remove from PATH" : "Add aw to PATH";
    btn.className = on ? "danger" : "primary";
  };
  void Bridge.awPathStatus().then((v) => {
    on = v ?? false;
    draw();
  });
  btn.addEventListener("click", async () => {
    try {
      on = await Bridge.awPathSet(!on);
    } catch (err) {
      state.textContent = String(err);
      return;
    }
    draw();
  });
  draw();
  return h("section", { id: "aw" },
    h("h2", {}, h("span", { text: "aw — command line" })),
    h("div", { class: "row" }, btn, state),
    h("div", { class: "hint", text: "aw starts Awuuu when it isn't running, warns when an agent's hooks are missing, then runs the agent. `aw setup <agent>` opens this page at that agent." }),
  );
}


export function page(): HTMLElement {
  return pageOf("About & aw", "",
    h("section", {},
      h("h2", {}, h("span", { text: `Awuuu ${version()}` })),
      h("div", { class: "hint", text: "No telemetry. Network requests only go to the services you configure yourself." }),
      h("div", { class: "row" }, h("button", { text: "Check for updates", onclick: () => void Bridge.updateCheckNow() })),
    ),
    awSection());
}
