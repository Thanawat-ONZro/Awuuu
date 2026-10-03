// Integrations: what Awuuu brings to Today. Mail, calendar and GitHub are a
// "Sign in" button; the rest is one short card each. App passwords, the iCal
// link, tokens and the OAuth client IDs live under "Advanced".

import "../integrations.css";
import { Bridge, type SignInStatus } from "../../core/bridge";
import { h } from "../../views/dom";
import { dropdown } from "../../ui/select";
import { listField, pageOf, save, settings, testRow, textField } from "../ui";

const GUIDE = "https://github.com/Thanawat-ONZro/Awuuu/blob/main/docs/OAUTH-SETUP.md";

type Account = "google" | "microsoft";

const NOBODY: SignInStatus = { connected: false, account: null, needsClientId: true };

/** What the page knows; refreshed by sync() after every change. */
const live = {
  google: NOBODY,
  microsoft: NOBODY,
  github: NOBODY,
  githubCli: false,
  /** Integrations that are set up (ids as the island knows them). */
  on: new Set<string>(),
};

/** Pieces of the page that redraw when `live` changes. */
let watchers: (() => void)[] = [];

async function sync() {
  const status = await Bridge.oauthStatus();
  if (status) Object.assign(live, status);
  live.on = new Set((await Bridge.integrationsConfigured()) ?? []);
  for (const w of watchers) w();
}

/** Runs `draw` now and after every sync. */
function watch(draw: () => void) {
  watchers.push(draw);
  draw();
}

function reason(err: unknown): string {
  return String(err).replace(/^Error:\s*/, "");
}

// ── Small pieces ──────────────────────────────────────────────────────────────

/** "Connected" / "Not set up", following `live`. */
function chip(isOn: () => boolean): HTMLElement {
  const el = h("span", { class: "int-chip" });
  watch(() => {
    const on = isOn();
    el.classList.toggle("on", on);
    el.textContent = on ? "Connected" : "Not set up";
  });
  return el;
}

/** One integration: a mark, its name, its state, then whatever it needs. */
function tile(opts: { id?: string; mark: string; color: string; name: string; what: string; on: () => boolean }, ...body: (Node | null | false)[]): HTMLElement {
  return h("div", { class: "int-card", id: opts.id },
    h("div", { class: "int-head" },
      h("span", { class: "int-mark", style: `background:${opts.color}`, text: opts.mark }),
      h("div", { class: "int-title" }, h("strong", { text: opts.name }), h("span", { text: opts.what })),
      chip(opts.on),
    ),
    ...body,
  );
}

function link(text: string, onClick: () => void): HTMLElement {
  return h("button", { class: "int-link", type: "button", text, onclick: onClick });
}

function webLink(text: string, url: string): HTMLElement {
  const el = link(text, () => void Bridge.openUrl(url));
  el.title = url;
  return el;
}

