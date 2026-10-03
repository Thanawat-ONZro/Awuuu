// Stats & limits: how much the agents did, and how much of each plan is left.

import { h } from "../../views/dom";
import { pageOf } from "../ui";

export function page(): HTMLElement {
  return pageOf("Stats & limits", "Activity over the last days, and the usage limits of your connected agents.",
    h("section", {}, h("div", { class: "empty-state" }, h("strong", { text: "No numbers yet." }))));
}
