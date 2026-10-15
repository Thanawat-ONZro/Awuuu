import { describe, expect, it } from "vitest";
import { directionBetween, offsetFor, tabOf } from "../src/island/transition";

describe("view transitions", () => {
  it("maps views to the tab that is lit", () => {
    expect(tabOf("overview")).toBe("overview");
    expect(tabOf("empty")).toBe("overview");
    expect(tabOf("agents")).toBe("agents");
    expect(tabOf("prompt")).toBe("prompt");
    expect(tabOf("approval")).toBeNull();
  });

  it("goes forward to a tab on the right and back to one on the left", () => {
    expect(directionBetween("agents", "prompt")).toBe("forward");
    expect(directionBetween("agents", "upload")).toBe("forward");
    expect(directionBetween("upload", "overview")).toBe("back");
    expect(directionBetween("prompt", "agents")).toBe("back");
  });

  it("rises for alerts and stays put inside one tab", () => {
    expect(directionBetween("agents", "approval")).toBe("up");
    expect(directionBetween("approval", "overview")).toBe("up");
    expect(directionBetween("overview", "empty")).toBe("none");
    expect(directionBetween("prompt", "prompt")).toBe("none");
  });

  it("moves the entering view from the side it comes from", () => {
    expect(offsetFor("forward")).toEqual({ x: 14, y: 0 });
    expect(offsetFor("back")).toEqual({ x: -14, y: 0 });
    expect(offsetFor("up")).toEqual({ x: 0, y: 14 });
    expect(offsetFor("none")).toEqual({ x: 0, y: 0 });
  });
});
