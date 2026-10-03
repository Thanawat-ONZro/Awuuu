// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { State, agentInfo, type AgentTask, type LogEntry, type LogKind } from "../core/state";
import { Bridge } from "../core/bridge";
import { washRGBA, type IslandViewName, type Wash } from "../core/layout";
import { createMiniBot, pruneMiniBots } from "../mochi/minibots";
import { buildPrompt } from "./chat";
import { buildChoose, buildUpload, buildUploading } from "./upload";
import { renderIntegrationCard, type IntegrationCardHooks } from "./integrations";
import { EXTRA_IDS, hasExtraData, renderExtraCard, renderToday, weatherChip } from "./today";
import "./hub-extra.css";
import { planHeadline } from "../island/plan";
import { refreshUsage } from "../island/usage";

export interface ViewActions {
  setView(v: IslandViewName): void;
  collapse(): void;
  setFocus(id: string): void;
  setAgentFocus(id: string): void;
  openTerminal(cwd?: string | null): void;
  /** Bring the session's own terminal window to the front (VS Code as a last resort). */
  focusTerminal(task: AgentTask): void;
  removeSession(id: string): void;
  /** Pick the island up (grip / Alt + press) — move.ts. */
  beginMove(e: PointerEvent, el: HTMLElement): void;
  /** The ↗ button: opens whatever the focused pill points at. */
  openTarget(): void;
  openUrl(url: string): void;
  /** `answers` are keyed by question text. */
  decide(d: "allow" | "deny" | "always", answers?: Record<string, string>): void;
  toggleSound(): void;
  setVolume(v: number): void;
  setAutoClose(seconds: number): void;
  /** Opens the Awuuu window: on `page` ("sessions"…), or where it was left. */
  openSettingsWindow(page?: string): void;
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

/** Three rows, each a bullet and a line: the Awuuu window's Sessions page. */
const ICON_DASHBOARD =
  "M4 5.2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm4.2.6v1.8H21V5.8H8.2zM4 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm4.2.6v1.8H21v-1.8H8.2zM4 15.8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm4.2.6v1.8H21v-1.8H8.2z";
/** A bin (stroked): clear the finished sessions. */
const ICON_CLEAR = "M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5";

export function buildHeader(actions: ViewActions): ViewHost {
  const tabHome = h("button", { class: "tab", title: "Overview (Integrations)", onclick: () => go("overview") }, svg(ICONS.kennel, 13));
  const tabAgents = h("button", { class: "tab", title: "Agent Sessions", onclick: () => go("agents") }, svg(ICONS.terminal, 13));
  const tabChat = h("button", { class: "tab", title: "Ask", onclick: () => go("prompt") }, svg(ICONS.bubble, 13));
  const tabDrop = h("button", { class: "tab", title: "Feed Awuuu a file", onclick: () => go("upload") }, svg(ICONS.bone, 13));

  // Both open the Awuuu window: the gear where it was left, the list on Sessions.
  const open = (page?: string) => () => {
    actions.blip();
    actions.openSettingsWindow(page);
  };
  const dashBtn = h("button", { title: "Dashboard", onclick: open("sessions") }, svg(ICON_DASHBOARD, 15));
  const gearBtn = h("button", { class: "gear-btn", title: "Settings", onclick: open() }, svg(ICONS.gear, 17));
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

  // Grip: press and drag to move the island (Alt + drag works anywhere on it).
  const grip = h("div", { class: "grip", title: "Drag to move the island (or Alt + drag)" },
    ...Array.from({ length: 6 }, () => h("i")));
  grip.addEventListener("pointerdown", (e) => actions.beginMove(e, grip));

  const el = h(
    "div",
    { id: "header" },
    h("div", { class: "tabs" }, tabAgents, tabChat, tabHome, tabDrop),
    grip,
    h("div", { class: "header-actions" }, soundBtn, dashBtn, gearBtn, collapseBtn),
  );

  return {
    el,
    sync() {
      const v = State.view;
      tabHome.classList.toggle("on", v === "overview" || v === "empty");
      tabAgents.classList.toggle("on", v === "agents");
      tabChat.classList.toggle("on", v === "prompt");
      tabDrop.classList.toggle("on", v === "upload");
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 14));
      soundBtn.title = State.settings.soundEnabled ? "Mute" : "Unmute";
      el.style.opacity = v === "confused" ? "0" : "1";
    },
  };
}

// ── Overview (Integrations) ──────────────────────────────────────────────────

