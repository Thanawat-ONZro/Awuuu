import "./setup-dom";
import { afterEach, expect, it, vi } from "vitest";
import { Bridge } from "../src/core/bridge";
import { Mover, type MoveHost } from "../src/island/move";

vi.mock("../src/core/bridge", () => ({ IS_TAURI: true, Bridge: {
  islandCarryBegin: vi.fn(), islandCarryStep: vi.fn(), islandOverlayEnd: vi.fn().mockResolvedValue(undefined),
  islandDockRect: vi.fn(), log: vi.fn(),
} }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("restores native geometry and releases the move guard after an IPC failure", async () => {
  const events = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("window", events);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.mocked(Bridge.islandCarryBegin).mockResolvedValue([1, 0, 0, 1920, 1040, 0, 0, 1920, 1080, 400, 0, 700, 10]);
  vi.mocked(Bridge.islandCarryStep).mockResolvedValue(null);
  const host: MoveHost = {
    rect: () => ({ x: 0, y: 0, w: 800, h: 360 }),
    currentGeometry: vi.fn(), applyDockedLayout: vi.fn(), setMoveOverride: vi.fn(),
    enterMove: vi.fn(() => ({ wasExpanded: true, view: "shelf" })), leaveMove: vi.fn(),
    startLiquid: vi.fn(), stepLiquid: vi.fn(), applyMorph: vi.fn(), getDockedTarget: vi.fn(), clearLiquid: vi.fn(),
  };
  const root = document.createElement("div");
  const handle = Object.assign(document.createElement("div"), {
    setPointerCapture: vi.fn(), hasPointerCapture: () => false,
  });
  const mover = new Mover(host, root);
  for (let attempt = 0; attempt < 2; attempt++) {
    const press = { button: 0, pointerId: 1, screenX: 0, screenY: 0,
      preventDefault() {}, stopPropagation() {} } as PointerEvent;
    const pending = mover.begin(press, handle);
    const move = new Event("pointermove");
    Object.defineProperties(move, { screenX: { value: 20 }, screenY: { value: 0 } });
    events.dispatchEvent(move);
    await pending;
    expect(root.classList.contains("moving")).toBe(false);
  }
  expect(Bridge.islandCarryBegin).toHaveBeenCalledTimes(2);
  expect(Bridge.islandOverlayEnd).toHaveBeenCalledWith("", 0);
  expect(host.leaveMove).toHaveBeenCalledTimes(2);
  expect(host.setMoveOverride).toHaveBeenLastCalledWith(null);
});
