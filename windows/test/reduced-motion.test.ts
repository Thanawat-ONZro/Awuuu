import { describe, expect, it } from "vitest";

// Vitest does not process CSS imports (?raw comes back empty), so read the files
// as text. The project tsconfig has no @types/node, hence the loose typing.
const fs: {
  readFileSync(url: URL, enc: "utf8"): string;
  readdirSync(url: URL): string[];
} = await import("node:fs" as string);

const src = new URL("../src/", import.meta.url);
const css = (dir: string) =>
  fs.readdirSync(new URL(dir, src)).filter((f) => f.endsWith(".css")).map((f) => `${dir}${f}`);

// Every stylesheet that might own motion. Each one that animates must override it.
const files = ["style.css", ...css("app/"), ...css("views/"), "ui/select.css", "settings/settings.css"];
const sheets = Object.fromEntries(files.map((f) => [f, fs.readFileSync(new URL(f, src), "utf8")]));

// Keyframes, or a transition that moves something with transform.
const MOVES = /@keyframes|transition:[^;]*\btransform\b/;
const REDUCE = /@media\s*\(prefers-reduced-motion:\s*reduce\)/;

describe("reduced motion coverage", () => {
  const moving = files.filter((f) => MOVES.test(sheets[f]));

  it("finds the stylesheets that animate", () => {
    expect(moving).toEqual(
      expect.arrayContaining(["style.css", "app/dashboard.css", "app/integrations.css", "ui/select.css", "settings/settings.css"]),
    );
  });

  for (const file of moving) {
    it(`${file} overrides motion under prefers-reduced-motion: reduce`, () => {
      expect(sheets[file]).toMatch(REDUCE);
    });
  }
});