function buildOverview(actions: ViewActions): ViewHost {
  // Today first: one list of what needs you, from every integration. Tap a
  // pill for that integration's own card; tap Today to come back.
  const pills = h("div", { class: "hub-pills" });
  const todayPill = h("button", { class: "today-pill", text: "Today" });
  todayPill.addEventListener("click", () => {
    State.overviewToday = true;
    cardKey = "";
    actions.blip();
    State.notify();
  });
  const weather = h("span", { class: "today-weather-slot" });
  const body = h("div", { class: "today-body" });
  const wrap = h("div", { class: "hub today-wrap" },
    h("div", { class: "hub-pill-row" }, todayPill, pills, weather),
    body,
  );
  const el = h("div", { class: "view hub-view overview" }, card(null, wrap));

  let pillKey = "";
  let cardKey = "";
  let detailOpen = false;

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
      const tasks = State.tasks.filter((t) => t.isIntegration);
      const focused = State.overviewToday ? null : State.focusTask?.isIntegration ? State.focusTask : null;
      todayPill.classList.toggle("on", !focused);

      const nextPills = tasks.map((t) => `${t.id}:${t.pillBadge ?? ""}:${focused?.id === t.id ? 1 : 0}`).join("|");
      if (nextPills !== pillKey) {
        pillKey = nextPills;
        clear(pills);
        for (const t of tasks) {
          pills.append(buildPill(t, {
            ...actions,
            setFocus: (id) => {
              State.overviewToday = false;
              detailOpen = false;
              actions.setFocus(id);
            },
          }, focused?.id === t.id));
        }
        pruneMiniBots();
      }

      const w = weatherChip();
      clear(weather);
      if (w) weather.append(w);

      const key = focused
        ? [focused.id, detailOpen, focused.state, focused.steps.join("|"), JSON.stringify(State.integrations[focused.id] ?? {})].join("~")
        : `today~${JSON.stringify(State.integrations)}~${Math.floor(Date.now() / 30000)}`;
      if (key === cardKey) return;
      cardKey = key;
      clear(body);
      if (!focused) {
        body.append(renderToday(() => actions.openSettingsWindow()));
      } else if (EXTRA_IDS.has(focused.id)) {
        const info = State.integrations[focused.id];
        body.append(hasExtraData(focused.id)
          ? renderExtraCard(focused.id)
          : h("div", { class: "today-sub", text: info?.error ?? (info?.configured ? "Loading…" : "Not set up — see Settings.") }));
      } else {
        body.append(renderIntegrationCard(focused, hooks));
      }
      el.style.setProperty("--agent", focused?.color ?? "#C9956A");
      el.style.setProperty("--agent-soft", `${focused?.color ?? "#C9956A"}33`);
    },
  };
}

// ── Agents Hub ───────────────────────────────────────────────────────────────


