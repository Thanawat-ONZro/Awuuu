import { beforeEach, describe, expect, it } from "vitest";
import { OVERLAP_WINDOW_MS, noteEdit, overlapMessage, resetOverlap } from "../src/island/overlap";

describe("noteEdit", () => {
  beforeEach(resetOverlap);

  it("warns when another session changed the file recently", () => {
    expect(noteEdit("a", "Claude", "C:\\app\\x.ts", 0)).toBeNull();
    const prev = noteEdit("b", "Codex", "c:/APP/x.ts", 60_000);
    expect(prev).toMatchObject({ session: "a", who: "Claude" });
    expect(overlapMessage("C:\\app\\x.ts", prev!, 60_000 + 30_000)).toBe("⚠ Claude changed x.ts 1 minute ago. Make sure this agent has read the latest version.");
  });

  it("stays quiet for the same session and for old edits", () => {
    noteEdit("a", "Claude", "x.ts", 0);
    expect(noteEdit("a", "Claude", "x.ts", 1000)).toBeNull();
    expect(noteEdit("b", "Codex", "x.ts", 1000 + OVERLAP_WINDOW_MS + 1)).toBeNull();
  });
});
