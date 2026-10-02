// Settings window — the place where anything that writes to disk is confirmed.
// Stage 2 covers the Claude Code hooks and the general preferences; API keys and
// integrations land here too in a later stage.

import "./settings.css";
import { Bridge, onEvent, type HookStatus } from "../core/bridge";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
import { h, clear } from "../views/dom";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";

const root = document.getElementById("settings-root")!;

async function save() {
  await Bridge.saveSettings(settings);
}

// ── Reusable bits ─────────────────────────────────────────────────────────────

function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": on });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    onChange(next);
  });
  return el;
}

function statusDot(ok: boolean): HTMLElement {
  return h("i", { class: "dot", style: `background:${ok ? "#22c55e" : "#f4505e"}` });
}

function renderDiff(text: string): HTMLElement {
  const box = h("div", { class: "diff" });
  for (const line of text.split("\n")) {
    const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
    box.append(h("div", { class: cls, text: line }));
  }
  return box;
}

// ── Multi-Agent Hooks section (Claude, Codex, AGY) ────────────────────────────

function agentHooksSection(
  agent: "claude" | "codex" | "agy",
  title: string,
  fileName: string,
  descInstalled: string,
  descNotInstalled: string,
  status: HookStatus,
): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h(
    "section",
    {},
    h("h2", {}, statusDot(status.installed), h("span", { text: title })),
    body,
  );

  const rebuild = async () => {
    const fresh = await Bridge.agentHooksStatus(agent);
    if (fresh) Object.assign(status, fresh);
    clear(body);
    draw();
    const head = section.querySelector("h2")!;
    clear(head);
    head.append(statusDot(status.installed), h("span", { text: title }));
  };

  function draw() {
    body.append(
      h("div", {
        class: "hint",
        text: status.installed ? descInstalled : descNotInstalled,
      }),
      h("div", { class: "row" },
        h("label", { text: fileName }),
        h("span", { class: "path", text: status.settingsPath }),
      ),
      h("div", { class: "row" },
        h("label", { text: "Relay" }),
        h("span", { class: "path", text: status.hookPath }),
        statusDot(status.hookReady),
      ),
    );

    if (!status.hookReady) {
      body.append(h("div", {
        class: "notice warn",
        text: "awuuu-hook.exe is not in place yet. Restart Awuuu; if it still fails, build it with `cargo build -p awuuu-hook`.",
      }));
    }

    const actions = h("div", { class: "row" });
    const install = h("button", {
      class: "primary",
      text: status.installed ? "Reinstall hooks…" : "Install hooks…",
      onclick: () => showPreview(true),
    });
    if (!status.hookReady) {
      install.disabled = true;
      install.title = "The relay isn't installed yet.";
    }
    actions.append(install);
    if (status.installed) {
      actions.append(h("button", {
        class: "danger",
        text: "Uninstall hooks…",
        onclick: () => showPreview(false),
      }));
    }
    body.append(actions);
  }

  async function showPreview(install: boolean) {
    let preview;
    try {
      preview = await Bridge.agentHooksPreview(agent, install);
    } catch (err) {
      clear(body);
      body.append(
        h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }),
        h("div", { class: "row" }, h("button", {
          text: "Back",
          onclick: () => { clear(body); draw(); },
        })),
      );
      return;
    }
    if (!preview) return;
    clear(body);
    body.append(
      h("div", {
        class: "hint",
        text: install
          ? `This is exactly what will change in your ${fileName}. Your other hooks and configurations are left untouched.`
          : `This removes Awuuu's entries only. Your other hooks and configurations are left untouched.`,
      }),
      renderDiff(preview.diff),
      h("div", { class: "row" },
        h("span", { class: "path", text: `Backup → ${preview.backup}` }),
      ),
    );
    const confirm = h("button", {
      class: install ? "primary" : "danger",
      text: install ? "Back up and write" : "Back up and remove",
    });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backup = await Bridge.agentHooksApply(agent, install, preview.fingerprint);
        clear(body);
        body.append(h("div", {
          class: "notice ok",
          text: `Done. Previous settings saved as ${backup}. Open a new session to pick the hooks up.`,
        }));
        window.setTimeout(() => void rebuild(), 2600);
      } catch (err) {
        confirm.disabled = false;
        body.append(h("div", { class: "notice err", text: `Could not write: ${String(err)}` }));
      }
    });
    body.append(h("div", { class: "row" }, confirm, h("button", {
      text: "Cancel",
      onclick: () => { clear(body); draw(); },
    })));
  }

  draw();
  return section;
}

// ── Always Allowed Rules section ──────────────────────────────────────────────

