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
      navigate("modules");
    },
  });

  const section = h(
    "section",
    { id: "welcome", class: "welcome" },
    h("h2", {}, h("span", { text: t("Welcome to Awuuu") })),
    h("div", {
      class: "hint",
      text: t("Awuuu lives on the edge of your screen. Hover the little tab to wake it, click to open, and drag the ⋮⋮ grip (or Alt + drag) to move it."),
    }),
    h("h3", { text: t("1 · Use what is ready") }),
    h("div", { class: "hint", text: t("Music controls, notes, to-dos, quick toggles and the temporary file shelf work on this PC without an account. Open the island to try them. Shelf files stay local and are removed after seven days.") }),
    h("div", { class: "row" }, h("button", { text: t("Choose features"), onclick: () => void navigate("modules") })),
    h("h3", { text: t("2 · Connect a coding agent (optional)") }),
    h("div", {
      class: "hint",
      text: t("If you use a supported coding agent, choose Set up below to install its hook once. Awuuu shows the change and keeps a dated backup. You can skip this and still use the local features."),
    }),
    agents,
    h("div", {
      class: "hint",
      text: t("Some agents ask once before running new hooks: Hermes (answer its prompt, or run `hermes hooks list`), Codex (run /hooks). OpenCode loads its plugin when it restarts."),
    }),
    h("h3", { text: t("3 · Add online features only when needed") }),
    h("div", { class: "hint", text: t("Weather needs a city and internet. Calendar, mail, translation and developer services need a source or account. Open Features to see the shortest setup path for each one.") }),
    h("div", { class: "row" }, h("button", { text: t("Open integrations"), onclick: () => void navigate("integrations") })),
    h("h3", { text: t("Optional · aw command") }),
    h("div", {
      class: "hint",
      text: t("aw is a command you can type instead of the agent's name — `aw claude`, `aw agy`, `aw hermes`… It starts Awuuu if it isn't running, checks that agent's hook and offers to set it up, then runs the agent. The hooks do the real work; aw only makes sure they are there. `aw status` lists what is connected."),
    }),
    h("div", { class: "row" }, awBtn, awState),
    h("h3", { text: t("Try an agent session") }),
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
