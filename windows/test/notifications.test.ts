import { describe, expect, it } from "vitest";
import {
  dedupeNotifications,
  groupNotificationsByApp,
  removeNotification,
  type NotificationItem,
} from "../src/core/notifications";

describe("notifications dedupe reducer", () => {
  it("deduplicates notifications with the same id and updates timestamp", () => {
    const initial: NotificationItem[] = [
      {
        id: "hook-1",
        source: "Claude Code",
        title: "Session Started",
        body: "Working on task",
        timestamp: 1000,
        kind: "info",
      },
    ];

    const incoming: NotificationItem = {
      id: "hook-1",
      source: "Claude Code",
      title: "Session Started",
      body: "Working on task (updated)",
      timestamp: 2000,
      kind: "info",
    };

    const result = dedupeNotifications(initial, incoming);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "hook-1",
      source: "Claude Code",
      title: "Session Started",
      body: "Working on task (updated)",
      timestamp: 2000,
      kind: "info",
    });
  });

  it("deduplicates identical source, title, and body within dedupe window", () => {
    const initial: NotificationItem[] = [
      {
        id: "alert-1",
        source: "Antigravity CLI",
        title: "Rate Limit Warning",
        body: "Too many requests",
        timestamp: 1000,
        kind: "error",
      },
    ];

    const incoming: NotificationItem = {
      id: "alert-2", // different id but same source + title + body
      source: "Antigravity CLI",
      title: "Rate Limit Warning",
      body: "Too many requests",
      timestamp: 1500,
      kind: "error",
    };

    const result = dedupeNotifications(initial, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("alert-2");
    expect(result[0].timestamp).toBe(1500);
  });

  it("sorts notifications by timestamp descending", () => {
    const items: NotificationItem[] = [
      { id: "1", source: "Claude Code", title: "First", body: "A", timestamp: 100, kind: "info" },
      { id: "2", source: "Awuuu", title: "Second", body: "B", timestamp: 300, kind: "info" },
      { id: "3", source: "Hermes Agent", title: "Third", body: "C", timestamp: 200, kind: "info" },
    ];

    const result = dedupeNotifications([], items);
    expect(result.map((n) => n.id)).toEqual(["2", "3", "1"]);
    expect(result.map((n) => n.timestamp)).toEqual([300, 200, 100]);
  });

  it("caps total notifications to maxLimit", () => {
    const list: NotificationItem[] = Array.from({ length: 10 }, (_, i) => ({
      id: `item-${i}`,
      source: "Awuuu",
      title: `Notice ${i}`,
      body: `Body ${i}`,
      timestamp: 1000 + i,
      kind: "info",
    }));

    const result = dedupeNotifications([], list, 5);
    expect(result).toHaveLength(5);
    expect(result.map((n) => n.id)).toEqual(["item-9", "item-8", "item-7", "item-6", "item-5"]);
  });

  it("removes a notification by id", () => {
    const list: NotificationItem[] = [
      { id: "1", source: "Claude Code", title: "First", body: "A", timestamp: 100 },
      { id: "2", source: "Awuuu", title: "Second", body: "B", timestamp: 200 },
    ];

    const result = removeNotification(list, "1");
    expect(result).toEqual([
      { id: "2", source: "Awuuu", title: "Second", body: "B", timestamp: 200 },
    ]);
  });
});

describe("groupNotificationsByApp reducer", () => {
  it("groups notifications by app, sorting groups and items by timestamp descending", () => {
    const notifications: NotificationItem[] = [
      { id: "c1", source: "Claude Code", title: "Write file", body: "src/main.ts", timestamp: 100 },
      { id: "c2", source: "Claude Code", title: "Approval needed", body: "Edit file", timestamp: 500, kind: "approval" },
      { id: "a1", source: "Awuuu", title: "File Dropped", body: "doc.pdf", timestamp: 300, kind: "upload" },
      { id: "h1", source: "Hermes Agent", title: "Thought", body: "Thinking...", timestamp: 700 },
      { id: "h2", source: "Hermes Agent", title: "Answer ready", body: "Finished response", timestamp: 900, kind: "done" },
    ];

    const groups = groupNotificationsByApp(notifications);

    expect(groups).toHaveLength(3);

    // Group 1: Hermes Agent (latest timestamp: 900)
    expect(groups[0].source).toBe("Hermes Agent");
    expect(groups[0].latestTimestamp).toBe(900);
    expect(groups[0].count).toBe(2);
    expect(groups[0].items.map((i) => i.id)).toEqual(["h2", "h1"]);

    // Group 2: Claude Code (latest timestamp: 500)
    expect(groups[1].source).toBe("Claude Code");
    expect(groups[1].latestTimestamp).toBe(500);
    expect(groups[1].count).toBe(2);
    expect(groups[1].items.map((i) => i.id)).toEqual(["c2", "c1"]);

    // Group 3: Awuuu (latest timestamp: 300)
    expect(groups[2].source).toBe("Awuuu");
    expect(groups[2].latestTimestamp).toBe(300);
    expect(groups[2].count).toBe(1);
    expect(groups[2].items.map((i) => i.id)).toEqual(["a1"]);
  });

  it("handles empty notification list", () => {
    expect(groupNotificationsByApp([])).toEqual([]);
  });
});
