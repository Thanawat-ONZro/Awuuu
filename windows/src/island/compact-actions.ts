import type { IslandMode } from "../core/layout";

/** A quick action must receive its click before the compact island expands. */
export function isCompactMediaButtonPress(mode: IslandMode, target: EventTarget | null): boolean {
  return mode === "compact" && target instanceof Element
    && target.closest(".compact-media-btn") !== null;
}
