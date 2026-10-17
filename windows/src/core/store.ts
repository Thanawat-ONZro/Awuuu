// Typed client for Awuuu's persistent JSON store under %LOCALAPPDATA%\Awuuu\store\<name>.json.
// Idle = 0 % CPU: writes are debounced (300 ms) and never poll.

import { Bridge } from "./bridge";

export interface Identifiable {
  id: string;
  deleted?: boolean;
}

/**
 * Merges a current active list and an incoming/persisted list:
 * - Preserves the ordering of `current`.
 * - Appends new items from `incoming`.
 * - For items existing in both, properties are merged (current wins conflicts).
 * - Drops any item whose id is in `deletedIds` or has `deleted: true`.
 * A stale incoming write cannot resurrect an id present in `deletedIds`.
 */
export function mergeById<T extends Identifiable>(
  current: T[],
  incoming: T[],
  deletedIds?: Iterable<string> | Set<string>,
): T[] {
  const deletedSet = new Set<string>();
  if (deletedIds) {
    for (const id of deletedIds) {
      deletedSet.add(id);
    }
  }

  for (const item of current) {
    if (item.deleted) deletedSet.add(item.id);
  }
  for (const item of incoming) {
    if (item.deleted) deletedSet.add(item.id);
  }

  const incomingMap = new Map<string, T>();
  for (const item of incoming) {
    if (!deletedSet.has(item.id)) {
      incomingMap.set(item.id, item);
    }
  }

  const result: T[] = [];
  const seen = new Set<string>();

  for (const curr of current) {
    if (deletedSet.has(curr.id)) continue;
    const inc = incomingMap.get(curr.id);
    if (inc) {
      result.push({ ...inc, ...curr });
      incomingMap.delete(curr.id);
    } else {
      result.push({ ...curr });
    }
    seen.add(curr.id);
  }

  for (const [id, inc] of incomingMap) {
    if (!seen.has(id) && !deletedSet.has(id)) {
      result.push({ ...inc });
      seen.add(id);
    }
  }

  return result;
}

/**
 * Debounces a function call by `delayMs` milliseconds (default 300 ms).
 * Exposes `.cancel()` and `.flush()`.
 */
export function debounceMs<Args extends unknown[]>(
  fn: (...args: Args) => void | Promise<void>,
  delayMs = 300,
): ((...args: Args) => void) & { cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Args | null = null;

  const debounced = (...args: Args) => {
    lastArgs = args;
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      if (lastArgs !== null) {
        const toCall = lastArgs;
        lastArgs = null;
        void fn(...toCall);
      }
    }, delayMs);
  };

  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };

  debounced.flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (lastArgs !== null) {
      const toCall = lastArgs;
      lastArgs = null;
      void fn(...toCall);
    }
  };

  return debounced;
}

const listSavers = new Map<string, (items: unknown[]) => void>();
const valueSavers = new Map<string, (val: unknown) => void>();

/** Loads a JSON array from store file `<name>.json`. */
export async function loadList<T>(name: string): Promise<T[]> {
  try {
    const val = await Bridge.storeRead<T[]>(name);
    if (Array.isArray(val)) {
      return val;
    }
  } catch {
    /* fallback to empty */
  }
  return [];
}

/** Saves a JSON array to store file `<name>.json`, debounced by 300 ms. */
export function saveList<T>(name: string, items: T[]): void {
  let saver = listSavers.get(name);
  if (!saver) {
    saver = debounceMs((data: unknown[]) => {
      void Bridge.storeWrite(name, data);
    }, 300);
    listSavers.set(name, saver);
  }
  saver(items);
}

/** Loads any JSON value from store file `<name>.json`. */
export async function loadValue<T>(name: string, fallback: T): Promise<T> {
  try {
    const val = await Bridge.storeRead<T>(name);
    if (val !== null && val !== undefined) {
      return val;
    }
  } catch {
    /* fallback */
  }
  return fallback;
}

/** Saves any JSON value to store file `<name>.json`, debounced by 300 ms. */
export function saveValue<T>(name: string, value: T): void {
  let saver = valueSavers.get(name);
  if (!saver) {
    saver = debounceMs((data: unknown) => {
      void Bridge.storeWrite(name, data);
    }, 300);
    valueSavers.set(name, saver);
  }
  saver(value);
}
