// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView from
// IslandViewContent.swift.

import { h, svg, clear } from "./dom";
import { renderMarkdown, type RenderOptions } from "./markdown";
import { todayRows } from "./today";
import { awarenessNote } from "../island/awareness";
import { ICONS } from "./icons";
import { Bridge, IS_TAURI, onEvent, type ChatContext } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, type ChatMessage } from "../core/state";
import { dropdown, type SelectOption } from "../ui/select";
import { clearOfDog, syncFileChips } from "./upload";
import type { ViewHost } from "./views";
import "./drop-chat.css";

let nextId = 1;

/** The assistant bubble being filled by a streamed reply, if any. */
let streaming: ChatMessage | null = null;

// Rust pushes the whole reply so far on every streamed piece.
void onEvent<string>("chat-delta", (text) => {
  if (!streaming) {
    streaming = { id: nextId++, role: "assistant", content: "" };
    State.chatHistory.push(streaming);
    State.stateOverride = null; // the bubble replaces the typing dots
  }
  streaming.content = text;
  State.notify();
});

// ── Who can answer ──────────────────────────────────────────────────────────
// Only what is connected is offered: Hermes when its gateway answers or its key
// is set, Claude when an Anthropic key is saved, and the providers added in
// Settings. Asked when the chat opens and when a key changes — never on a timer.

let probing = false;

async function probeBackends() {
  if (!IS_TAURI) {
    // Nothing to ask in a plain browser: offer both, so the pickers can be looked at.
    State.chatBackends ??= { hermes: true, claude: true };
    State.notify();
    return;
  }
  if (probing) return;
  probing = true;
  const [claude, hermes] = await Promise.all([
    Bridge.secretPresent("anthropic-api-key").then((v) => v === true),
    // A gateway that is down but has its key is still Hermes: sending says it can't be reached.
    Bridge.hermesStatus().then(() => true, (err) => !/key missing/i.test(String(err))),
  ]);
  probing = false;
  State.chatBackends = { hermes, claude };
  State.notify();
}

void onEvent<null>("secrets-changed", () => {
  if (State.mode === "expanded" && State.view === "prompt") void probeBackends();
});

