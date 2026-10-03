// Two git snapshots → the files a request changed, however it changed them (ground.rs
// takes the snapshots). Pure: no Tauri, so it runs under plain node.

export interface SnapFile {
  path: string;
  /** git status letters: "??" new, " M" changed, " D" deleted… */
  code: string;
  size: number;
  mtime: number;
}

export interface Snap {
  head: string;
  files: SnapFile[];
}

export interface GitChange {
  path: string;
  change: "edit" | "write" | "delete";
}

const key = (p: string) => p.replace(/\\/g, "/").toLowerCase();

function changeOf(code: string): GitChange["change"] {
  if (code.includes("D")) return "delete";
  return code === "??" || code.includes("A") ? "write" : "edit";
}

/**
 * What changed between the start and the end of a request: a file git lists now that it did
 * not list before or that has another size, time or state, plus the files of commits made
 * in between (`committed`, from the two HEADs). A file git stopped listing because it was
 * reverted is not reported: nothing says who did it.
 */
export function diffSnapshots(before: Snap, after: Snap, committed: SnapFile[] = []): GitChange[] {
  const was = new Map(before.files.map((f) => [key(f.path), f]));
  const out = new Map<string, GitChange>();
  for (const f of after.files) {
    const b = was.get(key(f.path));
    if (b && b.size === f.size && b.mtime === f.mtime && b.code === f.code) continue;
    out.set(key(f.path), { path: f.path, change: changeOf(f.code) });
  }
  if (before.head && after.head && before.head !== after.head) {
    for (const f of committed) if (!out.has(key(f.path))) out.set(key(f.path), { path: f.path, change: changeOf(f.code) });
  }
  return [...out.values()];
}
