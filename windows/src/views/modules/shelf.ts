// The Shelf: temporary file holding area with drop-in, drag-out (copy on drag),
// age display, retention sweep (default 7 days) and "clear all".
// Zero idle CPU: refreshes only when opened or on drop.

import { clear, h, svg } from "../dom";
import { ICONS } from "../icons";
import { Bridge, type ShelfFile } from "../../core/bridge";
import type { ModuleCtx, ModuleHost } from "../../core/modules";
import { t } from "../../i18n/i18n";

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
  const iconEl = svg(ICONS.stack, 13);
  const titleEl = h("span", { class: "shelf-header-title", text: t("Shelf") });
  const badgeEl = h("span", { class: "shelf-badge", text: "0" });
  badgeEl.style.display = "none";

  const clearBtn = h("button", {
    class: "shelf-clear-btn",
    text: t("Clear all"),
    onclick: async (e) => {
      e.stopPropagation();
      await Bridge.shelfClear();
      await loadFiles();
    },
  });
  clearBtn.style.display = "none";

  const headerLeft = h("div", { class: "shelf-header-left" }, iconEl, titleEl, badgeEl);
  const headerEl = h("div", { class: "shelf-header" }, headerLeft, clearBtn);

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

  const el = h("div", { class: "widget widget-shelf" }, headerEl, retentionEl, dropZone);

  let currentFiles: ShelfFile[] = [];
  let disposed = false;
  let lastTickMs = 0;

  function renderFiles() {
    clear(listEl);
    if (currentFiles.length === 0) {
      emptyEl.style.display = "";
      badgeEl.style.display = "none";
      clearBtn.style.display = "none";
      return;
    }

    emptyEl.style.display = "none";
    badgeEl.textContent = String(currentFiles.length);
    badgeEl.style.display = "";
    clearBtn.style.display = "";

    for (const file of currentFiles) {
      const docIcon = svg(ICONS.doc, 14);
      const nameEl = h("span", { class: "shelf-item-name", text: file.name, title: file.name });
      const metaEl = h("span", {
        class: "shelf-item-meta",
        text: `${formatShelfFileSize(file.size)} · ${formatShelfAge(file.addedAtMs)}`,
      });
      const infoEl = h("div", { class: "shelf-item-info" }, nameEl, metaEl);

      const revealBtn = h(
        "button",
        {
          class: "shelf-item-action",
          title: t("Show in folder"),
          onclick: (e) => {
            e.stopPropagation();
            void Bridge.revealFile(file.path);
          },
        },
        svg(ICONS.arrowUpRight, 10),
      );

      const removeBtn = h(
        "button",
        {
          class: "shelf-item-action danger",
          title: t("Remove {name}", { name: file.name }),
          onclick: async (e) => {
            e.stopPropagation();
            await Bridge.shelfRemove(file.path);
            await loadFiles();
          },
        },
        svg(ICONS.xmark, 10),
      );

      const actionsEl = h("div", { class: "shelf-item-actions" }, revealBtn, removeBtn);

      const itemEl = h(
        "div",
        {
          class: "shelf-item",
          title: `${file.name} (${formatShelfFileSize(file.size)})`,
        },
        docIcon,
        infoEl,
        actionsEl,
      );

      // Drag-out support: copy on drag
      itemEl.setAttribute("draggable", "true");
      itemEl.addEventListener("dragstart", (e) => {
        itemEl.classList.add("dragging");
        const uri = `file:///${file.path.replace(/\\/g, "/")}`;
        e.dataTransfer?.setData("text/plain", file.path);
        e.dataTransfer?.setData("text/uri-list", uri);
        e.dataTransfer?.setData("DownloadURL", `application/octet-stream:${file.name}:${uri}`);
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "copy";
        }
      });
      itemEl.addEventListener("dragend", () => {
        itemEl.classList.remove("dragging");
      });

      listEl.append(itemEl);
    }
  }

  async function loadFiles() {
    if (disposed) return;
    try {
      const files = await Bridge.shelfList(7);
      if (!disposed && files) {
        currentFiles = files;
        renderFiles();
      }
    } catch {
      /* ignore load error */
    }
  }

  // Initial load
  void loadFiles();

  return {
    el,
    refresh() {
      return loadFiles();
    },
    tick(nowMs) {
      // Re-render ages at most once every 30 seconds
      if (nowMs - lastTickMs >= 30_000) {
        lastTickMs = nowMs;
        renderFiles();
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
