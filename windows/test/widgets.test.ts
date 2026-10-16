import "./setup-dom";
import { describe, it, expect } from "vitest";
import { createDateWidget, createTodoWidget } from "../src/views/widgets";

describe("Small Desktop Widgets", () => {
  it("renders formatted date and weekday", () => {
    const w = createDateWidget(new Date("2026-10-16T12:00:00"));
    expect(w.el.querySelector(".widget-date-day")?.textContent).toBeDefined();
  });
  it("manages interactive checklist items", () => {
    const todo = createTodoWidget();
    todo.addItem("Buy kibble");
    expect(todo.items.length).toBe(1);
    todo.toggleItem(0);
    expect(todo.items[0].done).toBe(true);
  });
});
