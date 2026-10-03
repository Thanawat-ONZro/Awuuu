// Two agents, one file: spot an agent about to change a file that another agent session
// changed a few minutes ago. That is how parallel agents overwrite each other's work.
//
// Plain rules, no I/O. hooks.ts feeds it every edit and shows what comes back; nothing here
// blocks an agent (the island only ever warns).

export interface OverlapEdit {
  session: string;
  /** Who it was, for the message: the hub's name for the session. */
  who: string;
  at: number;
}

/** How recently the other session must have changed the file. */
export const OVERLAP_WINDOW_MS = 3 * 60_000;
const MAX_FILES = 500;

const lastEdit = new Map<string, OverlapEdit>();

const pathKey = (p: string) => p.replace(/\\/g, "/").toLowerCase();

/**
 * `session` is about to change `path`. Returns the other session's change when it is recent
 * (and says nothing the second time the same session asks, e.g. PreToolUse then its
 * permission request); then remembers this one.
 */
export function noteEdit(session: string, who: string, path: string, now = Date.now()): OverlapEdit | null {
  const key = pathKey(path);
  const prev = lastEdit.get(key);
  lastEdit.delete(key); // re-insert last: the oldest entry is the first key
  lastEdit.set(key, { session, who, at: now });
  if (lastEdit.size > MAX_FILES) lastEdit.delete(lastEdit.keys().next().value as string);
  return prev && prev.session !== session && now - prev.at <= OVERLAP_WINDOW_MS ? prev : null;
}

export function overlapMessage(file: string, prev: OverlapEdit, now = Date.now()): string {
  const name = file.replace(/\\/g, "/").split("/").pop() || file;
  const mins = Math.floor((now - prev.at) / 60_000);
  const ago = mins < 1 ? "less than a minute ago" : mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
  return `⚠ ${prev.who} changed ${name} ${ago}. Make sure this agent has read the latest version.`;
}

/** Test hook: forget everything. */
export function resetOverlap() {
  lastEdit.clear();
}
