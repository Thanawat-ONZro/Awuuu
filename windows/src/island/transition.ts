// How the island moves between views: which way a view enters, where the tab
// highlight goes, and the keyframes for both. The direction logic has no DOM
// and is tested in node; `animateView` / `moveThumb` only touch Web Animations.

import type { IslandViewName } from "../core/layout";
import { MOTION } from "../core/anim";

/** The four header tabs, left to right. */
export const TAB_ORDER = ["agents", "prompt", "overview", "upload"] as const;
export type TabId = (typeof TAB_ORDER)[number];

/** The tab that is lit for a view, or null for views no tab owns (alerts, notes…). */
export function tabOf(view: IslandViewName): TabId | null {
  if (view === "overview" || view === "empty") return "overview";
  if (view === "diff") return "agents";
  return (TAB_ORDER as readonly string[]).includes(view) ? (view as TabId) : null;
}

/** "forward" enters from the right, "back" from the left, "up" rises from below (alerts). */
export type Direction = "forward" | "back" | "up" | "none";

export function directionBetween(from: IslandViewName, to: IslandViewName): Direction {
  if (from === to) return "none";
  const a = tabOf(from);
  const b = tabOf(to);
  if (a === null || b === null) return "up";
  if (a === b) return "none";
  return TAB_ORDER.indexOf(b) > TAB_ORDER.indexOf(a) ? "forward" : "back";
}

/** Pixels the entering view travels (the leaving one goes the other way). */
export function offsetFor(dir: Direction, distance = 14): { x: number; y: number } {
  switch (dir) {
    case "forward": return { x: distance, y: 0 };
    case "back": return { x: -distance, y: 0 };
    case "up": return { x: 0, y: distance };
    default: return { x: 0, y: 0 };
  }
}

const reduced = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Slides one view in or out. Reduced motion keeps only a short fade. */
export function animateView(el: HTMLElement, entering: boolean, dir: Direction) {
  if (typeof el.animate !== "function") return;
  el.getAnimations().forEach((a) => a.cancel());
  const { x, y } = offsetFor(reduced() ? "none" : dir);
  const from = entering ? { opacity: 0, transform: `translate(${x}px, ${y}px) scale(0.985)` } : { opacity: 1, transform: "none" };
  const to = entering ? { opacity: 1, transform: "none" } : { opacity: 0, transform: `translate(${-x}px, ${-y}px) scale(0.985)` };
  el.animate([from, to], {
    duration: reduced() ? MOTION.fast : entering ? MOTION.base : MOTION.fast,
    delay: entering && !reduced() ? 90 : 0,
    easing: entering ? MOTION.spring : MOTION.in,
    fill: entering ? "backwards" : "none",
  });
}

/** Moves the tab highlight; it stretches while it travels. */
export function moveThumb(thumb: HTMLElement, fromX: number, toX: number) {
  thumb.style.transform = `translateX(${toX}px)`;
  if (fromX === toX || reduced() || typeof thumb.animate !== "function") return;
  thumb.getAnimations().forEach((a) => a.cancel());
  const mid = (fromX + toX) / 2;
  thumb.animate(
    [
      { transform: `translateX(${fromX}px) scaleX(1)` },
      { transform: `translateX(${mid}px) scaleX(${1 + Math.min(0.6, Math.abs(toX - fromX) / 120)})`, offset: 0.45 },
      { transform: `translateX(${toX}px) scaleX(1)` },
    ],
    { duration: MOTION.base + 20, easing: MOTION.spring },
  );
}
