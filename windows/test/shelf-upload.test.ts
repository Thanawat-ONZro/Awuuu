import "./setup-dom";
import { expect, it, vi } from "vitest";
import { buildChoose } from "../src/views/upload";
import type { ViewActions } from "../src/views/views";
import { State } from "../src/core/state";
import { Bridge, type ShelfFile } from "../src/core/bridge";
import { t } from "../src/i18n/i18n";

it("ignores a second Put on Shelf click while copying and passes the original name", async () => {
  let finish!: (file: ShelfFile) => void;
  const add = vi.spyOn(Bridge, "shelfAdd").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  State.droppedFiles = [{ id: 91, name: "original.exe", path: "C:/inbox/original (2).exe", size: 1, key: "original" }];
  const actions = { setView: vi.fn(), showNote: vi.fn() } as unknown as ViewActions;
  const view = buildChoose(actions);
  const button = Array.from(view.el.querySelectorAll(".btn")).find(item => item.textContent === t("Put on Shelf"))!;
  button.dispatchEvent(new Event("click"));
  button.dispatchEvent(new Event("click"));
  expect(add).toHaveBeenCalledTimes(1);
  expect(add).toHaveBeenCalledWith("C:/inbox/original (2).exe", "original.exe");
  finish({ name: "original.exe", path: "C:/shelf/original.exe", size: 1, addedAtMs: Date.now() });
  await vi.waitFor(() => expect(actions.setView).toHaveBeenCalledWith("shelf"));
  expect(State.droppedFiles).toEqual([]);
  add.mockRestore();
});
