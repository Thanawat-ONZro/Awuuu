import { describe, expect, it } from "vitest";
import { DIFF_MAX_SHOWN, DIFF_LINE_MAX, buildFileDiff, diffCounts, diffEdit, diffWrite } from "../src/core/diff";

const kinds = (d: ReturnType<typeof diffEdit>) => d.hunks.flatMap((h) => h.lines.map((l) => (l.kind === "added" ? "+" : l.kind === "removed" ? "-" : " ") + l.text));

describe("diffEdit", () => {
  it("counts and orders a replaced line with context", () => {
    const d = diffEdit("a\nb\nc\n", "a\nB\nc\n", "f.ts");
    expect(d).toMatchObject({ added: 1, removed: 1, truncated: false });
    expect(kinds(d)).toEqual([" a", "-b", "+B", " c"]);
    expect(d.hunks[0]).toMatchObject({ oldStart: 1, newStart: 1 });
  });
  it("splits distant changes into two hunks", () => {
    const base = Array.from({ length: 30 }, (_, i) => `l${i}`);
    const next = base.slice();
    next[2] = "X";
    next[25] = "Y";
    const d = diffEdit(base.join("\n"), next.join("\n"), "f");
    expect(d.hunks).toHaveLength(2);
    expect(d.hunks[1].oldStart).toBe(23);
  });
  it("keeps only counts for huge input", () => {
    const big = "x\n".repeat(150_000);
    const d = diffEdit(big, `${big}y\n`, "f");
    expect(d.truncated).toBe(true);
    expect(d.hunks).toEqual([]);
    expect(d.added).toBe(1);
  });
  it("keeps only counts when the line table would be too large", () => {
    const a = Array.from({ length: 1500 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 1500 }, (_, i) => `b${i}`).join("\n");
    const d = diffEdit(a, b, "f");
    expect(d.truncated).toBe(true);
    expect(d).toMatchObject({ added: 1500, removed: 1500 });
  });
  it("clips very long lines", () => {
    const d = diffEdit("a", "b".repeat(5000), "f");
    expect(d.hunks[0].lines.at(-1)!.text.length).toBe(DIFF_LINE_MAX);
  });
});

describe("buildFileDiff", () => {
  it("handles Edit", () => {
    const d = buildFileDiff("Edit", { file_path: "/a/b.ts", old_string: "one", new_string: "two" });
    expect(d).toMatchObject({ path: "/a/b.ts", added: 1, removed: 1 });
    expect(diffCounts(d!)).toBe("+1 −1");
  });
  it("handles MultiEdit", () => {
    const d = buildFileDiff("MultiEdit", { file_path: "f", edits: [{ old_string: "a", new_string: "b" }, { old_string: "", new_string: "c\nd" }] });
    expect(d).toMatchObject({ added: 3, removed: 1 });
    expect(d!.hunks).toHaveLength(2);
  });
  it("handles Write and truncates a long file", () => {
    const d = buildFileDiff("Write", { file_path: "f", content: "x\n".repeat(5000) })!;
    expect(d).toMatchObject({ added: 5000, removed: 0, isNew: true, truncated: true });
    expect(d.hunks[0].lines).toHaveLength(DIFF_MAX_SHOWN);
  });
  it("caps the shown lines of a big MultiEdit", () => {
    const edits = Array.from({ length: 50 }, (_, i) => ({ old_string: "", new_string: Array.from({ length: 30 }, (_, j) => `${i}-${j}`).join("\n") }));
    const d = buildFileDiff("MultiEdit", { file_path: "f", edits })!;
    expect(d.added).toBe(1500);
    expect(d.truncated).toBe(true);
    expect(d.hunks.reduce((n, h) => n + h.lines.length, 0)).toBe(DIFF_MAX_SHOWN);
  });
  it("ignores other tools and no-ops", () => {
    expect(buildFileDiff("Bash", { command: "ls" })).toBeNull();
    expect(buildFileDiff("Edit", { file_path: "f", old_string: "a", new_string: "a" })).toBeNull();
    expect(buildFileDiff("Write", { file_path: "f", content: "" })).toBeNull();
    expect(diffWrite("", "f").added).toBe(0);
  });
});
