// Git as the ground truth for a request (ground.rs). A snapshot when the user's prompt goes
// in, another when the turn ends; the difference lands in the history as "found by git"
// entries for the files no tool call named (a script, a formatter, `sed -i`, a commit).
// Silent when the folder is not a repository, the history is off, or git answers too slowly.

import { Bridge } from "../core/bridge";
import { History, type HistoryCtx } from "./history";
import { diffSnapshots, type Snap } from "./snapshot";

const starts = new Map<string, Promise<Snap | null>>();
const MAX_SESSIONS = 50;

export const Ground = {
  /** The user asked something: remember how the repository looks now. */
  start(session: string, cwd: string | null | undefined) {
    if (!cwd || !History.active()) return;
    starts.set(session, Bridge.gitSnapshot(cwd));
    if (starts.size > MAX_SESSIONS) starts.delete(starts.keys().next().value as string);
  },

  /** The turn ended: report what changed since `start`. */
  async finish(ctx: HistoryCtx) {
    const first = starts.get(ctx.session);
    starts.delete(ctx.session);
    if (!first || !ctx.cwd) return;
    const [before, after] = await Promise.all([first, Bridge.gitSnapshot(ctx.cwd)]);
    if (!before || !after) return;
    const committed = before.head && after.head && before.head !== after.head
      ? (await Bridge.gitChangedBetween(ctx.cwd, before.head, after.head)) ?? []
      : [];
    const changes = diffSnapshots(before, after, committed);
    if (changes.length) History.gitChanges(ctx, changes);
  },
};