function buildAgentsHub(actions: ViewActions): ViewHost {
  // One full-width column: sessions on top, then what the focused one is
  // doing — readable without opening the terminal.
  const pills = h("div", { class: "hub-pills" });
  const who = h("div", { class: "hub-who" });
  const steps = h("div", { class: "hub-steps" });
  const jump = h(
    "button",
    {
      class: "icon-btn",
      title: "Go to this session's terminal",
      onclick: () => {
        const s = State.focusedAgentSession;
        if (s) actions.focusTerminal(s);
      },
    },
    svg(ICONS.arrowUpRight, 9),
  );
  // Many sessions: the row scrolls sideways, the wheel included.
  pills.addEventListener("wheel", (e) => {
    if (pills.scrollWidth <= pills.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    pills.scrollLeft += e.deltaY;
  }, { passive: false });
  // Sessions that are done can be cleared in one go.
  const clearDone = h("button", {
    class: "hub-clear",
    title: "Clear finished — remove sessions that are idle or finished",
    onclick: () => {
      for (const s of [...State.activeAgentSessions]) {
        if (["idle", "finished", "error"].includes(s.state)) actions.removeSession(s.id);
      }
    },
  }, svg(ICON_CLEAR, 14, { stroke: 1.9 }));
  const empty = h("div", { class: "hub-empty" },
    h("div", { class: "title", text: "No active agent sessions." }),
    h("div", { class: "sub", text: "Start Claude Code, AGY, Hermes, OpenCode or Codex and it shows up here." }),
  );
  // A request waiting for an answer is never hidden behind the hub.
  const waiting = h("button", { class: "hub-waiting", onclick: () => actions.setView("approval") });
  const pillRow = h("div", { class: "hub-pill-row" }, pills, clearDone);
  // Who is focused, then room for more on the same line (plan step, usage…), then the jump.
  const usage = h("div", { class: "hub-usage" });
  const head = h("div", { class: "hub-head" }, who, usage, jump);
  // The plan the focused agent is working through: "2/4 · what it is doing".
  const planBar = h("i", {});
  const planText = h("span", { class: "txt" });
  const plan = h("div", { class: "hub-plan" }, h("span", { class: "meter" }, planBar), planText);
  const body = h("div", { class: "hub" }, pillRow, waiting, head, plan, steps, empty);
  let usageKey = "";
  let usageAsked = 0;
  const el = h("div", { class: "view hub-view" }, card(null, body));

  let pillKey = "";
  let stepsKey = "";
  let lastStepsFocus = "";
  // The log follows the newest line unless the user scrolled up to read.
  let readingBack = false;
  let programmatic = false;
  const toBottom = () => {
    programmatic = true;
    steps.scrollTop = steps.scrollHeight;
    requestAnimationFrame(() => (programmatic = false));
  };
  steps.addEventListener("scroll", () => {
    if (programmatic || steps.clientHeight < 40) return;
    readingBack = steps.scrollHeight - steps.scrollTop - steps.clientHeight > 24;
  });
  // The island opens, closes and gets resized under the log: stay on the newest line.
  new ResizeObserver(() => {
    if (!readingBack) toBottom();
  }).observe(steps);

  return {
    el,
    sync() {
      const sessions = State.activeAgentSessions;
      const focused = State.focusedAgentSession;
      const nWaiting = State.approvalQueue.length;
      waiting.style.display = nWaiting ? "" : "none";
      waiting.textContent = nWaiting === 1 ? "1 request waiting for you — Review" : `${nWaiting} requests waiting for you — Review`;
      const none = !focused || sessions.length === 0;
      empty.style.display = none ? "" : "none";
      for (const part of [pillRow, head, steps]) part.style.display = none ? "none" : "";
      if (none) plan.style.display = "none";
      if (none) {
        pillKey = stepsKey = "";
        clear(pills);
        return;
      }
      // The whole hub takes the focused agent's colour (Claude orange, AGY blue…).
      el.style.setProperty("--agent", focused.color);
      el.style.setProperty("--agent-soft", `${focused.color}33`);
      el.style.setProperty("--agent-ink", lighten(focused.color, 0.35));

      clear(who);
      const folder = focused.sessionCwd ? focused.sessionCwd.replace(/[\\/]+$/, "") : "";
      who.append(
        dot(focused.color, 8),
        h("span", { class: "name", text: focused.name }),
        h("span", { class: "hub-tag", text: agentInfo(focused.source).short }),
        h("span", { class: "tool", text: stateLabel(focused.state) }),
      );
      if (folder) who.title = folder;

      const headline = planHeadline(focused.plan);
      plan.style.display = headline ? "" : "none";
      if (headline && focused.plan) {
        planText.textContent = headline;
        planBar.style.width = `${Math.round((focused.plan.done / Math.max(1, focused.plan.total)) * 100)}%`;
        plan.title = focused.plan.items
          .map((i) => `${i.status === "completed" ? "✓" : i.status === "in_progress" ? "▸" : "·"} ${i.text}`)
          .join("\n");
      }

      // Plan limits of the focused agent, when it reports them (Claude, Codex).
      // Asked again at most once a minute, and only while the hub is looked at.
      if (State.mode === "expanded" && Date.now() - usageAsked > 60_000) {
        usageAsked = Date.now();
        void refreshUsage();
      }
      const mine = State.usage.find((u) => u.agent === focused.source);
      const nextUsage = mine ? JSON.stringify(mine.limits) : "";
      if (nextUsage !== usageKey) {
        usageKey = nextUsage;
        clear(usage);
        for (const l of mine?.limits ?? []) usage.append(limitChip(l));
      }

      const log = focused.log ?? [];
      const key = `${focused.id}:${log.length}:${log.at(-1)?.at ?? 0}:${focused.state}:${Math.floor(Date.now() / 30000)}:${State.settings.logLines}`;
      body.classList.toggle("hide-think", State.settings.showThinking === false);
      body.classList.toggle("hide-time", State.settings.showTime === false);
      body.style.setProperty("--hub-scale", String(State.settings.hubScale || 1));
      if (key !== stepsKey) {
        stepsKey = key;
        clear(steps);
        const n = State.settings.logLines || 80;
        const recent = log.slice(-n);
        if (recent.length === 0) steps.append(h("div", { class: "hub-step dim", text: "Waiting for the first step…" }));
        recent.forEach((entry, i) => {
          const last = i === recent.length - 1;
          const live = last && ["working", "thinking"].includes(focused.state);
          steps.append(logRow(entry, last, live));
        });
        if (focused.id !== lastStepsFocus) readingBack = false;
        if (!readingBack) toBottom();
        lastStepsFocus = focused.id;
      }

      clearDone.style.display = sessions.some((s) => ["idle", "finished", "error"].includes(s.state)) ? "" : "none";
      const nextPillKey = sessions.map((s) => `${s.id}:${s.name}:${s.pillBadge ?? ""}:${s.id === focused.id ? "1" : "0"}:${planCount(s)}`).join("|");
      if (nextPillKey !== pillKey) {
        const at = pills.scrollLeft;
        pillKey = nextPillKey;
        clear(pills);
        let shown: HTMLElement | null = null;
        for (const s of sessions) {
          const pill = buildPill(s, { ...actions, setFocus: (id) => actions.setAgentFocus(id) }, s.id === focused.id, () => actions.removeSession(s.id));
          if (s.id === focused.id) shown = pill;
          pills.append(pill);
        }
        // Rebuilt where it was scrolled to, with the focused pill in view (the
        // focus can move from elsewhere: an alert, "Show log").
        pills.scrollLeft = at;
        if (shown) {
          const left = shown.offsetLeft;
          const right = left + shown.offsetWidth;
          if (left < pills.scrollLeft) pills.scrollLeft = left - 6;
          else if (right > pills.scrollLeft + pills.clientWidth) pills.scrollLeft = right - pills.clientWidth + 6;
        }
        pruneMiniBots();
      }
    },
  };
}

/** "2/4" for a session with a plan still under way. */
function planCount(task: AgentTask): string {
  const p = task.plan;
  return p && p.total > 0 && p.done < p.total ? `${Math.min(p.done + 1, p.total)}/${p.total}` : "";
}

function resetText(at: number | null): string {
  if (!at) return "";
  const min = Math.round((at - Date.now()) / 60_000);
  if (min <= 0) return "resets now";
  if (min < 60) return `resets in ${min} min`;
  if (min < 24 * 60) return `resets in ${Math.floor(min / 60)}h ${min % 60}m`;
  return `resets ${new Date(at).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}`;
}

/** One plan limit: a small ring, what is left, and when it resets (tooltip). */
function limitChip(l: { label: string; usedPercent: number; resetsAt: number | null }): HTMLElement {
  const used = Math.max(0, Math.min(100, l.usedPercent));
  const left = Math.round(100 - used);
  const tone = used >= 90 ? "hot" : used >= 70 ? "warm" : "";
  const chip = h("span", { class: `limit-chip ${tone}`.trim() },
    h("i", { class: "ring", style: `--used:${used}` }),
    h("span", { text: `${l.label} ${left}% left` }));
  chip.title = [`${l.label} limit: ${Math.round(used)}% used`, resetText(l.resetsAt)].filter(Boolean).join(" · ");
  return chip;
}

const LOG_MARK: Record<LogKind, string> = {
  prompt: "›", sent: "›", tool: "▸", say: "●", think: "∴", done: "✓", error: "!", info: "·",
};

function logRow(entry: LogEntry, last: boolean, live: boolean): HTMLElement {
  return h(
    "div",
    { class: `hub-step k-${entry.kind}${last ? " now" : ""}`, title: entry.text },
    h("span", { class: "mark", text: LOG_MARK[entry.kind] }),
    h("span", { class: live ? "txt shimmer" : "txt", text: entry.text }),
    h("span", { class: "ago", text: ago(entry.at) }),
  );
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 45) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

function stateLabel(state: string): string {
  switch (state) {
    case "working": return "working";
    case "thinking": return "thinking";
    case "approval": return "waiting for you";
    case "question": return "has a question";
    case "finished": return "finished";
    case "error": return "error";
    case "ratelimit": return "rate limited";
    default: return "idle";
  }
}

function buildPill(task: AgentTask, actions: ViewActions, focused = false, onRemove?: () => void): HTMLElement {
  const label = task.name;
  const canvas = createMiniBot(task, 24);
  const tagText = agentInfo(task.source).short;
  const pill = h(
    "div",
    { class: focused ? "pill focused" : "pill", onclick: () => actions.setFocus(task.id) },
    canvas,
    h("span", { class: "lbl", text: label, title: label }),
    !task.isIntegration && planCount(task) ? h("span", { class: "pill-plan", text: planCount(task) }) : null,
  );
  // The end of a session pill: the agent's tag, which gives its place to the
  // × while the pill is hovered — same slot, so the pill never changes width.
  if (!task.isIntegration) {
    const end = h("span", { class: "pill-end" },
      h("span", { class: "pill-tag", style: `background:${task.color}22;color:${task.color}`, text: tagText }));
    if (onRemove) {
      const x = h("button", { class: "pill-x", title: "Remove this session" }, svg(ICONS.xmark, 8, { stroke: 2.6 }));
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        onRemove();
      });
      end.append(x);
      end.classList.add("removable");
    }
    pill.append(end);
  }
  const lbl = pill.querySelector(".lbl") as HTMLElement;
  // Resting look: the focused pill keeps its agent colour after the mouse
  // leaves, so you can always tell which session the hub is showing.
  const rest = () => {
    pill.style.background = focused ? `${task.color}2b` : "";
    pill.style.borderColor = focused ? `${task.color}99` : `${task.color}24`;
    pill.style.boxShadow = focused ? `0 0 0 1px ${task.color}40, 0 2px 10px ${task.color}40` : "";
    lbl.style.color = focused ? lighten(task.color, 0.35) : "";
  };
  rest();
  pill.addEventListener("mouseenter", () => {
    pill.style.background = `${task.color}2e`;
    pill.style.borderColor = `${task.color}8c`;
    pill.style.boxShadow = `0 2px 10px ${task.color}59`;
    lbl.style.color = lighten(task.color, 0.3);
  });
  pill.addEventListener("mouseleave", rest);

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