/** A key or link kept in the Credential Manager: Save stores it, an empty Save removes it. */
function secretRow(label: string, key: string, placeholder: string, secret = true): HTMLElement {
  const input = h("input", { type: secret ? "password" : "text", placeholder, autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
  const stored = () => (input.placeholder = "••••••••  (stored)");
  void Bridge.secretPresent(key).then((has) => has && stored());
  const saveBtn = h("button", { text: "Save" });
  const note = h("span", { class: "hint" });
  saveBtn.addEventListener("click", async () => {
    const value = input.value.trim();
    try {
      await Bridge.secretSet(key, value);
      input.value = "";
      if (value) stored();
      else input.placeholder = placeholder;
      note.textContent = value ? "Saved." : "Removed.";
      note.style.color = "";
      void sync();
    } catch (err) {
      note.textContent = reason(err);
      note.style.color = "#f4505e";
    }
  });
  return h("div", { class: "row int-field" }, h("label", { text: label }), input, saveBtn, note);
}

/** A plain setting (saved with the others), then a fresh look at what is connected. */
function settingRow(label: string, get: () => string, set: (v: string) => void, placeholder: string): HTMLElement {
  const input = textField(get, set, placeholder);
  input.addEventListener("change", () => window.setTimeout(() => void sync(), 150));
  return h("div", { class: "row int-field" }, h("label", { text: label }), input);
}

// ── Advanced: opened from anywhere on the page ────────────────────────────────

let advanced: HTMLDetailsElement;

/** Opens Advanced and brings one of its blocks into view. */
function openAdvanced(anchor: string) {
  advanced.open = true;
  const target = document.getElementById(anchor);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("flash");
  window.setTimeout(() => target.classList.remove("flash"), 1600);
}

// ── Google and Microsoft ──────────────────────────────────────────────────────

const ACCOUNTS: Record<Account, { name: string; mark: string; color: string; what: string }> = {
  google: { name: "Google", mark: "G", color: "#4285F4", what: "Gmail · Google Calendar" },
  microsoft: { name: "Microsoft", mark: "M", color: "#0A7CD6", what: "Outlook mail · calendar" },
};

function accountTile(id: Account): HTMLElement {
  const def = ACCOUNTS[id];
  const body = h("div", { class: "int-body" });
  let busy = false;
  let error = "";

  const signIn = async () => {
    if (live[id].needsClientId) return openAdvanced(`client-${id}`);
    busy = true;
    error = "";
    draw();
    try {
      await Bridge.oauthSignIn(id);
    } catch (err) {
      error = reason(err);
    }
    busy = false;
    await sync();
  };

  const draw = () => {
    const s = live[id];
    body.replaceChildren();
    if (s.connected) {
      body.append(
        h("div", { class: "int-who" }, "Signed in", s.account ? " as " : "", s.account ? h("strong", { text: s.account }) : null),
        h("div", { class: "row" },
          h("button", {
            text: "Sign out",
            onclick: async () => {
              try {
                await Bridge.oauthSignOut(id);
              } catch (err) {
                error = reason(err);
              }
              await sync();
            },
          }),
        ),
      );
    } else if (busy) {
      body.append(
        h("div", { class: "int-wait" }, h("i", { class: "int-spin" }), "Finish signing in in your browser…"),
        h("div", { class: "row" }, h("button", { text: "Cancel", onclick: () => void Bridge.oauthCancel() })),
      );
    } else {
      body.append(h("div", { class: "row" }, h("button", { class: "primary", text: `Sign in with ${def.name}`, onclick: () => void signIn() })));
      if (s.needsClientId) {
        body.append(
          h("div", { class: "int-need" },
            `Needs a ${def.name} client ID first — a one-time setup. `,
            link("Set it up in Advanced", () => openAdvanced(`client-${id}`)),
          ),
        );
      }
    }
    if (error) body.append(h("div", { class: "notice err", text: error }));
  };
  watch(draw);
  return tile({ ...def, on: () => live[id].connected }, body);
}

/** Which account (or fallback) feeds Mail / Calendar right now. */
function sourceLine(id: "integration_mail" | "integration_calendar", fallback: string): HTMLElement {
  const el = h("div", { class: "hint" });
  watch(() => {
    const from = (["google", "microsoft"] as Account[])
      .filter((a) => live[a].connected)
      .map((a) => (live[a].account ? `${ACCOUNTS[a].name} (${live[a].account})` : ACCOUNTS[a].name));
    el.textContent = from.length
      ? `From ${from.join(" and ")}.`
      : live.on.has(id)
        ? `From ${fallback} (Advanced).`
        : "Sign in above to turn this on.";
  });
  return el;
}

function mailAndCalendar(): HTMLElement {
  return h("section", { id: "everyday" },
    h("h2", {}, h("span", { text: "Mail & calendar" })),
    h("div", { class: "hint", text: "Sign in once in your browser: no password is typed into Awuuu, and it can only read. Unread mail and today's meetings then show in Today." }),
    h("div", { class: "int-grid" }, accountTile("google"), accountTile("microsoft")),
    h("div", { class: "int-grid" },
      tile({ mark: "✉", color: "#EA4335", name: "Mail", what: "Unread mail, with a nudge for new messages", on: () => live.on.has("integration_mail") },
        sourceLine("integration_mail", "your app password"), testRow("integration_mail")),
      tile({ mark: "▦", color: "#34A0F4", name: "Calendar", what: "Today's meetings with Join, 10 minutes' notice", on: () => live.on.has("integration_calendar") },
        sourceLine("integration_calendar", "your iCal link"), testRow("integration_calendar")),
    ),
    h("div", { class: "hint" },
      "No account to sign in with? ",
      link("Use an app password or an iCal link", () => openAdvanced("adv-imap")),
      ".",
    ),
  );
}

// ── GitHub ────────────────────────────────────────────────────────────────────

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function githubSection(): HTMLElement {
  const body = h("div", { class: "int-body" });
  let busy: "" | "cli" | "code" = "";
  let code: { userCode: string; verificationUri: string } | null = null;
  let error = "";

  const withCli = async () => {
    busy = "cli";
    error = "";
    draw();
    try {
      await Bridge.githubCliLogin();
    } catch (err) {
      error = reason(err);
    }
    busy = "";
    await sync();
  };

  const withCode = async () => {
    if (live.github.needsClientId) return openAdvanced("client-github");
    busy = "code";
    error = "";
    code = null;
    draw();
    try {
      code = await Bridge.githubDeviceStart();
      draw();
      await Bridge.githubDeviceWait();
    } catch (err) {
      error = reason(err);
    }
    busy = "";
    code = null;
    await sync();
  };

  const draw = () => {
    const s = live.github;
    body.replaceChildren();
    if (s.connected) {
      body.append(
        h("div", { class: "int-who" }, "Connected", s.account ? " as " : "", s.account ? h("strong", { text: s.account }) : null),
        h("div", { class: "row" },
          h("button", {
            text: "Sign out",
            onclick: async () => {
              try {
                await Bridge.oauthSignOut("github");
              } catch (err) {
                error = reason(err);
              }
              await sync();
            },
          }),
        ),
      );
    } else if (busy === "code" && code) {
      const shown = code;
      const copied = h("span", { class: "hint" });
      body.append(
        h("div", { class: "hint", text: "Type this code on GitHub to connect Awuuu:" }),
        h("div", { class: "int-code" },
          h("code", { text: shown.userCode }),
          h("button", {
            text: "Copy",
            onclick: async () => {
              copied.textContent = (await copyText(shown.userCode)) ? "Copied." : "Select the code and press Ctrl+C.";
            },
          }),
          h("button", { class: "primary", text: "Open GitHub", onclick: () => void Bridge.openUrl(shown.verificationUri) }),
          copied,
        ),
        h("div", { class: "int-wait" }, h("i", { class: "int-spin" }), "Waiting for you to enter it…",
          h("button", { text: "Cancel", onclick: () => void Bridge.oauthCancel() })),
      );
    } else if (busy) {
      body.append(h("div", { class: "int-wait" }, h("i", { class: "int-spin" }), busy === "cli" ? "Asking the GitHub CLI…" : "Asking GitHub for a code…"));
    } else {
      body.append(
        h("div", { class: "row" },
          live.githubCli ? h("button", { class: "primary", text: "Use GitHub CLI login", title: "Takes the login `gh` already has on this PC", onclick: () => void withCli() }) : null,
          h("button", { class: live.githubCli ? "" : "primary", text: "Sign in with a code", onclick: () => void withCode() }),
        ),
      );
      if (!live.githubCli) {
        body.append(h("div", { class: "hint", text: "With the GitHub CLI installed and signed in (gh auth login), one click is enough: a \"Use GitHub CLI login\" button appears here." }));
      }
      if (s.needsClientId) {
        body.append(
          h("div", { class: "int-need" },
            "Signing in with a code needs a GitHub client ID first. ",
            link("Set it up in Advanced", () => openAdvanced("client-github")),
            " — or ",
            link("paste a token", () => openAdvanced("adv-github")),
            ".",
          ),
        );
      }
    }
    if (error) body.append(h("div", { class: "notice err", text: error }));
    body.append(testRow("integration_github"));
  };
  watch(draw);

  return h("section", {},
    h("h2", {}, h("span", { text: "GitHub" })),
    tile({ mark: "GH", color: "#6E5494", name: "GitHub", what: "Reviews waiting for you, failing runs", on: () => live.on.has("integration_github") }, body),
  );
}

// ── Feeds, uptime, weather ────────────────────────────────────────────────────

function simpleSection(): HTMLElement {
  return h("section", {},
    h("h2", {}, h("span", { text: "No account needed" })),
    h("div", { class: "int-grid" },
      tile({ mark: "N", color: "#F59E0B", name: "News", what: "RSS or Atom feeds, one URL per line", on: () => live.on.has("integration_feeds") },
        listField(() => settings.rssFeeds ?? [], (v) => { settings.rssFeeds = v; window.setTimeout(() => void sync(), 150); }, "https://github.com/tauri-apps/tauri/releases.atom"),
        testRow("integration_feeds")),
      tile({ mark: "↑", color: "#22C55E", name: "Uptime", what: "Sites checked every 5 minutes, one URL per line", on: () => live.on.has("integration_uptime") },
        listField(() => settings.uptimeUrls ?? [], (v) => { settings.uptimeUrls = v; window.setTimeout(() => void sync(), 150); }, "https://your-site.com"),
        testRow("integration_uptime")),
      tile({ mark: "☀", color: "#38BDF8", name: "Weather", what: "Today's weather and the chance of rain (Open-Meteo)", on: () => live.on.has("integration_weather") },
        settingRow("City", () => settings.weatherCity ?? "", (v) => (settings.weatherCity = v), "Bangkok"),
        testRow("integration_weather")),
    ),
  );
}

// ── Advanced / other providers ────────────────────────────────────────────────

/** Services that are a key and nothing else. */
const SERVICES: { id: string; name: string; mark: string; color: string; what: string; fields: [label: string, key: string, placeholder: string, secret?: boolean][] }[] = [
  { id: "integration_todoist", name: "Todoist", mark: "T", color: "#E44332", what: "Tasks due today or overdue — Settings → Integrations → Developer → API token",
    fields: [["API token", "todoist-token", "token"]] },
  { id: "integration_stripe", name: "Stripe", mark: "S", color: "#635BFF", what: "Balance and the latest payments",
    fields: [["Secret key", "stripe-api-key", "sk_live_…"]] },
  { id: "integration_vercel", name: "Vercel", mark: "▲", color: "#7C5CFF", what: "Deployments, and the ones that fail",
    fields: [["Token", "vercel-token", "…"]] },
  { id: "integration_n8n", name: "n8n", mark: "n8", color: "#F29B38", what: "Workflow runs",
    fields: [["Instance URL", "n8n-url", "https://n8n.example.com", false], ["API key", "n8n-api-key", "…"]] },
  { id: "integration_resend", name: "Resend", mark: "R", color: "#22C55E", what: "Emails sent and bounced",
    fields: [["API key", "resend-api-key", "re_…"]] },
  { id: "integration_notion", name: "Notion", mark: "N", color: "#8C8C8C", what: "Recently edited pages",
    fields: [["Integration token", "notion-api-key", "ntn_…"]] },
  { id: "integration_calcom", name: "Cal.com", mark: "C", color: "#C9956A", what: "Upcoming bookings",
    fields: [["API key", "calcom-api-key", "cal_…"]] },
];

function block(id: string, title: string, ...children: (Node | null | false)[]): HTMLElement {
  return h("div", { class: "int-block", id }, h("h3", { text: title }), ...children);
}

function imapBlock(): HTMLElement {
  const known = ["gmail", "outlook", "icloud", "yahoo"];
  if (!settings.mailHost) settings.mailHost = "gmail";
  let mode = known.includes(settings.mailHost) ? settings.mailHost : "custom";
  const custom = textField(() => (known.includes(settings.mailHost) ? "" : settings.mailHost), (v) => (settings.mailHost = v), "imap.example.com:993");
  custom.style.display = mode === "custom" ? "" : "none";
  const service = dropdown({
    options: () => [
      { value: "gmail", label: "Gmail" },
      { value: "outlook", label: "Outlook / Hotmail" },
      { value: "icloud", label: "iCloud" },
      { value: "yahoo", label: "Yahoo" },
      { value: "custom", label: "Other (IMAP host)" },
    ],
    get: () => mode,
    set: (v) => {
      mode = v;
      custom.style.display = v === "custom" ? "" : "none";
      if (v !== "custom") {
        settings.mailHost = v;
        void save();
      }
    },
  });
  return block("adv-imap", "Mail with an app password (IMAP)",
    h("div", { class: "hint", text: "Used only when no Google or Microsoft account is signed in. Gmail: turn on 2-step verification, create an app password (myaccount.google.com/apppasswords) and paste it here — not your normal password." }),
    h("div", { class: "row int-field" }, h("label", { text: "Service" }), service, custom),
    settingRow("Email", () => settings.mailUser ?? "", (v) => (settings.mailUser = v), "you@gmail.com"),
    secretRow("App password", "mail-password", "xxxx xxxx xxxx xxxx"),
  );
}

function advancedSection(): HTMLElement {
  const services = h("div", { class: "int-grid" });
  for (const s of SERVICES) {
    services.append(
      tile({ mark: s.mark, color: s.color, name: s.name, what: s.what, on: () => live.on.has(s.id) },
        ...s.fields.map(([label, key, placeholder, secret]) => secretRow(label, key, placeholder, secret ?? true)),
        testRow(s.id)),
    );
  }

  advanced = h("details", { class: "int-adv", id: "advanced" },
    h("summary", {}, h("span", { text: "Advanced / other providers" }), h("small", { text: "Client IDs, app passwords, tokens and seven more services" })),

    block("adv-clients", "OAuth client IDs",
      h("div", { class: "hint" },
        "The Sign in buttons need an app ID that you create once, for free, with each provider — Awuuu ships none, so your data only ever passes between this PC and them. ",
        webLink("Step-by-step guide", GUIDE),
        "."),
      h("div", { class: "int-client", id: "client-google" },
        h("strong", { text: "Google" }),
        h("p", { class: "hint" },
          "In Google Cloud Console, create a project, enable the Gmail API and the Google Calendar API, set up the consent screen (add yourself as a test user), then create an OAuth client of type \"Desktop app\". Paste its client ID, and its client secret too — for desktop apps Google does not treat that secret as confidential. ",
          webLink("Open Google Cloud credentials", "https://console.cloud.google.com/apis/credentials")),
        settingRow("Client ID", () => settings.googleClientId ?? "", (v) => (settings.googleClientId = v), "1234567890-abc….apps.googleusercontent.com"),
        secretRow("Client secret", "google-client-secret", "GOCSPX-…  (optional)"),
      ),
      h("div", { class: "int-client", id: "client-microsoft" },
        h("strong", { text: "Microsoft" }),
        h("p", { class: "hint" },
          "In the Microsoft Entra admin center, register an app for \"any organizational directory and personal Microsoft accounts\", add the \"Mobile and desktop applications\" redirect http://localhost/callback, and allow public client flows. Paste its Application (client) ID; there is no secret. ",
          webLink("Open app registrations", "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade")),
        settingRow("Client ID", () => settings.microsoftClientId ?? "", (v) => (settings.microsoftClientId = v), "00000000-0000-0000-0000-000000000000"),
      ),
      h("div", { class: "int-client", id: "client-github" },
        h("strong", { text: "GitHub" }),
        h("p", { class: "hint" },
          "Only for \"Sign in with a code\" — the GitHub CLI login needs none. In GitHub → Settings → Developer settings → OAuth Apps, create an app (any homepage and callback URL), tick \"Enable Device Flow\", and paste its client ID. ",
          webLink("Open GitHub developer settings", "https://github.com/settings/developers")),
        settingRow("Client ID", () => settings.githubClientId ?? "", (v) => (settings.githubClientId = v), "Ov23li…"),
      ),
    ),

    imapBlock(),

    block("adv-ical", "Calendar from an iCal link",
      h("div", { class: "hint", text: "Used only when no account is signed in. Google Calendar: Settings → your calendar → \"Secret address in iCal format\". Outlook: Calendar → Shared calendars → Publish → ICS." }),
      secretRow("iCal link", "ical-url", "https://calendar.google.com/calendar/ical/…/basic.ics"),
    ),

    block("adv-github", "GitHub with a personal access token",
      h("div", { class: "hint", text: "A classic token with the repo, read:org and notifications scopes, instead of signing in." }),
      secretRow("Token", "github-token", "ghp_…"),
    ),

    block("adv-services", "Other services",
      h("div", { class: "hint", text: "Each turns on as soon as its key is saved and off when you save it empty. Keys are stored in the Windows Credential Manager, never on disk." }),
      services,
    ),
  ) as HTMLDetailsElement;
  return advanced;
}

export async function page(): Promise<HTMLElement> {
  watchers = [];
  const el = pageOf("Integrations", "What Awuuu brings to the Today page. Each one turns on when it is set up and off when you remove it.",
    mailAndCalendar(), githubSection(), simpleSection(), advancedSection());
  await sync();
  return el;
}
