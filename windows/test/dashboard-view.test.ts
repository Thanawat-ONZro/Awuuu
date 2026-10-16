import { describe, it, expect } from "vitest";
import { VIEW_LAYOUTS } from "../src/core/layout";

describe("Dashboard Island View", () => {
  it("registers dashboard in VIEW_LAYOUTS with default compact bounds", () => {
    expect((VIEW_LAYOUTS as Record<string, unknown>)["dashboard"]).toBeDefined();
    expect(VIEW_LAYOUTS["dashboard"].height).toBe(260);
  });
});
