import { h } from "./dom";
import { createCardShell } from "./card-shell";
import {
  createDateWidget,
  createNowPlayingWidget,
  createScratchpadWidget,
  createTodoWidget,
} from "./widgets";
import type { ViewActions, ViewHost } from "./views";

export function buildDashboardView(_actions: ViewActions): ViewHost {
  const dateWidget = createDateWidget();
  const mediaWidget = createNowPlayingWidget();
  const noteWidget = createScratchpadWidget();
  const todoWidget = createTodoWidget();
  const grid = h(
    "div",
    {
      class: "dashboard-grid",
      style: "display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:8px",
    },
    dateWidget.el,
    mediaWidget.el,
    noteWidget.el,
    todoWidget.el,
  );
  const shell = createCardShell({ title: "Tools", wash: "soft", body: grid });
  const el = h("div", { class: "view dashboard-view" }, shell.el);
  return {
    el,
    sync() {
      dateWidget.update();
      void mediaWidget.refresh();
    },
    tick(nowMs) {
      if (Math.floor(nowMs / 1000) % 5 === 0) void mediaWidget.refresh();
    },
  };
}
