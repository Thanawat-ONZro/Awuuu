import "./setup-dom";
import { expect, it, vi } from "vitest";
import { Bridge } from "../src/core/bridge";
import { createShelfModuleHost } from "../src/views/modules/shelf";
import { createShelfSharing } from "../src/views/modules/shelf-sharing";
import { State } from "../src/core/state";

vi.mock("../src/core/bridge", () => ({ Bridge: {
  shelfList: vi.fn(), shelfPreview: vi.fn().mockResolvedValue(null), shelfRemove: vi.fn().mockResolvedValue(true),
  shelfStartDrag: vi.fn().mockResolvedValue(true),
} }));
vi.mock("../src/views/modules/clipboard", () => ({ createClipboardPanel: () => ({
  el: document.createElement("div"), controls: document.createElement("div"),
}) }));
vi.mock("../src/views/modules/shelf-sharing", () => ({ createShelfSharing: vi.fn(() => ({
  el: document.createElement("div"), canShare: () => true, open: vi.fn(), refresh: vi.fn(), dispose: vi.fn(),
})) }));

it("selects all without rebuilding the file tiles, shares the selection and deletes only selected paths", async () => {
  const files = [
    { name: "ชื่อไฟล์ต้นฉบับ (final).exe", path: "C:/shelf/one.exe", size: 12, addedAtMs: Date.now() },
    { name: "Second file.zip", path: "C:/shelf/two.zip", size: 18, addedAtMs: Date.now() },
  ];
  vi.mocked(Bridge.shelfList).mockResolvedValue(files);
  const host = createShelfModuleHost();
  await vi.waitFor(() => expect(host.el.querySelectorAll(".shelf-item").length).toBe(2));
  const first = host.el.querySelector(".shelf-item");
  expect(host.el.querySelector(".shelf-item-name")?.textContent).toBe(files[0].name);
  host.el.querySelector(".shelf-select-all")!.dispatchEvent(new Event("click"));
  expect(host.el.querySelector(".shelf-item")).toBe(first);
  expect(Array.from(host.el.querySelectorAll<HTMLInputElement>(".shelf-item-check")).every(item => item.checked)).toBe(true);
  host.el.querySelector(".shelf-share-selected")!.dispatchEvent(new Event("click"));
  const sharing = vi.mocked(createShelfSharing).mock.results[0].value;
  expect(sharing.open).toHaveBeenCalledWith(files);
  const tile = host.el.querySelector(".shelf-item")!;
  const down = new Event("pointerdown");
  Object.defineProperties(down, { button: { value: 0 }, clientX: { value: 10 }, clientY: { value: 10 } });
  tile.dispatchEvent(down);
  const move = new Event("pointermove");
  Object.defineProperties(move, { buttons: { value: 1 }, clientX: { value: 30 }, clientY: { value: 10 } });
  tile.dispatchEvent(move);
  expect(Bridge.shelfStartDrag).toHaveBeenCalledWith(files.map(file => file.path));
  expect(State.fileDragOut).toBe(true);
  await Promise.resolve(); await Promise.resolve();
  expect(State.fileDragOut).toBe(false);
  vi.mocked(Bridge.shelfList).mockResolvedValue([]);
  host.el.querySelector(".shelf-clear-btn")!.dispatchEvent(new Event("click"));
  await vi.waitFor(() => expect(Bridge.shelfRemove).toHaveBeenCalledTimes(2));
  expect(Bridge.shelfRemove).toHaveBeenCalledWith(files[0].path);
  expect(Bridge.shelfRemove).toHaveBeenCalledWith(files[1].path);
  await vi.waitFor(() => expect(host.el.querySelectorAll(".shelf-item").length).toBe(0));
  host.dispose?.();
});

it("retries a failed file icon on refresh without replacing its tile", async () => {
  const file = { name: "app.exe", path: "C:/shelf/app.exe", size: 1, addedAtMs: Date.now() };
  vi.mocked(Bridge.shelfList).mockResolvedValue([file]);
  vi.mocked(Bridge.shelfPreview).mockReset().mockResolvedValueOnce(null).mockResolvedValue("data:image/png;base64,test");
  const host = createShelfModuleHost();
  await vi.waitFor(() => expect(Bridge.shelfPreview).toHaveBeenCalledTimes(1));
  const tile = host.el.querySelector(".shelf-item");
  const realNow = Date.now.bind(Date);
  const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 4000);
  try {
    await host.refresh?.();
    await vi.waitFor(() => expect(host.el.querySelector(".shelf-preview-img")).not.toBeNull());
    expect(host.el.querySelector(".shelf-item")).toBe(tile);
  } finally { clock.mockRestore(); host.dispose?.(); }
});
