import "./setup-dom";
import { describe, it, expect } from "vitest";

const fs: {
  readFileSync(url: URL, enc: "utf8"): string;
} = await import("node:fs" as string);

describe("WS13: Tools panel widgets grow to content (D1 finish)", () => {
  const css = fs.readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

  it("drops height: 100% from .widget so widgets size to their content", () => {
    // .widget rule should not force height: 100%
    const widgetRuleMatch = css.match(/\.widget\s*\{([^}]*)\}/);
    expect(widgetRuleMatch).toBeDefined();
    const widgetBody = widgetRuleMatch![1];
    expect(widgetBody).not.toMatch(/\bheight:\s*100%/);
  });

  it("gives .widget a sensible min-height floor (64px) matching the row floor", () => {
    const widgetRuleMatch = css.match(/\.widget\s*\{([^}]*)\}/);
    expect(widgetRuleMatch).toBeDefined();
    const widgetBody = widgetRuleMatch![1];
    expect(widgetBody).toMatch(/min-height:\s*64px/);
  });

  it("prevents .dashboard-grid from shrinking via flex-shrink: 0 inside .overview-tools flex container", () => {
    const gridMatch = css.match(/\.dashboard-grid\s*\{([^}]*)\}/);
    expect(gridMatch).toBeDefined();
    const gridBody = gridMatch![1];
    expect(gridBody).toMatch(/flex-shrink:\s*0/);
    expect(gridBody).toMatch(/min-height:\s*100%/);
  });

  it("preserves content-sized row templates with 64px floor and scrolling panel", () => {
    expect(css).toMatch(/\.dashboard-grid\s*\{[^}]*grid-auto-rows:\s*minmax\(64px,\s*auto\)/);
    expect(css).toMatch(/\.dashboard-grid\s*\{[^}]*grid-template-rows:\s*minmax\(64px,\s*auto\)\s+minmax\(64px,\s*auto\)/);
    expect(css).toMatch(/\.overview-tools\s*\{[^}]*overflow-y:\s*auto/);
  });
});
