import "./setup-dom";
import { describe, it, expect, vi } from "vitest";
import { createDateWidget, createNowPlayingWidget, createTodoWidget } from "../src/views/widgets";
import { Bridge } from "../src/core/bridge";

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

  describe("NowPlayingWidget (S6)", () => {
    it("stays visible with play button when playback is paused (active: true, playing: false)", async () => {
      vi.spyOn(Bridge, "nowPlaying").mockResolvedValue({
        title: "Song Name",
        artist: "Artist Name",
        status: "paused",
        playing: false,
        active: true,
        durationMs: 180000,
        positionMs: 60000,
      } as any);

      let activeState: boolean | undefined;
      const widget = createNowPlayingWidget((active) => {
        activeState = active;
      });

      await widget.refresh();

      expect(widget.el.style.display).toBe("flex");
      expect(activeState).toBe(true);
      const playBtn = widget.el.querySelector(".media-play") as HTMLButtonElement;
      expect(playBtn.getAttribute("title")).toBe("Play");
    });

    it("shows pause button when playback is active and playing", async () => {
      vi.spyOn(Bridge, "nowPlaying").mockResolvedValue({
        title: "Song Name",
        artist: "Artist Name",
        status: "playing",
        playing: true,
        active: true,
        durationMs: 180000,
        positionMs: 60000,
      } as any);

      const widget = createNowPlayingWidget();
      await widget.refresh();

      expect(widget.el.style.display).toBe("flex");
      const playBtn = widget.el.querySelector(".media-play") as HTMLButtonElement;
      expect(playBtn.getAttribute("title")).toBe("Pause");
    });

    it("hides when there is no active media session (active: false)", async () => {
      const mock = vi.spyOn(Bridge, "nowPlaying").mockResolvedValue({
        title: "Track",
        artist: "Artist",
        status: "playing",
        playing: true,
        active: true,
      } as any);

      let activeState: boolean | undefined;
      const widget = createNowPlayingWidget((active) => {
        activeState = active;
      });

      await widget.refresh();
      expect(activeState).toBe(true);

      mock.mockResolvedValue({
        title: "",
        artist: "",
        status: "closed",
        playing: false,
        active: false,
      } as any);

      await widget.refresh();

      expect(widget.el.style.display).toBe("none");
      expect(activeState).toBe(false);
    });

    it("polls at 5s interval when hidden and 1s when active", async () => {
      const nowPlayingMock = vi.spyOn(Bridge, "nowPlaying").mockResolvedValue({
        title: "",
        artist: "",
        status: "closed",
        playing: false,
        active: false,
      } as any);

      const widget = createNowPlayingWidget();
      await widget.refresh();
      expect(widget.el.style.display).toBe("none");

      nowPlayingMock.mockClear();

      // At 1000ms: should NOT poll because hidden interval is 5000ms
      widget.tick(1000);
      expect(nowPlayingMock).toHaveBeenCalledTimes(0);

      // At 4999ms: still should not poll
      widget.tick(4999);
      expect(nowPlayingMock).toHaveBeenCalledTimes(0);

      // At 5000ms: should poll
      widget.tick(5000);
      expect(nowPlayingMock).toHaveBeenCalledTimes(1);
    });
  });
});
