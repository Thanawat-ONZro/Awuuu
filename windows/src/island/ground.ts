// The difference between two git snapshots (git.rs): which files a request
// really changed, even those the hooks never saw (sed -i, a formatter, a
// generator), and how many lines. Pure: tested in node.

export interface GitFile {
  path: string;
  status: string;
  added?: number | null;
  removed?: number | null;
}

export interface GitSnapshot {
  root: string;
  head: string;
  files: GitFile[];
}

export interface GroundChange {
  path: string;
  change: "edit" | "write" | "delete";
}

export interface Ground {
  files: GroundChange[];
  added: number;
  removed: number;
  /** HEAD moved: something was committed (or checked out) during the request. */
  committed: boolean;
}

const key = (p: string) => p.replace(/\\/g, "/").toLowerCase();

function changeOf(f: GitFile): GroundChange["change"] {
  if (f.status.includes("D")) return "delete";
  if (f.status === "??" || f.status.includes("A")) return "write";
  return "edit";
}

/** What changed between `before` (request start) and `after` (its end). */
export function groundDiff(before: GitSnapshot | null, after: GitSnapshot): Ground {
  const was = new Map((before?.files ?? []).map((f) => [key(f.path), f]));
  const files: GroundChange[] = [];
  let added = 0;
  let removed = 0;
  for (const f of after.files) {
    const b = was.get(key(f.path));
    was.delete(key(f.path));
    if (b && b.status === f.status && b.added === f.added && b.removed === f.removed) continue;
    files.push({ path: f.path, change: changeOf(f) });
    added += Math.max(0, (f.added ?? 0) - (b?.added ?? 0));
    removed += Math.max(0, (f.removed ?? 0) - (b?.removed ?? 0));
  }
  const committed = !!before && !!before.head && before.head !== after.head;
  // Dirty before, clean after, HEAD unchanged: the change was undone.
  if (!committed) for (const b of was.values()) files.push({ path: b.path, change: "edit" });
  return { files, added, removed, committed };
}

/** "Git: 3 files changed +42 −7", or null when git saw nothing. */
export function groundTitle(g: Ground): string | null {
  if (g.files.length === 0) return g.committed ? "Git: committed" : null;
  const n = g.files.length;
  return `Git: ${n} file${n === 1 ? "" : "s"} changed +${g.added} −${g.removed}${g.committed ? " · committed" : ""}`;
}
