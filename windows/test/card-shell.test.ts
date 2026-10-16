import "./setup-dom";
import { describe, it, expect } from "vitest";
import { createCardShell } from "../src/views/card-shell";

describe("CardShell template", () => {
  it("renders header title and body with proper wash class", () => {
    const body = document.createElement("div");
    body.textContent = "Body text";
    const shell = createCardShell({ title: "Test Card", wash: "amber", body });
    expect(shell.el.classList.contains("card-shell")).toBe(true);
    expect(shell.el.querySelector(".card-title")?.textContent).toBe("Test Card");
  });
});
