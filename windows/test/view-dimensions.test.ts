import { describe, it, expect } from "vitest";
import { VIEW_LAYOUTS, approvalHeight, chatPromptHeight, APPROVAL_MIN_H, ORIENTATION_GEOMETRY } from "../src/core/layout";

describe("Derived view heights", () => {
  it("makes Music 30% shorter while preserving the Agents hub", () => {
    expect(VIEW_LAYOUTS.overview.height).toBe(252);
    expect(VIEW_LAYOUTS.agents.height).toBe(360);
  });
  it("enforces updated minimum height for approval cards", () => {
    expect(APPROVAL_MIN_H).toBe(200);
    expect(approvalHeight(0)).toBe(200);
  });
  it("scales chatPromptHeight inside the landscape bounds", () => {
    expect(chatPromptHeight(0)).toBe(400);
    expect(chatPromptHeight(5)).toBe(300 + 5 * 28);
    expect(chatPromptHeight(100)).toBe(ORIENTATION_GEOMETRY.landscape.max.h);
  });
});
