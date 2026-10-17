import { describe, it, expect } from "vitest";
import { VIEW_LAYOUTS, approvalHeight, chatPromptHeight, APPROVAL_MIN_H, ORIENTATION_GEOMETRY } from "../src/core/layout";

describe("Derived view heights", () => {
  it("keeps overview and agents aligned with hub default height", () => {
    expect(VIEW_LAYOUTS.overview.height).toBe(360);
    expect(VIEW_LAYOUTS.agents.height).toBe(360);
  });
  it("enforces updated minimum height for approval cards", () => {
    expect(APPROVAL_MIN_H).toBe(200);
    expect(approvalHeight(0)).toBe(200);
  });
  it("scales chatPromptHeight inside the landscape bounds", () => {
    const min = ORIENTATION_GEOMETRY.landscape.min.h;
    expect(chatPromptHeight(0)).toBe(min);
    expect(chatPromptHeight(5)).toBe(300 + 5 * 28);
    expect(chatPromptHeight(100)).toBe(ORIENTATION_GEOMETRY.landscape.max.h);
  });
});
