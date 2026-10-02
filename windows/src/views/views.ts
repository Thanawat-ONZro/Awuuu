// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { Ticker } from "./ticker";
import { State, agentInfo, type AgentTask } from "../core/state";
import { Bridge } from "../core/bridge";
import { washRGBA, type IslandViewName, type Wash } from "../core/layout";
import { createMiniBot, pruneMiniBots } from "../mochi/minibots";
import { buildPrompt } from "./chat";
import { buildChoose, buildUpload, buildUploading } from "./upload";
import { renderIntegrationCard, type IntegrationCardHooks } from "./integrations";

export interface ViewActions {
  setView(v: IslandViewName): void;
  collapse(): void;
  setFocus(id: string): void;
  setAgentFocus(id: string): void;
  openTerminal(cwd?: string | null): void;
  /** The ↗ button: opens whatever the focused pill points at. */
  openTarget(): void;
  openUrl(url: string): void;
  /** `answers` are keyed by question text. */
  decide(d: "allow" | "deny" | "always", answers?: Record<string, string>): void;
  toggleSound(): void;
  setVolume(v: number): void;
  setAutoClose(seconds: number): void;
  openSettingsWindow(): void;
  blip(): void;
}

export interface ViewHost {
  el: HTMLElement;
  sync(): void;
  /** Called when the view becomes active, for views with a text field. */
  focus?(): void;
  /** Called every frame while the view is on screen. */
  tick?(nowMs: number): void;
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function card(wash: Wash, ...children: (Node | string)[]): HTMLElement {
  const el = h("div", { class: wash ? "card wash" : "card" }, ...children);
  if (wash) el.style.setProperty("--wash", washRGBA(wash));
  return el;
}

function btn(
  label: string,
  kind: "primary" | "secondary",
  onClick: () => void,
  kbd?: string,
  icon?: string,
): HTMLElement {
  return h(
    "button",
    { class: `btn ${kind}`, onclick: onClick },
    icon ? svg(icon, 12) : null,
    h("span", { text: label }),
    kbd ? h("span", { class: "kbd", text: kbd }) : null,
  );
}

/** AgentWho — coloured dot + task name + grey label. */
function agentWho(task: AgentTask | null, label: string): HTMLElement {
  const row = h("div", { class: "who-row" });
  if (task) {
    row.append(dot(task.color, 8), h("span", { class: "n", text: task.name }));
  }
  row.append(h("span", { text: label }));
  return row;
}

function stack(padLeft: number, padRight: number, ...children: Node[]): HTMLElement {
  const el = h("div", { class: "stack" }, ...children);
  el.style.padding = `4px ${padRight}px 4px ${padLeft}px`;
  return el;
}

// ── Header ────────────────────────────────────────────────────────────────────

// ── Header ────────────────────────────────────────────────────────────────────

export function buildHeader(actions: ViewActions): ViewHost {
  const tabHome = h("button", { class: "tab", title: "Overview (Integrations)", onclick: () => go("overview") }, svg(ICONS.kennel, 13));
  const tabAgents = h("button", { class: "tab", title: "Agent Sessions", onclick: () => go("agents") }, svg(ICONS.terminal, 13));
  const tabChat = h("button", { class: "tab", title: "Ask", onclick: () => go("prompt") }, svg(ICONS.bubble, 13));
  const tabDrop = h("button", { class: "tab", title: "Feed Awuuu a file", onclick: () => go("upload") }, svg(ICONS.bone, 13));

  const gearBtn = h("button", { title: "Settings", onclick: () => go("settings") }, svg(ICONS.gear, 14));
  const soundBtn = h("button", { title: "Mute", onclick: () => actions.toggleSound() }, svg(ICONS.speakerOn, 14));
  const collapseBtn = h(
    "button",
    {
      class: "collapse-btn",
      title: "Collapse to notch (Esc)",
      onclick: () => {
        actions.blip();
        actions.collapse();
      },
    },
    svg(ICONS.chevronUp, 13, { stroke: 2.4 }),
  );

  function go(v: IslandViewName) {
    actions.blip();
    actions.setView(v);
  }

  const el = h(
    "div",
    { id: "header" },
    h("div", { class: "tabs" }, tabAgents, tabChat, tabHome, tabDrop),
    h("div", { class: "header-actions" }, soundBtn, gearBtn, collapseBtn),
  );

  return {
    el,
    sync() {
      const v = State.view;
      tabHome.classList.toggle("on", v === "overview" || v === "empty");
      tabAgents.classList.toggle("on", v === "agents");
      tabChat.classList.toggle("on", v === "prompt");
      tabDrop.classList.toggle("on", v === "upload");
      gearBtn.classList.toggle("on", v === "settings");
      clear(gearBtn);
      gearBtn.append(svg(v === "settings" ? ICONS.gearFill : ICONS.gear, 14));
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 14));
      el.style.opacity = v === "confused" ? "0" : "1";
    },
  };
}

