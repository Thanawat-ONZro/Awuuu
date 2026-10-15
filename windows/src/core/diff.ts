// Unified-style diff of one file edit, built from the tool input an agent sends
// (Edit / MultiEdit / Write, and the same calls under other agents' names).
// Pure: no DOM, no I/O. The result lives in memory only (never written to disk).

export type DiffKind = "context" | "added" | "removed";

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

export interface DiffHunk {
  /** 1-based first line of the hunk in the old / new text. */
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  added: number;
  removed: number;
  hunks: DiffHunk[];
  /** True when the input was too big: counts are kept, lines are cut or absent. */
  truncated: boolean;
  /** A Write: the whole file is new content. */
  isNew: boolean;
}

/** Above this much text (old + new, UTF-16 units) only counts are kept. */
export const DIFF_MAX_CHARS = 200_000;
/** Above this many input lines (old + new) only counts are kept. */
export const DIFF_MAX_INPUT_LINES = 4000;
/** LCS is O(m·n): bail out before the quadratic blowup. */
const MAX_CELLS = 1_000_000;
/** Lines kept in a diff that is shown. */
export const DIFF_MAX_SHOWN = 600;
/** A single line is clipped to this many characters. */
export const DIFF_LINE_MAX = 400;
const CONTEXT = 3;

function lines(text: string): string[] {
  const parts = text.replace(/\r\n/g, "\n").split("\n");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

const clipLine = (s: string) => (s.length > DIFF_LINE_MAX ? `${s.slice(0, DIFF_LINE_MAX - 1)}…` : s);

/** Counts only: lines of one text that the other lacks (set based, cheap). */
function countOnly(oldText: string, newText: string, path: string): FileDiff {
  const a = lines(oldText);
  const b = lines(newText);
  const sa = new Set(a);
  const sb = new Set(b);
  return {
    path,
    added: b.filter((l) => l !== "" && !sa.has(l)).length,
    removed: a.filter((l) => l !== "" && !sb.has(l)).length,
    hunks: [],
    truncated: true,
    isNew: false,
  };
}

function flatDiff(a: string[], b: string[]): DiffLine[] {
  const m = a.length;
  const n = b.length;
  const w = n + 1;
  const dp = new Uint16Array((m + 1) * w);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i * w + j] = a[i - 1] === b[j - 1] ? dp[(i - 1) * w + j - 1] + 1 : Math.max(dp[(i - 1) * w + j], dp[i * w + j - 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      out.push({ kind: "context", text: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i * w + j - 1] >= dp[(i - 1) * w + j])) {
      out.push({ kind: "added", text: b[j - 1] });
      j--;
    } else {
      out.push({ kind: "removed", text: a[i - 1] });
      i--;
    }
  }
  return out.reverse();
}

/** Groups changed lines with CONTEXT lines around them into hunks. */
function toHunks(flat: DiffLine[]): DiffHunk[] {
  const ranges: [number, number][] = [];
  flat.forEach((l, i) => {
    if (l.kind === "context") return;
    const s = Math.max(0, i - CONTEXT);
    const e = Math.min(flat.length - 1, i + CONTEXT);
    const last = ranges.at(-1);
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else ranges.push([s, e]);
  });
  return ranges.map(([s, e]) => {
    let oldAt = 1;
    let newAt = 1;
    for (let i = 0; i < s; i++) {
      if (flat[i].kind !== "added") oldAt++;
      if (flat[i].kind !== "removed") newAt++;
    }
    return { oldStart: oldAt, newStart: newAt, lines: flat.slice(s, e + 1).map((l) => ({ kind: l.kind, text: clipLine(l.text) })) };
  });
}

/** Diff of replacing `oldText` with `newText`. */
export function diffEdit(oldText: string, newText: string, path: string): FileDiff {
  if (oldText.length + newText.length > DIFF_MAX_CHARS) return countOnly(oldText, newText, path);
  const a = lines(oldText);
  const b = lines(newText);
  if (a.length + b.length > DIFF_MAX_INPUT_LINES || a.length * b.length > MAX_CELLS) return countOnly(oldText, newText, path);
  const flat = flatDiff(a, b);
  return {
    path,
    added: flat.filter((l) => l.kind === "added").length,
    removed: flat.filter((l) => l.kind === "removed").length,
    hunks: toHunks(flat),
    truncated: false,
    isNew: false,
  };
}