function alwaysAllowSection(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:10px" });
  const section = h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Always Allowed Commands" })),
    body,
  );

  function loadRules(): { commandPrefix: string; sessionId?: string }[] {
    try {
      const raw = localStorage.getItem("awuuu_always_allowed");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveRules(rules: { commandPrefix: string; sessionId?: string }[]) {
    try {
      localStorage.setItem("awuuu_always_allowed", JSON.stringify(rules));
    } catch {
      // ignore
    }
  }

  function render() {
    clear(body);
    const rules = loadRules();
    if (rules.length === 0) {
      body.append(
        h("div", {
          class: "hint",
          text: "No permanent permissions saved. When you click 'Always allow' on an approval card, the command prefix will appear here so it can execute automatically without prompting.",
        }),
      );
      return;
    }

    body.append(
      h("div", {
        class: "hint",
        text: "The following command prefixes are automatically approved. You can revoke them individually or clear all.",
      }),
    );

    const list = h("div", { style: "display:flex;flex-direction:column;gap:6px" });
    rules.forEach((rule, idx) => {
      const row = h(
        "div",
        {
          class: "row",
          style: "justify-content:space-between;background:rgba(255,255,255,0.02);padding:6px 10px;border-radius:6px",
        },
        h(
          "div",
          { style: "display:flex;flex-direction:column;gap:2px;overflow:hidden" },
          h("code", { style: "font-family:var(--mono);font-size:12px;color:var(--ink)", text: rule.commandPrefix }),
          rule.sessionId
            ? h("span", { class: "hint", style: "font-size:11px", text: `Session: ${rule.sessionId}` })
            : h("span", { class: "hint", style: "font-size:11px", text: "Global (all sessions)" }),
        ),
        h("button", {
          class: "danger",
          style: "padding:3px 8px;font-size:11px",
          text: "Revoke",
          onclick: () => {
            rules.splice(idx, 1);
            saveRules(rules);
            render();
          },
        }),
      );
      list.append(row);
    });
    body.append(list);

    const clearAllRow = h("div", { class: "row", style: "justify-content:flex-end;margin-top:4px" });
    clearAllRow.append(
      h("button", {
        class: "danger",
        text: "Clear all rules",
        onclick: () => {
          saveRules([]);
          render();
        },
      }),
    );
    body.append(clearAllRow);
  }

  render();
  return section;
}

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

function apiAgentsOverviewSection(): HTMLElement {
  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "Hermes Agent & OpenCode Gateway" })),
    h("div", {
      class: "hint",
      text: "Hermes Agent and OpenCode connect over local HTTP/REST endpoints. Awuuu automatically unifies them alongside your CLI sessions with real-time approvals, chat streaming, and dynamic island notifications.",
    }),
    h("div", { style: "display:flex;flex-direction:column;gap:8px;margin-top:10px" },
      h("div", { class: "row", style: "justify-content:space-between;background:rgba(255,255,255,0.02);padding:8px 12px;border-radius:6px" },
        h("div", { style: "display:flex;align-items:center;gap:8px" },
          h("span", { style: "display:inline-block;width:8px;height:8px;border-radius:50%;background:#8B5CF6" }),
          h("strong", { text: "Hermes Agent" }),
          h("span", { class: "hint", text: "Port :8642 — Streaming chat, autonomous tool calling, system notifications" }),
        ),
        h("span", { class: "badge", style: "font-size:11px;background:rgba(139,92,246,0.15);color:#8B5CF6;padding:2px 6px;border-radius:4px", text: "Built-in" }),
      ),
      h("div", { class: "row", style: "justify-content:space-between;background:rgba(255,255,255,0.02);padding:8px 12px;border-radius:6px" },
        h("div", { style: "display:flex;align-items:center;gap:8px" },
          h("span", { style: "display:inline-block;width:8px;height:8px;border-radius:50%;background:#00D26A" }),
          h("strong", { text: "OpenCode" }),
          h("span", { class: "hint", text: "Port :4096 — Local SSE event stream, permission prompts, multi-session" }),
        ),
        h("span", { class: "badge", style: "font-size:11px;background:rgba(0,210,106,0.15);color:#00D26A;padding:2px 6px;border-radius:4px", text: "Auto-detect" }),
      ),
    ),
  );
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

// ── Integrations section ──────────────────────────────────────────────────────

interface IntegrationDef {
  id: string;
  name: string;
  color: string;
  /** Credential Manager keys, in the order they are shown. */
  fields: { key: string; label: string; placeholder: string; secret: boolean }[];
}

