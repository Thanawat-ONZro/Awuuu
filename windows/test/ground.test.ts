import { describe, expect, it } from "vitest";
import { groundDiff, groundTitle, type GitSnapshot } from "../src/island/ground";

const snap = (head: string, files: GitSnapshot["files"]): GitSnapshot => ({ root: "C:/app", head, files });

describe("groundDiff", () => {
  it("sees only what changed during the request", () => {
    const before = snap("abc", [{ path: "C:/app/old.ts", status: "M", added: 2, removed: 1 }]);
    const after = snap("abc", [
      { path: "C:/app/old.ts", status: "M", added: 2, removed: 1 },
      { path: "C:/app/a.ts", status: "M", added: 10, removed: 3 },
      { path: "C:/app/new.ts", status: "??" },
      { path: "C:/app/gone.ts", status: "D", added: 0, removed: 7 },
    ]);
    const g = groundDiff(before, after);
    expect(g.files).toEqual([
      { path: "C:/app/a.ts", change: "edit" },
      { path: "C:/app/new.ts", change: "write" },
      { path: "C:/app/gone.ts", change: "delete" },
    ]);
    expect(groundTitle(g)).toBe("Git: 3 files changed +10 −10");
  });

  it("counts only the new lines of a file that was already dirty", () => {
    const g = groundDiff(snap("a", [{ path: "C:/app/x.ts", status: "M", added: 5, removed: 0 }]), snap("a", [{ path: "C:/app/x.ts", status: "M", added: 8, removed: 1 }]));
    expect([g.added, g.removed]).toEqual([3, 1]);
  });

  it("notices a commit and an undo", () => {
    expect(groundTitle(groundDiff(snap("a", [{ path: "C:/app/x.ts", status: "M" }]), snap("b", [])))).toBe("Git: committed");
    expect(groundDiff(snap("a", [{ path: "C:/app/x.ts", status: "M" }]), snap("a", [])).files).toEqual([{ path: "C:/app/x.ts", change: "edit" }]);
  });

  it("says nothing when nothing changed", () => {
    const s = snap("a", [{ path: "C:/app/x.ts", status: "M", added: 1, removed: 1 }]);
    expect(groundTitle(groundDiff(s, s))).toBeNull();
  });
});
