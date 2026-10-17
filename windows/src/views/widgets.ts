import { clear, h, svg } from "./dom";
import { ICONS } from "./icons";
import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import { t } from "../i18n/i18n";
import { formatTime, pctBar } from "../core/format";
import { loadList, loadValue, mergeById, saveList, saveValue } from "../core/store";
export { formatTime, pctBar };
export { createSystemModuleHost as createSystemWidget } from "./modules/system";

export function createDateWidget(refDate = new Date()) {
  const timeEl = h("div", { class: "widget-time" });
  const dayEl = h("div", { class: "widget-date-day" });
  const el = h("div", { class: "widget widget-date" }, timeEl, dayEl);
  function update(d = new Date()) {
    timeEl.textContent = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    dayEl.textContent = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }
  update(refDate);
  return { el, update };
}

export function createNowPlayingWidget(onActiveChange?: (active: boolean) => void) {
  const barsEl = h(
    "div",
    { class: "media-bars" },
    h("span", { class: "bar bar-1" }),
    h("span", { class: "bar bar-2" }),
    h("span", { class: "bar bar-3" }),
  );
  const artIcon = svg(ICONS.play, 12);
  const artEl = h("div", { class: "media-art" }, artIcon, barsEl);

  const titleEl = h("div", { class: "track-title" });
  const artistEl = h("div", { class: "track-artist" });
  const timeEl = h("div", { class: "track-time", style: "display:none" });
  const progressFill = h("div", { class: "track-progress-fill" });
  const progressEl = h("div", { class: "track-progress", style: "display:none" }, progressFill);

  const trackInfoEl = h("div", { class: "track-info" }, titleEl, artistEl, progressEl, timeEl);

  const prevBtn = h(
    "button",
    { class: "media-btn media-prev", title: t("Previous"), "aria-label": t("Previous") },
    svg(ICONS.prev, 12),
  );
  const playBtn = h(
    "button",
    { class: "media-btn media-play", title: t("Play / Pause"), "aria-label": t("Play / Pause") },
    svg(ICONS.pause, 12),
  );
  const nextBtn = h(
    "button",
    { class: "media-btn media-next", title: t("Next"), "aria-label": t("Next") },
    svg(ICONS.next, 12),
  );
  const controlsEl = h("div", { class: "media-controls" }, prevBtn, playBtn, nextBtn);

  const el = h(
    "div",
    { class: "widget widget-media", style: "display:none" },
    artEl,
    trackInfoEl,
    controlsEl,
  );

  prevBtn.addEventListener("click", async (e: Event) => {
    e.stopPropagation();
    try {
      await Bridge.mediaControl("prev");
      await refresh();
    } catch {
      /* ignore player errors */
    }
  });

  playBtn.addEventListener("click", async (e: Event) => {
    e.stopPropagation();
    try {
      await Bridge.mediaControl("play_pause");
      await refresh();
    } catch {
      /* ignore player errors */
    }
  });

  nextBtn.addEventListener("click", async (e: Event) => {
    e.stopPropagation();
    try {
      await Bridge.mediaControl("next");
      await refresh();
    } catch {
      /* ignore player errors */
    }
  });

  let wasActive = false;
  let lastTrackKey = "";
  let isRefreshing = false;
  let lastTickMs = 0;

  async function refresh() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      const info = await Bridge.nowPlaying();
      const isLive = Boolean(info && info.active);
      if (!isLive || !info) {
        if (el.style.display !== "none") {
          el.style.display = "none";
        }
        if (wasActive) {
          wasActive = false;
          lastTrackKey = "";
          onActiveChange?.(false);
        }
        return;
      }

      titleEl.textContent = info.title;
      artistEl.textContent = info.artist;

      clear(playBtn);
      playBtn.append(svg(info.playing ? ICONS.pause : ICONS.play, 12));
      playBtn.setAttribute("title", info.playing ? t("Pause") : t("Play"));

      if (info.durationMs != null && info.durationMs > 0) {
        const pos = info.positionMs ?? 0;
        const dur = info.durationMs;
        const pct = Math.min(100, Math.max(0, (pos / dur) * 100));
        progressFill.style.width = `${pct}%`;
        progressEl.style.display = "block";
        timeEl.textContent = `${formatTime(pos)} / ${formatTime(dur)}`;
        timeEl.style.display = "block";
      } else if (info.positionMs != null && info.positionMs > 0) {
        progressEl.style.display = "none";
        timeEl.textContent = formatTime(info.positionMs);
        timeEl.style.display = "block";
      } else {
        progressEl.style.display = "none";
        timeEl.style.display = "none";
      }

      if (el.style.display !== "flex") {
        el.style.display = "flex";
      }

      const trackKey = `${info.title} - ${info.artist}`;
      if (!wasActive || trackKey !== lastTrackKey) {
        wasActive = true;
        lastTrackKey = trackKey;
        onActiveChange?.(true);
      }
    } finally {
      isRefreshing = false;
    }
  }

  function tick(nowMs: number) {
    const isHidden = el.style.display === "none";
    const interval = isHidden ? 5000 : 1000;
    if (nowMs - lastTickMs < interval) return;
    lastTickMs = nowMs;
    void refresh();
  }

  function dispose() {
    wasActive = false;
    lastTrackKey = "";
  }

  return { el, refresh, tick, dispose };
}

