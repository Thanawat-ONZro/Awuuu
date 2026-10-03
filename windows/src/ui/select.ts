// Awuuu's own dropdown — the native <select> popup is drawn by Windows and
// never matches the island. Used by the island (chat pickers) and the Awuuu
// window alike.
//
// The popup is positioned with `position: fixed` inside `host` (default: the
// document), opening downward when there is room and upward otherwise, so it
// never leaves the island's own rectangle.

import "./select.css";

export interface SelectOption {
  value: string;
  label: string;
  /** Options with the same group are listed under that heading. */
  group?: string;
  /** Dim text after the label. */
  hint?: string;
}

export interface DropdownOptions {
  options: () => SelectOption[];
  get: () => string;
  set: (value: string) => void;
  title?: string;
  /** Extra class on the button ("wide", …). */
  class?: string;
  /** Shown when the current value matches no option. */
  placeholder?: string;
  /** The popup stays inside this element's box (default: the viewport). */
  host?: () => HTMLElement | null;
  /** Called when the list opens — fetch options lazily, then call refresh(). */
  onOpen?: () => void;
  /** Called when the list closes, however it was closed. */
  onClose?: () => void;
}

export interface Dropdown extends HTMLDivElement {
  /** Re-read the options and the current value. */
  refresh(): void;
  close(): void;
}

const SEARCH_FROM = 9; // a filter box appears once the list is this long

let openOne: Dropdown | null = null;

export function dropdown(opts: DropdownOptions): Dropdown {
  const el = document.createElement("div") as Dropdown;
  el.className = `aw-select ${opts.class ?? ""}`.trim();
  const button = document.createElement("button");
  button.type = "button";
  button.className = "aw-select-btn";
  if (opts.title) button.title = opts.title;
  const label = document.createElement("span");
  label.className = "aw-select-label";
  const caret = document.createElement("i");
  caret.className = "aw-select-caret";
  button.append(label, caret);
  el.append(button);

  let pop: HTMLDivElement | null = null;
  let active = -1;
  let rows: { el: HTMLElement; opt: SelectOption }[] = [];

  function current(): SelectOption | undefined {
    const v = opts.get();
    return opts.options().find((o) => o.value === v);
  }

  function refresh() {
    const cur = current();
    label.textContent = cur?.label ?? opts.placeholder ?? opts.get() ?? "";
    if (!pop) return;
    // Options fetched after the list opened may make it long enough to filter.
    ensureSearch();
    renderList(pop.querySelector<HTMLInputElement>(".aw-select-search")?.value ?? "");
  }

  /** The filter box, once the list is long enough to want one. */
  function ensureSearch() {
    if (!pop || pop.querySelector(".aw-select-search") || opts.options().length < SEARCH_FROM) return;
    const search = document.createElement("input");
    search.className = "aw-select-search";
    search.type = "text";
    search.placeholder = "Filter…";
    search.spellcheck = false;
    search.addEventListener("input", () => renderList(search.value));
    search.addEventListener("keydown", onKey);
    pop.prepend(search);
  }

  function close() {
    if (!pop) return;
    pop.remove();
    pop = null;
    el.classList.remove("open");
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("blur", close);
    if (openOne === el) openOne = null;
    opts.onClose?.();
  }

  function onOutside(e: Event) {
    const t = e.target as Node;
    if (pop?.contains(t) || el.contains(t)) return;
    close();
  }

  function pick(opt: SelectOption) {
    close();
    if (opt.value !== opts.get()) opts.set(opt.value);
    refresh();
  }

  function setActive(i: number) {
    active = rows.length ? (i + rows.length) % rows.length : -1;
    rows.forEach((r, k) => r.el.classList.toggle("active", k === active));
    rows[active]?.el.scrollIntoView({ block: "nearest" });
  }

  function renderList(filter: string) {
    if (!pop) return;
    const list = pop.querySelector(".aw-select-list") as HTMLElement;
    list.textContent = "";
    rows = [];
    const q = filter.trim().toLowerCase();
    const value = opts.get();
    let group: string | undefined;
    for (const opt of opts.options()) {
      if (q && !`${opt.label} ${opt.group ?? ""}`.toLowerCase().includes(q)) continue;
      if (opt.group !== group) {
        group = opt.group;
        if (group) {
          const head = document.createElement("div");
          head.className = "aw-select-group";
          head.textContent = group;
          list.append(head);
        }
      }
      const row = document.createElement("div");
      row.className = opt.value === value ? "aw-select-opt on" : "aw-select-opt";
      const text = document.createElement("span");
      text.textContent = opt.label;
      row.append(text);
      if (opt.hint) {
        const hint = document.createElement("em");
        hint.textContent = opt.hint;
        row.append(hint);
      }
      row.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        pick(opt);
      });
      list.append(row);
      rows.push({ el: row, opt });
    }
    if (rows.length === 0) {
      const none = document.createElement("div");
      none.className = "aw-select-group";
      none.textContent = q ? "No match" : "Nothing to choose yet";
      list.append(none);
    }
    setActive(Math.max(0, rows.findIndex((r) => r.opt.value === value)));
  }

  function place() {
    if (!pop) return;
    const b = button.getBoundingClientRect();
    const box = opts.host?.()?.getBoundingClientRect()
      ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const pad = 6;
    const below = box.bottom - b.bottom - pad;
    const above = b.top - box.top - pad;
    const up = below < 140 && above > below;
    const room = Math.max(90, Math.min(320, up ? above : below));
    const width = Math.min(Math.max(b.width, 180), box.width - pad * 2);
    const left = Math.min(Math.max(box.left + pad, b.left), box.right - pad - width);
    pop.style.width = `${width}px`;
    pop.style.left = `${left}px`;
    pop.style.maxHeight = `${room}px`;
    if (up) {
      pop.style.top = "";
      pop.style.bottom = `${window.innerHeight - b.top + 4}px`;
    } else {
      pop.style.bottom = "";
      pop.style.top = `${b.bottom + 4}px`;
    }
  }

  function open() {
    if (pop) return;
    openOne?.close();
    openOne = el;
    opts.onOpen?.();
    pop = document.createElement("div");
    pop.className = "aw-select-pop";
    const list = document.createElement("div");
    list.className = "aw-select-list";
    pop.append(list);
    // Clicks in the popup never reach whatever is under it (island drag, tabs).
    for (const name of ["mousedown", "click", "wheel"]) pop.addEventListener(name, (e) => e.stopPropagation());
    ensureSearch();
    document.body.append(pop);
    el.classList.add("open");
    renderList("");
    place();
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("blur", close);
    pop.querySelector<HTMLInputElement>(".aw-select-search")?.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (!pop) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        open();
      }
      return;
    }
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      button.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[active]) pick(rows[active].opt);
    }
  }

  button.addEventListener("mousedown", (e) => e.stopPropagation());
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (pop) close();
    else open();
  });
  button.addEventListener("keydown", onKey);

  el.refresh = refresh;
  el.close = close;
  refresh();
  return el;
}
