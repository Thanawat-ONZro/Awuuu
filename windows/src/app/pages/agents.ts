// Agents: one card per coding agent Awuuu can follow, and the commands that
// are always allowed.

import { Bridge, type HookAgentId, type HookStatus } from "../../core/bridge";
import { h, clear } from "../../views/dom";
import { pageOf, renderDiff, statusDot } from "../ui";

// ── Multi-Agent Hooks section (Claude, AGY, Hermes, OpenCode) ──────────

function agentHooksSection(
  agent: "claude" | "agy" | "hermes" | "opencode" | "codex",
  title: string,
  fileName: string,
  descInstalled: string,
  descNotInstalled: string,
  status: HookStatus,
): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h(
    "section",
    { id: `agent-${agent}` },
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


const AGENTS: [HookAgentId, string, string, string, string][] = [
  ["claude", "Claude Code", "settings.json",
    "Awuuu is hooked into your Claude Code sessions (~/.claude/settings.json). Tool calls and permission requests appear in the island.",
    "Install the hooks to see your Claude Code sessions in the island and approve permissions with 1-click."],
  ["agy", "Antigravity CLI (AGY)", "hooks.json",
    "Awuuu is hooked into your Antigravity CLI sessions (~/.gemini/config/hooks.json). Tool executions appear in the island.",
    "Install the hooks to see your Antigravity CLI sessions in the island and approve tool calls with 1-click."],
  ["hermes", "Hermes Agent", "config.yaml",
    "Awuuu follows your Hermes sessions (CLI, Desktop, gateway) through shell hooks in config.yaml. Hermes asks for approvals in its own window; the island tells you when it does. Hermes asks once to trust new hooks — or run `hermes hooks list`.",
    "Install the shell hooks to see Hermes sessions (CLI, Desktop, Discord…) in the island: what it runs, what it says, and when it waits for your approval."],
  ["opencode", "OpenCode", "awuuu.js plugin",
    "Awuuu's plugin is in OpenCode's plugin folder. Sessions show in the island and permission requests can be answered there. Restart OpenCode after installing.",
    "Install the plugin to see OpenCode sessions in the island and answer its permission requests with 1-click."],
  ["codex", "Codex CLI — Experimental", "hooks.json",
    "Awuuu's hooks are in ~/.codex/hooks.json. Codex asks once to trust new hooks: run /hooks in Codex. Approvals show in the island (Allow / Deny — Codex can't keep an \"Always\" rule from a hook); if nobody answers, Codex asks itself after about two minutes.",
    "Experimental: not yet tried against a live Codex session. Installs Awuuu's hooks in ~/.codex/hooks.json (config.toml is never touched); Codex then asks you to trust them with /hooks."],
];

export async function page(): Promise<HTMLElement> {
  const blank: HookStatus = { installed: false, settingsPath: "", hookPath: "", hookReady: false };
  const cards: HTMLElement[] = [];
  for (const [id, title, file, on, off] of AGENTS) {
    cards.push(agentHooksSection(id, title, file, on, off, (await Bridge.agentHooksStatus(id)) ?? { ...blank }));
  }
  return pageOf("Agents", "Connect a coding agent once and Awuuu follows its sessions. Nothing is written without showing you the change first.",
    ...cards, alwaysAllowSection());
}
