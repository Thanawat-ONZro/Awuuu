import { describe, it, expect } from "vitest";
import { VIEW_LAYOUTS, approvalHeight, chatPromptHeight, APPROVAL_MIN_H } from "../src/core/layout";

describe("Derived view heights", () => {
  it("keeps overview and agents aligned with hub default height", () => {
    expect(VIEW_LAYOUTS.overview.height).toBe(300);
    expect(VIEW_LAYOUTS.agents.height).toBe(300);
  });
  it("enforces updated minimum height for approval cards", () => {
    expect(APPROVAL_MIN_H).toBe(180);
    expect(approvalHeight(0)).toBe(220);
  });
  it("scales chatPromptHeight within updated bounds", () => {
    expect(chatPromptHeight(0)).toBe(260);
    expect(chatPromptHeight(4)).toBe(360);
  });
});
