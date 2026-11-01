// The Shelf: temporary file holding area with drop-in, drag-out (copy on drag),
// age display, retention sweep (default 7 days) and "clear all".
// Zero idle CPU: refreshes only when opened or on drop.

import { clear, h, svg } from "../dom";
import { ICONS } from "../icons";
import { Bridge, type ShelfFile } from "../../core/bridge";
import type { ModuleCtx, ModuleHost } from "../../core/modules";
import { t } from "../../i18n/i18n";
import { createClipboardPanel } from "./clipboard";
import { createShelfSharing } from "./shelf-sharing";
import { State } from "../../core/state";

/** Formats age of a shelf item relative to nowMs (e.g. "Just now", "5m ago", "2h ago", "3d ago"). */
export function formatShelfAge(addedAtMs: number, nowMs?: number): string {
  const now = nowMs ?? Date.now();
  const diff = now - addedAtMs;
  if (diff < 60_000) {
    return t("Just now");
  }
  if (diff < 3_600_000) {
    const mins = Math.max(1, Math.floor(diff / 60_000));
    return t("{n}m ago", { n: mins });
  }
  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000);
    return t("{n}h ago", { n: hours });
  }
  const days = Math.floor(diff / 86_400_000);
  return t("{n}d ago", { n: days });
}

/** Formats retention description string. */
export function formatShelfRetention(retentionDays: number): string {
  if (retentionDays === 1) {
    return t("Kept for 1 day");
  }
  return t("Kept for {n} days", { n: retentionDays });
}

