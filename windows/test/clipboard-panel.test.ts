import "./setup-dom";
import { expect, it, vi } from "vitest";
import { Bridge, onEvent } from "../src/core/bridge";
import { createClipboardPanel } from "../src/views/modules/clipboard";

vi.mock("../src/core/bridge", () => ({
  Bridge: { clipboardHistory: vi.fn(), clipboardCopy: vi.fn(), clipboardRemove: vi.fn(), clipboardEnable: vi.fn() },
  onEvent: vi.fn(),
}));

it("renders an externally copied item when the Windows history event arrives", async () => {
  let update: () => void = () => {};
  vi.mocked(onEvent).mockImplementation(async (_name, handler) => {
    update = () => handler(undefined as never);
    return () => {};
  });
  vi.mocked(Bridge.clipboardHistory).mockResolvedValue({ ready: true, enabled: true, entries: [] });
  const panel = createClipboardPanel();
  await vi.waitFor(() => expect(panel.el.querySelector(".clipboard-empty")).not.toBeNull());
  vi.mocked(Bridge.clipboardHistory).mockResolvedValue({ ready: true, enabled: true, entries: [
    { id: 1, kind: "text", text: "Copied outside Awuuu", preview: null, addedAtMs: Date.now() },
  ] });
  update();
  await vi.waitFor(() => expect(panel.el.querySelector(".clipboard-text")?.textContent).toBe("Copied outside Awuuu"));
  expect(panel.el.querySelector(".clipboard-empty")).toBeNull();
  panel.dispose?.();
});