// ── Overview (Integrations) ──────────────────────────────────────────────────

function buildOverview(actions: ViewActions): ViewHost {
  const leftBody = h("div", { class: "left-body" });
  const jump = h(
    "button",
    { class: "icon-btn jump", title: "Open", onclick: () => actions.openTarget() },
    svg(ICONS.arrowUpRight, 8),
  );
  const left = card(null, leftBody, jump);
  const pills = h("div", { class: "pills" });
  const right = card(null, pills);

  const el = h("div", { class: "view overview" },
    h("div", { class: "left" }, left),
    h("div", { class: "right" }, right),
  );

  let pillIds = "";
  let detailOpen = false;
  let lastFocus: string | null = null;
  let cardKey = "";

  const hooks: IntegrationCardHooks = {
    get detailOpen() {
      return detailOpen;
    },
    openDetail() {
      detailOpen = true;
      cardKey = "";
      State.notify();
    },
    closeDetail() {
      detailOpen = false;
      cardKey = "";
      State.notify();
    },
    openSettings: () => actions.openSettingsWindow(),
  };

  return {
    el,
    sync() {
      const task = State.focusTask;
      if (task?.id !== lastFocus) {
        lastFocus = task?.id ?? null;
        detailOpen = false;
        cardKey = "";
      }

      if (task && task.isIntegration) {
        const info = State.integrations[task.id];
        const key = [
          task.id, detailOpen, task.state, task.steps.join("|"),
          info?.loaded, info?.error, info?.configured,
          JSON.stringify(info?.data ?? {}),
        ].join("~");
        if (key !== cardKey) {
          cardKey = key;
          clear(leftBody);
          leftBody.append(renderIntegrationCard(task, hooks));
        }
      } else {
        clear(leftBody);
        leftBody.append(
          h("div", { class: "stack", style: "padding:0 18px 0 118px;justify-content:center;gap:6px" },
            h("div", { class: "title", text: "Integrations Overview" }),
            h("div", { class: "sub", text: "Connect GitHub, Stripe, Vercel, Resend in Settings." }),
          ),
        );
      }

      jump.style.display = detailOpen ? "none" : "";

      const others = State.otherTasks.slice(0, 4);
      const pillKey = others.map((t) => `${t.id}:${t.pillBadge ?? ""}`).join("|");
      if (pillKey !== pillIds) {
        pillIds = pillKey;
        clear(pills);
        for (const t of others) pills.append(buildPill(t, actions));
        pruneMiniBots();
      }
    },
  };
}

// ── Agents Hub ───────────────────────────────────────────────────────────────