/** Formats file size in bytes to human readable format. */
export function formatShelfFileSize(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function createShelfModuleHost(_ctx?: ModuleCtx): ModuleHost {
  const selected = new Set<string>();
  let busy = false;
  let suppressClickUntil = 0;
  let nativeDragging = false;
  const badgeEl = h("span", { class: "shelf-badge", text: "0" });
  badgeEl.style.display = "none";

  const clearBtn = h("button", {
    class: "shelf-clear-btn",
    text: t("Delete selected"),
    onclick: async (e) => {
      e.stopPropagation();
      if (busy || !selected.size) return;
      busy = true; syncSelection();
      try {
        for (const path of [...selected]) {
          await Bridge.shelfRemove(path);
          const item = rendered.get(path)?.el;
          if (item && typeof item.animate === "function" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
            void item.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "translateY(-5px) scale(.94)" }], { duration: 140, fill: "forwards", easing: "ease-in" }).finished.catch(() => {});
          }
          selected.delete(path);
        }
        await new Promise(resolve => setTimeout(resolve, 150));
      } catch (error) { feedback.textContent = t(String(error).replace(/^Error:\s*/, "")); }
      finally { busy = false; await loadFiles(); }
    },
  });
  clearBtn.style.display = "none";
  const selectAll = h("button", { class: "shelf-select-all", text: t("Select all"), onclick: () => {
    if (selected.size === currentFiles.length) selected.clear(); else currentFiles.forEach(file => selected.add(file.path));
    syncSelection();
  } });
  const shareSelected = h("button", { class: "shelf-share-selected", text: t("Share selected"), onclick: () => {
    sharing.open(currentFiles.filter(file => selected.has(file.path)));
  } });
  const feedback = h("div", { class: "shelf-feedback", role: "status", "aria-live": "polite" });


  const retentionEl = h("div", {
    class: "shelf-retention-note",
    text: formatShelfRetention(7),
  });

  const listEl = h("div", { class: "shelf-file-list" });
  const emptyEl = h(
    "div",
    { class: "shelf-empty" },
    h("span", { class: "shelf-empty-title", text: t("No files on the shelf") }),
    h("span", { class: "shelf-empty-hint", text: t("Drop files here or onto the island") }),
  );

  const dropZone = h("div", { class: "shelf-drop-zone" }, listEl, emptyEl);

  const sharing = createShelfSharing(() => { if (!disposed) syncSelection(); });
  const fileControls = h("div", { class: "shelf-file-toolbar" }, selectAll, badgeEl, shareSelected, clearBtn);
  const filesPanel = h("div", { class: "shelf-files-panel" }, feedback, dropZone,
    h("div", { class: "shelf-footer" }, retentionEl, sharing.el));
  const clipboard = createClipboardPanel();
  clipboard.el.hidden = true;
  clipboard.controls.hidden = true;
  const tabs = h("div", { class: "shelf-tabs", role: "tablist", "aria-label": t("Shelf") });
  const filesTab = h("button", { role: "tab", "aria-selected": "true", text: t("Files") });
  const clipboardTab = h("button", { role: "tab", "aria-selected": "false", text: t("Clipboard") });
  const selectTab = (showClipboard: boolean) => {
    filesPanel.hidden = showClipboard; clipboard.el.hidden = !showClipboard;
    clipboard.controls.hidden = !showClipboard;
    fileControls.hidden = showClipboard;
    tabs.classList.toggle("clipboard-active", showClipboard);
    filesTab.setAttribute("aria-selected", String(!showClipboard)); clipboardTab.setAttribute("aria-selected", String(showClipboard));
    if (showClipboard) void clipboard.refresh?.();
  };
  filesTab.addEventListener("click", () => selectTab(false)); clipboardTab.addEventListener("click", () => selectTab(true)); tabs.append(clipboardTab, filesTab);
  tabs.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const showClipboard = clipboard.el.hidden;
    selectTab(showClipboard);
    (showClipboard ? clipboardTab : filesTab).focus();
  });
  const el = h("div", { class: "widget widget-shelf" }, h("div", { class: "shelf-topbar" }, tabs, clipboard.controls, fileControls), filesPanel, clipboard.el);
  listEl.addEventListener("wheel", (event) => {
    if (listEl.scrollWidth <= listEl.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault(); listEl.scrollLeft += event.deltaY;
  }, { passive: false });

  let currentFiles: ShelfFile[] = [];
  let disposed = false;
  let lastTickMs = 0;
  const previews = new Map<string, Promise<string | null>>();
  const retryPreviewAt = new Map<string, number>();
  const rendered = new Map<string, { el: HTMLElement; checkbox: HTMLInputElement; preview: HTMLButtonElement; meta: HTMLElement }>();
  const seen = new Set<string>();

  function loadPreview(file: ShelfFile, preview: HTMLElement) {
    const key = `${file.path}:${file.addedAtMs}:${file.size}`;
    if (preview.dataset.previewKey === key || Date.now() < (retryPreviewAt.get(key) ?? 0)) return;
    if (!previews.has(key)) {
      const request = Bridge.shelfPreview(file.path).catch(() => null).then(src => {
        if (!src) { previews.delete(key); retryPreviewAt.set(key, Date.now() + 3000); }
        return src;
      });
      previews.set(key, request);
    }
    void previews.get(key)!.then(src => {
      if (!src || disposed || preview.dataset.previewKey === key) return;
      preview.dataset.previewKey = key;
      clear(preview);
      preview.append(h("img", { class: "shelf-preview-img", src, alt: file.name, loading: "lazy", draggable: "false" }));
    });
  }

  function syncSelection() {
    selectAll.disabled = busy || !currentFiles.length;
    selectAll.textContent = selected.size && selected.size === currentFiles.length ? t("Deselect all") : t("Select all");
    badgeEl.textContent = selected.size ? t("{n} selected", { n: selected.size }) : t("{n} files", { n: currentFiles.length });
    clearBtn.style.display = "";
    clearBtn.disabled = busy || !selected.size;
    const files = currentFiles.filter(file => selected.has(file.path));
    shareSelected.disabled = busy || !files.length || files.some(file => !sharing.canShare(file.size));
    shareSelected.title = files.some(file => file.size > 25 * 1024 * 1024) ? t("Maximum file size is 25 MB") : t("Share by link or QR");
    selectAll.setAttribute("aria-pressed", String(selected.size > 0 && selected.size === currentFiles.length));
    for (const [path, item] of rendered) {
      item.checkbox.checked = selected.has(path); item.checkbox.disabled = busy;
      item.el.classList.toggle("selected", selected.has(path));
      item.preview.setAttribute("aria-pressed", String(selected.has(path)));
    }
  }

  function renderFiles() {
    const scroll = listEl.scrollLeft;
    clear(listEl);
    rendered.clear();
    syncSelection();
    if (currentFiles.length === 0) {
      emptyEl.style.display = "";
      badgeEl.style.display = "none";
      return;
    }

    emptyEl.style.display = "none";
    badgeEl.style.display = "";

    for (const file of currentFiles) {
      const toggle = (event?: Event) => { if ((event as MouseEvent | undefined)?.altKey || busy || nativeDragging || Date.now() < suppressClickUntil) return; if (selected.has(file.path)) selected.delete(file.path); else selected.add(file.path); syncSelection(); };
      const preview = h("button", { class: "shelf-preview", title: file.name, "aria-label": file.name, "aria-pressed": String(selected.has(file.path)),
        onclick: toggle, ondblclick: () => { void Bridge.revealFile(file.path); } }, svg(ICONS.doc, 64),
        h("span", { class: "shelf-file-extension", text: file.name.split(".").pop()?.slice(0, 8).toUpperCase() ?? "" }));
      if (/\.(png|jpe?g|webp|bmp)$/i.test(file.name)) preview.classList.add("is-photo");
      loadPreview(file, preview);
      const nameEl = h("button", { class: "shelf-item-name", text: file.name, title: file.name, onclick: toggle });
      const metaEl = h("span", {
        class: "shelf-item-meta",
        text: `${formatShelfFileSize(file.size)} · ${formatShelfAge(file.addedAtMs)}`,
      });
      const infoEl = h("div", { class: "shelf-item-info" }, nameEl, metaEl);

      const checkbox = h("input", { class: "shelf-item-check", type: "checkbox", "aria-label": t("Select {name}", { name: file.name }), disabled: busy });
      checkbox.checked = selected.has(file.path);
      checkbox.addEventListener("change", toggle);

      const itemEl = h(
        "div",
        {
          class: selected.has(file.path) ? "shelf-item selected" : "shelf-item",
          title: `${file.name} (${formatShelfFileSize(file.size)})`,
        },
        preview,
        checkbox,
        infoEl,
      );
      if (!seen.has(file.path)) { itemEl.classList.add("is-new"); seen.add(file.path); }
      rendered.set(file.path, { el: itemEl, checkbox, preview, meta: metaEl });

      // Wait for a real drag gesture, then let Windows own the file transfer.
      // HTML text/uri-list is not a native file payload in Explorer or chat apps.
      let origin: { x: number; y: number } | null = null;
      itemEl.addEventListener("dragstart", event => event.preventDefault());
      itemEl.addEventListener("pointerdown", event => {
        if (event.button !== 0 || event.altKey || event.target === checkbox || busy || nativeDragging) return;
        origin = { x: event.clientX, y: event.clientY };
      });
      itemEl.addEventListener("pointerup", () => { origin = null; });
      itemEl.addEventListener("pointercancel", () => { origin = null; });
      itemEl.addEventListener("pointermove", event => {
        if (!origin || event.altKey || !(event.buttons & 1) || nativeDragging) return;
        if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 6) return;
        origin = null;
        if (!selected.has(file.path)) { selected.clear(); selected.add(file.path); syncSelection(); }
        nativeDragging = true; State.fileDragOut = true; itemEl.classList.add("dragging");
        void Bridge.shelfStartDrag([...selected]).catch(error => {
          feedback.textContent = t(String(error).replace(/^Error:\s*/, ""));
        }).finally(() => {
          nativeDragging = false; State.fileDragOut = false; suppressClickUntil = Date.now() + 300;
          itemEl.classList.remove("dragging");
        });
      });

      listEl.append(itemEl);
    }
    listEl.scrollLeft = scroll;
  }

  async function loadFiles() {
    if (disposed) return;
    try {
      const files = await Bridge.shelfList(7);
      if (!disposed && files) {
        if (files.length === currentFiles.length && files.every((file, index) => file.path === currentFiles[index].path && file.size === currentFiles[index].size && file.addedAtMs === currentFiles[index].addedAtMs)) {
          syncSelection();
          for (const file of files) { const preview = rendered.get(file.path)?.preview; if (preview) loadPreview(file, preview); }
          return;
        }
        currentFiles = files;
        const paths = new Set(files.map(file => file.path));
        for (const path of selected) if (!paths.has(path)) selected.delete(path);
        const keys = new Set(files.map(file => `${file.path}:${file.addedAtMs}:${file.size}`));
        for (const key of previews.keys()) if (!keys.has(key)) previews.delete(key);
        for (const key of retryPreviewAt.keys()) if (!keys.has(key)) retryPreviewAt.delete(key);
        renderFiles();
      }
    } catch {
      /* ignore load error */
    }
  }

  // Initial load
  void loadFiles();
  void sharing.refresh();

  return {
    el,
    refresh() {
      void sharing.refresh();
      return loadFiles();
    },
    tick(nowMs) {
      // Retry failed icons without rebuilding tiles or resetting horizontal scroll.
      if (nowMs - lastTickMs >= 5000) {
        lastTickMs = nowMs;
        for (const file of currentFiles) {
          const meta = rendered.get(file.path)?.meta;
          if (meta) meta.textContent = `${formatShelfFileSize(file.size)} · ${formatShelfAge(file.addedAtMs)}`;
          const preview = rendered.get(file.path)?.preview;
          if (preview) loadPreview(file, preview);
        }
      }
    },
    dispose() {
      disposed = true;
      clipboard.dispose?.();
      sharing.dispose();
    },
  };
}