export function createScratchpadWidget() {
  const textarea = h("textarea", {
    class: "scratchpad-input",
    placeholder: t("Quick note…"),
  }) as HTMLTextAreaElement;
  textarea.value = State.noteMessage ?? "";

  void loadValue<{ text: string } | string>("notes", { text: "" }).then((val) => {
    const text = typeof val === "string" ? val : (val?.text ?? "");
    if (text && !textarea.value) {
      textarea.value = text;
      State.noteMessage = text;
    }
  });

  textarea.addEventListener("input", () => {
    State.noteMessage = textarea.value;
    saveValue("notes", { text: textarea.value });
  });
  return { el: h("div", { class: "widget widget-note" }, textarea) };
}

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

let nextTodoSeq = 1;
export function generateTodoId(): string {
  return `todo-${Date.now().toString(36)}-${(nextTodoSeq++).toString(36)}`;
}

export function createTodoWidget() {
  const items: TodoItem[] = [];
  const deletedIds = new Set<string>();
  const listEl = h("ul", { class: "todo-list" });
  const input = h("input", {
    class: "todo-input",
    placeholder: t("Add todo…"),
  }) as HTMLInputElement;
  const el = h("div", { class: "widget widget-todo" }, listEl, input);

  function render() {
    listEl.innerHTML = "";
    items.forEach((it, idx) => {
      const li = h(
        "li",
        { class: it.done ? "done" : "" },
        h("span", {
          text: it.text,
          onclick: () => {
            it.done = !it.done;
            render();
            saveList("todo", items);
          },
        }),
        h("button", {
          text: "×",
          title: t("Delete"),
          "aria-label": t("Delete"),
          onclick: () => {
            deletedIds.add(it.id);
            items.splice(idx, 1);
            render();
            saveList("todo", items);
          },
        }),
      );
      listEl.append(li);
    });
  }

  void loadList<TodoItem>("todo").then((loaded) => {
    if (Array.isArray(loaded) && loaded.length > 0) {
      const normalised = loaded.map((it) => ({
        id: it.id || generateTodoId(),
        text: it.text,
        done: Boolean(it.done),
      }));
      const merged = mergeById(items, normalised, deletedIds);
      items.length = 0;
      items.push(...merged);
      render();
    }
  });

  input.addEventListener("keydown", (e: Event) => {
    const keyEvent = e as KeyboardEvent;
    if (keyEvent.key === "Enter" && input.value.trim()) {
      const newItem: TodoItem = { id: generateTodoId(), text: input.value.trim(), done: false };
      items.push(newItem);
      input.value = "";
      render();
      saveList("todo", items);
    }
  });

  return {
    el,
    items,
    addItem: (text: string) => {
      const newItem: TodoItem = { id: generateTodoId(), text, done: false };
      items.push(newItem);
      render();
      saveList("todo", items);
    },
    toggleItem: (idx: number) => {
      if (items[idx]) {
        items[idx].done = !items[idx].done;
        render();
        saveList("todo", items);
      }
    },
  };
}
