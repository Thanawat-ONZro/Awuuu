// Integrations: everyday things shown in Today, and developer services.

import { Bridge } from "../../core/bridge";
import { h } from "../../views/dom";
import { listField, pageOf, save, secretField, settings, statusDot, testRow, textField } from "../ui";

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

function everydaySection(): HTMLElement {
  const host = h("select", {}) as HTMLSelectElement;
  for (const [v, t] of [["gmail", "Gmail"], ["outlook", "Outlook / Hotmail"], ["icloud", "iCloud"], ["yahoo", "Yahoo"], ["custom", "Other (IMAP host)"]]) {
    host.append(h("option", { value: v, text: t }));
  }
  const customHost = textField(() => (["gmail", "outlook", "icloud", "yahoo"].includes(settings.mailHost) ? "" : settings.mailHost), (v) => (settings.mailHost = v), "imap.example.com:993");
  host.value = ["gmail", "outlook", "icloud", "yahoo", ""].includes(settings.mailHost ?? "") ? settings.mailHost || "gmail" : "custom";
  customHost.style.display = host.value === "custom" ? "" : "none";
  host.addEventListener("change", () => {
    customHost.style.display = host.value === "custom" ? "" : "none";
    if (host.value !== "custom") {
      settings.mailHost = host.value;
      void save();
    }
  });
  if (!settings.mailHost) settings.mailHost = "gmail";

  const group = (title: string, color: string, hint: string, ...rows: (Node | null)[]) =>
    h("div", { class: "everyday" },
      h("div", { class: "everyday-head" }, h("i", { class: "dot", style: `background:${color}` }), h("strong", { text: title })),
      h("div", { class: "hint", text: hint }),
      ...rows,
    );

  return h("section", { id: "everyday" },
    h("h2", {}, h("span", { text: "Everyday — shown in Today" })),
    h("div", { class: "hint", text: "These need no special app setup. Passwords, tokens and private links stay in the Windows Credential Manager. Each turns on as soon as it is filled in." }),
    group("Mail", "#EA4335",
      "Unread mail and who it is from, with a nudge for new messages. Gmail: turn on 2-step verification, create an app password (myaccount.google.com/apppasswords) and paste it here — not your normal password.",
      h("div", { class: "row" }, h("label", { text: "Service" }), host, customHost),
      h("div", { class: "row" }, h("label", { text: "Email" }), textField(() => settings.mailUser ?? "", (v) => (settings.mailUser = v), "you@gmail.com")),
      h("div", { class: "row" }, h("label", { text: "App password" }), secretField("mail-password", "xxxx xxxx xxxx xxxx")),
      testRow("integration_mail"),
    ),
    group("Calendar", "#4285F4",
      "Today's meetings with a Join button, and a heads-up 10 minutes before. Google Calendar: Settings → your calendar → \"Secret address in iCal format\". Outlook: Calendar → Shared calendars → Publish → ICS.",
      h("div", { class: "row" }, h("label", { text: "iCal link" }), secretField("ical-url", "https://calendar.google.com/calendar/ical/…/basic.ics")),
      testRow("integration_calendar"),
    ),
    group("Todoist", "#E44332", "Tasks due today or overdue. Todoist → Settings → Integrations → Developer → API token.",
      h("div", { class: "row" }, h("label", { text: "API token" }), secretField("todoist-token", "token")),
      testRow("integration_todoist"),
    ),
    group("Uptime", "#22C55E", "Sites to check every 5 minutes; you hear when one goes down or comes back. One URL per line.",
      h("div", { class: "row" }, listField(() => settings.uptimeUrls ?? [], (v) => (settings.uptimeUrls = v), "https://your-site.com")),
      testRow("integration_uptime"),
    ),
    group("News", "#F59E0B", "RSS or Atom feeds — blogs, release notes, news. One URL per line.",
      h("div", { class: "row" }, listField(() => settings.rssFeeds ?? [], (v) => (settings.rssFeeds = v), "https://github.com/tauri-apps/tauri/releases.atom")),
      testRow("integration_feeds"),
    ),
    group("Weather", "#38BDF8", "Today's weather and the chance of rain (Open-Meteo, no key).",
      h("div", { class: "row" }, h("label", { text: "City" }), textField(() => settings.weatherCity ?? "", (v) => (settings.weatherCity = v), "Bangkok")),
      testRow("integration_weather"),
    ),
  );
}

function integrationsSection(present: Record<string, boolean>): HTMLElement {
  const note = h("div", {
    class: "hint",
    text: "An integration turns on as soon as its key is saved, and off when you remove it. Keys are stored in the Windows Credential Manager, never on disk.",
  });
  const list = h("div", { style: "display:flex;flex-direction:column;gap:14px" });

  for (const def of INTEGRATIONS) {
    const result = h("span", { class: "hint", style: "font-size:11.5px" });
    const test = h("button", { text: "Test" });
    test.addEventListener("click", async () => {
      result.textContent = "Testing…";
      result.style.color = "";
      try {
        result.textContent = await Bridge.integrationTest(def.id);
        result.style.color = "#22c55e";
      } catch (err) {
        result.textContent = String(err).replace(/^Error:\s*/, "");
        result.style.color = "#f4505e";
      }
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
          if (value) test.click();
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
          h("i", { class: "dot", style: `background:${def.color}` }),
          h("span", { style: "font-size:12.5px", text: def.name }),
        ),
        h("div", { style: "display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-width:0" },
          rows,
          h("div", { class: "row" }, test, result),
        ),
      ),
    );
  }

  return h("section", {}, h("h2", {}, h("span", { text: "Integrations" })), note, list);
}


export async function page(): Promise<HTMLElement> {
  const present: Record<string, boolean> = {};
  for (const def of INTEGRATIONS) {
    for (const f of def.fields) present[f.key] = (await Bridge.secretPresent(f.key)) ?? false;
  }
  return pageOf("Integrations", "What Awuuu brings to the Today page. Each one turns on when it is set up and off when you remove it.",
    everydaySection(), integrationsSection(present));
}
