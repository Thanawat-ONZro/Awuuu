// Tests for the git snapshot diff (src/island/snapshot.ts).  node dev/test-snapshot.mjs
import assert from "node:assert/strict";
import { diffSnapshots } from "../src/island/snapshot.ts";

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`ok  ${name}`); }

const f = (path, code = " M", size = 10, mtime = 1) => ({ path, code, size, mtime });

test("new, changed and deleted files are reported; untouched ones are not", () => {
  const before = { head: "a", files: [f("C:/p/same.ts"), f("C:/p/dirty.ts", " M", 10, 1)] };
  const after = { head: "a", files: [f("C:/p/same.ts"), f("C:/p/dirty.ts", " M", 12, 5), f("C:/p/new.ts", "??"), f("C:/p/gone.ts", " D")] };
  assert.deepEqual(diffSnapshots(before, after), [
    { path: "C:/p/dirty.ts", change: "edit" },
    { path: "C:/p/new.ts", change: "write" },
    { path: "C:/p/gone.ts", change: "delete" },
  ]);
});

test("a file that was already dirty counts only if it changed again", () => {
  const same = { head: "a", files: [f("C:/p/x.ts", " M", 10, 1)] };
  assert.deepEqual(diffSnapshots(same, same), []);
});

test("paths compare ignoring case and slash direction", () => {
  const before = { head: "a", files: [f("C:\\P\\x.ts", " M", 10, 1)] };
  const after = { head: "a", files: [f("c:/p/x.ts", " M", 10, 1)] };
  assert.deepEqual(diffSnapshots(before, after), []);
});

test("commits made in between add their files, once", () => {
  const before = { head: "a", files: [] };
  const after = { head: "b", files: [f("C:/p/left.ts", "??")] };
  const committed = [f("C:/p/done.ts", "A "), f("C:/p/left.ts", "M ")];
  assert.deepEqual(diffSnapshots(before, after, committed), [
    { path: "C:/p/left.ts", change: "write" },
    { path: "C:/p/done.ts", change: "write" },
  ]);
  // the same HEAD ignores `committed`
  assert.deepEqual(diffSnapshots({ head: "a", files: [] }, { head: "a", files: [] }, committed), []);
});

test("a file git stops listing is not reported", () => {
  assert.deepEqual(diffSnapshots({ head: "a", files: [f("C:/p/x.ts")] }, { head: "a", files: [] }), []);
});

console.log(`\n${passed} passed`);
