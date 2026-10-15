import { describe, expect, it } from "vitest";
import {
  SHORTCUTS, activeKeys, conflictWith, displayKeys, duplicates, effectiveKeys, normalizeKeys,
  parseKeys, recordPress, validate, withBinding,
} from "../src/core/shortcuts";

const press = (o: Partial<Parameters<typeof recordPress>[0]>) =>
  recordPress({ key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o });

describe("accelerators", () => {
  it("normalises spellings", () => {
    expect(normalizeKeys("control+option+space")).toBe("Ctrl+Alt+Space");
    expect(normalizeKeys("alt+ctrl+KeyY")).toBe("Ctrl+Alt+Y");
    expect(normalizeKeys("Ctrl+Shift+ArrowLeft")).toBe("Ctrl+Shift+Left");
    expect(normalizeKeys("Win+,")).toBe("Super+Comma");
  });
  it("rejects bare keys and junk", () => {
    expect(parseKeys("Y")).toBeNull();
    expect(parseKeys("F5")).toBeNull();
    expect(parseKeys("Shift+Y")).toBeNull();
    expect(parseKeys("Ctrl+")).toBeNull();
    expect(parseKeys("Ctrl+Alt")).toBeNull();
    expect(parseKeys("Ctrl+Y+Alt")).toBeNull();
    expect(parseKeys("Ctrl+Nope")).toBeNull();
    expect(parseKeys("")).toBeNull();
    expect(validate("Y")).not.toBeNull();
    expect(validate("Ctrl+Y")).toBeNull();
    expect(validate("")).toBeNull();
  });
  it("displays", () => {
    expect(displayKeys("Ctrl+Alt+Left")).toBe("Ctrl+Alt+←");
    expect(displayKeys("")).toBe("Off");
  });
});

describe("defaults and bindings", () => {
  it("has the requested defaults, island toggle off", () => {
    expect(effectiveKeys(SHORTCUTS.find((s) => s.id === "openChat")!, {})).toBe("Ctrl+Alt+Space");
    expect(effectiveKeys(SHORTCUTS.find((s) => s.id === "toggleIsland")!, {})).toBe("");
    expect(activeKeys({}).map(([id]) => id)).not.toContain("toggleIsland");
    expect(activeKeys({}).map(([id]) => id)).toContain("approvalDeny");
  });
  it("all defaults are valid and distinct", () => {
    for (const d of SHORTCUTS) expect(parseKeys(d.defaultKeys)).not.toBeNull();
    expect(new Set(SHORTCUTS.map((d) => d.defaultKeys)).size).toBe(SHORTCUTS.length);
    expect(duplicates(SHORTCUTS.map((d) => [d.id, d.defaultKeys] as [string, string])).size).toBe(0);
  });
  it("stores only changes and treats '' as off", () => {
    let b = withBinding({}, "muteToggle", "ctrl+alt+m");
    expect(b).toEqual({ muteToggle: "Ctrl+Alt+M" });
    b = withBinding(b, "muteToggle", "Ctrl+Alt+S");
    expect(b).toEqual({});
    b = withBinding(b, "openChat", "");
    expect(b).toEqual({ openChat: "" });
    expect(activeKeys(b).map(([id]) => id)).not.toContain("openChat");
    b = withBinding(b, "toggleIsland", "Ctrl+Alt+I");
    expect(b.toggleIsland).toBe("Ctrl+Alt+I");
    expect(withBinding(b, "toggleIsland", "").toggleIsland).toBeUndefined();
  });
  it("detects conflicts", () => {
    expect(conflictWith({}, "muteToggle", "Ctrl+Alt+N")).toBe("approvalDeny");
    expect(conflictWith({}, "approvalDeny", "ctrl+alt+n")).toBeNull();
    expect(conflictWith({}, "muteToggle", "Ctrl+Alt+M")).toBeNull();
    const dups = duplicates([["a", "Ctrl+Alt+X"], ["b", "alt+control+x"], ["c", "Ctrl+Alt+Z"]]);
    expect([...dups].sort()).toEqual(["a", "b"]);
  });
});

describe("recorder", () => {
  it("waits on modifiers, cancels, clears", () => {
    expect(press({ key: "Control", ctrlKey: true }).kind).toBe("pending");
    expect(press({ key: "Escape" }).kind).toBe("cancel");
    expect(press({ key: "Backspace" }).kind).toBe("clear");
  });
  it("needs a modifier", () => {
    expect(press({ key: "y", code: "KeyY" }).kind).toBe("needsModifier");
    expect(press({ key: "Y", code: "KeyY", shiftKey: true }).kind).toBe("needsModifier");
  });
  it("records combos", () => {
    expect(press({ key: "y", code: "KeyY", ctrlKey: true, altKey: true })).toEqual({ kind: "keys", keys: "Ctrl+Alt+Y" });
    expect(press({ key: " ", code: "Space", ctrlKey: true, altKey: true })).toEqual({ kind: "keys", keys: "Ctrl+Alt+Space" });
    expect(press({ key: "ArrowLeft", code: "ArrowLeft", ctrlKey: true })).toEqual({ kind: "keys", keys: "Ctrl+Left" });
    expect(press({ key: "F5", code: "F5", altKey: true })).toEqual({ kind: "keys", keys: "Alt+F5" });
    expect(press({ key: "CapsLock", code: "CapsLock", ctrlKey: true }).kind).toBe("unsupported");
  });
});
