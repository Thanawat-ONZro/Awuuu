// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView from
// IslandViewContent.swift.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, onEvent, type ChatContext } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, type ChatMessage } from "../core/state";
import type { ViewHost } from "./views";

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

function bubble(message: ChatMessage): HTMLElement {
  if (message.role === "user") {
    return h(
      "div",
      { class: "chat-row user" },
      h("div", { class: "bubble", text: message.content }),
    );
  }
  return h("div", { class: "chat-row" }, h("div", { class: "reply", text: message.content }));
}

function typingDots(): HTMLElement {
  return h(
    "div",
    { class: "chat-row" },
    h("div", { class: "typing" }, h("i"), h("i"), h("i")),
  );
}

/** The coloured chip showing what the question is about (a dropped file). */
function contextChip(label: string): HTMLElement {
  const chip = h("div", { class: "chip" }, h("i", { class: "chip-dot" }), h("span", { text: label }));
  requestAnimationFrame(() => chip.classList.add("settled"));
  return chip;
}

export function buildPrompt(onHeightChange: () => void): ViewHost {
  const chipRow = h("div", { class: "chip-row" });
  const log = h("div", { class: "chat-log" });
  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: "Ask Awuuu (Hermes Agent)…",
    spellcheck: "false",
  }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: "Send" }, svg(ICONS.arrowUp, 11));
  // ── Who answers ─────────────────────────────────────────────────────────
  // Provider (Hermes, Claude, or one added in Settings) · model · effort, and
  // what really answered the last turn — the server's word, fallbacks included.
  const stop = (e: Event) => e.stopPropagation();
  const providerSel = h("select", { class: "chat-pick", title: "Who answers" }) as HTMLSelectElement;
  const modelSel = h("select", { class: "chat-pick wide", title: "Model" }) as HTMLSelectElement;
  const effortSel = h("select", { class: "chat-pick", title: "Reasoning effort" }) as HTMLSelectElement;
  for (const [v, t] of [["", "Effort: auto"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]]) {
    effortSel.append(h("option", { value: v, text: t }));
  }
  const usedChip = h("span", { class: "chat-used", title: "What answered the last message" });
  for (const sel of [providerSel, modelSel, effortSel]) sel.addEventListener("mousedown", stop);
  const head = h("div", { class: "chat-head" }, providerSel, modelSel, effortSel, usedChip);
  let hermesOptions: Awaited<ReturnType<typeof Bridge.hermesModelOptions>> | null = null;
  let headKey = "";

  const CLAUDE_MODELS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];
  const which = () =>
    State.settings.chatProvider ? "custom" : State.settings.model?.startsWith("claude-") ? "claude" : "hermes";

  function save() {
    void Bridge.saveSettings(State.settings);
    headKey = "";
    State.notify();
  }
  function resetChat() {
    void Bridge.chatReset();
    State.chatHistory = [];
  }
  providerSel.addEventListener("change", () => {
    const v = providerSel.value;
    if (v === "hermes") {
      State.settings.chatProvider = "";
      State.settings.model = "hermes-agent";
    } else if (v === "claude") {
      State.settings.chatProvider = "";
      if (!State.settings.model?.startsWith("claude-")) State.settings.model = CLAUDE_MODELS[1];
    } else {
      State.settings.chatProvider = v;
    }
    usedChip.textContent = "";
    resetChat();
    save();
  });
  modelSel.addEventListener("change", () => {
    const v = modelSel.value;
    const kind = which();
    if (kind === "hermes") {
      const [provider, model] = v ? v.split("|") : ["", ""];
      State.settings.hermesProvider = provider;
      State.settings.hermesModel = model;
    } else if (kind === "claude") {
      State.settings.model = v;
    } else {
      const p = State.settings.providers.find((x) => x.id === State.settings.chatProvider);
      if (p) p.model = v;
    }
    save();
  });
  effortSel.addEventListener("change", () => {
    State.settings.reasoningEffort = effortSel.value;
    save();
  });
  // The Hermes list is fetched when the picker is first used, not before.
  modelSel.addEventListener("focus", () => {
    if (which() === "hermes" && !hermesOptions) {
      void Bridge.hermesModelOptions()
        .then((o) => {
          hermesOptions = o;
          headKey = "";
          State.notify();
        })
        .catch((err) => {
          usedChip.textContent = String(err).replace(/^Error:\s*/, "");
        });
    }
  });

  function syncHead() {
    const s = State.settings;
    const kind = which();
    const key = [kind, s.chatProvider, s.model, s.hermesModel, s.hermesProvider, s.reasoningEffort,
      (s.providers ?? []).map((p) => p.id + p.model).join(","), hermesOptions ? "1" : "0"].join("|");
    if (key === headKey) return;
    headKey = key;
    clear(providerSel);
    providerSel.append(h("option", { value: "hermes", text: "Hermes" }), h("option", { value: "claude", text: "Claude" }));
    for (const p of s.providers ?? []) providerSel.append(h("option", { value: p.id, text: p.name }));
    providerSel.value = kind === "custom" ? s.chatProvider : kind;

    clear(modelSel);
    if (kind === "hermes") {
      const def = hermesOptions ? `Default · ${hermesOptions.model}` : "Default model";
      modelSel.append(h("option", { value: "", text: def }));
      for (const p of hermesOptions?.providers ?? []) {
        const group = h("optgroup", { label: p.name }) as HTMLOptGroupElement;
        for (const m of p.models) group.append(h("option", { value: `${p.slug}|${m}`, text: m }));
        modelSel.append(group);
      }
      if (s.hermesModel && !hermesOptions) {
        modelSel.append(h("option", { value: `${s.hermesProvider}|${s.hermesModel}`, text: s.hermesModel }));
      }
      modelSel.value = s.hermesModel ? `${s.hermesProvider}|${s.hermesModel}` : "";
    } else if (kind === "claude") {
      for (const m of CLAUDE_MODELS) modelSel.append(h("option", { value: m, text: m }));
      if (!CLAUDE_MODELS.includes(s.model)) modelSel.append(h("option", { value: s.model, text: s.model }));
      modelSel.value = s.model;
    } else {
      const p = (s.providers ?? []).find((x) => x.id === s.chatProvider);
      if (p) {
        modelSel.append(h("option", { value: p.model, text: p.model || "model" }));
        modelSel.value = p.model;
      }
    }
    // Effort: Hermes only (Claude and OpenAI-compatible servers take the defaults).
    effortSel.style.display = kind === "hermes" ? "" : "none";
    effortSel.value = s.reasoningEffort ?? "";

    // The card's glow follows who answers: Hermes violet, Claude coral, others neutral.
    const glow = kind === "hermes" ? "rgba(139,92,246,0.5)" : kind === "claude" ? "rgba(240,101,67,0.45)" : "rgba(148,163,184,0.35)";
    (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", glow);
  }
  const bar = h("div", { class: "chat-bar" }, input, send);

  const el = h(
    "div",
    { class: "view" },
    h("div", { class: "card wash chat-card" }, h("div", { class: "chat-body" }, head, chipRow, log, bar)),
  );

  let sending = false;
  let renderedKey = "";

  async function submit() {
    const query = input.value.trim();
    if (!query || sending) return;
    input.value = "";
    sending = true;
    Sound.play("send");

    State.chatHistory.push({ id: nextId++, role: "user", content: query });
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();

    const file = State.droppedFile;
    const context: ChatContext | null =
      State.chatHistory.length === 1 && file ? { kind: "file", name: file.name, path: file.path } : null;

    streaming = null;
    try {
      const reply = await Bridge.chatSend(query, context);
      if (reply.used) usedChip.textContent = reply.used;
      if (streaming) (streaming as ChatMessage).content = reply.text;
      else State.chatHistory.push({ id: nextId++, role: "assistant", content: reply.text });
      State.stateOverride = null;
      Sound.play("finish");
    } catch (err) {
      // A reply cut off mid-stream stays in the log; the note says why.
      State.stateOverride = null;
      State.noteMessage = String(err).replace(/^Error:\s*/, "");
      State.view = "note";
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
      const file = State.droppedFile;
      const wantChip = file?.name ?? "";
      if (chipRow.dataset.label !== wantChip) {
        chipRow.dataset.label = wantChip;
        clear(chipRow);
        if (wantChip) chipRow.append(contextChip(wantChip));
      }

      const thinking = State.stateOverride === "thinking";
      // The last bubble grows while a reply streams, so its length is part of the key.
      const last = State.chatHistory[State.chatHistory.length - 1];
      const key = `${State.chatHistory.length}|${thinking}|${last?.content.length ?? 0}`;
      if (key !== renderedKey) {
        renderedKey = key;
        clear(log);
        for (const m of State.chatHistory) log.append(bubble(m));
        if (thinking) log.append(typingDots());
        log.scrollTop = log.scrollHeight;
      }

      syncHead();

      input.placeholder = State.chatHistory.length === 0 ? "Ask Awuuu anything…" : "Continue…";
      input.disabled = sending;
    },
    focus() {
      input.focus();
      input.select();
    },
  };
}