function buildAgentsHub(actions: ViewActions): ViewHost {
  const ticker = new Ticker();
  const who = h("div", { class: "who" });
  const tickerBody = h("div", { class: "card-body" }, who, ticker.el);
  const leftBody = h("div", { class: "left-body" });
  const jump = h(
    "button",
    {
      class: "icon-btn jump",
      title: "Open in VS Code / Terminal",
      onclick: () => {
        const session = State.focusedAgentSession;
        actions.openTerminal(session?.sessionCwd ?? null);
      },
    },
    svg(ICONS.arrowUpRight, 8),
  );
  const left = card(null, leftBody, jump);
  const pills = h("div", { class: "pills" });
  const right = card(null, pills);

  const el = h("div", { class: "view overview" },
    h("div", { class: "left" }, left),
    h("div", { class: "right" }, right),
  );

  let pillIds = "";
  let lastSessionId: string | null = null;

  return {
    el,
    tick(nowMs: number) {
      ticker.tick(nowMs);
    },
    sync() {
      const sessions = State.activeAgentSessions;
      const focused = State.focusedAgentSession;

      if (!focused || sessions.length === 0) {
        clear(leftBody);
        leftBody.append(
          h("div", { class: "stack", style: "padding:0 18px 0 118px;justify-content:center;gap:6px" },
            h("div", { class: "title", text: "No active agent sessions." }),
            h("div", { class: "sub", text: "Launch Claude Code or any agent in a terminal to see it here." }),
          ),
        );
        jump.style.display = "none";
        clear(pills);
        pillIds = "";
        lastSessionId = null;
        return;
      }

      jump.style.display = "";

      if (focused.id !== lastSessionId) {
        lastSessionId = focused.id;
        clear(leftBody);
        leftBody.append(tickerBody);
      }

      const agentLabel = agentInfo(focused.source).name;

      clear(who);
      who.append(
        dot(focused.color, 7),
        h("span", { class: "name", text: focused.name }),
        h("span", { class: "tool", text: agentLabel }),
      );
      if (focused.steps.length > 1) {
        who.append(h("span", {
          class: "count",
          text: `${Math.min(focused.stepIndex + 1, focused.steps.length)}/${focused.steps.length}`,
        }));
      }
      ticker.sync(focused);

      const pillKey = sessions.map((s) => `${s.id}:${s.pillBadge ?? ""}:${s.id === focused.id ? "1" : "0"}`).join("|");
      if (pillKey !== pillIds) {
        pillIds = pillKey;
        clear(pills);
        for (const s of sessions) {
          const pill = buildPill(s, {
            ...actions,
            setFocus: (id) => actions.setAgentFocus(id),
          });
          if (s.id === focused.id) {
            pill.style.background = `${s.color}24`;
            pill.style.borderColor = `${s.color}66`;
          }
          pills.append(pill);
        }
        pruneMiniBots();
      }
    },
  };
}

function buildPill(task: AgentTask, actions: ViewActions): HTMLElement {
  const label = task.name;
  const canvas = createMiniBot(task, 24);
  const tagText = agentInfo(task.source).short;
  const pill = h(
    "div",
    { class: "pill", onclick: () => actions.setFocus(task.id) },
    canvas,
    h("span", { class: "lbl", text: label }),
    !task.isIntegration
      ? h("span", {
          style: `font-size:9.5px;opacity:0.75;padding:1px 4px;border-radius:4px;background:${task.color}22;color:${task.color};font-weight:600;margin-left:auto`,
          text: tagText,
        })
      : null,
  );
  pill.style.borderColor = `${task.color}24`;
  pill.addEventListener("mouseenter", () => {
    pill.style.background = `${task.color}2e`;
    pill.style.borderColor = `${task.color}8c`;
    pill.style.boxShadow = `0 2px 10px ${task.color}59`;
    (pill.querySelector(".lbl") as HTMLElement).style.color = lighten(task.color, 0.3);
  });
  pill.addEventListener("mouseleave", () => {
    pill.style.background = "";
    pill.style.borderColor = `${task.color}24`;
    pill.style.boxShadow = "";
    (pill.querySelector(".lbl") as HTMLElement).style.color = "";
  });

  if (task.pillBadge) {
    const colors = { approval: "#F5A524", finished: "#22C55E", error: "#F4505E" } as const;
    const icons = { approval: ICONS.bang, finished: ICONS.check, error: ICONS.xmark } as const;
    const inner = h("i", { style: `background:${colors[task.pillBadge]}` }, svg(icons[task.pillBadge], 6, { stroke: task.pillBadge === "finished" ? 3 : 0 }));
    const badge = h("div", { class: "pill-badge" }, inner);
    badge.style.boxShadow = `0 0 4px ${colors[task.pillBadge]}99`;
    pill.append(badge);
  }
  return pill;
}

