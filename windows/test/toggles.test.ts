import "./setup-dom";
import { describe, expect, it, vi } from "vitest";
import { createTogglesModuleHost } from "../src/views/modules/toggles";
import { Bridge } from "../src/core/bridge";

describe("createTogglesModuleHost", () => {
  it("renders 3 toggles: Bluetooth, Wi-Fi, and Never Sleep (no DND)", () => {
    const host = createTogglesModuleHost();
    const btns = host.el.querySelectorAll(".toggle-btn");
    expect(btns.length).toBe(3);

    const classes = Array.from(btns).map((b) => b.className);
    expect(classes.some((c) => c.includes("toggle-bluetooth"))).toBe(true);
    expect(classes.some((c) => c.includes("toggle-wifi"))).toBe(true);
    expect(classes.some((c) => c.includes("toggle-never_sleep"))).toBe(true);
    expect(classes.some((c) => c.includes("toggle-dnd"))).toBe(false);
  });

  it("updates active classes on refresh based on Bridge states", async () => {
    vi.spyOn(Bridge, "toggleGet").mockImplementation(async (kind: string) => {
      if (kind === "bluetooth") return true;
      if (kind === "wifi") return false;
      if (kind === "never_sleep") return true;
      return false;
    });

    const host = createTogglesModuleHost();
    await host.refresh?.();

    const bt = host.el.querySelector(".toggle-bluetooth");
    const wf = host.el.querySelector(".toggle-wifi");
    const ns = host.el.querySelector(".toggle-never_sleep");

    expect(bt?.classList.contains("is-active")).toBe(true);
    expect(wf?.classList.contains("is-active")).toBe(false);
    expect(ns?.classList.contains("is-active")).toBe(true);

    vi.restoreAllMocks();
  });
});