// ── Error ─────────────────────────────────────────────────────────────────────

function buildError(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title", text: "Workflow stopped." });
  const detail = h("div", { class: "detail" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" }, card("red", stack(116, 16, who, title, detail, row)));
  let rowKey = "";
  return {
    el,
    sync() {
      const task = State.alertTask;
      clear(who);
      const n8n = task?.id === "integration_n8n";
      who.append(agentWho(task, n8n ? "n8n" : task ? agentInfo(task.source).name : "Agent"));
      title.textContent = n8n ? "Workflow stopped." : "Session stopped on an error.";
      detail.textContent = task?.steps.at(-1) ?? "No detail available.";
      const key = `${task?.id}:${n8n}`;
      if (key === rowKey) return;
      rowKey = key;
      clear(row);
      if (n8n) {
        row.append(
          btn("Retry", "primary", () => actions.setView(State.defaultView())),
          btn("Open in n8n", "secondary", () => actions.openUrl("")),
        );
      } else {
        row.append(
          btn("Show log", "primary", () => {
            if (task) actions.setAgentFocus(task.id);
            actions.setView("agents");
          }),
          btn("Open terminal", "secondary", () => (task ? actions.focusTerminal(task) : actions.openTerminal(null))),
        );
      }
    },
  };
}

// ── Finished ──────────────────────────────────────────────────────────────────

function buildFinished(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  const row = h("div", { class: "actions" },
    btn("Open terminal", "primary", () => {
      const t = State.alertTask;
      if (t && !t.isIntegration) actions.focusTerminal(t);
      else actions.openTerminal(t?.sessionCwd ?? null);
    }),
    btn("OK", "secondary", () => actions.collapse()),
  );
  const el = h("div", { class: "view" }, card("green", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      const task = State.alertTask;
      who.append(agentWho(task, task && !task.isIntegration ? `${agentInfo(task.source).name} finished` : "Finished"));
      title.textContent = task?.steps.at(-1) ?? "Session finished";
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

  // Quick toggles only (reached from the tray); everything else lives in the
  // Awuuu window.
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
  );

  const el = h("div", { class: "view" },
    card(null, h("div", { class: "stack", style: "padding:14px 16px 14px 84px;flex-direction:row;align-items:center;justify-content:flex-start;gap:16px" },
      rows,
      h("div", { class: "grow" }),
      btn("Open Awuuu…", "secondary", () => actions.openSettingsWindow()),
    )));

  return {
    el,
    sync() {
      const s = State.settings;
      soundSwitch.classList.toggle("on", s.soundEnabled);
      volume.value = String(s.soundVolume);
      volume.style.opacity = s.soundEnabled ? "1" : "0.4";
      autoLabel.textContent = `Auto-close · ${Math.round(s.autoCloseInterval)}s`;
      segButtons.forEach((b, i) => b.classList.toggle("on", s.autoCloseInterval === [10, 15, 30][i]));
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