const CLAUDE_MODELS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];
const EFFORTS: SelectOption[] = [
  { value: "", label: "Effort: auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

type BackendKind = "hermes" | "claude" | "custom";

/** The saved choice: "hermes", "claude" or a provider id. */
function chosen(): string {
  const s = State.settings;
  return s.chatProvider ? s.chatProvider : s.model?.startsWith("claude-") ? "claude" : "hermes";
}

function kindOf(id: string): BackendKind {
  return id === "hermes" || id === "claude" ? id : "custom";
}

/** What can answer right now, in the order it is offered. */
function usable(): SelectOption[] {
  const b = State.chatBackends;
  // Not asked yet: only the saved choice, rather than a list that may be wrong.
  if (!b) {
    const id = chosen();
    const p = State.settings.providers?.find((x) => x.id === id);
    return [{ value: id, label: id === "hermes" ? "Hermes" : id === "claude" ? "Claude" : p?.name ?? "Provider" }];
  }
  const out: SelectOption[] = [];
  if (b.hermes) out.push({ value: "hermes", label: "Hermes" });
  if (b.claude) out.push({ value: "claude", label: "Claude" });
  for (const p of State.settings.providers ?? []) out.push({ value: p.id, label: p.name });
  return out;
}

/** What the island sees, for the chat (Settings → Privacy → Chat awareness). */
function awareness(): string | null {
  if (State.settings.chatAwareness === "off") return null;
  const now = new Date().toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return awarenessNote(todayRows(), State.tasks, now) || null;
}

const MD: RenderOptions = {
  openUrl: (url) => void Bridge.openUrl(url),
  copy: (text) => void navigator.clipboard.writeText(text).catch(() => {}),
};

function bubble(message: ChatMessage): HTMLElement {
  if (message.role === "user") {
    return h(
      "div",
      { class: "chat-row user" },
      h("div", { class: "bubble", text: message.content }),
    );
  }
  return h("div", { class: "chat-row" }, h("div", { class: "reply md" }, renderMarkdown(message.content, MD)));
}

function typingDots(): HTMLElement {
  return h(
    "div",
    { class: "chat-row" },
    h("div", { class: "typing" }, h("i"), h("i"), h("i")),
  );
}

export function buildPrompt(onHeightChange: () => void): ViewHost {
  const chipRow = h("div", { class: "file-chips chat-files" });
  const log = h("div", { class: "chat-log" });
  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: "Ask Awuuu (Hermes Agent)…",
    spellcheck: "false",
  }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: "Send" }, svg(ICONS.arrowUp, 11));

  let hermesOptions: Awaited<ReturnType<typeof Bridge.hermesModelOptions>> | null = null;
  let headKey = "";
  /** Something the chat has to say itself: a failed turn, nothing connected. */
  let notice: string | null = null;

  function save() {
    void Bridge.saveSettings(State.settings);
    headKey = "";
    State.notify();
  }
  function resetChat() {
    void Bridge.chatReset();
    State.chatHistory = [];
  }

  function chooseBackend(id: string) {
    const s = State.settings;
    if (id === "hermes") {
      s.chatProvider = "";
      s.model = "hermes-agent";
    } else if (id === "claude") {
      s.chatProvider = "";
      if (!s.model?.startsWith("claude-")) s.model = CLAUDE_MODELS[1];
    } else {
      s.chatProvider = id;
    }
    usedChip.textContent = "";
    notice = null;
    resetChat();
    save();
  }

  function modelOptions(): SelectOption[] {
    const s = State.settings;
    const kind = kindOf(chosen());
    if (kind === "hermes") {
      const out: SelectOption[] = [
        { value: "", label: hermesOptions ? `Default · ${hermesOptions.model}` : "Default model" },
      ];
      for (const p of hermesOptions?.providers ?? []) {
        for (const m of p.models) out.push({ value: `${p.slug}|${m}`, label: m, group: p.name });
      }
      // The saved pick shows before the list has been fetched.
      if (s.hermesModel && !hermesOptions) {
        out.push({ value: `${s.hermesProvider}|${s.hermesModel}`, label: s.hermesModel });
      }
      return out;
    }
    if (kind === "claude") {
      const out = CLAUDE_MODELS.map((m) => ({ value: m, label: m }));
      if (!CLAUDE_MODELS.includes(s.model)) out.push({ value: s.model, label: s.model });
      return out;
    }
    const p = (s.providers ?? []).find((x) => x.id === s.chatProvider);
    return p ? [{ value: p.model, label: p.model || "model" }] : [];
  }

  function modelValue(): string {
    const s = State.settings;
    const kind = kindOf(chosen());
    if (kind === "hermes") return s.hermesModel ? `${s.hermesProvider}|${s.hermesModel}` : "";
    if (kind === "claude") return s.model;
    return (s.providers ?? []).find((x) => x.id === s.chatProvider)?.model ?? "";
  }

  function chooseModel(v: string) {
    const s = State.settings;
    const kind = kindOf(chosen());
    if (kind === "hermes") {
      const [provider, model] = v ? v.split("|") : ["", ""];
      s.hermesProvider = provider;
      s.hermesModel = model;
    } else if (kind === "claude") {
      s.model = v;
    } else {
      const p = s.providers.find((x) => x.id === s.chatProvider);
      if (p) p.model = v;
    }
    save();
  }

  // ── Who answers ─────────────────────────────────────────────────────────
  // Provider (Hermes, Claude, or one added in Settings) · model · effort, and
  // what really answered the last turn — the server's word, fallbacks included.
  // The lists open inside the island, the only part of the window that takes
  // clicks, and hold the island open while they are up.
  const host = () => document.getElementById("island");
  let menus = 0;
  const menuOpened = () => {
    if (menus++ > 0) return;
    State.isPinned = true;
    State.notify();
  };
  const menuClosed = () => {
    if (--menus > 0) return;
    menus = 0;
    State.isPinned = State.approvalQueue.length > 0;
    State.notify();
  };
  const providerPick = dropdown({
    class: "chat-pick",
    title: "Who answers",
    host,
    options: usable,
    get: chosen,
    set: chooseBackend,
    onOpen: menuOpened,
    onClose: menuClosed,
  });
  const modelPick = dropdown({
    class: "chat-pick wide",
    title: "Model",
    host,
    options: modelOptions,
    get: modelValue,
    set: chooseModel,
    onClose: menuClosed,
    // The Hermes list is fetched when the picker is first opened, not before.
    onOpen: () => {
      menuOpened();
      if (kindOf(chosen()) !== "hermes" || hermesOptions) return;
      void Bridge.hermesModelOptions()
        .then((o) => {
          hermesOptions = o;
          headKey = "";
          modelPick.refresh();
          State.notify();
        })
        .catch((err) => {
          usedChip.textContent = String(err).replace(/^Error:\s*/, "");
        });
    },
  });
  const effortPick = dropdown({
    class: "chat-pick",
    title: "Reasoning effort",
    host,
    options: () => EFFORTS,
    get: () => State.settings.reasoningEffort ?? "",
    set: (v) => {
      State.settings.reasoningEffort = v;
      save();
    },
    onOpen: menuOpened,
    onClose: menuClosed,
  });
  const picks = [providerPick, modelPick, effortPick];
  const usedChip = h("span", { class: "chat-used", title: "What answered the last message" });
  const connect = h("button", {
    class: "btn secondary chat-connect",
    text: "Connect a model…",
    title: "Nothing can answer yet: connect Hermes, Claude or another provider",
    onclick: () => void Bridge.openSettingsWindow("chat"),
  });
  connect.addEventListener("mousedown", (e) => e.stopPropagation());
  const head = h("div", { class: "chat-head" }, ...picks, connect, usedChip);

  // A list left open must not outlive the chat it belongs to.
  State.subscribe(() => {
    if (menus > 0 && (State.mode !== "expanded" || State.view !== "prompt")) {
      for (const p of picks) p.close();
    }
  });

  function syncHead() {
    const s = State.settings;
    const options = usable();
    // The saved choice is gone (key removed, provider deleted): the first that works.
    if (State.chatBackends && options.length > 0 && !options.some((o) => o.value === chosen())) {
      chooseBackend(options[0].value);
    }
    const none = State.chatBackends != null && options.length === 0;
    const kind = kindOf(chosen());
    const key = [none, kind, s.chatProvider, s.model, s.hermesModel, s.hermesProvider, s.reasoningEffort,
      options.map((o) => o.value + o.label).join(","),
      (s.providers ?? []).map((p) => p.id + p.model).join(","), hermesOptions ? "1" : "0"].join("|");
    if (key === headKey) return;
    headKey = key;

    for (const p of picks) p.style.display = none ? "none" : "";
    connect.style.display = none ? "" : "none";
    // Effort: Hermes only (Claude and OpenAI-compatible servers take the defaults).
    if (kind !== "hermes") effortPick.style.display = "none";
    for (const p of picks) p.refresh();

    // The card's glow follows who answers: Hermes violet, Claude coral, others neutral.
    const glow = none ? "rgba(148,163,184,0.2)" : kind === "hermes" ? "rgba(139,92,246,0.5)" : kind === "claude" ? "rgba(240,101,67,0.45)" : "rgba(148,163,184,0.35)";
    (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", glow);
  }
  const bar = h("div", { class: "chat-bar" }, input, send);
  const body = h("div", { class: "chat-body" }, head, log, chipRow, bar);
  body.style.paddingLeft = `${clearOfDog("prompt", 20)}px`;

  const el = h("div", { class: "view" }, h("div", { class: "card wash chat-card" }, body));

  let sending = false;
  let renderedKey = "";

  async function submit() {
    const query = input.value.trim();
    if (!query || sending) return;
    if (State.chatBackends && usable().length === 0) {
      notice = "Nothing is connected to answer yet. Use “Connect a model…” above to add Hermes, a Claude API key or another provider, then ask again.";
      Sound.play("error");
      State.notify();
      return;
    }
    input.value = "";
    sending = true;
    notice = null;
    Sound.play("send");

    const first = State.chatHistory.length === 0;
    const mine: ChatMessage = { id: nextId++, role: "user", content: query };
    State.chatHistory.push(mine);
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();

    streaming = null;
    try {
      // The files ride with the first message, once their copies have landed.
      let context: ChatContext | null = null;
      if (first && State.droppedFiles.length > 0) {
        await Promise.allSettled(State.droppedFiles.map((f) => f.ready));
        const files = State.droppedFiles.filter((f) => f.path).map((f) => ({ name: f.name, path: f.path }));
        if (files.length > 0) context = { kind: "files", files };
      }
      const reply = await Bridge.chatSend(query, context, awareness());
      if (reply.used) usedChip.textContent = reply.used;
      if (streaming) (streaming as ChatMessage).content = reply.text;
      else State.chatHistory.push({ id: nextId++, role: "assistant", content: reply.text });
      State.stateOverride = null;
      Sound.play("finish");
    } catch (err) {
      // The reason shows in the chat itself. A reply cut off mid-stream stays;
      // a turn that never started goes back into the field, files and all.
      State.stateOverride = null;
      notice = String(err).replace(/^Error:\s*/, "");
      if (!streaming) {
        State.chatHistory = State.chatHistory.filter((m) => m !== mine);
        if (!input.value) input.value = query;
      }
      Sound.play("error");
    } finally {
      streaming = null;
      sending = false;
      State.notify();
      onHeightChange();
      input.focus();
    }
  }

  send.addEventListener("click", () => void submit());
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      void submit();
    }
    e.stopPropagation(); // Escape closes the island, not the chat
  });

  return {
    el,
    sync() {
      // Files can be taken out until the first message has carried them off.
      const asked = State.chatHistory.length > 0 || sending;
      syncFileChips(chipRow, !asked);

      const thinking = State.stateOverride === "thinking";
      // The last bubble grows while a reply streams, so its length is part of the key.
      const last = State.chatHistory[State.chatHistory.length - 1];
      const key = `${State.chatHistory.length}|${thinking}|${last?.content.length ?? 0}|${notice ?? ""}`;
      if (key !== renderedKey) {
        renderedKey = key;
        clear(log);
        for (const m of State.chatHistory) log.append(bubble(m));
        if (thinking) log.append(typingDots());
        if (notice) log.append(h("div", { class: "chat-row" }, h("div", { class: "chat-note", text: notice })));
        log.scrollTop = log.scrollHeight;
      }

      syncHead();

      const files = State.droppedFiles.length;
      input.placeholder = State.chatHistory.length > 0
        ? "Continue…"
        : files === 1 ? "Ask about this file…" : files > 1 ? "Ask about these files…" : "Ask Awuuu anything…";
      input.disabled = sending;
    },
    focus() {
      input.focus();
      input.select();
      void probeBackends();
    },
  };
}
