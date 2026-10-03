// Chat & models: who answers when you talk to Awuuu.

import { Bridge } from "../../core/bridge";
import type { ChatProvider } from "../../core/state";
import { h, clear } from "../../views/dom";
import { pageOf, save, select, settings, statusDot, textField } from "../ui";

// ── Agent / API section ────────────────────────────────────────────────────────


const MODELS: [string, string][] = [
  ["hermes-agent", "Hermes Agent (Local :8642)"],
  ["claude-opus-5", "Claude Opus 5"],
  ["claude-sonnet-5", "Claude Sonnet 5"],
  ["claude-haiku-4-5", "Claude Haiku 4.5"],
];

function hermesSection(): HTMLElement {
  const dot = statusDot(false);
  dot.style.background = "#a89a8a";
  const state = h("span", {
    class: "hint",
    text: "Awuuu chats with your local Hermes Agent. The key is read from API_SERVER_KEY in %LOCALAPPDATA%\\hermes\\.env unless you set one here.",
  });

  const url = h("input", {
    type: "text",
    placeholder: "http://127.0.0.1:8642  (default)",
    style: "flex:1 1 auto;min-width:0",
    spellcheck: "false",
  }) as HTMLInputElement;
  const saveUrl = h("button", { text: "Save" });

  const key = h("input", {
    type: "password",
    placeholder: "Optional — overrides the .env key",
    style: "flex:1 1 auto;min-width:0",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;
  const saveKey = h("button", { text: "Save" });
  const clearKey = h("button", { class: "danger", text: "Remove" });

  const test = h("button", { class: "primary", text: "Test connection" });
  const feedback = h("div", {});

  function say(kind: "ok" | "err", text: string) {
    clear(feedback);
    feedback.append(h("div", { class: `notice ${kind}`, text }));
  }

  async function refreshKey() {
    const present = (await Bridge.secretPresent("hermes-api-key")) ?? false;
    key.placeholder = present ? "••••••••••••  (stored)" : "Optional — overrides the .env key";
    clearKey.style.display = present ? "" : "none";
  }

  saveUrl.addEventListener("click", async () => {
    try {
      // Empty clears it, which falls back to the default local gateway.
      await Bridge.secretSet("hermes-url", url.value.trim());
      say("ok", url.value.trim() ? "Server saved." : "Back to the default local gateway.");
    } catch (err) {
      say("err", `Could not save: ${String(err)}`);
    }
  });

  saveKey.addEventListener("click", async () => {
    const value = key.value.trim();
    if (!value) return;
    try {
      await Bridge.secretSet("hermes-api-key", value);
      key.value = "";
      say("ok", "Key saved in the Windows Credential Manager.");
      await refreshKey();
    } catch (err) {
      say("err", `Could not save: ${String(err)}`);
    }
  });

  clearKey.addEventListener("click", async () => {
    try {
      await Bridge.secretClear("hermes-api-key");
      say("ok", "Key removed — the .env key is used again.");
      await refreshKey();
    } catch (err) {
      say("err", `Could not remove: ${String(err)}`);
    }
  });

  test.addEventListener("click", async () => {
    test.setAttribute("disabled", "");
    say("ok", "Sniffing for Hermes…");
    try {
      const models = await Bridge.hermesStatus();
      dot.style.background = "#22c55e";
      say("ok", models.length
        ? `Connected — ${models.length} model${models.length > 1 ? "s" : ""}: ${models.slice(0, 6).join(", ")}`
        : "Connected.");
      if (models.length > 0) {
        for (const m of models) {
          if (!Array.from(model.options).some((opt) => opt.value === m)) {
            model.append(h("option", { value: m, text: m }));
          }
        }
      }
    } catch (err) {
      dot.style.background = "#f0645a";
      say("err", String(err).replace(/^Error:\s*/, ""));
    } finally {
      test.removeAttribute("disabled");
    }
  });

  const model = h("select", {}) as HTMLSelectElement;
  for (const [id, label] of MODELS) model.append(h("option", { value: id, text: label }));
  if (!MODELS.some(([id]) => id === settings.model)) {
    model.append(h("option", { value: settings.model, text: settings.model }));
  }
  model.value = settings.model;
  model.addEventListener("change", () => {
    settings.model = model.value;
    void save();
  });

  const presetsRow = h("div", { class: "row", style: "gap:6px;flex-wrap:wrap;margin-top:2px" });
  const presets: [string, string][] = [
    ["Hermes Agent", "http://127.0.0.1:8642/v1/chat/completions"],
    ["OpenCode", "http://127.0.0.1:4096/v1/chat/completions"],
    ["Ollama", "http://127.0.0.1:11434/v1/chat/completions"],
    ["LM Studio", "http://127.0.0.1:1234/v1/chat/completions"],
    ["OpenRouter", "https://openrouter.ai/api/v1/chat/completions"],
  ];
  presetsRow.append(h("span", { class: "hint", style: "font-size:11px;align-self:center", text: "Presets:" }));
  for (const [name, pUrl] of presets) {
    presetsRow.append(h("button", {
      text: name,
      style: "padding:2px 8px;font-size:11px",
      onclick: () => {
        url.value = pUrl;
      },
    }));
  }

  void refreshKey();

  return h(
    "section",
    {},
    h("h2", {}, dot, h("span", { text: "Chat & Gateway — Hermes Agent" })),
    state,
    h("div", { class: "row" }, h("label", { text: "Model" }), model),
    h("div", { class: "row" }, h("label", { text: "Server" }), url, saveUrl),
    presetsRow,
    h("div", { class: "row" }, h("label", { text: "API key" }), key, saveKey, clearKey),
    h("div", { class: "row" }, test),
    feedback,
  );
}

// ── Chat providers (OpenAI-compatible) ──────────────────────────────────────

const PROVIDER_PRESETS: { name: string; baseUrl: string; model: string }[] = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-5-mini" },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openrouter/auto" },
  { name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2" },
  { name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", model: "local-model" },
  { name: "Custom", baseUrl: "http://127.0.0.1:8000/v1", model: "" },
];

function providerId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "provider";
  let id = base;
  for (let n = 2; settings.providers.some((p) => p.id === id); n++) id = `${base}-${n}`;
  return id;
}

function providersSection(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:10px" });
  const feedback = h("div", {});
  const say = (kind: "ok" | "err", text: string) => {
    clear(feedback);
    feedback.append(h("div", { class: `notice ${kind}`, text }));
  };

  function draw() {
    clear(body);
    const active = h("select", {}) as HTMLSelectElement;
    active.append(h("option", { value: "", text: "Hermes Agent / Claude (model above)" }));
    for (const p of settings.providers) active.append(h("option", { value: p.id, text: `${p.name} — ${p.model}` }));
    active.value = settings.chatProvider ?? "";
    active.addEventListener("change", () => {
      settings.chatProvider = active.value;
      void save();
    });
    body.append(h("div", { class: "row" }, h("label", { text: "Island chat uses" }), active));

    for (const p of settings.providers) body.append(providerRow(p));

    const add = h("select", {}) as HTMLSelectElement;
    add.append(h("option", { value: "", text: "Add a provider…" }));
    for (const preset of PROVIDER_PRESETS) add.append(h("option", { value: preset.name, text: preset.name }));
    add.addEventListener("change", () => {
      const preset = PROVIDER_PRESETS.find((x) => x.name === add.value);
      if (!preset) return;
      settings.providers = [...settings.providers, { id: providerId(preset.name), ...preset }];
      void save();
      draw();
    });
    const detect = h("button", { text: "Detect local (Ollama, LM Studio)" });
    detect.addEventListener("click", async () => {
      say("ok", "Looking on 11434 and 1234…");
      const found = (await Bridge.detectLocalProviders()) ?? [];
      if (found.length === 0) {
        say("err", "Nothing answered on the usual local ports.");
        return;
      }
      for (const f of found) {
        if (settings.providers.some((p) => p.baseUrl === f.baseUrl)) continue;
        settings.providers = [...settings.providers, { id: providerId(f.name), name: f.name, baseUrl: f.baseUrl, model: f.models[0] ?? "" }];
      }
      await save();
      say("ok", `Found: ${found.map((f) => `${f.name} (${f.models.length} models)`).join(", ")}`);
      draw();
    });
    body.append(h("div", { class: "row" }, add, detect), feedback);
  }

  function providerRow(p: ChatProvider): HTMLElement {
    const field = (value: string, placeholder: string, set: (v: string) => void, width = "160px") => {
      const input = h("input", { type: "text", value, placeholder, spellcheck: "false", style: `width:${width}` }) as HTMLInputElement;
      input.addEventListener("change", () => {
        set(input.value.trim());
        void save();
      });
      return input;
    };
    const models = h("datalist", { id: `models-${p.id}` });
    const model = field(p.model, "model", (v) => (p.model = v), "180px");
    model.setAttribute("list", `models-${p.id}`);
    const key = h("input", { type: "password", placeholder: "API key (optional)", autocomplete: "off", style: "width:150px" }) as HTMLInputElement;
    void Bridge.secretPresent(`provider-key:${p.id}`).then((has) => {
      if (has) key.placeholder = "••••••  (stored)";
    });
    key.addEventListener("change", async () => {
      try {
        await Bridge.secretSet(`provider-key:${p.id}`, key.value.trim());
        key.value = "";
        key.placeholder = "••••••  (stored)";
        say("ok", `${p.name}: key saved in the Credential Manager.`);
      } catch (err) {
        say("err", String(err));
      }
    });
    const test = h("button", { text: "Test" });
    test.addEventListener("click", async () => {
      try {
        const list = (await Bridge.providerModels(p.baseUrl, p.id)) ?? [];
        clear(models);
        for (const m of list) models.append(h("option", { value: m }));
        say("ok", `${p.name}: connected — ${list.length} models${list.length ? ` (${list.slice(0, 5).join(", ")}…)` : ""}`);
      } catch (err) {
        say("err", `${p.name}: ${String(err).replace(/^Error:\s*/, "")}`);
      }
    });
    const remove = h("button", { class: "danger", text: "Remove" });
    remove.addEventListener("click", async () => {
      settings.providers = settings.providers.filter((x) => x.id !== p.id);
      if (settings.chatProvider === p.id) settings.chatProvider = "";
      await Bridge.secretClear(`provider-key:${p.id}`).catch(() => {});
      await save();
      draw();
    });
    return h("div", { class: "row", style: "flex-wrap:wrap;gap:6px" },
      field(p.name, "name", (v) => (p.name = v || p.name), "110px"),
      field(p.baseUrl, "https://…/v1", (v) => (p.baseUrl = v), "220px"),
      model, models, key, test, remove);
  }

  draw();
  return h("section", {},
    h("h2", {}, h("span", { text: "Chat providers" })),
    h("div", { class: "hint", text: "Any OpenAI-compatible server — OpenAI, OpenRouter, Ollama, LM Studio or your own. Keys stay in the Windows Credential Manager. Switch providers from the chat too." }),
    body);
}

function apiSection(hasKey: boolean): HTMLElement {
  const dot = statusDot(hasKey);
  const state = h("span", { class: "hint", text: hasKey ? "Key saved in the Windows Credential Manager." : "No Claude key yet." });

  const field = h("input", {
    type: "password",
    placeholder: hasKey ? "••••••••••••  (stored)" : "sk-ant-...",
    style: "flex:1 1 auto;min-width:0",
    autocomplete: "off",
    spellcheck: "false",
  }) as HTMLInputElement;

  const saveBtn = h("button", { class: "primary", text: "Save key" });
  const clearBtn = h("button", { class: "danger", text: "Remove" });
  const feedback = h("div", {});

  async function refresh() {
    const present = (await Bridge.secretPresent("anthropic-api-key")) ?? false;
    dot.style.background = present ? "#22c55e" : "#f4505e";
    state.textContent = present
      ? "Key saved in the Windows Credential Manager."
      : "No Claude key yet.";
    field.placeholder = present ? "••••••••••••  (stored)" : "sk-ant-...";
    clearBtn.style.display = present ? "" : "none";
  }

  saveBtn.addEventListener("click", async () => {
    const value = field.value.trim();
    if (!value) return;
    clear(feedback);
    try {
      await Bridge.secretSet("anthropic-api-key", value);
      field.value = "";
      feedback.append(h("div", { class: "notice ok", text: "Saved. It never touches disk." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `Could not save: ${String(err)}` }));
    }
  });

  clearBtn.addEventListener("click", async () => {
    clear(feedback);
    try {
      await Bridge.secretClear("anthropic-api-key");
      feedback.append(h("div", { class: "notice ok", text: "Key removed." }));
      await refresh();
    } catch (err) {
      feedback.append(h("div", { class: "notice err", text: `Could not remove: ${String(err)}` }));
    }
  });

  clearBtn.style.display = hasKey ? "" : "none";

  return h(
    "section",
    {},
    h("h2", {}, dot, h("span", { text: "Claude API" })),
    state,
    h("div", { class: "hint", text: "Only needed when a Claude model is picked above." }),
    h("div", { class: "row" }, h("label", { text: "API key" }), field, saveBtn, clearBtn),
    feedback,
  );
}


// ── Personality: how Awuuu talks ───────────────────────────────────────────────

const TONES: [string, string][] = [
  ["playful", "Playful: warm, a little silly"],
  ["calm", "Calm: few words, no chatter"],
  ["pro", "Professional: straight to the point"],
];

function personalitySection(): HTMLElement {
  return h("section", {},
    h("h2", {}, h("span", { text: "Personality" })),
    h("div", { class: "row" }, h("label", { text: "Tone" }),
      select(TONES, () => settings.chatTone || "playful", (v) => (settings.chatTone = v))),
    h("div", { class: "row" }, h("label", { text: "Call me" }),
      textField(() => settings.userName ?? "", (v) => (settings.userName = v), "Your first name (default: from your Windows account)")),
    h("div", { class: "hint", text: "Awuuu replies in the language you write in. Hermes keeps its own memory; this only sets the voice." }),
  );
}

export async function page(): Promise<HTMLElement> {
  const hasKey = (await Bridge.secretPresent("anthropic-api-key")) ?? false;
  return pageOf("Chat & models", "The island's chat can talk to your local Hermes Agent, to Claude, or to any OpenAI-compatible server.",
    personalitySection(), hermesSection(), providersSection(), apiSection(hasKey));
}
