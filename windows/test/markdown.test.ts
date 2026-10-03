import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeUrl } from "../src/views/markdown";

describe("safeUrl", () => {
  it("lets only web links through", () => {
    expect(safeUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeUrl("http://x.test")).toBe("http://x.test/");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("file:///C:/Windows")).toBeNull();
    expect(safeUrl("data:text/html,<b>")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
  });
});

describe("parseInline", () => {
  it("reads bold, italic and code", () => {
    expect(parseInline("a **b** *c* `d*e*`")).toEqual([
      { t: "text", v: "a " },
      { t: "bold", c: [{ t: "text", v: "b" }] },
      { t: "text", v: " " },
      { t: "italic", c: [{ t: "text", v: "c" }] },
      { t: "text", v: " " },
      { t: "code", v: "d*e*" },
    ]);
  });

  it("keeps the words of an unsafe link and drops its target", () => {
    expect(parseInline("[click](javascript:alert(1))")).toEqual([{ t: "text", v: "click" }, { t: "text", v: ")" }]);
    expect(parseInline("[docs](https://x.test/d)")).toEqual([{ t: "link", href: "https://x.test/d", c: [{ t: "text", v: "docs" }] }]);
  });

  it("links bare web addresses without the trailing period", () => {
    const out = parseInline("see https://x.test/a.");
    expect(out[1]).toEqual({ t: "link", href: "https://x.test/a", c: [{ t: "text", v: "https://x.test/a" }] });
    expect(out[2]).toEqual({ t: "text", v: "." });
  });

  it("leaves snake_case and lone stars alone", () => {
    expect(parseInline("my_var_name and 2 * 3")).toEqual([{ t: "text", v: "my_var_name and 2 * 3" }]);
  });

  it("treats HTML as plain text", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ t: "text", v: "<img src=x onerror=alert(1)>" }]);
  });
});

describe("parseMarkdown", () => {
  it("reads paragraphs, lists, headings and quotes", () => {
    const blocks = parseMarkdown("# Title\n\nHello\nworld\n\n- a\n- b\n\n1. one\n2. two\n\n> quoted");
    expect(blocks.map((b) => b.t)).toEqual(["h", "p", "ul", "ol", "quote"]);
    expect(blocks[1]).toEqual({ t: "p", c: [{ t: "text", v: "Hello\nworld" }] });
    expect(blocks[2]).toMatchObject({ items: [[{ v: "a" }], [{ v: "b" }]] });
  });

  it("keeps code blocks verbatim, even unclosed while streaming", () => {
    expect(parseMarkdown("```ts\nconst a = **1**;\n```")).toEqual([{ t: "code", lang: "ts", v: "const a = **1**;" }]);
    expect(parseMarkdown("text\n```\npartial")).toEqual([
      { t: "p", c: [{ t: "text", v: "text" }] },
      { t: "code", lang: "", v: "partial" },
    ]);
  });

  it("reads Thai text as is", () => {
    expect(parseMarkdown("สวัสดีครับ **วันนี้** ประชุม")).toEqual([
      { t: "p", c: [{ t: "text", v: "สวัสดีครับ " }, { t: "bold", c: [{ t: "text", v: "วันนี้" }] }, { t: "text", v: " ประชุม" }] },
    ]);
  });
});
