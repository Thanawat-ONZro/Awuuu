// Integrations: what Awuuu brings to Today. Mail, calendar and GitHub are a
// "Sign in" button; the rest is one short card each. App passwords, the iCal
// link, tokens and the OAuth client IDs live under "Advanced".

import "../integrations.css";
import { Bridge, type SignInStatus } from "../../core/bridge";
import { h } from "../../views/dom";
import { composioSection } from "./composio-card";
import { dropdown } from "../../ui/select";
import { listField, pageOf, save, select, settings, testRow, textField } from "../ui";
import { t, currentLanguage } from "../../i18n/i18n";
import { serviceGuide } from "../setup-guide";
import { serviceCost } from "../service-cost";
import { setupImage } from "../setup-images";

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
    el.textContent = on ? t("Connected") : t("Not set up");
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
    serviceCost(opts.name),
    ...body,
    serviceGuide(opts.name),
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
  const stored = () => (input.placeholder = t("Stored securely on this PC"));
  const saveBtn = h("button", { text: t("Save"), disabled: true }) as HTMLButtonElement;
  const remove = h("button", { text: t("Remove"), hidden: true }) as HTMLButtonElement;
  const note = h("span", { class: "hint", role: "status", "aria-live": "polite" });
  void Bridge.secretPresent(key).then((has) => {
    remove.hidden = !has;
    if (has) { stored(); if (!input.value) note.textContent = t("Saved on this PC"); }
  }).catch(() => { note.textContent = t("Could not read saved status"); });
  input.addEventListener("input", () => {
    saveBtn.disabled = !input.value.trim();
    note.textContent = input.value ? t("Unsaved changes") : "";
  });
  saveBtn.addEventListener("click", async () => {
    const value = input.value.trim();
    if (!value) return;
    saveBtn.disabled = true;
    note.textContent = t("Saving…");
    try {
      await Bridge.secretSet(key, value);
      input.value = "";
      if (value) stored();
      else input.placeholder = placeholder;
      note.textContent = value ? t("Saved.") : t("Removed.");
      note.style.color = "";
      remove.hidden = false;
      void sync();
    } catch (err) {
      saveBtn.disabled = false;
      note.textContent = reason(err);
      note.style.color = "var(--state-error)";
    }
  });
  remove.addEventListener("click", async () => {
    remove.disabled = true;
    try {
      await Bridge.secretSet(key, "");
      input.value = ""; input.placeholder = placeholder;
      remove.hidden = true; saveBtn.disabled = true;
      note.textContent = t("Removed.");
      void sync();
    } catch (error) { note.textContent = reason(error); }
    finally { remove.disabled = false; }
  });
  return h("div", { class: "row int-field" }, h("label", { text: label }), input, saveBtn, remove, note);
}

/** A plain setting (saved with the others), then a fresh look at what is connected. */
function settingRow(label: string, get: () => string, set: (v: string) => void, placeholder: string): HTMLElement {
  const input = h("input", { value: get(), placeholder, spellcheck: "false" }) as HTMLInputElement;
  const note = h("span", { class: "hint", role: "status", text: get() ? t("Saved on this PC") : "" });
  const button = h("button", { text: t("Save"), disabled: true }) as HTMLButtonElement;
  input.addEventListener("input", () => { button.disabled = input.value.trim() === get(); note.textContent = button.disabled ? t("Saved on this PC") : t("Unsaved changes"); });
  button.addEventListener("click", async () => {
    const before = get();
    set(input.value.trim()); button.disabled = true; note.textContent = t("Saving…");
    try { await save(); note.textContent = t("Saved on this PC"); void sync(); }
    catch (error) { set(before); button.disabled = false; note.textContent = reason(error); }
  });
  return h("div", { class: "row int-field" }, h("label", { text: label }), input, button, note);
}

// ── Advanced: opened from anywhere on the page ────────────────────────────────

let advanced: HTMLDetailsElement;

/** Opens Advanced and brings one of its blocks into view. */
function openAdvanced(anchor: string) {

  const target = document.getElementById(anchor);
  if (!target) return;
  let parent: HTMLElement | null = target;
  while (parent) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("flash");
  window.setTimeout(() => target.classList.remove("flash"), 1600);
}

// ── Google and Microsoft ──────────────────────────────────────────────────────

