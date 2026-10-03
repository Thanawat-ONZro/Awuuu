// Shared pieces of the Awuuu window: the settings being edited and the small
// controls every page is built from.

import { Bridge } from "../core/bridge";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
import { h } from "../views/dom";
import { dropdown } from "../ui/select";

/** The one copy of the settings this window edits (mutated in place). */
export const settings: Settings = { ...DEFAULT_SETTINGS };

export async function save() {
  await Bridge.saveSettings(settings);
}

/** A card with a heading — what every page is made of. */
export function card(title: string | null, ...children: (Node | string | null | false | undefined)[]): HTMLElement {
  return h("section", {}, title ? h("h2", {}, h("span", { text: title })) : null, ...children);
}

/** A page: its title, one line about it, then its cards. */
export function pageOf(title: string, sub: string, ...children: (Node | null | false | undefined)[]): HTMLElement {
  return h("div", { class: "page" },
    h("header", { class: "page-head" }, h("h1", { text: title }), sub ? h("p", { text: sub }) : null),
    ...children,
  );
}

export function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": on });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    onChange(next);
  });
  return el;
}

export function statusDot(ok: boolean): HTMLElement {
  return h("i", { class: "dot", style: `background:${ok ? "#22c55e" : "#f4505e"}` });
}

export function renderDiff(text: string): HTMLElement {
  const box = h("div", { class: "diff" });
  for (const line of text.split("\n")) {
    const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
    box.append(h("div", { class: cls, text: line }));
  }
  return box;
}

export function testRow(id: string): HTMLElement {
  const result = h("span", { class: "hint", style: "font-size:11.5px" });
  const btn = h("button", { text: "Test" });
  btn.addEventListener("click", async () => {
    result.textContent = "Testing…";
    result.style.color = "";
    try {
      result.textContent = await Bridge.integrationTest(id);
      result.style.color = "#22c55e";
    } catch (err) {
      result.textContent = String(err).replace(/^Error:\s*/, "");
      result.style.color = "#f4505e";
    }
  });
  return h("div", { class: "row" }, btn, result);
}

export function secretField(key: string, placeholder: string): HTMLElement {
  const input = h("input", { type: "password", placeholder, autocomplete: "off", spellcheck: "false", style: "flex:1 1 auto;min-width:0" }) as HTMLInputElement;
  void Bridge.secretPresent(key).then((has) => {
    if (has) input.placeholder = "••••••••  (stored)";
  });
  const saveBtn = h("button", { text: "Save" });
  saveBtn.addEventListener("click", async () => {
    await Bridge.secretSet(key, input.value.trim());
    input.placeholder = input.value.trim() ? "••••••••  (stored)" : placeholder;
    input.value = "";
  });
  return h("span", { style: "display:flex;gap:6px;flex:1 1 auto;min-width:0" }, input, saveBtn);
}

export function textField(get: () => string, set: (v: string) => void, placeholder: string): HTMLInputElement {
  const input = h("input", { type: "text", value: get(), placeholder, spellcheck: "false", style: "flex:1 1 auto;min-width:0" }) as HTMLInputElement;
  input.addEventListener("change", () => {
    set(input.value.trim());
    void save();
  });
  return input;
}

export function listField(get: () => string[], set: (v: string[]) => void, placeholder: string): HTMLTextAreaElement {
  const area = h("textarea", { rows: "3", placeholder, spellcheck: "false", style: "flex:1 1 auto;min-width:0;resize:vertical" }) as HTMLTextAreaElement;
  area.value = get().join("\n");
  area.addEventListener("change", () => {
    set(area.value.split(/\s*\n\s*/).map((x) => x.trim()).filter((x) => /^https?:\/\//.test(x)));
    area.value = get().join("\n");
    void save();
  });
  return area;
}

// ── Layout: where the island sits, how big it is, what the hub shows ──────────

/** Controls that must follow changes made elsewhere (dragging the island). */
export const layoutRefreshers: (() => void)[] = [];

export function select(options: [string, string][], get: () => string, set: (v: string) => void): HTMLElement {
  const el = dropdown({
    options: () => options.map(([value, label]) => ({ value, label })),
    get,
    set: (v) => {
      set(v);
      void save();
    },
  });
  layoutRefreshers.push(() => el.refresh());
  return el;
}

export function slider(min: number, max: number, step: number, get: () => number, set: (v: number) => void, unit = "px") {
  const input = h("input", { type: "range", min: String(min), max: String(max), step: String(step) }) as HTMLInputElement;
  const out = h("span", { class: "hint" });
  const refresh = () => {
    input.value = String(get());
    out.textContent = `${Math.round(get())} ${unit}`;
  };
  refresh();
  layoutRefreshers.push(refresh);
  input.addEventListener("input", () => {
    set(Number(input.value));
    out.textContent = `${input.value} ${unit}`;
  });
  input.addEventListener("change", () => void save());
  return h("span", { class: "slider" }, input, out);
}
