// Getting started: what Awuuu needs, in plain words.

import { Bridge } from "../../core/bridge";
import { h, clear } from "../../views/dom";
import { navigate } from "../shell";
import { pageOf, save, settings } from "../ui";
import { t } from "../../i18n/i18n";

// ── Welcome: what Awuuu needs, in plain words ──────────────────────────────

function welcomeSection(): HTMLElement {
  const agents = h("div", { class: "welcome-agents" });
  const awState = h("span", { class: "hint" });
  const awBtn = h("button", {});
  let awOn = false;
  const drawAw = () => {
    awBtn.textContent = awOn ? t("aw is on your PATH ✓") : t("Add aw to PATH");
    awBtn.className = awOn ? "" : "primary";
    (awBtn as HTMLButtonElement).disabled = awOn;
    awState.textContent = awOn ? t("Open a new terminal and try `aw claude`.") : "";
  };
  awBtn.addEventListener("click", async () => {
    try {
      awOn = await Bridge.awPathSet(true);
    } catch (err) {
      awState.textContent = String(err);
    }
    drawAw();
  });
  void Bridge.awPathStatus().then((v) => {
    awOn = v ?? false;
    drawAw();
  });

  async function drawAgents() {
    const found = (await Bridge.detectAgents()) ?? [];
    clear(agents);
    for (const a of found) {
      const status = !a.present
        ? h("span", { class: "hint", text: t("not on this PC") })
        : a.hooksInstalled
        ? h("span", { class: "welcome-ok", text: t("connected ✓") })
        : h("span", { class: "welcome-todo", text: t("not connected yet") });
      const setUp = h("button", {
        text: a.hooksInstalled ? t("Manage") : t("Set up"),
        class: a.present && !a.hooksInstalled ? "primary" : "",
        onclick: () => navigate("agents", `agent-${a.id}`),
      });
      if (!a.present) (setUp as HTMLButtonElement).disabled = true;
      agents.append(h("div", { class: "row" }, h("label", { text: a.name }), status, setUp));
    }
  }
  void drawAgents();

  const done = h("button", {
    class: "primary",
    text: t("Got it"),
    onclick: async () => {
      settings.onboarded = true;
      await save();
      navigate("agents");
    },
  });

  const section = h(
    "section",
    { id: "welcome", class: "welcome" },
    h("h2", {}, h("span", { text: t("Welcome to Awuuu") })),
    h("div", {
      class: "hint",
      text: t("Awuuu lives on the edge of your screen and keeps an eye on your coding agents. Hover the little tab to wake it, click to open, drag the ⋮⋮ grip (or Alt + drag) to put it on any edge, and drop files on it."),
    }),
    h("h3", { text: t("1 · Connect your agents — hooks") }),
    h("div", {
      class: "hint",
      text: t("An agent tells Awuuu what it is doing through a hook: a small entry in that agent's own settings that calls Awuuu's relay. You install it once per agent, from this page — Awuuu shows exactly what changes and keeps a dated backup. Without its hook, Awuuu can't see that agent."),
    }),
    agents,
    h("div", {
      class: "hint",
      text: t("Some agents ask once before running new hooks: Hermes (answer its prompt, or run `hermes hooks list`), Codex (run /hooks). OpenCode loads its plugin when it restarts."),
    }),
    h("h3", { text: t("2 · aw — an optional shortcut") }),
    h("div", {
      class: "hint",
      text: t("aw is a command you can type instead of the agent's name — `aw claude`, `aw agy`, `aw hermes`… It starts Awuuu if it isn't running, checks that agent's hook and offers to set it up, then runs the agent. The hooks do the real work; aw only makes sure they are there. `aw status` lists what is connected."),
    }),
    h("div", { class: "row" }, awBtn, awState),
    h("h3", { text: t("3 · Try it") }),
    h("div", {
      class: "hint",
      text: t("Start a session in any connected agent: its steps appear in the island's terminal page, questions and permission requests pop up as cards you answer with a click, and \"Open terminal\" takes you back to that session's window."),
    }),
    h("div", { class: "row" }, done),
  );
  return section;
}


export function page(): HTMLElement {
  return pageOf(t("Getting started"), "", welcomeSection());
}