function lighten(hex: string, amount: number): string {
  const v = parseInt(hex.replace("#", ""), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) =>
    Math.min(255, Math.round(x + amount * 255)),
  );
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ── Empty ─────────────────────────────────────────────────────────────────────

function buildEmpty(actions: ViewActions): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px;flex-direction:row;align-items:center;gap:16px" },
    h(
      "div",
      { style: "display:flex;flex-direction:column;gap:5px" },
      h("div", { class: "title", text: "All quiet — Awuuu is on guard." }),
      h("div", { class: "sub", text: "Toss me a file or a window, or ask me anything." }),
    ),
    h("div", { class: "grow" }),
    btn("Ask Awuuu", "primary", () => actions.setView("prompt")),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Approval ──────────────────────────────────────────────────────────────────

function buildApproval(actions: ViewActions, onHeightChange: (shrinking: boolean) => void): ViewHost {
  const who = h("div");
  const code = h("div", {
    class: "code",
    style: "white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.45",
  });
  const row = h("div", { class: "actions", style: "flex-wrap:wrap;gap:8px" });
  const other = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: "Other answer…",
    spellcheck: "false",
  }) as HTMLInputElement;
  const otherSend = h("button", { class: "send-btn", title: "Send" }, svg(ICONS.arrowUp, 11));
  const otherBar = h("div", { class: "chat-bar", style: "margin-top:6px" }, other, otherSend);
  const body = stack(116, 16, who, code, row, otherBar);
  // Taller than the window allows: scroll instead of clipping the top.
  body.style.overflowY = "auto";
  body.style.justifyContent = "safe center";
  const el = h("div", { class: "view" }, card("amber", body));

  // The island grows or shrinks to the card's content (layout.approvalHeight).
  function fit() {
    const kids = [...body.children] as HTMLElement[];
    const shown = kids.filter((k) => k.style.display !== "none");
    const cs = getComputedStyle(body);
    const gap = parseFloat(cs.rowGap) || 0;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const content = shown.reduce((sum, k) => sum + k.offsetHeight, 0) + gap * Math.max(0, shown.length - 1) + pad + 16;
    if (Math.abs(content - State.approvalFit) < 3) return;
    const shrinking = content < State.approvalFit;
    State.approvalFit = content;
    onHeightChange(shrinking);
  }
  let lastReqKey = "";

  // An agent can ask several questions at once; they are answered one after
  // another and sent back together.
  let questionIndex = 0;
  let answers: Record<string, string> = {};
  let picked = new Set<string>();
  let currentRequest = "";

  // The island never takes focus on its own (WS_EX_NOACTIVATE): the text field
  // asks for it while it is being typed in, and hands it back after.
  other.addEventListener("mousedown", () => {
    void Bridge.focusWindow(true);
    window.setTimeout(() => other.focus(), 30);
  });
  other.addEventListener("blur", () => void Bridge.focusWindow(false));
  other.addEventListener("keydown", (e) => {
    if (e.key === "Enter") answerOther();
    if (e.key === "Escape") other.blur();
  });
  otherSend.addEventListener("click", () => answerOther());

  function answerOther() {
    const text = other.value.trim();
    if (!text) return;
    other.value = "";
    other.blur();
    answer(text);
  }

  function answer(text: string) {
    const req = State.pendingApproval;
    const q = req?.questions?.[questionIndex];
    if (!req || !q) return;
    answers[q.question] = text;
    picked = new Set();
    if (questionIndex + 1 < (req.questions?.length ?? 0)) {
      questionIndex++;
      lastReqKey = "";
      State.notify();
    } else {
      actions.decide("allow", answers);
    }
  }

  return {
    el,
    sync() {
      const req = State.pendingApproval;
      if (!req) return;

      if (req.requestId !== currentRequest) {
        currentRequest = req.requestId;
        questionIndex = 0;
        answers = {};
        picked = new Set();
      }

      const session = State.agentSessions.find((s) => s.id === `session_${req.sessionId}`);
      const qCount = State.approvalQueue.length > 1 ? ` (${State.approvalQueue.length} pending)` : "";
      const questions = req.isQuestion ? (req.questions ?? []) : [];
      const q = questions[questionIndex];

      clear(who);
      if (q) {
        const step = questions.length > 1 ? ` ${questionIndex + 1}/${questions.length}` : "";
        who.append(agentWho(session ?? State.focusTask, `asks a question${step}${qCount}`));
        code.textContent = q.header ? `${q.header} — ${q.question}` : q.question;
      } else {
        who.append(agentWho(session ?? State.focusTask, `needs permission${qCount}`));
        code.textContent = req.command || req.tool || "…";
      }

      const reqKey = `${req.requestId}:${q ? `q${questionIndex}:${[...picked].join("|")}` : "p"}`;
      if (lastReqKey === reqKey) return;
      lastReqKey = reqKey;

      clear(row);
      otherBar.style.display = q ? "" : "none";
      if (q) {
        for (const opt of q.options ?? []) {
          const on = picked.has(opt.label);
          const b = btn(opt.label, q.multiSelect && !on ? "secondary" : "primary", () => {
            if (!q.multiSelect) return answer(opt.label);
            if (picked.has(opt.label)) picked.delete(opt.label);
            else picked.add(opt.label);
            State.notify();
          });
          if (opt.description) b.title = opt.description;
          row.append(b);
        }
        if (q.multiSelect) {
          const done = btn(questionIndex + 1 < questions.length ? "Next" : "Send", "primary", () => {
            if (picked.size) answer([...picked].join(", "));
          });
          if (!picked.size) done.style.opacity = "0.5";
          row.append(done);
        }
        row.append(btn("Answer in terminal", "secondary", () => actions.decide("deny")));
      } else {
        row.append(
          btn("Deny", "secondary", () => actions.decide("deny"), "N"),
          btn("Allow", "primary", () => actions.decide("allow"), "Y", ICONS.paw),
          btn("Always allow", "secondary", () => actions.decide("always")),
        );
      }
      requestAnimationFrame(fit);
    },
  };
}