const INTEGRATIONS: IntegrationDef[] = [
  { id: "integration_stripe", name: "Stripe", color: "#0570DE",
    fields: [{ key: "stripe-api-key", label: "Secret key", placeholder: "sk_live_…", secret: true }] },
  { id: "integration_github", name: "GitHub", color: "#F4505E",
    fields: [{ key: "github-token", label: "Token", placeholder: "ghp_…", secret: true }] },
  { id: "integration_vercel", name: "Vercel", color: "#7C5CFF",
    fields: [{ key: "vercel-token", label: "Token", placeholder: "…", secret: true }] },
  { id: "integration_n8n", name: "n8n", color: "#F29B38",
    fields: [
      { key: "n8n-url", label: "Instance URL", placeholder: "https://n8n.example.com", secret: false },
      { key: "n8n-api-key", label: "API key", placeholder: "…", secret: true },
    ] },
  { id: "integration_resend", name: "Resend", color: "#22C55E",
    fields: [{ key: "resend-api-key", label: "API key", placeholder: "re_…", secret: true }] },
  { id: "integration_notion", name: "Notion", color: "#8C8C8C",
    fields: [{ key: "notion-api-key", label: "Integration token", placeholder: "ntn_…", secret: true }] },
  { id: "integration_calcom", name: "Cal.com", color: "#C9956A",
    fields: [{ key: "calcom-api-key", label: "API key", placeholder: "cal_…", secret: true }] },
];

const MAX_ACTIVE = 4;

function integrationsSection(present: Record<string, boolean>): HTMLElement {
  const note = h("div", { class: "hint" });
  const list = h("div", { style: "display:flex;flex-direction:column;gap:14px" });

  function updateNote() {
    const used = settings.activeIntegrations.length;
    note.textContent = `Pick up to ${MAX_ACTIVE} pills to show next to Awuuu — ${used}/${MAX_ACTIVE} in use. Keys are stored in the Windows Credential Manager, never on disk.`;
  }

  for (const def of INTEGRATIONS) {
    const active = settings.activeIntegrations.includes(def.id);
    const sw = h("button", { class: active ? "switch on" : "switch" });
    sw.addEventListener("click", () => {
      const on = settings.activeIntegrations.includes(def.id);
      if (on) {
        settings.activeIntegrations = settings.activeIntegrations.filter((x) => x !== def.id);
      } else {
        if (settings.activeIntegrations.length >= MAX_ACTIVE) return;
        settings.activeIntegrations = [...settings.activeIntegrations, def.id];
      }
      sw.classList.toggle("on", !on);
      updateNote();
      void save();
    });

    const rows = h("div", { style: "display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-width:0" });
    for (const field of def.fields) {
      const input = h("input", {
        type: field.secret ? "password" : "text",
        placeholder: present[field.key] ? "••••••••  (stored)" : field.placeholder,
        autocomplete: "off",
        spellcheck: "false",
        style: "flex:1 1 auto;min-width:0",
      }) as HTMLInputElement;
      const saveBtn = h("button", { text: "Save" });
      const dotEl = statusDot(present[field.key] ?? false);
      saveBtn.addEventListener("click", async () => {
        const value = input.value.trim();
        try {
          await Bridge.secretSet(field.key, value);
          present[field.key] = value.length > 0;
          input.value = "";
          input.placeholder = value ? "••••••••  (stored)" : field.placeholder;
          dotEl.style.background = value ? "#22c55e" : "#f4505e";
        } catch {
          dotEl.style.background = "#f5a524";
        }
      });
      rows.append(
        h("div", { class: "row" },
          h("label", { style: "min-width:104px", text: field.label }),
          input, saveBtn, dotEl,
        ),
      );
    }

    list.append(
      h("div", { style: "display:flex;gap:12px;align-items:flex-start" },
        h("div", { style: "display:flex;align-items:center;gap:8px;min-width:132px;padding-top:4px" },
          sw,
          h("i", { class: "dot", style: `background:${def.color}` }),
          h("span", { style: "font-size:12.5px", text: def.name }),
        ),
        rows,
      ),
    );
  }

  updateNote();
  return h("section", {}, h("h2", {}, h("span", { text: "Integrations" })), note, list);
}

// ── General section ───────────────────────────────────────────────────────────

