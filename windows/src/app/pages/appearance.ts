// Appearance: how Awuuu the dog looks.

import { h } from "../../views/dom";
import { pageOf } from "../ui";

export function page(): HTMLElement {
  return pageOf("Appearance", "Make Awuuu yours.",
    h("section", {}, h("div", { class: "empty-state" }, h("strong", { text: "The classic Shiba, for now." }))));
}