/** Diff of writing a whole new file. Shows the first DIFF_MAX_SHOWN lines. */
export function diffWrite(content: string, path: string): FileDiff {
  const all = lines(content.length > DIFF_MAX_CHARS * 4 ? content.slice(0, DIFF_MAX_CHARS * 4) : content);
  // Total line count even when the text is huge (cheap: counts newlines).
  const total = content.length > DIFF_MAX_CHARS * 4 ? content.split("\n").length : all.length;
  const shown = all.slice(0, DIFF_MAX_SHOWN).map((t) => ({ kind: "added" as const, text: clipLine(t) }));
  return {
    path,
    added: total,
    removed: 0,
    hunks: shown.length ? [{ oldStart: 0, newStart: 1, lines: shown }] : [],
    truncated: total > shown.length,
    isNew: true,
  };
}

/** Keeps a finished diff within DIFF_MAX_SHOWN shown lines. */
function capShown(d: FileDiff): FileDiff {
  let budget = DIFF_MAX_SHOWN;
  const hunks: DiffHunk[] = [];
  for (const hk of d.hunks) {
    if (budget <= 0) { d.truncated = true; break; }
    if (hk.lines.length > budget) {
      hunks.push({ ...hk, lines: hk.lines.slice(0, budget) });
      d.truncated = true;
      budget = 0;
    } else {
      hunks.push(hk);
      budget -= hk.lines.length;
    }
  }
  return { ...d, hunks };
}

const s = (v: unknown): string | null => (typeof v === "string" ? v : null);

function lookup(input: Record<string, unknown>, ...names: string[]): unknown {
  for (const [k, v] of Object.entries(input)) if (names.includes(k.toLowerCase())) return v;
  return undefined;
}

/**
 * The diff of one Edit, MultiEdit or Write call, or null when the call is not
 * a file edit or changes nothing. Tool names follow history.ts (other agents).
 */
export function buildFileDiff(tool: string, input: Record<string, unknown>): FileDiff | null {
  const path = s(lookup(input, "file_path", "filepath", "absolutepath", "targetfile", "path"));
  if (!path) return null;
  const edits = lookup(input, "edits");
  if (tool === "MultiEdit" || (Array.isArray(edits) && /^(edit|multi)/i.test(tool))) {
    if (!Array.isArray(edits)) return null;
    const out: FileDiff = { path, added: 0, removed: 0, hunks: [], truncated: false, isNew: false };
    for (const e of edits) {
      if (!e || typeof e !== "object") continue;
      const r = e as Record<string, unknown>;
      const o = s(r.old_string);
      const n = s(r.new_string);
      if (o == null || n == null) continue;
      const d = diffEdit(o, n, path);
      out.added += d.added;
      out.removed += d.removed;
      out.hunks.push(...d.hunks);
      out.truncated ||= d.truncated;
    }
    return out.added || out.removed ? capShown(out) : null;
  }
  if (tool === "Edit" || tool === "edit") {
    const o = s(lookup(input, "old_string", "oldstring"));
    const n = s(lookup(input, "new_string", "newstring"));
    if (o == null || n == null || (!o && !n)) return null;
    const d = diffEdit(o, n, path);
    return d.added || d.removed ? capShown(d) : null;
  }
  if (tool === "Write" || tool === "write" || tool === "write_file" || tool === "write_to_file") {
    const c = s(lookup(input, "content", "codecontent", "file_text"));
    if (!c) return null;
    return diffWrite(c, path);
  }
  return null;
}

/** "+3 −1" label. */
export function diffCounts(d: Pick<FileDiff, "added" | "removed">): string {
  return `+${d.added} −${d.removed}`;
}

/** Last path component, either separator. */
export function baseName(path: string): string {
  const p = path.replace(/[\\/]+$/, "");
  return p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1) || p;
}
