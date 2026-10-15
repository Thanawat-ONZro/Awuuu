import { describe, expect, it } from "vitest";
import { assembleAnswer, parseQuestions, togglePick } from "../src/island/ask-question";

describe("ask-question", () => {
  it("parses AskUserQuestion with multi-select and caps at 4", () => {
    const qs = Array.from({ length: 6 }, (_, i) => ({
      question: `Q${i}`, header: "H", multiSelect: i === 1,
      options: [{ label: "a", description: "d" }, { label: "b" }],
    }));
    const r = parseQuestions("AskUserQuestion", { questions: qs })!;
    expect(r).toHaveLength(4);
    expect(r[1].multiSelect).toBe(true);
    expect(r[0].options[0]).toEqual({ label: "a", description: "d" });
  });
  it("parses AGY ask_question string options", () => {
    const r = parseQuestions("ask_question", { questions: [{ question: "Q", options: ["x", "y"], is_multi_select: true }] })!;
    expect(r[0].options.map((o) => o.label)).toEqual(["x", "y"]);
    expect(r[0].multiSelect).toBe(true);
  });
  it("rejects non-questions and drops empty ones", () => {
    expect(parseQuestions("Bash", { questions: [{ question: "Q" }] })).toBeUndefined();
    expect(parseQuestions("AskUserQuestion", { questions: [{ question: " " }] })).toBeUndefined();
    expect(parseQuestions("AskUserQuestion", {})).toBeUndefined();
  });
  it("assembles answers", () => {
    expect(assembleAnswer(["a", "b"])).toBe("a, b");
    const s = togglePick(togglePick(new Set(), "a"), "b");
    expect([...togglePick(s, "a")]).toEqual(["b"]);
  });
});
