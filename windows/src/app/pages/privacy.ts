// Privacy & history: what Awuuu keeps, where, and what leaves this PC.

import { h } from "../../views/dom";
import { pageOf } from "../ui";

export function page(): HTMLElement {
  return pageOf("Privacy & history", "Awuuu keeps everything on this PC. Nothing is sent anywhere unless you connect a service yourself.",
    h("section", {}, h("div", { class: "hint", text: "No telemetry. Network requests only go to the services you configure yourself." })));
}
