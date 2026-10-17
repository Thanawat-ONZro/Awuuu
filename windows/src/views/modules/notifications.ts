// Notifications module for Awuuu's notch dashboard (Task 11).
// Surfaces Awuuu's event stream (sessions, approvals, uploads) as a centered notification list (Phase A).
// Phase B integrates with Windows Toast notifications via WinRT UserNotificationListener behind a setting.
// 0 % CPU when idle: renders reactively upon incoming notification events.

import { clear, h, svg } from "../dom";
import { ICONS } from "../icons";
import type { ModuleCtx, ModuleHost } from "../../core/modules";
import {
  clearAllNotifications,
  dismissNotification,
  getNotifications,
  groupNotificationsByApp,
  subscribeNotifications,
  type NotificationItem,
} from "../../core/notifications";
import { t } from "../../i18n/i18n";

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 45) return t("Just now");
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t("{n}m", { n: diffMin });
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t("{n}h", { n: diffHr });
  const diffDays = Math.floor(diffHr / 24);
  return t("{n}d", { n: diffDays });
}

export function createNotificationsModuleHost(ctx: ModuleCtx): ModuleHost {
  const iconEl = svg(ICONS.bell, 13);
  const titleEl = h("span", { class: "notifications-header-title", text: t("Notifications") });
  const badgeEl = h("span", { class: "notifications-badge", text: "0" });
  badgeEl.style.display = "none";

  const clearBtn = h(
    "button",
    { class: "notifications-clear-btn", title: t("Clear all") },
    h("span", { text: t("Clear all") }),
  );
  clearBtn.addEventListener("click", () => {
    clearAllNotifications();
  });

  const headerEl = h(
    "div",
    { class: "notifications-header" },
    h("div", { class: "notifications-header-left" }, iconEl, titleEl, badgeEl),
    clearBtn,
  );

  const listContainer = h("div", { class: "notifications-list" });
  const el = h("div", { class: "widget widget-notifications" }, headerEl, listContainer);

  function renderNotificationCard(item: NotificationItem): HTMLElement {
    const cardEl = h("div", { class: `notification-card ${item.kind ?? "info"}` });

    // Top row: Source badge + relative time + dismiss button
    const sourceBadge = h("span", { class: "notification-card-source", text: item.source });
    const timeEl = h("span", { class: "notification-card-time", text: formatRelativeTime(item.timestamp) });
    const topRowLeft = h("div", { class: "notification-top-left" }, sourceBadge, timeEl);

    const dismissBtn = h(
      "button",
      { class: "notification-dismiss-btn", title: t("Dismiss") },
      svg(ICONS.xmark, 10),
    );
    dismissBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dismissNotification(item.id);
    });

    const topRow = h("div", { class: "notification-card-top" }, topRowLeft, dismissBtn);

    // Title & Body
    const title = h("div", { class: "notification-card-title", text: item.title });
    const body = h("div", { class: "notification-card-body", text: item.body });

    cardEl.append(topRow, title, body);

    // Action button if applicable
    if (item.kind === "approval") {
      const actBtn = h("button", { class: "notification-action-btn", text: item.actionLabel ?? t("Review") });
      actBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        ctx.open("approval");
      });
      cardEl.append(h("div", { class: "notification-card-actions" }, actBtn));
    } else if (item.kind === "upload") {
      const actBtn = h("button", { class: "notification-action-btn", text: t("Open") });
      actBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        ctx.open("choose");
      });
      cardEl.append(h("div", { class: "notification-card-actions" }, actBtn));
    } else if (item.kind === "done" || item.kind === "error") {
      cardEl.style.cursor = "pointer";
      cardEl.addEventListener("click", () => {
        ctx.open("agents");
      });
    }

    return cardEl;
  }

  function render() {
    const items = getNotifications();
    clear(listContainer);

    if (items.length === 0) {
      badgeEl.style.display = "none";
      clearBtn.style.display = "none";
      listContainer.append(
        h(
          "div",
          { class: "notifications-empty" },
          h("div", { class: "notifications-empty-title", text: t("No notifications") }),
          h("div", { class: "notifications-empty-hint", text: t("Alerts from agents and Awuuu appear here.") }),
        ),
      );
      return;
    }

    badgeEl.textContent = String(items.length);
    badgeEl.style.display = "inline-block";
    clearBtn.style.display = "inline-block";

    const groups = groupNotificationsByApp(items);
    for (const group of groups) {
      const groupHeader = h(
        "div",
        { class: "notifications-group-header" },
        h("span", { class: "group-source-name", text: group.source }),
        h("span", { class: "group-count", text: String(group.count) }),
      );
      listContainer.append(groupHeader);
      for (const item of group.items) {
        listContainer.append(renderNotificationCard(item));
      }
    }
  }

  const unsubscribe = subscribeNotifications(() => {
    render();
  });

  render();

  return {
    el,
    refresh: () => {
      render();
    },
    dispose: () => {
      unsubscribe();
    },
  };
}
