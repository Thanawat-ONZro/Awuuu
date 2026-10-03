// Privacy & history: what Awuuu keeps, where, and what leaves this PC.

import "../dashboard.css";
import { Bridge } from "../../core/bridge";
import { h, clear } from "../../views/dom";
import { navigate } from "../shell";
import { card, pageOf, save, select, settings, toggle } from "../ui";
import { clearHistory, loadHistoryInfo, type HistoryInfo } from "../history-data";
import { bytesLabel, plural } from "../dash-ui";

function historyCard(): HTMLElement {
  const days = h("input", {
    type: "number", min: "1", max: "90", step: "1", style: "width:72px",
    value: String(Math.round(settings.historyDays || 7)),
  }) as HTMLInputElement;
  days.addEventListener("change", () => {
    settings.historyDays = Math.max(1, Math.min(90, Math.round(Number(days.value)) || 7));
    days.value = String(settings.historyDays);
    void save();
  });

  const state = h("span", { class: "hint" });
  const sayState = () => {
    state.textContent = settings.historyEnabled
      ? "On — what your agents do is written to one file on this PC."
      : "Off — nothing new is recorded.";
  };
  sayState();

  const file = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  let info: HistoryInfo | null = null;

  function drawFile(message?: HTMLElement) {
    clear(file);
    if (!info) {
      file.append(h("div", { class: "row" }, h("label", { text: "File" }),
        h("span", { class: "hint", text: "Awuuu could not say where the history file is." })));
      if (message) file.append(message);
      return;
    }
    const path = info.path;
    file.append(
      h("div", { class: "row" }, h("label", { text: "File" }), h("span", { class: "path", style: "flex:1 1 200px", text: path })),
      h("div", { class: "row" }, h("label", { text: "Size" }),
        h("span", { text: `${bytesLabel(info.bytes)} · ${plural(info.entries, "entry", "entries")}` })),
    );
    if (message) file.append(message);
    const clearBtn = h("button", { class: "danger", text: "Clear history…", onclick: () => drawConfirm() });
    clearBtn.disabled = info.entries === 0 && info.bytes === 0;
    file.append(h("div", { class: "row" },
      h("button", { text: "Show in folder", onclick: () => void Bridge.revealFile(path) }),
      h("button", { text: "Open Sessions", onclick: () => void navigate("sessions") }),
      h("span", { class: "spacer" }), clearBtn));
  }

  function drawConfirm() {
    if (!info) return;
    const n = info.entries;
    const yes = h("button", { class: "danger", text: "Delete the history" }) as HTMLButtonElement;
    const box = h("div", { class: "notice warn confirm" },
      h("span", { text: `This deletes ${n > 0 ? `all ${plural(n, "entry", "entries")}` : "the history file"} from this PC. It cannot be undone. Files you exported to Downloads are not touched.` }),
      h("div", { class: "row" }, yes, h("button", { text: "Cancel", onclick: () => drawFile() })));
    yes.addEventListener("click", async () => {
      yes.disabled = true;
      try {
        await clearHistory();
        info = await loadHistoryInfo();
        drawFile(h("div", { class: "notice ok", text: "History cleared." }));
      } catch (err) {
        drawFile(h("div", { class: "notice err", text: `Could not clear the history: ${String(err).replace(/^Error:\s*/, "")}` }));
      }
    });
    clear(file);
    file.append(
      h("div", { class: "row" }, h("label", { text: "File" }), h("span", { class: "path", style: "flex:1 1 200px", text: info.path })),
      box);
  }

  void loadHistoryInfo().then((i) => {
    info = i;
    drawFile();
  }).catch(() => drawFile());
  drawFile();

  return card("History",
    h("div", { class: "hint", text: "The Sessions and Stats pages are built from this history: prompts, the commands and files of each step, and clipped output. It stays in one file on this PC. It can contain anything your agents printed, so treat an export like source code." }),
    h("div", { class: "row" }, h("label", { text: "Keep history" }),
      toggle(settings.historyEnabled !== false, (v) => {
        settings.historyEnabled = v;
        sayState();
        void save();
      }), state),
    h("div", { class: "row" }, h("label", { text: "Keep for" }), days,
      h("span", { class: "hint", text: "days (1–90). Older entries are removed." })),
    file,
  );
}

function fact(title: string, ...text: (Node | string)[]): HTMLElement {
  return h("div", { class: "fact" }, h("b", { text: title }), h("span", {}, ...text));
}

function leavesCard(): HTMLElement {
  const updates = settings.updateCheck === true;
  return card("What leaves this PC",
    h("div", { class: "notice ok", text: "Nothing by default. No telemetry, no analytics, no account. Awuuu only talks to services you set up yourself." }),
    h("div", { class: "facts-list" },
      fact("Chat", "What you type in the chat, and a file you drop on it, go to the chat provider you picked — by default your local Hermes Agent on this PC (127.0.0.1). Pick a cloud model or another provider and that conversation goes to them."),
      fact("Integrations", "Each integration you connect (GitHub, Stripe, Vercel, n8n, Resend, Notion, Cal.com, mail, weather, feeds, uptime checks) is polled at its own service. Not connected means never called."),
      fact("Update check", updates
        ? "On: Awuuu asks GitHub for the latest version every few hours. "
        : "Off: Awuuu contacts GitHub only when you click “Check for updates”. ",
      h("a", { href: "#", text: "Change in Sound & behaviour", onclick: (e) => { e.preventDefault(); void navigate("general"); } })),
      fact("Agent sessions", "Awuuu follows Claude Code, Codex and the others through local hooks and files. What it sees stays in the history above. The agents themselves talk to their own services, as they do without Awuuu."),
      fact("Usage limits", "Read from files your agents write on this PC."),
      fact("Keys & tokens", "Stored in Windows Credential Manager, never in Awuuu’s settings file."),
      fact("Exports", "“Export” writes a .md and a .json to your Downloads folder. Nothing is uploaded."),
    ),
  );
}

function awarenessCard(): HTMLElement {
  return card("Chat awareness",
    h("div", { class: "row" }, h("label", { text: "Share with the chat" }),
      select([
        ["local", "Only with Hermes and models on this PC (default)"],
        ["always", "With every chat model, cloud ones too"],
        ["off", "Never"],
      ], () => settings.chatAwareness || "local", (v) => (settings.chatAwareness = v))),
    h("div", { class: "hint", text: "A short note of what the island sees (your agents, the next meeting, PRs waiting for you) rides along with each chat message so answers fit what you are doing. E-mail addresses, keys and your user folder are removed first." }),
  );
}

export function page(): HTMLElement {
  const root = pageOf("Privacy & history",
    "Awuuu keeps everything on this PC. Nothing is sent anywhere unless you connect a service yourself.",
    awarenessCard(), historyCard(), leavesCard());
  root.classList.add("dash");
  return root;
}
