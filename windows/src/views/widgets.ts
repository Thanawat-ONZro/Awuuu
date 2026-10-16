import { h, svg } from "./dom";
import { ICONS } from "./icons";
import { Bridge } from "../core/bridge";
import { State } from "../core/state";

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
  const titleEl = h("div", { class: "track-title" });
  const artistEl = h("div", { class: "track-artist" });
  const el = h(
    "div",
    { class: "widget widget-media", style: "display:none" },
    svg(ICONS.play, 14),
    h("div", { class: "track-info" }, titleEl, artistEl),
  );
  async function refresh() {
    const info = await Bridge.nowPlaying();
    if (!info || !info.active) {
      el.style.display = "none";
      onActiveChange?.(false);
      return;
    }
    titleEl.textContent = info.title;
    artistEl.textContent = info.artist;
    el.style.display = "flex";
    onActiveChange?.(true);
  }
  return { el, refresh };
}

export function createScratchpadWidget() {
  const textarea = h("textarea", {
    class: "scratchpad-input",
    placeholder: "Quick note…",
  }) as HTMLTextAreaElement;
  textarea.value = State.noteMessage ?? "";
  textarea.addEventListener("input", () => {
    State.noteMessage = textarea.value;
  });
  return { el: h("div", { class: "widget widget-note" }, textarea) };
}

export interface TodoItem {
  text: string;
  done: boolean;
}

export function createTodoWidget() {
  const items: TodoItem[] = [];
  const listEl = h("ul", { class: "todo-list" });
  const input = h("input", {
    class: "todo-input",
    placeholder: "Add todo…",
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
          },
        }),
        h("button", {
          text: "×",
          onclick: () => {
            items.splice(idx, 1);
            render();
          },
        }),
      );
      listEl.append(li);
    });
  }

  input.addEventListener("keydown", (e: Event) => {
    const keyEvent = e as KeyboardEvent;
    if (keyEvent.key === "Enter" && input.value.trim()) {
      items.push({ text: input.value.trim(), done: false });
      input.value = "";
      render();
    }
  });

  return {
    el,
    items,
    addItem: (text: string) => {
      items.push({ text, done: false });
      render();
    },
    toggleItem: (idx: number) => {
      if (items[idx]) {
        items[idx].done = !items[idx].done;
        render();
      }
    },
  };
}