const accounts = (): Record<Account, { name: string; mark: string; color: string; what: string }> => ({
  google: { name: "Google", mark: "G", color: "#4285F4", what: t("Gmail · Google Calendar") },
  microsoft: { name: "Microsoft", mark: "M", color: "#0A7CD6", what: t("Outlook mail · calendar") },
});

function accountTile(id: Account): HTMLElement {
  const def = accounts()[id];
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
        h("div", { class: "int-who" }, t("Signed in"), s.account ? " as " : "", s.account ? h("strong", { text: s.account }) : null),
        h("div", { class: "row" },
          h("button", {
            text: t("Sign out"),
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
        h("div", { class: "int-wait" }, h("i", { class: "int-spin" }), t("Finish signing in in your browser…")),
        h("div", { class: "row" }, h("button", { text: t("Cancel"), onclick: () => void Bridge.oauthCancel() })),
      );
    } else {
      body.append(h("div", { class: "row" }, h("button", { class: "primary", text: s.needsClientId ? t("Set up {name} sign-in", { name: def.name }) : t("Sign in with {name}", { name: def.name }), onclick: () => void signIn() })));
      if (s.needsClientId) {
        body.append(
          h("div", { class: "int-need" },
            t("Requires a {name} developer app and client ID. ", { name: def.name }),
            link(t("Open setup steps"), () => openAdvanced(`client-${id}`)),
          ),
        );
      }
    }
    if (error) body.append(h("div", { class: "notice err", text: error }));
  };
  watch(draw);
  return tile({ ...def, on: () => live[id].connected }, body, oauthProvider(id));
}

/** Which account (or fallback) feeds Mail / Calendar right now. */
function sourceLine(id: "integration_mail" | "integration_calendar", fallback: string): HTMLElement {
  const el = h("div", { class: "hint" });
  watch(() => {
    const from = (["google", "microsoft"] as Account[])
      .filter((a) => live[a].connected)
      .map((a) => (live[a].account ? `${accounts()[a].name} (${live[a].account})` : accounts()[a].name));
    el.textContent = from.length
      ? t("From {v}.", { v: from.join(t(" and ")) })
      : live.on.has(id)
        ? t("From {fallback}.", { fallback })
        : t("Sign in above to turn this on.");
  });
  return el;
}

