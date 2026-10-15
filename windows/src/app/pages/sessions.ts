// Sessions: what every agent did — requests, files, commands, full log — with
// search, a recap to paste in a PR, and Markdown/JSON export.
//
// The list on the left, one session on the right. Everything heavy is drawn
// only when it is opened (a request's steps, a step's output), and long lists
// are capped behind "Show more", so 5000 entries stay quick.

import "../dashboard.css";
import { Bridge, type HistoryData, type HistoryEntry } from "../../core/bridge";
import { h, clear } from "../../views/dom";
import { dropdown } from "../../ui/select";
import { navigate, onLeave } from "../shell";
import { pageOf, settings } from "../ui";
import { lastTestRun, turnStory } from "../story";
import { handoffNote } from "../handoff";
import { redact } from "../../island/awareness";
import { exportFiles, loadHistory, onHistoryChanged } from "../history-data";
import { agentDot, clickable, clock, copyText, highlight, plural, rangeLabel, relTime } from "../dash-ui";
import {
  agentMeta, dayStart, exportAll, exportSession, folderOf, formatDuration, recapTurns, relPath,
  searchSession, sessionMarkdown, summarizeSessions, turnMarkdown, turnSummary,
  type Facts, type FileTouch, type SessionSummary, type Turn,
} from "../recap";
import { t } from "../../i18n/i18n";

const LIST_PAGE = 60;
const TURN_PAGE = 30;
const STEP_PAGE = 40;
const LOG_PAGE = 200;
const FILE_PAGE = 12;

type Range = "today" | "7" | "all";

const CHANGE_MARK: Record<FileTouch["change"], string> = { read: "R", edit: "M", write: "A", delete: "D" };
const CHANGE_WORD: Record<FileTouch["change"], string> = { read: "read", edit: "edited", write: "written", delete: "deleted" };

function factChips(f: Facts, requests?: number): HTMLElement {
  const box = h("div", { class: "chips" });
  const add = (n: number, text: string, cls = "") => {
    if (n > 0) box.append(h("span", { class: `chip ${cls}`.trim(), text }));
  };
  if (requests != null) add(requests, plural(requests, "request"));
  add(f.edited, `${plural(f.edited, "file")} edited`);
  add(f.written, `${plural(f.written, "file")} written`);
  add(f.deleted, `${plural(f.deleted, "file")} deleted`);
  add(f.read, `${plural(f.read, "file")} read`);
  add(f.commands, plural(f.commands, "command"));
  add(f.commandsFailed, `${f.commandsFailed} failed`, "bad");
  add(f.searches, plural(f.searches, "search", "searches"));
  add(f.web, `${f.web} web`);
  add(f.agents, plural(f.agents, "sub-agent"));
  add(f.mcp, `${f.mcp} MCP`);
  add(f.skills, plural(f.skills, "skill"));
  if (requests == null && f.ms >= 1000) box.append(h("span", { class: "chip dim", text: formatDuration(f.ms) }));
  return box;
}

