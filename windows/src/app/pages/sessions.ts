// Sessions: what every agent did — requests, files, commands, full log.
// (Filled in by the dashboard work; this is the page's slot.)

import { h } from "../../views/dom";
import { pageOf } from "../ui";

export function page(): HTMLElement {
  return pageOf("Sessions", "Everything your agents did on this PC, kept locally.",
    h("section", {}, h("div", { class: "empty-state" }, h("strong", { text: "Nothing recorded yet." }),
      h("span", { text: "Start a session in a connected agent and it shows up here." }))));
}