function mailAndCalendar(): HTMLElement {
  return h("section", { id: "everyday" },
    h("h2", {}, h("span", { text: t("Calendar & mail") })),
    h("div", { class: "hint", text: t("For calendar only, paste a private iCal link. For mail or a richer calendar connection, connect Google or Microsoft below; their sign-in currently requires a client ID that you create in the provider's developer console.") }),
    h("div", { class: "int-grid" },
      tile({ mark: "▦", color: "#34A0F4", name: "Calendar", what: t("Easiest: paste an iCal link from your calendar settings"), on: () => live.on.has("integration_calendar") },
        secretRow(t("Private iCal link"), "ical-url", "https://calendar.google.com/calendar/ical/…/basic.ics"),
        h("div", { class: "hint", text: t("Google Calendar: Settings → your calendar → Secret address in iCal format. Outlook: Calendar → Shared calendars → Publish → ICS. Keep this link private.") }),
        setupImage("calendar-mail", "Panel 1: copy the private iCal address. Panel 2 is for Gmail app passwords.", "ภาพที่ 1: กดคัดลอกที่อยู่ iCal ส่วนภาพที่ 2 ใช้สำหรับรหัสผ่านแอป Gmail"),
        sourceLine("integration_calendar", t("your iCal link")), testRow("integration_calendar")),
      tile({ mark: "✉", color: "#EA4335", name: "Mail", what: t("Unread mail, with a nudge for new messages"), on: () => live.on.has("integration_mail") },
        sourceLine("integration_mail", t("your app password")), setupPanel("mail-password-setup", t("Mail with an app password (IMAP)"), imapBlock())),
    ),
    h("details", { class: "int-adv" },
      h("summary", {}, h("span", { text: t("Connect an account (optional)") }), h("small", { text: t("Google or Microsoft · requires your own OAuth client ID") })),
      h("div", { class: "int-grid int-account-grid" }, accountTile("google"), accountTile("microsoft")),
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
        h("div", { class: "int-who" }, t("Connected"), s.account ? " as " : "", s.account ? h("strong", { text: s.account }) : null),
        h("div", { class: "row" },
          h("button", {
            text: t("Sign out"),
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
        h("div", { class: "hint", text: t("Type this code on GitHub to connect Awuuu:") }),
        h("div", { class: "int-code" },
          h("code", { text: shown.userCode }),
          h("button", {
            text: t("Copy"),
            onclick: async () => {
              copied.textContent = (await copyText(shown.userCode)) ? t("Copied.") : t("Select the code and press Ctrl+C.");
            },
          }),
          h("button", { class: "primary", text: t("Open GitHub"), onclick: () => void Bridge.openUrl(shown.verificationUri) }),
          copied,
        ),
        h("div", { class: "int-wait" }, h("i", { class: "int-spin" }), t("Waiting for you to enter it…"),
          h("button", { text: t("Cancel"), onclick: () => void Bridge.oauthCancel() })),
      );
    } else if (busy) {
      body.append(h("div", { class: "int-wait" }, h("i", { class: "int-spin" }), busy === "cli" ? t("Asking the GitHub CLI…") : t("Asking GitHub for a code…")));
    } else {
      body.append(
        h("div", { class: "row" },
          live.githubCli ? h("button", { class: "primary", text: t("Use GitHub CLI login"), title: t("Takes the login `gh` already has on this PC"), onclick: () => void withCli() }) : null,
          h("button", { class: live.githubCli ? "" : "primary", text: t("Sign in with a code"), onclick: () => void withCode() }),
        ),
      );
      if (!live.githubCli) {
        body.append(h("div", { class: "hint", text: t("With the GitHub CLI installed and signed in (gh auth login), one click is enough: a \"Use GitHub CLI login\" button appears here.") }));
      }
      if (s.needsClientId) {
        body.append(
          h("div", { class: "int-need" },
            t("Signing in with a code needs a GitHub client ID first. "),
            link(t("Open setup steps"), () => openAdvanced("client-github")),
            " — or ",
            link(t("paste a token"), () => openAdvanced("adv-github")),
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
    tile({ mark: "GH", color: "#6E5494", name: "GitHub", what: t("Reviews waiting for you, failing runs"), on: () => live.on.has("integration_github") }, body, oauthProvider("github"), setupPanel("github-token-setup", t("GitHub with a personal access token"), githubTokenSetup())),
  );
}

// ── Feeds, uptime, weather ────────────────────────────────────────────────────

function simpleSection(): HTMLElement {
  return h("section", { id: "no-account" },
    h("h2", {}, h("span", { text: t("No account needed") })),
    h("div", { class: "hint", text: t("These features need internet but no service account or API key.") }),
    h("div", { class: "int-grid" },
      tile({ mark: "N", color: "#F59E0B", name: "News", what: t("RSS or Atom feeds, one URL per line"), on: () => live.on.has("integration_feeds") },
        listField(() => settings.rssFeeds ?? [], (v) => { settings.rssFeeds = v; window.setTimeout(() => void sync(), 150); }, "https://github.com/tauri-apps/tauri/releases.atom"),
        testRow("integration_feeds")),
      tile({ mark: "↑", color: "#22C55E", name: "Uptime", what: t("Sites checked every 5 minutes, one URL per line"), on: () => live.on.has("integration_uptime") },
        listField(() => settings.uptimeUrls ?? [], (v) => { settings.uptimeUrls = v; window.setTimeout(() => void sync(), 150); }, "https://your-site.com"),
        testRow("integration_uptime")),
      tile({ mark: "☀", color: "#38BDF8", name: "Weather", what: t("Today's weather and the chance of rain (Open-Meteo)"), on: () => live.on.has("integration_weather") },
        settingRow(t("City"), () => settings.weatherCity ?? "", (v) => (settings.weatherCity = v), t("Bangkok")),
        h("div", { class: "row int-field" }, h("label", { text: t("Temperature unit") }),
          select([["c", t("Celsius")], ["f", t("Fahrenheit")]], () => settings.weatherUnit ?? "c", (v) => { settings.weatherUnit = v as "c" | "f"; })),
        testRow("integration_weather")),
    ),
  );
}

// ── Advanced / other providers ────────────────────────────────────────────────

/** Services that are a key and nothing else. */
const serviceDefs = (): { id: string; name: string; mark: string; color: string; what: string; fields: [label: string, key: string, placeholder: string, secret?: boolean][] }[] => [
  { id: "integration_todoist", name: "Todoist", mark: "T", color: "#E44332", what: t("Tasks due today or overdue — Settings → Integrations → Developer → API token"),
    fields: [[t("API token"), "todoist-token", "token"]] },
  { id: "integration_stripe", name: "Stripe", mark: "S", color: "#635BFF", what: t("Balance and the latest payments"),
    fields: [[t("Secret key"), "stripe-api-key", "sk_live_…"]] },
  { id: "integration_vercel", name: "Vercel", mark: "▲", color: "#7C5CFF", what: t("Deployments, and the ones that fail"),
    fields: [[t("Token"), "vercel-token", "…"]] },
  { id: "integration_n8n", name: "n8n", mark: "n8", color: "#F29B38", what: t("Workflow runs"),
    fields: [[t("Instance URL"), "n8n-url", "https://n8n.example.com", false], [t("API key"), "n8n-api-key", "…"]] },
  { id: "integration_resend", name: "Resend", mark: "R", color: "#22C55E", what: t("Emails sent and bounced"),
    fields: [[t("API key"), "resend-api-key", "re_…"]] },
  { id: "integration_notion", name: "Notion", mark: "N", color: "#8C8C8C", what: t("Recently edited pages"),
    fields: [[t("Integration token"), "notion-api-key", "ntn_…"]] },
  { id: "integration_calcom", name: "Cal.com", mark: "C", color: "#C9956A", what: t("Upcoming bookings"),
    fields: [[t("API key"), "calcom-api-key", "cal_…"]] },
];

function block(id: string, title: string, ...children: (Node | null | false)[]): HTMLElement {
  return h("div", { class: "int-block", id }, h("h3", { text: title }), ...children);
}

const languageText = (en: string, th: string) => currentLanguage() === "th" ? th : en;
function setupSteps(...steps: [string, string, string?][]): HTMLElement {
  return h("ol", { class: "int-steps" }, ...steps.map(([en, th, url]) => h("li", {},
    languageText(en, th), url ? webLink(languageText("Open this page ↗", "เปิดหน้านี้ ↗"), url) : null)));
}

function setupPanel(id: string, title: string, ...children: HTMLElement[]): HTMLElement {
  return h("details", { class: "int-provider-setup", id }, h("summary", { text: title }), ...children);
}

function copyValue(label: string, value: string): HTMLElement {
  const note = h("span", { class: "hint", role: "status" });
  return h("div", { class: "int-copy-value" }, h("span", { text: label }), h("code", { text: value }),
    h("button", { text: t("Copy"), onclick: async () => { note.textContent = await copyText(value) ? t("Copied.") : t("Select the code and press Ctrl+C."); } }), note);
}

function imapBlock(): HTMLElement {
  const known = ["gmail", "outlook", "icloud", "yahoo"];
  if (!settings.mailHost) settings.mailHost = "gmail";
  let mode = known.includes(settings.mailHost) ? settings.mailHost : "custom";
  const custom = textField(() => (known.includes(settings.mailHost) ? "" : settings.mailHost), (v) => (settings.mailHost = v), "imap.example.com:993");
  custom.style.display = mode === "custom" ? "" : "none";
  const instructions = h("div");
  const fields = h("div", {},
    settingRow(t("Email"), () => settings.mailUser ?? "", (v) => (settings.mailUser = v), "you@gmail.com"),
    secretRow(t("App password"), "mail-password", "xxxx xxxx xxxx xxxx"), testRow("integration_mail"));
  const drawInstructions = () => {
    fields.hidden = mode === "outlook";
    const steps: Record<string, [string, string, string?][]> = {
      gmail: [
        ["Enable 2-Step Verification for your Google account.", "เปิดการยืนยันสองขั้นตอนในบัญชี Google", "https://myaccount.google.com/signinoptions/two-step-verification"],
        ["Open App passwords, name it Awuuu and copy the generated password. This option may be unavailable for managed accounts or Advanced Protection.", "เปิด App passwords ตั้งชื่อ Awuuu แล้วคัดลอกรหัสที่สร้าง บัญชีที่องค์กรดูแลหรือใช้ Advanced Protection อาจไม่มีตัวเลือกนี้", "https://myaccount.google.com/apppasswords"],
        ["Enter your Gmail address and generated app password below. Save the password, then press Test.", "ใส่อีเมล Gmail และรหัสผ่านสำหรับแอปที่สร้างด้านล่าง กดบันทึกรหัส แล้วกดทดสอบ"],
      ],
      icloud: [
        ["Sign in to your Apple Account. Open Sign-In and Security → App-Specific Passwords → Generate. Two-factor authentication is required.", "เข้าสู่บัญชี Apple เปิด Sign-In and Security → App-Specific Passwords → Generate ต้องเปิดการยืนยันสองปัจจัยไว้ก่อน", "https://account.apple.com/"],
        ["Enter your iCloud Mail address and generated password below, save, then test.", "ใส่อีเมล iCloud Mail และรหัสที่สร้างด้านล่าง กดบันทึก แล้วทดสอบ"],
      ],
      yahoo: [
        ["Open Yahoo Account Security → Generate and manage app passwords. Create a password for Awuuu.", "เปิด Yahoo Account Security → Generate and manage app passwords แล้วสร้างรหัสสำหรับ Awuuu", "https://login.yahoo.com/account/security"],
        ["Enter your Yahoo email and generated password below, save, then test. Some accounts may not offer app password generation.", "ใส่อีเมล Yahoo และรหัสที่สร้างด้านล่าง กดบันทึก แล้วทดสอบ บางบัญชีอาจไม่มีตัวเลือกสร้างรหัสผ่านสำหรับแอป"],
      ],
      outlook: [["Outlook/Hotmail requires modern authentication. Use Microsoft sign-in above; an app password will not work with this IMAP connector.", "Outlook/Hotmail ต้องใช้การยืนยันตัวตนแบบใหม่ ให้ใช้ Microsoft sign-in ด้านบน รหัสผ่านสำหรับแอปใช้กับตัวเชื่อม IMAP นี้ไม่ได้"]],
      custom: [["Ask your mail provider for the IMAP hostname, TLS port (usually 993), and an app password. Enter hostname:port, email and app password, then save and test. OAuth-only servers are not supported by this password connector.", "ขอชื่อเซิร์ฟเวอร์ IMAP พอร์ต TLS (ปกติ 993) และรหัสผ่านสำหรับแอปจากผู้ให้บริการเมล ใส่ hostname:port อีเมล และรหัสผ่านสำหรับแอป บันทึกแล้วทดสอบ ตัวเชื่อมแบบรหัสผ่านนี้ไม่รองรับเซิร์ฟเวอร์ที่บังคับ OAuth"]],
    };
    instructions.replaceChildren(setupSteps(...(steps[mode] ?? steps.custom)));
  };
  const service = dropdown({
    options: () => [
      { value: "gmail", label: "Gmail" },
      ...(mode === "outlook" ? [{ value: "outlook", label: "Outlook / Hotmail · OAuth" }] : []),
      { value: "icloud", label: t("iCloud") },
      { value: "yahoo", label: t("Yahoo") },
      { value: "custom", label: t("Other (IMAP host)") },
    ],
    get: () => mode,
    set: (v) => {
      mode = v;
      custom.style.display = v === "custom" ? "" : "none";
      drawInstructions();
      if (v !== "custom") {
        settings.mailHost = v;
        void save();
      }
    },
  });
  drawInstructions();
  return block("adv-imap", t("Mail with an app password (IMAP)"),
    h("div", { class: "row int-field" }, h("label", { text: t("Service") }), service, custom),
    instructions, fields,
    setupImage("calendar-mail", "Panel 2: enter an app name, create the password, then copy the generated password to Awuuu.", "ภาพที่ 2: ใส่ชื่อแอป สร้างรหัสผ่าน แล้วคัดลอกรหัสที่ได้มาใส่ Awuuu"),
  );
}


function oauthProvider(id: Account | "github"): HTMLElement {
  if (id === "google") return setupPanel("client-google", "Google · Gmail / Calendar",
        copyValue(languageText("Suggested app name", "ชื่อแอปตัวอย่าง"), "Awuuu"),
        setupImage("google-oauth", "Enable API → Branding → Audience → Desktop client.", "เปิด API → ตั้งค่า Branding → เพิ่ม Test user → สร้าง Desktop client"),
        setupSteps(
          ["Create or select a project in Google Cloud Console.", "สร้างหรือเลือกโปรเจกต์ใน Google Cloud Console", "https://console.cloud.google.com/projectcreate"],
          ["In APIs & Services → Library, enable Gmail API and Google Calendar API.", "ไปที่ APIs & Services → Library แล้วเปิด Gmail API และ Google Calendar API", "https://console.cloud.google.com/apis/library"],
          ["Open Google Auth Platform. Configure Branding and Audience; for a personal test app, add your own email under Test users.", "เปิด Google Auth Platform ตั้งค่า Branding และ Audience ถ้าเป็นแอปทดลองส่วนตัว ให้เพิ่มอีเมลของตัวเองใน Test users", "https://console.cloud.google.com/auth/overview"],
          ["In Clients, create an OAuth client of type Desktop app. Copy the Client ID and Client secret into the fields below; press Save beside the secret.", "ใน Clients สร้าง OAuth client ชนิด Desktop app คัดลอก Client ID และ Client secret มาใส่ด้านล่าง แล้วกดบันทึกข้างช่อง secret", "https://console.cloud.google.com/auth/clients"],
          ["Return to Connect an account → Google and sign in. A test app can show an unverified-app notice, and test refresh tokens may expire after seven days.", "กลับไปที่เชื่อมบัญชี → Google แล้วเข้าสู่ระบบ แอปทดลองอาจขึ้นแจ้งว่าแอปยังไม่ผ่านการตรวจสอบ และอาจต้องเข้าสู่ระบบใหม่หลังเจ็ดวัน"],
        ),
        settingRow(t("Client ID"), () => settings.googleClientId ?? "", (v) => (settings.googleClientId = v), "1234567890-abc….apps.googleusercontent.com"),
        secretRow(t("Client secret"), "google-client-secret", "GOCSPX-…"),
      );
  if (id === "microsoft") return setupPanel("client-microsoft", "Microsoft · Outlook / Calendar",
        copyValue(languageText("Suggested app name", "ชื่อแอปตัวอย่าง"), "Awuuu"),
        setupSteps(
          ["Open App registrations → New registration. Name it Awuuu and allow organizational directories and personal Microsoft accounts.", "เปิด App registrations → New registration ตั้งชื่อ Awuuu และเลือกให้ใช้ได้ทั้งบัญชีองค์กรและบัญชี Microsoft ส่วนตัว", "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"],
          ["In Authentication, add Mobile and desktop applications with redirect URI http://localhost/callback, then enable Allow public client flows.", "ใน Authentication เพิ่ม Mobile and desktop applications พร้อม redirect URI http://localhost/callback แล้วเปิด Allow public client flows"],
          ["In API permissions → Microsoft Graph → Delegated permissions, add User.Read, Mail.Read, Calendars.Read and offline_access. Your organization may require administrator consent.", "ใน API permissions → Microsoft Graph → Delegated permissions เพิ่ม User.Read, Mail.Read, Calendars.Read และ offline_access บัญชีองค์กรอาจต้องให้ผู้ดูแลอนุมัติ"],
          ["Copy Application (client) ID from Overview below. No client secret is needed. Return to Connect an account → Microsoft and sign in.", "คัดลอก Application (client) ID จาก Overview มาใส่ด้านล่าง ไม่ต้องใช้ client secret แล้วกลับไปเชื่อมบัญชี → Microsoft เพื่อเข้าสู่ระบบ"],
        ),
        copyValue("Redirect URI", "http://localhost/callback"),
        copyValue("Microsoft Graph permissions", "User.Read Mail.Read Calendars.Read offline_access"),
        settingRow(t("Client ID"), () => settings.microsoftClientId ?? "", (v) => (settings.microsoftClientId = v), "00000000-0000-0000-0000-000000000000"),
      );
  return setupPanel("client-github", "GitHub · Device Flow",
        copyValue(languageText("Suggested app name", "ชื่อแอปตัวอย่าง"), "Awuuu"),
        setupImage("github-notion", "Panel 3: create or edit a GitHub OAuth app.", "ภาพที่ 3: สร้างหรือแก้ไข GitHub OAuth app"),
        setupSteps(
          ["If GitHub CLI is already signed in, use Use GitHub CLI login above and skip these fields.", "ถ้า GitHub CLI เข้าสู่ระบบแล้ว ให้ใช้ปุ่มใช้การเข้าสู่ระบบ GitHub CLI ด้านบน และข้ามช่องเหล่านี้ได้"],
          ["Open Developer settings → OAuth Apps → New OAuth App. Use Awuuu as the name and this project's URL as the homepage. Enter http://127.0.0.1/callback as the callback URL.", "เปิด Developer settings → OAuth Apps → New OAuth App ตั้งชื่อ Awuuu ใช้ URL โปรเจกต์นี้เป็น Homepage และใส่ http://127.0.0.1/callback เป็น Callback URL", "https://github.com/settings/applications/new"],
          ["Register the app, enable Device Flow, then copy its Client ID below. Return to GitHub → Sign in with a code and follow the displayed code. No client secret is needed.", "สร้างแอปแล้วเปิด Device Flow คัดลอก Client ID มาใส่ด้านล่าง จากนั้นกลับไป GitHub → เข้าสู่ระบบด้วยรหัส และทำตามรหัสที่แสดง ไม่ต้องใช้ client secret"],
        ),
        copyValue("Homepage URL", "https://github.com/Thanawat-ONZro/Awuuu"),
        copyValue("Callback URL", "http://127.0.0.1/callback"),
        settingRow(t("Client ID"), () => settings.githubClientId ?? "", (v) => (settings.githubClientId = v), "Ov23li…"),
      );
}

function githubTokenSetup(): HTMLElement {
  return block("adv-github", t("GitHub with a personal access token"),
      setupImage("github-notion", "Panel 1: generate a GitHub classic token.", "ภาพที่ 1: สร้าง GitHub classic token"),
      setupSteps(
        ["Prefer Use GitHub CLI login if you already use gh. For a manual token, open Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic).", "ถ้าใช้ gh อยู่แล้ว แนะนำปุ่มใช้การเข้าสู่ระบบ GitHub CLI ถ้าจะใส่ token เอง ให้เปิด Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)", "https://github.com/settings/tokens/new"],
        ["Name it Awuuu, set an expiration, and choose repo, read:org and notifications for the current connector. The repo scope grants broad repository access; use this option only if that is acceptable. Organization approval or SSO authorization may also be required.", "ตั้งชื่อ Awuuu กำหนดวันหมดอายุ แล้วเลือก repo, read:org และ notifications ตามที่ตัวเชื่อมปัจจุบันใช้ สิทธิ์ repo เข้าถึง repository ได้กว้าง ให้ใช้ตัวเลือกนี้เมื่อยอมรับสิทธิ์ดังกล่าว บัญชีองค์กรอาจต้องอนุมัติหรือยืนยัน SSO เพิ่ม"],
        ["Generate the token, copy it before leaving GitHub, paste it below and press Save, then Test. When it expires, create a replacement and save it here.", "สร้าง token แล้วคัดลอกก่อนออกจากหน้า GitHub วางด้านล่าง กดบันทึก แล้วทดสอบ เมื่อหมดอายุให้สร้างใหม่แล้วนำมาบันทึกแทน"],
      ),
      secretRow("Token", "github-token", "ghp_…"),
      testRow("integration_github"),
    );
}

function advancedSection(): HTMLElement {
  const services = h("div", { class: "int-grid" });
  for (const s of serviceDefs()) {
    services.append(
      tile({ mark: s.mark, color: s.color, name: s.name, what: s.what, on: () => live.on.has(s.id) },
        ...s.fields.map(([label, key, placeholder, secret]) => secretRow(label, key, placeholder, secret ?? true)),
        testRow(s.id)),
    );
  }

  advanced = h("details", { class: "int-adv", id: "advanced" },
    h("summary", {}, h("span", { text: t("Other services") }), h("small", { text: languageText("Developer keys and optional Hermes tools", "คีย์บริการนักพัฒนาและเครื่องมือเสริม Hermes") })),

    block("adv-services", t("Other services"),
      h("div", { class: "hint", text: t("Each turns on as soon as its key is saved and off when you save it empty. Keys are stored in the Windows Credential Manager, never on disk.") }),
      services,
    ),
    composioSection(),
  ) as HTMLDetailsElement;
  return advanced;
}

export async function page(): Promise<HTMLElement> {
  watchers = [];
  const el = pageOf(t("Integrations"), t("Start with one field and no account. Connect accounts or add developer keys only if you need them."),
    simpleSection(), mailAndCalendar(), githubSection(), advancedSection());
  await sync();
  return el;
}