export function page(): HTMLElement {
  // ── State ────────────────────────────────────────────────────────────────
  let data: HistoryData = { entries: [], sessions: {} };
  let all: SessionSummary[] = [];
  let visible: SessionSummary[] = [];
  let hits = new Map<string, { meta: boolean; hits: Set<HistoryEntry> }>();
  let loaded = false;
  let loadError = "";
  let alive = true;

  let query = "";
  let agent = "";
  let range: Range = "7";
  let selected: string | null = null;
  let fullLog = false;
  let listCap = LIST_PAGE;
  /** Explicit open/closed choices, by `<session>#<turn>`; default: newest open. */
  const turnOpen = new Map<string, boolean>();
  /** Entry ids whose detail is expanded (survives a refresh). */
  const stepOpen = new Set<string>();
  /** How many steps / turns / log lines are drawn, by key. */
  const caps = new Map<string, number>();

  // ── Skeleton ─────────────────────────────────────────────────────────────
  const search = h("input", {
    type: "text", class: "dash-search", placeholder: t("Search prompts, commands, output, files…"), spellcheck: "false",
  }) as HTMLInputElement;
  const matchInfo = h("span", { class: "hint match-info" });
  const agentPick = dropdown({
    title: t("Agent"),
    options: () => [
      { value: "", label: t("All agents") },
      ...[...new Set(all.map((s) => s.agent))].sort().map((a) => ({ value: a, label: agentMeta(a).name })),
    ],
    get: () => agent,
    set: (v) => { agent = v; listCap = LIST_PAGE; render(); },
  });
  const rangePick = dropdown({
    title: t("Dates"),
    options: () => [
      { value: "today", label: t("Today") },
      { value: "7", label: t("7 days") },
      { value: "all", label: t("All") },
    ],
    get: () => range,
    set: (v) => { range = v as Range; listCap = LIST_PAGE; render(); },
  });
  const refreshBtn = h("button", { text: t("Refresh"), title: t("Read the history again"), onclick: () => void load() });
  const exportAllBtn = h("button", { text: t("Export all"), title: t("Save every listed session as one .md and one .json in Downloads") });
  exportAllBtn.addEventListener("click", () => {
    void doExport(exportAll(visible), `${plural(visible.length, "session")} exported`, exportAllBtn);
  });

  const toolbar = h("div", { class: "dash-toolbar" }, search, agentPick, rangePick, matchInfo,
    h("span", { class: "spacer" }), refreshBtn, exportAllBtn);
  const status = h("div", { class: "dash-status" });
  const offNote = h("div", {});
  const listEl = h("div", { class: "sess-list" });
  const detailEl = h("div", { class: "sess-detail" });
  const panes = h("div", { class: "sess-panes" }, listEl, detailEl);
  const body = h("div", { class: "sess-body" });

  const root = pageOf(t("Sessions"), t("Everything your agents did on this PC, kept locally."), toolbar, status, offNote, body);
  root.classList.add("wide", "dash");

  let debounce = 0;
  search.addEventListener("input", () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      query = search.value.trim();
      listCap = LIST_PAGE;
      render();
    }, 180);
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && search.value) {
      search.value = "";
      query = "";
      render();
    }
  });

  // ── Data ─────────────────────────────────────────────────────────────────
  async function load() {
    refreshBtn.disabled = true;
    try {
      data = await loadHistory();
      loadError = "";
    } catch (err) {
      loadError = String(err).replace(/^Error:\s*/, "");
    }
    refreshBtn.disabled = false;
    if (!alive) return;
    loaded = true;
    all = summarizeSessions(data);
    agentPick.refresh();
    render();
  }

  function filter() {
    const since = range === "today" ? dayStart(Date.now()) : range === "7" ? dayStart(Date.now(), 6) : 0;
    hits = new Map();
    visible = [];
    for (const s of all) {
      if (agent && s.agent !== agent) continue;
      if (s.last < since) continue;
      if (query) {
        const r = searchSession(s, query);
        if (!r.meta && r.hits.length === 0) continue;
        hits.set(s.id, { meta: r.meta, hits: new Set(r.hits) });
      }
      visible.push(s);
    }
  }

  // ── Export / copy ────────────────────────────────────────────────────────
  async function doExport(bundle: { name: string; markdown: string; json: string }, what: string, btn: HTMLButtonElement) {
    btn.disabled = true;
    clear(status);
    try {
      const paths = await exportFiles(bundle.name, bundle.markdown, bundle.json);
      const box = h("div", { class: "notice ok export-done" },
        h("div", { class: "row" },
          h("strong", { text: t("{what} to Downloads.", { what }) }),
          h("span", { class: "spacer" }),
          paths.length > 0 ? h("button", { text: t("Show in folder"), onclick: () => void Bridge.revealFile(paths[0]) }) : null,
          h("button", { text: t("Close"), onclick: () => clear(status) })),
        ...paths.map((p) => h("div", { class: "path", text: p })));
      status.append(box);
    } catch (err) {
      status.append(h("div", { class: "notice err", text: t("Could not export: {v}", { v: String(err).replace(/^Error:\s*/, "") }) }));
    }
    btn.disabled = false;
    status.scrollIntoView({ block: "nearest" });
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function render() {
    filter();
    clear(offNote);
    clear(body);
    const off = settings.historyEnabled === false;
    const privacyLink = h("button", { text: t("Open Privacy & history"), onclick: () => void navigate("privacy") });

    exportAllBtn.disabled = visible.length === 0;
    matchInfo.textContent = "";

    if (!loaded) {
      body.append(h("section", {}, h("div", { class: "empty-state" }, h("span", { text: t("Reading the history…") }))));
      return;
    }
    if (loadError) {
      body.append(h("section", {}, h("div", { class: "notice err", text: t("The history could not be read: {loadError}", { loadError }) })));
      return;
    }
    if (all.length === 0) {
      body.append(h("section", {}, off
        ? h("div", { class: "empty-state" },
          h("strong", { text: t("History is turned off.") }),
          h("span", { text: t("Awuuu is not recording what your agents do. Turn it on to see sessions here.") }),
          privacyLink)
        : h("div", { class: "empty-state" },
          h("strong", { text: t("Nothing recorded yet.") }),
          h("span", { text: t("Start a session in a connected agent and it shows up here.") }),
          h("button", { text: t("Connect an agent"), onclick: () => void navigate("agents") }))));
      return;
    }
    if (off) {
      offNote.append(h("div", { class: "notice warn row" },
        h("span", { text: t("History is turned off — nothing new is recorded. What you see is what was kept before.") }),
        h("span", { class: "spacer" }), privacyLink));
    }

    if (query) {
      let n = 0;
      let inSessions = 0;
      for (const s of visible) {
        const c = hits.get(s.id)?.hits.size ?? 0;
        n += c;
        if (c > 0) inSessions++;
      }
      matchInfo.textContent = visible.length === 0
        ? t("No matches")
        : `${plural(n, "match", "matches")} in ${plural(inSessions, "session")}${visible.length > inSessions ? ` · ${visible.length - inSessions} by name` : ""}`;
    }

    if (visible.length === 0) {
      const filtered = query || agent || range !== "all";
      body.append(h("section", {}, h("div", { class: "empty-state" },
        h("strong", { text: query ? t("Nothing matches “{query}”.", { query }) : t("No sessions in this view.") }),
        h("span", { text: t("{v} kept in total. Try another search, agent or date range.", { v: plural(all.length, "session") }) }),
        filtered ? h("button", {
          text: t("Clear filters"),
          onclick: () => {
            query = "";
            search.value = "";
            agent = "";
            range = "all";
            agentPick.refresh();
            rangePick.refresh();
            render();
          },
        }) : null)));
      return;
    }

    if (!selected || !visible.some((s) => s.id === selected)) selected = visible[0].id;
    body.append(panes);
    renderList();
    renderDetail();
  }

  function renderList() {
    const keep = listEl.scrollTop;
    clear(listEl);
    const now = Date.now();
    for (const s of visible.slice(0, listCap)) {
      const meta = agentMeta(s.agent);
      const changed = s.facts.changed.length;
      const bits = [plural(s.requests, "request")];
      if (changed) bits.push(`${plural(changed, "file")} changed`);
      if (s.facts.commands) bits.push(plural(s.facts.commands, "command"));
      const hit = hits.get(s.id);
      const row = h("div", { class: s.id === selected ? "sess-row on" : "sess-row", "data-id": s.id },
        h("div", { class: "sess-top" },
          agentDot(s.agent),
          h("strong", { class: "sess-name" }, highlight(s.name, query)),
          h("span", { class: "sess-agent", text: meta.short }),
          s.state === "running" ? h("span", { class: "st st-running", text: "running" })
            : s.state === "waiting" ? h("span", { class: "st st-waiting", text: "waiting" })
              : s.state === "failed" ? h("span", { class: "st st-failed", text: t("{failures} failed", { failures: s.facts.failures }) }) : null,
          h("span", { class: "spacer" }),
          h("span", { class: "sess-when", text: relTime(s.last, now), title: rangeLabel(s.first, s.last) })),
        s.cwd ? h("div", { class: "sess-folder", title: s.cwd }, highlight(folderOf(s.cwd, 3), query)) : null,
        h("div", { class: "sess-meta", title: bits.join(" · ") }, h("span", { text: bits.join(" · ") })),
        hit && hit.hits.size > 0 ? h("div", { class: "sess-hits", text: plural(hit.hits.size, "match", "matches") }) : null,
      );
      clickable(row, () => {
        if (selected === s.id) return;
        selected = s.id;
        listEl.querySelectorAll(".sess-row.on").forEach((el) => el.classList.remove("on"));
        row.classList.add("on");
        renderDetail();
        // Stacked: bring the detail up. Side by side: back to its top if scrolled past.
        if (window.matchMedia("(max-width: 860px)").matches) detailEl.scrollIntoView({ block: "start" });
        else if (detailEl.getBoundingClientRect().top < 0) root.parentElement?.scrollTo({ top: 0 });
      });
      listEl.append(row);
    }
    if (visible.length > listCap) {
      listEl.append(h("button", {
        class: "more",
        text: t("Show {v} more ({v2} left)", { v: Math.min(LIST_PAGE, visible.length - listCap), v2: visible.length - listCap }),
        onclick: () => { listCap += LIST_PAGE; renderList(); },
      }));
    }
    listEl.scrollTop = keep;
  }

  function stepRow(e: HistoryEntry, cwd: string): HTMLElement {
    const el = h("div", { class: `step is-${e.kind === "error" ? "failed" : e.status}` });
    const label = e.title.trim() || e.tool || e.kind;
    const head = h("div", { class: "step-head" },
      h("span", { class: `kind k-${e.kind}`, text: e.kind }),
      h("span", { class: "step-title" }, highlight(label.length > 300 ? `${label.slice(0, 300)}…` : label, query)),
      h("span", { class: "step-time", text: clock(e.at) }),
      h("span", { class: "step-ms", text: e.ms && e.ms > 0 ? formatDuration(e.ms) : "" }),
      e.status === "info" ? h("span", { class: "st" }) : h("span", { class: `st st-${e.status}`, text: e.status }));
    let bodyEl: HTMLElement | null = null;
    const draw = () => {
      const open = stepOpen.has(e.id);
      el.classList.toggle("open", open);
      if (open && !bodyEl) {
        bodyEl = h("div", { class: "step-body" });
        if (e.tool) bodyEl.append(h("div", { class: "step-tool" }, h("span", { class: "hint", text: "Tool " }), h("code", {}, highlight(e.tool, query))));
        if (label.length > 80 || label.includes("\n")) bodyEl.append(h("pre", { class: "out title-full" }, highlight(e.title, query)));
        for (const f of e.files ?? []) {
          bodyEl.append(h("div", { class: `file c-${f.change}` },
            h("span", { class: "file-mark", text: CHANGE_MARK[f.change], title: CHANGE_WORD[f.change] }),
            h("span", { class: "path" }, highlight(relPath(f.path, cwd), query))));
        }
        if (e.detail) {
          // Highlighting a huge output makes thousands of nodes: plain text then.
          const pre = h("pre", { class: "out" });
          if (e.detail.length <= 40_000) pre.append(highlight(e.detail, query));
          else pre.textContent = e.detail;
          bodyEl.append(pre);
        } else if (!e.files?.length) {
          bodyEl.append(h("div", { class: "hint", text: t("Nothing more was recorded for this step.") }));
        }
        el.append(bodyEl);
      }
    };
    clickable(head, () => {
      if (stepOpen.has(e.id)) stepOpen.delete(e.id);
      else stepOpen.add(e.id);
      draw();
    });
    el.append(head);
    draw();
    return el;
  }

  /** A capped list of step rows with "Show more". */
  function stepList(key: string, entries: HistoryEntry[], cwd: string, page: number): HTMLElement {
    const box = h("div", { class: "steps" });
    const draw = () => {
      clear(box);
      const cap = caps.get(key) ?? page;
      for (const e of entries.slice(0, cap)) box.append(stepRow(e, cwd));
      if (entries.length > cap) {
        box.append(h("button", {
          class: "more",
          text: t("Show {v} more ({v2} left)", { v: Math.min(page * 2, entries.length - cap), v2: entries.length - cap }),
          onclick: () => { caps.set(key, cap + page * 2); draw(); },
        }));
      }
    };
    draw();
    return box;
  }

  function fileList(files: FileTouch[], cwd: string, key: string): HTMLElement {
    const box = h("div", { class: "files" });
    const draw = () => {
      clear(box);
      const cap = caps.get(key) ?? FILE_PAGE;
      for (const f of files.slice(0, cap)) {
        box.append(h("div", { class: `file c-${f.change}`, title: f.path },
          h("span", { class: "file-mark", text: CHANGE_MARK[f.change], title: CHANGE_WORD[f.change] }),
          h("span", { class: "path" }, highlight(relPath(f.path, cwd), query))));
      }
      if (files.length > cap) {
        box.append(h("button", { class: "more", text: t("Show all {length} files", { length: files.length }), onclick: () => { caps.set(key, files.length); draw(); } }));
      }
    };
    draw();
    return box;
  }

  function turnBlock(s: SessionSummary, turn: Turn, isNewest: boolean, found: Set<HistoryEntry> | null): HTMLElement {
    const key = `${s.id}#${turn.index}`;
    const steps = found ? turn.steps.filter((e) => found.has(e)) : turn.steps;
    const promptText = turn.prompt ? (turn.prompt.detail?.trim() || turn.prompt.title) : "";
    const first = turn.prompt?.at ?? turn.steps[0]?.at ?? turn.end?.at ?? s.first;
    const waiting = turn.steps.some((e) => e.status === "waiting");
    const el = h("div", { class: "turn" });
    const head = h("div", { class: "turn-head" },
      h("i", { class: "caret" }),
      h("span", { class: "turn-n", text: turn.prompt ? `#${s.turns.slice(0, turn.index + 1).filter((x) => x.prompt).length}` : "–" }),
      h("span", { class: "turn-title" }, highlight(turn.prompt ? (turn.prompt.title.split(/\r?\n/)[0] || "(empty request)") : "Before the first recorded request", query)),
      found ? h("span", { class: "sess-hits", text: plural(steps.length + (turn.prompt && found.has(turn.prompt) ? 1 : 0) + (turn.end && found.has(turn.end) ? 1 : 0), "match", "matches") }) : null,
      h("span", { class: "step-time", text: clock(first, false) }),
      h("span", { class: "step-ms", text: turn.facts.ms >= 1000 ? formatDuration(turn.facts.ms) : "" }),
      turn.end?.kind === "error" ? h("span", { class: "st st-failed", text: "error" })
        : waiting && isNewest && s.state === "waiting" ? h("span", { class: "st st-waiting", text: "waiting" })
          : !turn.end && isNewest && s.state === "running" ? h("span", { class: "st st-running", text: "running" })
            : turn.facts.failures > 0 ? h("span", { class: "st st-failed", text: t("{failures} failed", { failures: turn.facts.failures }) })
              : turn.end ? h("span", { class: "st st-ok", text: "done" }) : h("span", { class: "st" }));
    let bodyEl: HTMLElement | null = null;
    const isOpen = () => turnOpen.get(key) ?? (found ? true : isNewest);
    const draw = () => {
      const open = isOpen();
      el.classList.toggle("open", open);
      if (!open || bodyEl) return;
      bodyEl = h("div", { class: "turn-body" });
      if (promptText) bodyEl.append(h("pre", { class: "prompt" }, highlight(promptText, query)));
      bodyEl.append(factChips(turn.facts));
      const story = turnStory(turn);
      const storyEl = h("div", { class: `story t-${story.tests ?? "none"}` }, h("span", { class: "story-line", text: story.line }));
      const run = story.tests === "unclear" || story.tests === "no-tests" ? lastTestRun(turn) : null;
      if (run) {
        // A second opinion, only on a click: the output's end goes to Hermes, redacted.
        const ask = h("button", { class: "story-ask", text: t("Ask Hermes"), title: t("Send the end of this test output (keys and e-mails removed) to Hermes for a verdict") });
        ask.addEventListener("click", async (e) => {
          e.stopPropagation();
          ask.setAttribute("disabled", "");
          ask.textContent = t("Asking…");
          try {
            const word = await Bridge.judgeTests(redact(run.title), redact(run.detail ?? ""));
            ask.textContent = word === "passed" ? t("Hermes: passed") : word === "failed" ? "Hermes: failed" : "Hermes: can't tell";
          } catch (err) {
            ask.textContent = String(err).replace(/^Error:\s*/, "");
          }
        });
        storyEl.append(ask);
      }
      bodyEl.append(storyEl);
      for (const w of story.warnings) bodyEl.append(h("div", { class: "notice warn", text: `⚠ ${w}` }));
      const summary = turnSummary(turn);
      if (summary) {
        bodyEl.append(h("div", { class: "summary" },
          h("div", { class: "label", text: t("{short}'s summary", { short: agentMeta(s.agent).short }) }),
          h("pre", { class: "summary-text" }, highlight(summary, query))));
      }
      if (turn.end?.kind === "error") {
        bodyEl.append(h("div", { class: "notice err" }, highlight(`Ended with an error: ${turn.end.detail?.trim() || turn.end.title}`, query)));
      }
      if (turn.facts.changed.length > 0) {
        bodyEl.append(h("div", { class: "label", text: t("Changed files ({length})", { length: turn.facts.changed.length }) }), fileList(turn.facts.changed, s.cwd, `f:${key}`));
      }
      if (steps.length > 0) {
        bodyEl.append(
          h("div", { class: "label", text: found ? t("Matching steps ({length} of {length2})", { length: steps.length, length2: turn.steps.length }) : t("Steps ({length})", { length: steps.length }) }),
          stepList(`s:${key}:${found ? query : ""}`, steps, s.cwd, STEP_PAGE));
      } else if (!found) {
        bodyEl.append(h("div", { class: "hint", text: t("No steps were recorded for this request.") }));
      }
      const copy = h("button", { text: t("Copy recap"), title: t("Copy this request as Markdown") }) as HTMLButtonElement;
      copy.addEventListener("click", () => void copyText(turnMarkdown(turn, s), copy, status).then((ok) => {
        if (!ok) status.scrollIntoView({ block: "nearest" });
      }));
      bodyEl.append(h("div", { class: "row turn-actions" }, copy));
      el.append(bodyEl);
    };
    clickable(head, () => {
      turnOpen.set(key, !isOpen());
      draw();
    });
    el.append(head);
    draw();
    return el;
  }

  function renderDetail() {
    clear(detailEl);
    const s = visible.find((x) => x.id === selected);
    if (!s) return;
    const meta = agentMeta(s.agent);
    const hit = hits.get(s.id);
    // Matched by its name only: show the whole session.
    const found = query && hit && hit.hits.size > 0 ? hit.hits : null;
    const work = s.turns.reduce((sum, t) => sum + t.facts.ms, 0);

    const copy = h("button", { class: "primary", text: t("Copy recap"), title: t("Copy the whole session as Markdown, ready for a PR") }) as HTMLButtonElement;
    copy.addEventListener("click", () => void copyText(sessionMarkdown(s), copy, status).then((ok) => {
      if (!ok) status.scrollIntoView({ block: "nearest" });
    }));
    const handoff = h("button", { text: t("Copy handoff"), title: t("Copy a note another agent can continue from: what was asked, what changed, how the tests stand") }) as HTMLButtonElement;
    handoff.addEventListener("click", () => void copyText(handoffNote(s), handoff, status).then((ok) => {
      if (!ok) status.scrollIntoView({ block: "nearest" });
    }));
    const exp = h("button", { text: t("Export .md + .json"), title: t("Save this session to Downloads") }) as HTMLButtonElement;
    exp.addEventListener("click", () => void doExport(exportSession(s), "Session exported", exp));
    const logBtn = h("button", {
      class: fullLog ? "seg on" : "seg", text: t("Full log"), "aria-pressed": fullLog,
      title: t("Every entry of this session in one flat list"),
      onclick: () => { fullLog = !fullLog; renderDetail(); },
    });

    detailEl.append(h("section", { class: "sess-head" },
      h("div", { class: "sess-title" },
        agentDot(s.agent, 10),
        h("h2", {}, highlight(s.name, query)),
        h("span", { class: "sess-agent", text: meta.name }),
        s.state === "running" ? h("span", { class: "st st-running", text: "running" })
          : s.state === "waiting" ? h("span", { class: "st st-waiting", text: t("waiting for you") }) : null),
      s.cwd ? h("div", { class: "path" }, highlight(s.cwd, query)) : null,
      h("div", { class: "hint", text: `${rangeLabel(s.first, s.last)}${work >= 1000 ? ` · ${formatDuration(work)} of work` : ""} · ${plural(s.entries.length, "entry", "entries")}` }),
      factChips(s.facts, s.requests),
      h("div", { class: "row" }, copy, handoff, exp, h("span", { class: "spacer" }), logBtn),
    ));

    if (query) {
      detailEl.append(h("div", { class: "hint found-note", text: found
        ? t("Showing the {v} matching “{query}” in this session. Clear the search to see everything.", { v: plural(found.size, "entry", "entries"), query })
        : t("This session matches “{query}” by its name or folder; no entry inside matches.", { query }) }));
    }

    if (fullLog) {
      const entries = found ? s.entries.filter((e) => found.has(e)) : s.entries;
      detailEl.append(h("section", { class: "log-flat" },
        h("div", { class: "label", text: found ? t("Full log — {length} of {length2} entries", { length: entries.length, length2: s.entries.length }) : t("Full log — {v}, oldest first", { v: plural(entries.length, "entry", "entries") }) }),
        stepList(`log:${s.id}:${found ? query : ""}`, entries, s.cwd, LOG_PAGE)));
      return;
    }

    // Newest request first; with a search, only the requests that have a match.
    const turns = [...recapTurns(s)].reverse()
      .filter((t) => !found || (t.prompt && found.has(t.prompt)) || (t.end && found.has(t.end)) || t.steps.some((e) => found.has(e)));
    const newest = s.turns[s.turns.length - 1];
    const box = h("div", { class: "turns" });
    const capKey = `t:${s.id}`;
    const draw = () => {
      clear(box);
      const cap = caps.get(capKey) ?? TURN_PAGE;
      for (const t of turns.slice(0, cap)) box.append(turnBlock(s, t, t === newest, found));
      if (turns.length > cap) {
        box.append(h("button", {
          class: "more", text: t("Show {v} older requests ({v2} left)", { v: Math.min(TURN_PAGE, turns.length - cap), v2: turns.length - cap }),
          onclick: () => { caps.set(capKey, cap + TURN_PAGE); draw(); },
        }));
      }
    };
    draw();
    detailEl.append(box);
  }

  // ── Life cycle ───────────────────────────────────────────────────────────
  const stop = onHistoryChanged(() => void load());
  onLeave(() => {
    alive = false;
    window.clearTimeout(debounce);
    stop();
    agentPick.close();
    rangePick.close();
  });

  render();
  void load();
  return root;
}
