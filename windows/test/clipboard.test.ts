import { describe, expect, it } from "vitest";
import { clipboardKind, matchingClipboard } from "../src/core/clipboard";
import type { ClipboardEntry } from "../src/core/bridge";
const entry = (text: string, id = 1): ClipboardEntry => ({ id, text, kind: "text", preview: null, addedAtMs: 1 });
describe("clipboard history filters", () => {
  it("classifies links, code, colors and normal text without treating arbitrary script URLs as links", () => {
    expect(clipboardKind(entry("https://example.com/a"))).toBe("links");
    expect(clipboardKind(entry("javascript:alert(1)"))).toBe("text");
    expect(clipboardKind(entry("const x = 2;"))).toBe("code");
    expect(clipboardKind(entry("#aabbcc"))).toBe("colors");
    expect(clipboardKind(entry("#abcd"))).toBe("colors");
    expect(clipboardKind(entry("#abcde"))).toBe("text");
    expect(clipboardKind(entry("hello"))).toBe("text");
  });
  it("combines filters with case-insensitive searching and never changes the stored list", () => {
    const entries = [entry("https://example.com/Work",1),entry("work notes",2)];
    expect(matchingClipboard(entries,"links","WORK").map(e => e.id)).toEqual([1]);
    expect(matchingClipboard(entries,"all","work")).toHaveLength(2);
    expect(entries).toHaveLength(2);
  });
});
