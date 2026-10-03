// Drop zone, upload progress and the "what do you want to do with them" card —
// ports of UploadView / UploadingView / ChooseView from IslandViewContent.swift.
//
// Sending a file by email is not in the Windows v1, so `choose` offers the one
// action the spec asks for: ask a question about the files. Several files can
// wait there; each can be taken out again, and more can be added.
//
// Nothing here has a fixed width: the cards fill the island, whatever its width
// and edge, and the text starts clear of Awuuu, who sits at the left of the card
// (VIEW_LAYOUTS says where).

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { VIEW_LAYOUTS, type IslandViewName } from "../core/layout";
import { State, type PendingFile } from "../core/state";
import { dropTitle, uploadLabel } from "../upload/canvas";
import type { ViewActions, ViewHost } from "./views";

/** The card starts this far inside the island (#content's padding). */
const CARD_INSET = 10;

/** Left padding that keeps a card's text clear of Awuuu in `view`. */
export function clearOfDog(view: IslandViewName, gap = 22): number {
  const l = VIEW_LAYOUTS[view];
  return Math.round(l.botX + l.botDiameter / 2 + gap - CARD_INSET);
}

/** Navigation handed to the files card; the drop zone's "Back" uses it too. */
let nav: ViewActions | null = null;

function fileSize(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Takes a waiting file out of the list. */
export function removeFile(file: PendingFile) {
  State.droppedFiles = State.droppedFiles.filter((f) => f !== file);
  State.dropError = null;
  State.notify();
}

/** A waiting file: its name, and an × while it can still be taken out. */
export function fileChip(file: PendingFile, onRemove?: () => void): HTMLElement {
  const size = fileSize(file.size);
  const chip = h(
    "div",
    { class: "chip file-chip", title: size ? `${file.name} · ${size}` : file.name },
    h("i", { class: "chip-dot" }),
    h("span", { class: "chip-name", text: file.name }),
  );
  if (onRemove) {
    const x = h("button", { class: "chip-x", title: `Remove ${file.name}` }, svg(ICONS.xmark, 9));
    x.addEventListener("mousedown", (e) => e.stopPropagation());
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      onRemove();
    });
    chip.append(x);
  }
  requestAnimationFrame(() => chip.classList.add("settled"));
  return chip;
}

/** Fills `row` with the waiting files; rebuilt only when the list changes. */
export function syncFileChips(row: HTMLElement, removable: boolean, onRemoved?: () => void) {
  const key = `${removable}|${State.droppedFiles.map((f) => `${f.id}:${f.size}`).join(",")}`;
  if (row.dataset.key === key) return;
  row.dataset.key = key;
  clear(row);
  for (const file of State.droppedFiles) {
    row.append(
      fileChip(file, removable
        ? () => {
            removeFile(file);
            onRemoved?.();
          }
        : undefined),
    );
  }
}

/** Dashed rounded rect drawn as SVG so the dashes can march like on macOS. */
function dashedFrame(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(ns, "svg");
  el.setAttribute("class", "drop-frame");
  el.setAttribute("preserveAspectRatio", "none");
  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("x", "0.75");
  rect.setAttribute("y", "0.75");
  rect.setAttribute("width", "calc(100% - 1.5px)");
  rect.setAttribute("height", "calc(100% - 1.5px)");
  rect.setAttribute("rx", "20");
  rect.setAttribute("fill", "none");
  rect.setAttribute("stroke-width", "1.5");
  rect.setAttribute("stroke-dasharray", "6 5");
  el.append(rect);
  return el;
}

export function buildUpload(): ViewHost {
  const frame = dashedFrame();
  const title = h("div", { class: "drop-title" });
  const tags = h(
    "div",
    { class: "drop-tags" },
    ...["PDF", "Images", "Code", "Docs"].map((t) => h("span", { text: t })),
  );
  // Reached with "Add more": the files already there are one click away.
  const back = h("button", { class: "btn secondary drop-back", onclick: () => nav?.setView("choose") });
  const body = h("div", { class: "drop-body" }, title, tags, back);
  body.style.paddingLeft = `${clearOfDog("upload", 25)}px`;
  const card = h("div", { class: "card drop-card" }, frame, body);
  const el = h("div", { class: "view" }, card);

  return {
    el,
    sync() {
      card.classList.toggle("over", State.fileDragOver);
      title.textContent = dropTitle();
      const n = State.droppedFiles.length;
      back.style.display = n > 0 ? "" : "none";
      back.textContent = n === 1 ? "Back to 1 file" : `Back to ${n} files`;
    },
  };
}

export function buildUploading(): ViewHost {
  const label = h("span", { class: "up-name" });
  const percent = h("span", { class: "up-pct" });
  const fill = h("div", { class: "up-fill" });
  const glow = h("div", { class: "up-glow" });
  const card = h(
    "div",
    { class: "card up-card" },
    h("div", { class: "up-row" }, label, percent),
    h("div", { class: "up-track" }, fill, glow),
  );
  const el = h("div", { class: "view" }, card);

  return {
    el,
    sync() {
      const done = State.uploadProgress >= 0.999;
      const pct = Math.round(State.uploadProgress * 100);
      label.textContent = done ? `✓  ${uploadLabel().replace(/^Uploading /, "")}` : uploadLabel();
      label.classList.toggle("done", done);
      percent.textContent = done ? "" : `${pct} %`;
      // Percentages of the track, which is as wide as the card allows.
      fill.style.width = `${State.uploadProgress * 100}%`;
      glow.style.left = `calc(${State.uploadProgress * 100}% - 28px)`;
      glow.style.opacity = State.uploadProgress > 0.01 ? "1" : "0";
      card.classList.toggle("done", done);
    },
  };
}

export function buildChoose(actions: ViewActions): ViewHost {
  nav = actions;
  const title = h("div", { class: "title" });
  const chips = h("div", { class: "file-chips" });
  const ask = h("button", { class: "btn primary", onclick: () => actions.setView("prompt") });
  const cancel = () => {
    State.droppedFiles = [];
    State.dropError = null;
    actions.setView(State.defaultView());
  };
  const row = h(
    "div",
    { class: "actions" },
    ask,
    h("button", { class: "btn secondary", text: "Add more", onclick: () => actions.setView("upload") }),
    h("button", { class: "btn secondary", text: "Cancel", onclick: cancel }),
  );
  const stack = h("div", { class: "stack choose-stack" }, title, chips, row);
  stack.style.paddingLeft = `${clearOfDog("choose")}px`;
  const el = h("div", { class: "view" }, h("div", { class: "card" }, stack));

  return {
    el,
    sync() {
      const n = State.droppedFiles.length;
      clear(title);
      title.append(h("b", { text: n === 1 ? "1 file is ready." : `${n} files are ready.` }));
      title.append(
        State.dropError
          ? h("span", { class: "choose-error", text: ` ${State.dropError}` })
          : h("span", { class: "choose-sub", text: n === 1 ? " What do you want to do with it?" : " What do you want to do with them?" }),
      );
      // Taking the last one out is the same as cancelling.
      syncFileChips(chips, true, () => {
        if (State.droppedFiles.length === 0 && State.view === "choose") cancel();
      });
      ask.textContent = n === 1 ? "Ask about this" : "Ask about these";
    },
  };
}
