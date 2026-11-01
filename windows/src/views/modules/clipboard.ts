import { Bridge, onEvent, type ClipboardSnapshot } from "../../core/bridge";
import { matchingClipboard, type ClipboardKind, clipboardKind } from "../../core/clipboard";
import { t } from "../../i18n/i18n";
import { h, clear } from "../dom";
import type { ModuleHost } from "../../core/modules";
import { dropdown } from "../../ui/select";
import { svg } from "../dom";

export function createClipboardPanel(): ModuleHost & { controls: HTMLElement } {
  let snapshot: ClipboardSnapshot = { enabled: false, ready: false, entries: [] };
  let kind: ClipboardKind | "all" = "all";
  let disposed = false;
  let unlisten: (() => void) | undefined;
  const state = h("button", { class: "clipboard-status", onclick: async () => {
    if (snapshot.enabled) return;
    try { await Bridge.clipboardEnable(true); await load(); } catch (error) { feedback.textContent = t(String(error).replace(/^Error:\s*/, "")); }
  } });
  const feedback = h("div", { class: "clipboard-feedback", role: "status", "aria-live": "polite" });
  const search = h("input", { type: "search", placeholder: t("Search clipboard"), "aria-label": t("Search clipboard") });
  const list = h("div", { class: "clipboard-items" });
  const clearButton = h("button", { class: "clipboard-clear", title: t("Clear history"), "aria-label": t("Clear history"), onclick: async () => {
    try { await Bridge.clipboardRemove(); await load(); } catch (error) { feedback.textContent = t(String(error).replace(/^Error:\s*/, "")); }
  } }, svg("M7 7h10l-1 14H8L7 7zm-2-4h5V1h4v2h5v2H5V3z", 15));
  const filterDefs: [ClipboardKind | "all", string][] = [["all", "All"], ["text", "Text"], ["links", "Links"], ["images", "Images"], ["code", "Code"], ["colors", "Colors"]];
  const filters = dropdown({ class: "clipboard-category", title: t("Clipboard filters"),
    options: () => filterDefs.map(([value, label]) => ({ value, label: t(label) })), get: () => kind,
    set: (value) => { if (filterDefs.some(([key]) => key === value)) { kind = value as ClipboardKind | "all"; render(); } },
  });
  const controls = h("div", { class: "clipboard-controls" }, search, filters, state, clearButton);
  const el = h("div", { class: "clipboard-panel" }, feedback, list);
  list.addEventListener("wheel", (event) => {
    if (list.scrollWidth <= list.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault(); list.scrollLeft += event.deltaY;
  }, { passive: false });
  function render() {
    state.textContent = !snapshot.ready ? t("Clipboard listener is not ready") : snapshot.enabled ? "●" : t("Resume");
    state.title = snapshot.enabled ? t("Recording") : t("Paused");
    state.classList.toggle("is-live", snapshot.enabled && snapshot.ready);
    clearButton.disabled = snapshot.entries.length === 0;
    filters.refresh();
    clear(list);
    const entries = matchingClipboard(snapshot.entries, kind, search.value);
    if (!entries.length) list.append(h("p", { class: "clipboard-empty", text: !snapshot.enabled
      ? t("Clipboard history is paused. Use Resume to continue.")
      : snapshot.entries.length ? t("No matching clipboard items") : t("Copy text or an image. It will appear here automatically.") }));
    for (const entry of entries) {
      const copy = h("button", { class: "clipboard-copy", title: t("Copy"), onclick: async () => {
        try { await Bridge.clipboardCopy(entry.id); feedback.textContent = t("Copied. Paste it into another app."); } catch (error) { feedback.textContent = t(String(error).replace(/^Error:\s*/, "")); }
      } }, h("span", { class: "clipboard-kind", text: t(filterDefs.find(([value]) => value === clipboardKind(entry))?.[1] ?? "Text") }),
      entry.kind === "image" && entry.preview ? h("img", { src: entry.preview, alt: t("Clipboard image"), loading: "lazy" }) : h("span", { class: "clipboard-text", text: entry.text?.slice(0,1200) ?? "" }));
      const remove = h("button", { class: "clipboard-remove", text: "×", "aria-label": t("Remove clipboard item"), onclick: async () => {
        try { await Bridge.clipboardRemove(entry.id); await load(); } catch (error) { feedback.textContent = t(String(error).replace(/^Error:\s*/, "")); }
      } });
      list.append(h("div", { class: `clipboard-item clipboard-item-${clipboardKind(entry)}` }, copy, remove));
    }
  }
  async function load() {
    const result = await Bridge.clipboardHistory();
    if (!disposed && result) { snapshot = result; render(); }
  }
  search.addEventListener("input", render);
  void onEvent("clipboard-history-changed", () => { if (!el.hidden) void load(); }).then(fn => { if (disposed) fn(); else unlisten = fn; });
  void load(); render();
  return { el, controls, refresh: load, dispose() { disposed = true; filters.close(); unlisten?.(); } };
}