// ── Question ──────────────────────────────────────────────────────────────────

function buildQuestion(): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" }, card("cyan", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "Claude Code is asking a question"));
      const task = State.focusTask;
      title.textContent = task?.steps.at(-1) ?? "Claude needs an answer.";
      clear(row);
      row.append(h("div", { class: "sub", text: "Answer in your terminal — Awuuu can't reply for you yet." }));
    },
  };
}

// ── Error ─────────────────────────────────────────────────────────────────────

function buildError(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title", text: "Workflow stopped." });
  const detail = h("div", { class: "detail" });
  const row = h("div", { class: "actions" },
    btn("Retry", "primary", () => actions.setView(State.defaultView())),
    btn("Open in n8n", "secondary", () => actions.openUrl("")),
  );
  const el = h("div", { class: "view" }, card("red", stack(116, 16, who, title, detail, row)));
  return {
    el,
    sync() {
      const task = State.focusTask;
      clear(who);
      const n8n = task?.id === "integration_n8n";
      who.append(agentWho(task, n8n ? "n8n" : task ? agentInfo(task.source).name : "Agent"));
      title.textContent = n8n ? "Workflow stopped." : "Session stopped on an error.";
      detail.textContent = task?.steps.at(-1) ?? "No detail available.";
    },
  };
}

// ── Finished ──────────────────────────────────────────────────────────────────

function buildFinished(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  const row = h("div", { class: "actions" },
    btn("Open terminal", "primary", () => actions.openTerminal()),
    btn("OK", "secondary", () => actions.collapse()),
  );
  const el = h("div", { class: "view" }, card("green", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "Claude Code finished"));
      title.textContent = State.focusTask?.steps.at(-1) ?? "Session finished";
    },
  };
}

// ── Confused ──────────────────────────────────────────────────────────────────

function buildConfused(): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 128px" },
    h("div", { class: "title", text: "Too many pats at once!" }),
    h("div", { class: "sub", text: "Woof… shaking it off — back to work in three seconds." }),
  );
  return { el: h("div", { class: "view" }, card("pink", body)), sync() {} };
}

