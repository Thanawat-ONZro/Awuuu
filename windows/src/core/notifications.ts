// Pure notifications store and reducers for Awuuu's notch dashboard.
// Keeps notifications in memory only — never persisted or logged.

export interface NotificationItem {
  id: string;
  source: string;
  title: string;
  body: string;
  timestamp: number;
  kind?: "approval" | "info" | "error" | "done" | "upload";
  key?: string;
  actionLabel?: string;
  actionPayload?: unknown;
}

export interface NotificationGroup {
  source: string;
  items: NotificationItem[];
  latestTimestamp: number;
  count: number;
}

/**
 * Deduplicates and updates the notification list.
 * Replaces entries sharing the same ID, or collapses identical
 * source+title+body occurrences arriving within `windowMs` (default 5 min).
 * Retains newest entries first, capped at `maxLimit`.
 */
export function dedupeNotifications(
  existing: NotificationItem[],
  incoming: NotificationItem | NotificationItem[],
  maxLimit: number = 50,
  windowMs: number = 300_000,
): NotificationItem[] {
  const itemsToAdd = Array.isArray(incoming) ? incoming : [incoming];
  const list = [...existing];

  for (const item of itemsToAdd) {
    const existingIndex = list.findIndex(
      (n) =>
        n.id === item.id ||
        (n.source === item.source &&
          n.title === item.title &&
          n.body === item.body &&
          Math.abs(n.timestamp - item.timestamp) <= windowMs),
    );

    if (existingIndex >= 0) {
      list[existingIndex] = item;
    } else {
      list.push(item);
    }
  }

  // Sort newest first
  list.sort((a, b) => b.timestamp - a.timestamp);

  // Cap length
  if (list.length > maxLimit) {
    return list.slice(0, maxLimit);
  }

  return list;
}

/**
 * Groups notifications by their originating source / app.
 * Groups are ordered by their latest notification timestamp descending.
 * Items within each group are also ordered by timestamp descending.
 */
export function groupNotificationsByApp(items: NotificationItem[]): NotificationGroup[] {
  if (items.length === 0) return [];

  const map = new Map<string, NotificationItem[]>();
  for (const item of items) {
    const group = map.get(item.source);
    if (group) {
      group.push(item);
    } else {
      map.set(item.source, [item]);
    }
  }

  const groups: NotificationGroup[] = [];
  for (const [source, list] of map.entries()) {
    list.sort((a, b) => b.timestamp - a.timestamp);
    const latestTimestamp = list[0]?.timestamp ?? 0;
    groups.push({
      source,
      items: list,
      latestTimestamp,
      count: list.length,
    });
  }

  groups.sort((a, b) => b.latestTimestamp - a.latestTimestamp);
  return groups;
}

/**
 * Removes a notification by id.
 */
export function removeNotification(items: NotificationItem[], id: string): NotificationItem[] {
  return items.filter((n) => n.id !== id);
}

// ── In-memory Notification Store (0% idle CPU, no disk persistence) ──────────

let storeNotifications: NotificationItem[] = [];
const subscribers = new Set<(items: NotificationItem[]) => void>();

export function getNotifications(): NotificationItem[] {
  return [...storeNotifications];
}

export function pushNotification(item: NotificationItem): void {
  storeNotifications = dedupeNotifications(storeNotifications, item);
  for (const sub of subscribers) {
    sub(storeNotifications);
  }
}

export function dismissNotification(id: string): void {
  storeNotifications = removeNotification(storeNotifications, id);
  for (const sub of subscribers) {
    sub(storeNotifications);
  }
}

export function clearAllNotifications(): void {
  storeNotifications = [];
  for (const sub of subscribers) {
    sub(storeNotifications);
  }
}

export function subscribeNotifications(sub: (items: NotificationItem[]) => void): () => void {
  subscribers.add(sub);
  return () => {
    subscribers.delete(sub);
  };
}
