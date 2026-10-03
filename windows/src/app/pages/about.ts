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


/** "Check my setup": every reason Awuuu might stay quiet, with the fix (doctor.rs). */
function doctorSection(): HTMLElement {
  const list = h("div", { class: "doctor" });
  const run = h("button", { class: "primary", text: "Check my setup" });
  run.addEventListener("click", async () => {
    run.setAttribute("disabled", "");
    run.textContent = "Checking…";
    list.replaceChildren();
    const checks = (await Bridge.doctor()) ?? [];
    for (const c of checks) {
      const mark = c.level === "ok" ? "✓" : c.level === "warn" ? "!" : "✕";
      list.append(h("div", { class: `doctor-row d-${c.level}` },
        h("span", { class: "doctor-mark", text: mark }),
        h("span", { class: "doctor-main" },
          h("b", { text: c.name }), ` ${c.detail}`,
          c.fix ? h("div", { class: "hint", text: c.fix }) : null)));
    }
    if (checks.length === 0) list.append(h("div", { class: "hint", text: "Nothing to check outside the app." }));
    run.removeAttribute("disabled");
    run.textContent = "Check again";
  });
  return h("section", {},
    h("h2", {}, h("span", { text: "Check my setup" })),
    h("div", { class: "hint", text: "Agents connected, the hook relay, Hermes, git and the aw command. Read-only: nothing is changed." }),
    h("div", { class: "row" }, run),
    list);
}

export function page(): HTMLElement {
  return pageOf("About & aw", "",
    h("section", {},
      h("h2", {}, h("span", { text: `Awuuu ${version()}` })),
      h("div", { class: "hint", text: "No telemetry. Network requests only go to the services you configure yourself." }),
      h("div", { class: "row" }, h("button", { text: "Check for updates", onclick: () => void Bridge.updateCheckNow() })),
    ),
    doctorSection(),
    awSection());
}
