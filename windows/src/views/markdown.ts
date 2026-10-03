// Chat reply → DOM. The parsing is core/markdown.ts; this only builds elements, with
// textContent throughout, so nothing in a reply can inject markup.

import { h } from "./dom";
import { Bridge } from "../core/bridge";
import { parseMarkdown, type Block, type Inline } from "../core/markdown";

function inline(nodes: Inline[]): Node[] {
  return nodes.map((n): Node => {
    switch (n.t) {
      case "text": return document.createTextNode(n.v);
      case "code": return h("code", { text: n.v });
      case "b": return h("strong", {}, ...inline(n.c));
      case "i": return h("em", {}, ...inline(n.c));
      case "a": return h("a", { href: n.href, title: n.href, onclick: (e: Event) => { e.preventDefault(); void Bridge.openUrl(n.href); } }, ...inline(n.c));
    }
  });
}

function copyButton(text: string): HTMLElement {
  const btn = h("button", { class: "md-copy", type: "button", text: "Copy" });
  btn.addEventListener("click", () => {
    void navigator.clipboard?.writeText(text).then(() => {
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = "Copy"), 1200);
    });
  });
  return btn;
}

function block(b: Block): HTMLElement {
  switch (b.t) {
    case "p": return h("p", { class: "md-p" }, ...inline(b.c));
    case "h": return h("p", { class: "md-p md-h" }, h("strong", {}, ...inline(b.c)));
    case "quote": return h("blockquote", { class: "md-quote" }, ...inline(b.c));
    case "ul":
    case "ol": return h(b.t, { class: "md-list" }, ...b.items.map((it) => h("li", {}, ...inline(it))));
    case "code": return h("div", { class: "md-code" }, copyButton(b.v), h("pre", {}, h("code", { text: b.v })));
  }
}

export function renderMarkdown(text: string): HTMLElement {
  return h("div", { class: "reply md" }, ...parseMarkdown(text).map(block));
}