function generalSection(): HTMLElement {
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
    value: String(settings.soundVolume),
  }) as HTMLInputElement;
  volume.addEventListener("input", () => {
    settings.soundVolume = Number(volume.value);
    void save();
  });

  const autoClose = h("input", {
    type: "number", min: "5", max: "120", step: "1",
    value: String(Math.round(settings.autoCloseInterval)),
    style: "width:72px",
  }) as HTMLInputElement;
  autoClose.addEventListener("change", () => {
    settings.autoCloseInterval = Math.max(5, Math.min(120, Number(autoClose.value) || 15));
    autoClose.value = String(settings.autoCloseInterval);
    void save();
  });

  const hide = h("select", {}) as HTMLSelectElement;
  hide.append(
    h("option", { value: "3", text: "After 3 seconds" }),
    h("option", { value: "5", text: "After 5 seconds (default)" }),
    h("option", { value: "10", text: "After 10 seconds" }),
    h("option", { value: "60", text: "After 1 minute" }),
    h("option", { value: "0", text: "Never — stays on screen" }),
  );
  hide.value = String(settings.hideAfter ?? 5);
  if (hide.value === "") hide.value = "5";
  hide.addEventListener("change", () => {
    settings.hideAfter = Number(hide.value);
    void save();
  });

  const position = h("select", {}) as HTMLSelectElement;
  position.append(
    h("option", { value: "top", text: "Top of the screen" }),
    h("option", { value: "bottom", text: "Bottom, above the taskbar" }),
  );
  position.value = settings.position ?? "top";
  position.addEventListener("change", () => {
    settings.position = position.value as Settings["position"];
    void save();
  });

  const screen = h("select", {}) as HTMLSelectElement;
  screen.append(
    h("option", { value: "primary", text: "Main display" }),
    h("option", { value: "cursor", text: "Display under the cursor" }),
  );
  screen.value = settings.screen;
  screen.addEventListener("change", () => {
    settings.screen = screen.value as Settings["screen"];
    void save();
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "General" })),
    h("div", { class: "row" },
      h("label", { text: "Sound" }),
      toggle(settings.soundEnabled, (v) => { settings.soundEnabled = v; void save(); }),
      volume,
    ),
    h("div", { class: "row" },
      h("label", { text: "Auto-close" }),
      autoClose,
      h("span", { class: "hint", text: "seconds after you leave the island" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Notification auto-hide" }),
      hide,
    ),
    h("div", { class: "row" },
      h("label", { text: "Island lives on" }),
      screen,
    ),
    h("div", { class: "row" },
      h("label", { text: "Position" }),
      position,
    ),
    h("div", { class: "row" },
      h("label", { text: "Updates" }),
      toggle(settings.updateCheck === true, (v) => { settings.updateCheck = v; void save(); }),
      h("span", { class: "hint", text: "check automatically" }),
      h("button", { text: "Check now", onclick: () => void Bridge.updateCheckNow() }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Launch at startup" }),
      toggle(settings.autostart, (v) => { settings.autostart = v; void save(); }),
    ),
  );
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function main() {
  const boot = await Bridge.boot();
  if (boot) {
    settings = { ...settings, ...boot.settings };
    version = boot.version;
  }
  const claudeStatus = (await Bridge.agentHooksStatus("claude")) ?? {
    installed: false, settingsPath: "", hookPath: "", hookReady: false,
  };
  const codexStatus = (await Bridge.agentHooksStatus("codex")) ?? {
    installed: false, settingsPath: "", hookPath: "", hookReady: false,
  };
  const agyStatus = (await Bridge.agentHooksStatus("agy")) ?? {
    installed: false, settingsPath: "", hookPath: "", hookReady: false,
  };

  const hasKey = (await Bridge.secretPresent("anthropic-api-key")) ?? false;

  const keys = [
    "stripe-api-key", "github-token", "vercel-token",
    "n8n-url", "n8n-api-key", "resend-api-key", "notion-api-key", "calcom-api-key",
  ];
  const present: Record<string, boolean> = {};
  for (const k of keys) present[k] = (await Bridge.secretPresent(k)) ?? false;

  clear(root);
  root.append(
    h("h1", {}, h("span", { text: "Awuuu" }), h("span", { class: "version", text: version })),
    agentHooksSection(
      "claude",
      "Claude Code",
      "settings.json",
      "Awuuu is hooked into your Claude Code sessions (~/.claude/settings.json). Tool calls and permission requests appear in the island.",
      "Install the hooks to see your Claude Code sessions in the island and approve permissions with 1-click.",
      claudeStatus,
    ),
    agentHooksSection(
      "codex",
      "Codex CLI",
      "hooks.json",
      "Awuuu is hooked into your Codex CLI sessions (~/.codex/hooks.json). Tool runs and permission requests appear in the island.",
      "Install the hooks to see your Codex CLI sessions in the island and approve permissions with 1-click.",
      codexStatus,
    ),
    agentHooksSection(
      "agy",
      "Antigravity CLI (AGY)",
      "hooks.json",
      "Awuuu is hooked into your Antigravity CLI sessions (~/.gemini/config/hooks.json). Tool executions appear in the island.",
      "Install the hooks to see your Antigravity CLI sessions in the island and approve tool calls with 1-click.",
      agyStatus,
    ),
    apiAgentsOverviewSection(),
    alwaysAllowSection(),
    hermesSection(),
    apiSection(hasKey),
    integrationsSection(present),
    generalSection(),
    h("div", {
      class: "hint",
      text: "No telemetry. Network requests only go to the services you configure yourself.",
    }),
  );

  void onEvent<Settings>("settings-changed", (s) => {
    settings = { ...settings, ...s };
  });
}

void main();
