import { h, svg } from "./dom";
import { washRGBA, type Wash } from "../core/layout";

export interface CardShellOptions {
  title?: string;
  icon?: string;
  wash?: Wash;
  body: HTMLElement;
  footer?: HTMLElement;
  headerRight?: HTMLElement;
}

export interface CardShellHost {
  el: HTMLElement;
  setTitle(title: string): void;
}

export function createCardShell(options: CardShellOptions): CardShellHost {
  const titleEl = h("div", { class: "card-title", text: options.title ?? "" });
  const headerLeft = h("div", { class: "card-header-left" }, options.icon ? svg(options.icon, 14) : null, titleEl);
  const header = h("div", { class: "card-header" }, headerLeft, options.headerRight ?? null);
  const bodyEl = h("div", { class: "card-body" }, options.body);
  const shellEl = h("div", { class: "card-shell card" }, header, bodyEl, options.footer ?? null);
  if (options.wash) {
    shellEl.classList.add("wash");
    shellEl.style.setProperty("--wash", washRGBA(options.wash));
  }
  return {
    el: shellEl,
    setTitle(newTitle: string) {
      titleEl.textContent = newTitle;
    },
  };
}
