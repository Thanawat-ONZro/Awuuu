// Shortcuts: global keys that work from any app. Each row can record a new
// combination, switch it off, or go back to its default. Keys another app
// already owns are reported in the row.

import { Bridge } from "../../core/bridge";
import {
  SHORTCUTS, conflictWith, displayKeys, effectiveKeys, recordPress, withBinding,
  type ShortcutDef,
} from "../../core/shortcuts";
import { h } from "../../views/dom";
import { card, pageOf, save, settings } from "../ui";
import { t } from "../../i18n/i18n";

function row(def: ShortcutDef, redrawAll: () => void, errors: Record<string, string>): HTMLElement {
  const keys = () => effectiveKeys(def, settings.shortcuts);
  const isDefault = () => keys() === (def.defaultOn ? def.defaultKeys : "");

  const msg = h("div", { class: "notice err", style: "display:none" });
  const say = (text: string | null) => {
    msg.textContent = text ?? "";
    msg.style.display = text ? "" : "none";
  };
  // Registration failure from Rust (taken by another app), then conflicts here.
  const own = conflictWith(settings.shortcuts, def.id, keys());
  if (errors[def.id]) say(errors[def.id]);
  else if (own) say(t("Same keys as “{label}”. Only one of them will work.", { label: t(SHORTCUTS.find((s) => s.id === own)?.label ?? "") }));

  const record = h("button", { style: "min-width:150px" }) as HTMLButtonElement;
  const paint = () => (record.textContent = displayKeys(keys()));
  paint();

  let stop: (() => void) | null = null;
  const commit = (value: string) => {
    settings.shortcuts = withBinding(settings.shortcuts, def.id, value);
    void save().then(redrawAll);
  };
  const finish = () => {
    stop?.();
    stop = null;
    record.style.outline = "";
    paint();
  };
  record.addEventListener("click", () => {
    if (stop) return finish();
    record.style.outline = "2px solid var(--accent, #e8a03e)";
    record.textContent = t("Press the keys…");
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const r = recordPress(e);
      switch (r.kind) {
        case "pending": return;
        case "cancel": finish(); say(null); return;
        case "clear": finish(); commit(""); return;
        case "needsModifier": say(t("Hold Ctrl, Alt or the Windows key together with the key.")); return;
        case "unsupported": say(t("That key can't be used.")); return;
        case "keys": {
          const clash = conflictWith(settings.shortcuts, def.id, r.keys);
          finish();
          if (clash) {
            say(t("“{v}” is already used by “{label}”.", { v: displayKeys(r.keys), label: t(SHORTCUTS.find((s) => s.id === clash)?.label ?? "") }));
            return;
          }
          commit(r.keys);
        }
      }
    };
    const onBlur = () => finish();
    window.addEventListener("keydown", onKey, true);
    record.addEventListener("blur", onBlur, { once: true });
    stop = () => {
      window.removeEventListener("keydown", onKey, true);
      record.removeEventListener("blur", onBlur);
    };
  });

  const actions: (HTMLElement | null)[] = [record];
  if (keys() === "" && def.defaultKeys) {
    actions.push(h("button", { text: t("Use {v}", { v: displayKeys(def.defaultKeys) }), onclick: () => commit(def.defaultKeys) }));
  } else {
    actions.push(h("button", { text: t("Off"), title: t("Switch this shortcut off"), onclick: () => commit("") }));
  }
  const reset = h("button", { text: t("Reset"), title: t("Default: {v}", { v: def.defaultOn ? displayKeys(def.defaultKeys) : "off" }), onclick: () => commit(def.defaultOn ? def.defaultKeys : "") }) as HTMLButtonElement;
  reset.disabled = isDefault();
  actions.push(reset);

  return h("div", { style: "display:flex;flex-direction:column;gap:6px" },
    h("div", { class: "row" }, h("label", { text: t(def.label) }), ...actions),
    h("div", { class: "hint", text: t(def.hint) }),
    msg);
}

export function page(): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:14px" });
  const root = pageOf(t("Shortcuts"),
    t("Global keys that work from any app. Awuuu never takes focus from the app you are in, except in the chat's text field."),
    body);

  const draw = async () => {
    const errors = (await Bridge.shortcutErrors()) ?? {};
    const group = (title: string, defs: ShortcutDef[]) =>
      card(title, h("div", { style: "display:flex;flex-direction:column;gap:14px" }, ...defs.map((d) => row(d, () => void draw(), errors))));
    body.replaceChildren(
      group(t("Anywhere"), SHORTCUTS.filter((d) => !d.approvalOnly)),
      group(t("Permission card"), SHORTCUTS.filter((d) => d.approvalOnly)),
      h("div", { class: "hint", text: t("Click a key box, then press the new combination. Esc cancels, Backspace switches it off. A shortcut needs Ctrl, Alt or the Windows key. If another app already uses a combination, the row says so and you can pick another.") }),
    );
  };
  void draw();
  return root;
}
