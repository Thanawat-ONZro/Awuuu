// "Composio (via Hermes)": off by default and opt-in only. Composio is a cloud
// service, so this card says so first, shows the exact fragment, and edits
// Hermes' files only through a diff + dated backup + confirm (same pattern as
// the agent hooks in agents.ts). See docs/HERMES-COMPOSIO.md.

import { Bridge, type ComposioStatus } from "../../core/bridge";
import { h, clear } from "../../views/dom";
import { copyText } from "../dash-ui";
import { renderDiff } from "../ui";
import { t } from "../../i18n/i18n";

const KEY = "composio-api-key";
const PLACEHOLDER_URL = "https://backend.composio.dev/v3/mcp/<SERVER_ID>?user_id=<USER_ID>";

const WARNING =
  "Composio is a cloud service (composio.dev). When Hermes uses it, the content of your connected apps (mail, files, calendars...) and the sign-in tokens for them pass through and are held by Composio's servers, outside this PC. Awuuu itself stays local, but this switch is the one place your data leaves. It is off until you turn it on, and you can remove it at any time.";

function reason(err: unknown): string {
  return String(err).replace(/^Error:\s*/, "");
}

function fragment(url: string): string {
  return `mcp_servers:\n  composio:\n    url: "${url || PLACEHOLDER_URL}"\n    headers:\n      x-api-key: "\${COMPOSIO_API_KEY}"\n\n# ~/.hermes/.env\nCOMPOSIO_API_KEY=<your Composio API key>`;
}

export function composioSection(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const panel = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const chip = h("span", { class: "int-chip" });
  let status: ComposioStatus | null = null;
  let url = "";

  const card = h("div", { class: "int-card", id: "composio" },
    h("div", { class: "int-head" },
      h("span", { class: "int-mark", style: "background:#7C3AED", text: "C" }),
      h("div", { class: "int-title" }, h("strong", { text: t("Composio (via Hermes)") }), h("span", { text: t("Lets Hermes act in your other apps through Composio's cloud") })),
      chip),
    body, panel);

  async function refresh() {
    status = (await Bridge.composioStatus()) ?? null;
    if (status?.url && !url) url = status.url;
    chip.classList.toggle("on", !!status?.configInstalled);
    chip.textContent = status?.configInstalled ? t("On") : t("Off");
    draw();
  }

  function draw() {
    clear(body);
    body.append(h("div", { class: "notice warn", text: WARNING }));
    const on = !!status?.configInstalled;
    const agree = h("input", { type: "checkbox" }) as HTMLInputElement;
    agree.checked = on;
    agree.disabled = on;
    body.append(h("label", { class: "row" }, agree, h("span", { text: t(" I understand my app data will go through Composio, and I want to turn this on.") })));
    const form = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
    form.style.display = agree.checked ? "" : "none";
    agree.addEventListener("change", () => (form.style.display = agree.checked ? "" : "none"));
    body.append(form);

    const urlInput = h("input", { type: "text", placeholder: PLACEHOLDER_URL, autocomplete: "off", spellcheck: "false", value: url }) as HTMLInputElement;
    const keyInput = h("input", { type: "password", placeholder: status?.keySaved ? "••••••••  (stored)" : t("Composio API key"), autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
    const note = h("span", { class: "hint" });
    const saveKey = h("button", { text: t("Save key") });
    saveKey.addEventListener("click", async () => {
      try {
        await Bridge.secretSet(KEY, keyInput.value.trim());
        keyInput.value = "";
        await refresh();
      } catch (err) {
        note.textContent = reason(err);
      }
    });
    const pre = h("pre", { class: "path", style: "white-space:pre-wrap;user-select:text", text: fragment(url) });
    urlInput.addEventListener("input", () => { url = urlInput.value.trim(); pre.textContent = fragment(url); });
    const fallback = h("div");
    const copy = h("button", { text: t("Copy") }) as HTMLButtonElement;
    copy.addEventListener("click", () => void copyText(pre.textContent ?? "", copy, fallback));

    form.append(
      h("div", { class: "hint", text: t("Paste the MCP URL from your Composio dashboard, and your API key. The key is kept in the Windows Credential Manager. Hermes reads it from the environment (${COMPOSIO_API_KEY}), so the config file never holds the key; the only copy outside Awuuu is the one you choose to put in Hermes' .env below.") }),
      h("div", { class: "row int-field" }, h("label", { text: t("MCP URL") }), urlInput),
      h("div", { class: "row int-field" }, h("label", { text: t("API key") }), keyInput, saveKey, note),
      h("div", { class: "hint", text: t("What gets added (copy it if you prefer to edit the files yourself):") }),
      pre, h("div", { class: "row" }, copy), fallback,
      h("div", { class: "row" },
        h("button", { class: "primary", text: on ? t("Update Hermes config…") : t("Add to Hermes config…"), onclick: () => void review("config", true) }),
        h("button", { text: status?.envInstalled ? t("Key already in .env") : t("Add key to Hermes .env…"), disabled: !status?.keySaved || !!status?.envInstalled, title: status?.keySaved ? "" : t("Save your API key first"), onclick: () => void review("env", true) }),
        on || status?.envInstalled ? h("button", { class: "danger", text: t("Turn off…"), onclick: () => void turnOff() }) : null),
      h("div", { class: "hint", text: t("Hermes files: {v} and {v2}. Restart Hermes after a change (or /reload-mcp). Tool calls Hermes makes through Composio still ask for your approval here in the island.", { v: status?.configPath ?? "config.yaml", v2: status?.envPath ?? ".env" }) }),
    );
  }

  async function turnOff() {
    if (status?.configInstalled) await review("config", false, () => void (status?.envInstalled ? review("env", false) : undefined));
    else await review("env", false);
  }

  async function review(target: "config" | "env", install: boolean, then?: () => void) {
    clear(panel);
    let preview;
    try {
      preview = await Bridge.composioPreview(target, install, url);
    } catch (err) {
      panel.append(h("div", { class: "notice err", text: reason(err) }), h("div", { class: "row" }, h("button", { text: t("Close"), onclick: () => clear(panel) })));
      return;
    }
    const what = target === "config" ? "config.yaml" : ".env (this file is plain text: the key will be readable there by anything that can read your Hermes folder)";
    panel.append(
      h("div", { class: "hint", text: install ? t("This is exactly what will change in {what}. Everything else is left untouched.", { what }) : t("This removes Awuuu's Composio entry only from {what}.", { what }) }),
      renderDiff(preview.diff),
      h("div", { class: "row" }, h("span", { class: "path", text: t("Backup → {backup}", { backup: preview.backup }) })));
    const confirm = h("button", { class: install ? "primary" : "danger", text: install ? t("Back up and write") : t("Back up and remove") });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backup = await Bridge.composioApply(target, install, url, preview.fingerprint);
        clear(panel);
        panel.append(h("div", { class: "notice ok", text: t("Done. Previous file saved as {backup}. Restart Hermes to pick it up.", { backup }) }));
        await refresh();
        then?.();
      } catch (err) {
        confirm.disabled = false;
        panel.append(h("div", { class: "notice err", text: t("Could not write: {v}", { v: reason(err) }) }));
      }
    });
    panel.append(h("div", { class: "row" }, confirm, h("button", { text: t("Cancel"), onclick: () => clear(panel) })));
  }

  void refresh();
  return h("section", {}, h("h2", {}, h("span", { text: t("Optional · uses an outside service") })), h("div", { class: "int-grid" }, card));
}