// ── Note ──────────────────────────────────────────────────────────────────────

function buildNote(): ViewHost {
  const title = h("div", { class: "title" });
  const el = h("div", { class: "view" }, card(null, h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title)));
  return {
    el,
    sync() {
      title.textContent = State.noteMessage ?? "";
    },
  };
}

// ── In-island settings ────────────────────────────────────────────────────────

function buildSettings(actions: ViewActions): ViewHost {
  const soundSwitch = h("button", { class: "switch", onclick: () => actions.toggleSound() });
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    oninput: (e: Event) => actions.setVolume(Number((e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
  const autoLabel = h("span", {});
  const segButtons = [10, 15, 30].map((s) =>
    h("button", { onclick: () => actions.setAutoClose(s) }, `${s}s`),
  );
  const claudeBadge = h("span", { class: "status-badge" });
  const apiBadge = h("span", { class: "status-badge" });

  const rows = h(
    "div",
    { class: "settings-rows" },
    h("div", { class: "settings-row" }, soundSwitch, h("span", { text: "Sound" }), volume),
    h(
      "div",
      { class: "settings-row" },
      svg(ICONS.timer, 12),
      autoLabel,
      h("div", { class: "seg" }, ...segButtons),
    ),
    h(
      "div",
      { class: "settings-row", style: "gap:14px" },
      claudeBadge,
      apiBadge,
      h("div", { class: "grow" }),
      h("button", {
        class: "link-btn",
        style: "color:#8e939c;font-size:11.5px",
        text: "Settings…",
        onclick: () => actions.openSettingsWindow(),
      }),
    ),
  );

  const el = h("div", { class: "view" },
    card(null, h("div", { class: "stack", style: "padding:14px 16px 14px 84px" }, rows)));

  return {
    el,
    sync() {
      const s = State.settings;
      soundSwitch.classList.toggle("on", s.soundEnabled);
      volume.value = String(s.soundVolume);
      volume.style.opacity = s.soundEnabled ? "1" : "0.4";
      autoLabel.textContent = `Auto-close · ${Math.round(s.autoCloseInterval)}s`;
      segButtons.forEach((b, i) => b.classList.toggle("on", s.autoCloseInterval === [10, 15, 30][i]));
      clear(claudeBadge);
      claudeBadge.append(
        dot(s.hooksInstalled ? "#22C55E" : "#F4505E", 6),
        h("span", { text: "Claude Code" }),
      );
      clear(apiBadge);
      apiBadge.append(dot("#F0645A", 6), h("span", { text: "API" }));
    },
  };
}

// ── Placeholders filled in later stages ───────────────────────────────────────

function buildPlaceholder(title: string, sub: string): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px" },
    h("div", { class: "title", text: title }),
    h("div", { class: "sub", text: sub }),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export function buildViews(
  actions: ViewActions,
  onChatHeightChange: () => void,
  onApprovalHeightChange: (shrinking: boolean) => void,
): Map<IslandViewName, ViewHost> {
  const map = new Map<IslandViewName, ViewHost>();
  map.set("overview", buildOverview(actions));
  map.set("agents", buildAgentsHub(actions));
  map.set("empty", buildEmpty(actions));
  map.set("approval", buildApproval(actions, onApprovalHeightChange));
  map.set("question", buildQuestion());
  map.set("error", buildError(actions));
  map.set("finished", buildFinished(actions));
  map.set("confused", buildConfused());
  map.set("note", buildNote());
  map.set("settings", buildSettings(actions));
  map.set("prompt", buildPrompt(onChatHeightChange));
  map.set("upload", buildUpload());
  map.set("uploading", buildUploading());
  map.set("choose", buildChoose(actions));
  // Not in the Windows v1: sending a file by email, window attach + web result.
  map.set("mail", buildPlaceholder("Sending by email isn't in this version.", ""));
  map.set("searching", buildPlaceholder("Claude is searching…", ""));
  map.set("result", buildPlaceholder("Result", ""));
  return map;
}
