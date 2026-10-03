// Tests for the chat's Markdown parser (src/core/markdown.ts). No framework:
//   node dev/test-markdown.mjs
import assert from "node:assert/strict";
import { parseMarkdown, parseInline } from "../src/core/markdown.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok  ${name}`);
}

test("inline spans", () => {
  assert.deepEqual(parseInline("a **b** `c` *d*"), [
    { t: "text", v: "a " }, { t: "b", c: [{ t: "text", v: "b" }] }, { t: "text", v: " " },
    { t: "code", v: "c" }, { t: "text", v: " " }, { t: "i", c: [{ t: "text", v: "d" }] },
  ]);
});

test("unmatched markers stay text", () => {
  assert.deepEqual(parseInline("2 * 3 and **half"), [{ t: "text", v: "2 * 3 and **half" }]);
});

test("only http(s) links become links", () => {
  assert.equal(parseInline("[x](https://a.b/c)")[0].t, "a");
  assert.equal(parseInline("[x](javascript:alert(1))")[0].t, "text");
  assert.equal(parseInline("[x](file:///c:/secret)")[0].t, "text");
});

test("code fences keep their text, even unclosed (streaming)", () => {
  const closed = parseMarkdown("hi\n```ts\nconst a = *1*;\n```\nbye");
  assert.deepEqual(closed.map((b) => b.t), ["p", "code", "p"]);
  assert.equal(closed[1].v, "const a = *1*;");
  assert.equal(closed[1].lang, "ts");
  const open = parseMarkdown("```\nline 1\nline 2");
  assert.deepEqual(open, [{ t: "code", lang: "", v: "line 1\nline 2" }]);
});

test("lists and quotes group their lines", () => {
  const b = parseMarkdown("- one\n- two\n\n1. a\n2) b\n\n> q1\n> q2");
  assert.deepEqual(b.map((x) => x.t), ["ul", "ol", "quote"]);
  assert.equal(b[0].items.length, 2);
  assert.equal(b[1].items.length, 2);
});

test("headings become one block and paragraphs keep line breaks", () => {
  const b = parseMarkdown("## Title\nline a\nline b");
  assert.deepEqual(b.map((x) => x.t), ["h", "p"]);
  assert.deepEqual(b[1].c, [{ t: "text", v: "line a\nline b" }]);
});

console.log(`\n${passed} passed`);
